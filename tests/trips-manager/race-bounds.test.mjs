import '../storage/indexeddb/support/setup-fake-indexeddb.mjs'
import { installMinimalDOMParser } from '../support/minimal-dom-parser.mjs'
installMinimalDOMParser()
import test from 'node:test'
import assert from 'node:assert/strict'
import { applyRaceBounds, buildRaceCourse, raceCourseMetrics } from '../../src/analysis/race-bounds.ts'
import { importGpxTrip } from '../../src/import/gpx/import-gpx-trip.ts'
import { buildGpxXml, toGpxImportFile } from '../import/gpx/support/fixtures.mjs'
import { createIdFactory, fixedNow, openImportTestDatabase } from '../import/gpx/support/run-import.mjs'
import { createTripRepository } from '../../src/storage/indexeddb/trip-repository.ts'
import { createSourceFileRepository } from '../../src/storage/indexeddb/source-file-repository.ts'
import { loadTripEditDraft, editGpxTrip } from '../../src/trips-manager/trip-editor.ts'
import { createTripBackup, prepareTripBackupRestore, restorePreparedTripBackup } from '../../src/backup/trip-backup.ts'
import { validateTripBundle } from '../../src/trip-core/index.ts'
import { renderRaceCourseCard } from '../../src/ui/trips/race-bounds-view.ts'

const NOW = '2027-02-01T08:00:00.000Z'
const file = (name='course', latitude=45) => toGpxImportFile(buildGpxXml({ tracks: [{ name, segments: [Array.from({ length: 101 }, (_, i) => ({ lat: latitude + i * .001, lon: 6, ele: 200 + i * 2 }))] }] }), `${name}.gpx`)
async function setup(mode='league') {
  const database = await openImportTestDatabase()
  const source = file()
  const result = await importGpxTrip({ database, files: [source], options: { tripId: 'race', slug: 'race', name: 'Race', organizationMode: mode, startDate: '2027-05-10', timezone: 'Europe/Brussels', importedAt: NOW, engineVersion: 'test' }, dayStructure: [{ kind: 'ride', eventDate: '2027-05-10', departureTime: '08:00' }], idFactory: createIdFactory('race'), now: fixedNow() })
  assert.equal(result.ok, true, result.error?.message)
  return { database, bundle: result.bundle, source }
}
function bounded(bundle, startOffsetM=1000, finishOffsetM=5000) {
  const course = buildRaceCourse(bundle, bundle.stages[0])
  return applyRaceBounds(bundle, bundle.stages[0].id, { routeFingerprint: course.fingerprint, startOffsetM, finishOffsetM }, course.fingerprint, NOW)
}

for (const mode of ['league', 'tour']) test(`${mode}: boundaries clip interpolated points while full metrics and all original collections remain intact`, async () => {
  const { database, bundle } = await setup(mode)
  try {
    const next = bounded(bundle)
    const course = buildRaceCourse(next, next.stages[0])
    assert.equal(course.status, 'bounded')
    assert.ok(course.geometry[0].latitude > bundle.routes[0].geometry.full[0].latitude)
    assert.ok(course.geometry.at(-1).latitude < bundle.routes[0].geometry.full.at(-1).latitude)
    for (const key of ['routes', 'sourceFiles', 'weather', 'settings', 'days', 'climbs', 'routePoints', 'practicalPlaces']) assert.equal(next[key], bundle[key])
    for (const key of ['distanceKm', 'elevationGainM', 'movingDurationSeconds', 'totalDurationSeconds']) assert.equal(next.stages[0][key], bundle.stages[0][key])
    assert.equal(validateTripBundle(next).ok, true)
    const reset = applyRaceBounds(next, next.stages[0].id, null, course.fingerprint, NOW)
    assert.equal(reset.stages[0].raceBounds, undefined)
    assert.equal(buildRaceCourse(reset, reset.stages[0]).status, 'full')
  } finally { database.close() }
})

test('a short selection inside one sparse GPX segment has interpolated endpoints and correct altitude delta', async () => {
  const { database, bundle } = await setup()
  try {
    const points = [{ latitude: 45, longitude: 6, altitudeM: 100 }, { latitude: 45.1, longitude: 6, altitudeM: 300 }]
    const sparse = { ...bundle, routes: [{ ...bundle.routes[0], geometry: { ...bundle.routes[0].geometry, full: points } }] }
    const next = bounded(sparse, 1000, 2000)
    const course = buildRaceCourse(next, next.stages[0])
    assert.equal(course.geometry.length, 2)
    assert.ok(Math.abs(course.geometry[0].altitudeM - (100 + 200 / course.indexed.lengthKm)) < .001)
    const metrics = raceCourseMetrics(course.geometry)
    assert.ok(metrics.elevationGainM > 17 && metrics.elevationGainM < 19)
    assert.equal(metrics.elevationLossM, 0)
  } finally { database.close() }
})

test('a repeated route location is selected by its own occurrence along the source chainage', async () => {
  const { database, bundle } = await setup()
  try {
    const a = { latitude: 45, longitude: 6, altitudeM: 100 }, b = { latitude: 45.01, longitude: 6, altitudeM: 200 }
    const route = { ...bundle.routes[0], geometry: { ...bundle.routes[0].geometry, full: [a,b,a,b,a] } }
    const loop = { ...bundle, routes: [route] }
    const initial = buildRaceCourse(loop, loop.stages[0])
    const leg = initial.indexed.lengthKm * 1000 / 4
    const next = bounded(loop, 2 * leg, 4 * leg)
    const course = buildRaceCourse(next, next.stages[0])
    assert.deepEqual(course.geometry, [a,b,a])
    assert.equal(course.bounds.startOffsetM, 2 * leg)
    assert.notEqual(course.bounds.startOffsetM, 0)
  } finally { database.close() }
})

test('altitude gaps never create a fictitious ascent and absent altitude remains unknown', () => {
  const geometry = [100,100,null,900,900].map((altitudeM,i) => ({ latitude: 45+i*.001, longitude: 6, altitudeM }))
  assert.deepEqual(raceCourseMetrics(geometry), { elevationGainM: 0, elevationLossM: 0 })
  assert.deepEqual(raceCourseMetrics(geometry.map(point => ({ ...point, altitudeM: null }))), { elevationGainM: null, elevationLossM: null })
})

test('negative, inverted, empty, non-finite and out-of-trace ranges cannot replace a saved course', async () => {
  const { database, bundle } = await setup()
  try {
    const repository = createTripRepository(database)
    const next = bounded(bundle), fingerprint = next.stages[0].raceBounds.routeFingerprint
    await repository.saveTripBundle(next)
    for (const [startOffsetM, finishOffsetM] of [[-1,500], [500,100], [100,100], [NaN,100], [0,Infinity], [0,1e8]]) {
      await assert.rejects(repository.updateTripBundle('race', latest => applyRaceBounds(latest, latest.stages[0].id, { routeFingerprint: fingerprint, startOffsetM, finishOffsetM }, fingerprint, NOW)))
      assert.deepEqual((await repository.loadTripBundle('race')).stages, next.stages)
    }
    const forged = structuredClone(next); forged.stages[0].raceBounds.startOffsetM = -1
    assert.equal(validateTripBundle(forged).ok, false)
  } finally { database.close() }
})

test('save guards the latest route fingerprint and does not resurrect a removed stage or modify a Voyage', async () => {
  const { database, bundle } = await setup()
  try {
    const next = bounded(bundle), bounds = next.stages[0].raceBounds
    const changed = { ...bundle, sourceFiles: bundle.sourceFiles.map(file => ({ ...file, sha256: '0'.repeat(64) })) }
    assert.throws(() => applyRaceBounds(changed, next.stages[0].id, bounds, bounds.routeFingerprint, NOW), /parcours a changé/)
    assert.throws(() => applyRaceBounds(bundle, 'missing', bounds, bounds.routeFingerprint, NOW))
    const voyage = { ...bundle, settings: { ...bundle.settings, global: { ...bundle.settings.global, raceMode: false, organizationMode: 'voyage' } } }
    assert.equal(buildRaceCourse(voyage, voyage.stages[0]), null)
    assert.throws(() => applyRaceBounds(voyage, next.stages[0].id, bounds, bounds.routeFingerprint, NOW))
  } finally { database.close() }
})

test('full backup/restore preserves course limits and exact original GPX payload', async () => {
  const { database, bundle, source } = await setup()
  try {
    const next = bounded(bundle), repository = createTripRepository(database)
    await repository.saveTripBundle(next)
    assert.deepEqual((await repository.loadTripBundle('race')).stages, next.stages)
    const backup = await createTripBackup(database, NOW)
    const prepared = await prepareTripBackupRestore(backup.file)
    const restored = await restorePreparedTripBackup(database, prepared, createIdFactory('copy'), NOW)
    const copy = await repository.loadTripBundle(restored[0])
    assert.deepEqual(copy.stages[0].raceBounds, next.stages[0].raceBounds)
    assert.equal(buildRaceCourse(copy, copy.stages[0]).status, 'bounded')
    const payload = await createSourceFileRepository(database).getSourceFilePayload(copy.metadata.id, copy.sourceFiles[0].id)
    const text = payload.content instanceof Blob ? await payload.content.text() : new TextDecoder().decode(payload.content)
    assert.equal(text, new TextDecoder().decode(source.bytes))
  } finally { database.close() }
})

test('structural edits preserve limits on retained courses, and replacement GPX keeps them explicitly stale', async () => {
  const { database, bundle } = await setup()
  try {
    const next = bounded(bundle), repository = createTripRepository(database)
    await repository.saveTripBundle(next)
    const draft = await loadTripEditDraft(database, 'race')
    const edited = await editGpxTrip({ database, tripId: 'race', slots: [...draft.slots.map(slot => ({ ...slot, eventDate: '2027-06-01', customName: 'Renamed' })), { kind: 'ride', existingDayId: null, existingSourceFileId: null, file: file('earlier',46), eventDate: '2027-05-01', departureTime: '09:00' }], idFactory: createIdFactory('edit'), now: () => NOW })
    assert.equal(edited.ok, true, edited.message)
    const retained = edited.bundle.stages.find(stage => stage.id === next.stages[0].id)
    assert.deepEqual(retained.raceBounds, next.stages[0].raceBounds)
    assert.equal(buildRaceCourse(edited.bundle, retained).status, 'bounded')
    const newDraft = await loadTripEditDraft(database, 'race')
    const replaced = await editGpxTrip({ database, tripId: 'race', slots: newDraft.slots.map(slot => slot.existingDayId === retained.dayId ? { ...slot, existingSourceFileId: null, file: file('replacement',47) } : slot), idFactory: createIdFactory('replace'), now: () => NOW })
    assert.equal(replaced.ok, true, replaced.message)
    const changed = replaced.bundle.stages.find(stage => stage.dayId === retained.dayId)
    assert.deepEqual(changed.raceBounds, next.stages[0].raceBounds)
    const course = buildRaceCourse(replaced.bundle, changed)
    assert.equal(course.status, 'stale')
    assert.equal(course.geometry, null)
    assert.equal(validateTripBundle(replaced.bundle).ok, true)
    const markup = renderRaceCourseCard(course, changed)
    assert.match(markup, /redéfinissez/)
    assert.match(markup, /data-race-distance>—/)
    const reset = applyRaceBounds(replaced.bundle, changed.id, null, course.fingerprint, NOW)
    assert.equal(buildRaceCourse(reset, reset.stages.find(stage => stage.id === changed.id)).status, 'full')
  } finally { database.close() }
})
