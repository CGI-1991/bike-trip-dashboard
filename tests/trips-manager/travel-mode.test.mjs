import '../storage/indexeddb/support/setup-fake-indexeddb.mjs'
import { installMinimalDOMParser } from '../support/minimal-dom-parser.mjs'

installMinimalDOMParser()

import assert from 'node:assert/strict'
import test from 'node:test'

import { selectTravelMode, validateTripBundle } from '../../src/trip-core/index.ts'
import { applyTripPreferences, tripPreferencesUpdateIsNoop, updateTripPreferences, validateTripPreferencesUpdate } from '../../src/trips-manager/trip-preferences.ts'
import { createTripRepository } from '../../src/storage/indexeddb/trip-repository.ts'
import { createTripBackup, prepareTripBackupRestore, restorePreparedTripBackup } from '../../src/backup/trip-backup.ts'
import { createGenericTripBundle } from '../trip-core/support/generic-trip-fixture.mjs'
import { openTestDatabase } from '../storage/indexeddb/support/open-test-database.mjs'
import { buildGpxXml, toGpxImportFile } from '../import/gpx/support/fixtures.mjs'
import { runImport } from '../import/gpx/support/run-import.mjs'
import { createLinkedTripBundle } from './support/linked-trip-fixture.mjs'
import { computeRideArrivalEta } from '../../src/trips-manager/trip-day-temporal-state.ts'
import { dayDepartureTime } from '../../src/trips-manager/linked-stages.ts'

const UPDATED = '2027-02-01T10:00:00.000Z'

for (const departure of ['06:00', '18:00']) test(`a walking mode change resolves linked departures or reports the midnight overflow (${departure})`, async () => {
  const database = await openTestDatabase()
  try {
    const repository = createTripRepository(database)
    const bundle = createLinkedTripBundle({ rideCount: 2, links: [1] })
    bundle.settings.global.raceMode = true
    bundle.settings.days = bundle.settings.days.map((entry, index) => ({ ...entry, departureTime: index === 0 ? departure : '08:00' }))
    await repository.saveTripBundle(bundle)
    const result = await updateTripPreferences({ database, tripId: bundle.metadata.id, update: { travelMode: 'walking' }, now: () => '2028-05-01T10:00:00.000Z', idFactory: idFactory() })
    assert.equal(result.ok, true, result.message)
    const saved = await repository.loadTripBundle(bundle.metadata.id)
    const arrival = computeRideArrivalEta(saved, saved.days[0]).minutesFromDayStart
    assert.ok(result.schedule)
    if (departure === '06:00') {
      const nextDeparture = dayDepartureTime(saved, saved.days[1].id).split(':').reduce((hours, value) => hours * 60 + Number(value), 0)
      assert.ok(nextDeparture >= arrival, 'the next stage must follow the newly computed walking arrival')
      assert.equal(nextDeparture % 15, 0)
      assert.equal(result.schedule.adjustments.length, 1)
    } else {
      assert.ok(arrival >= 24 * 60)
      assert.ok(result.schedule.overflows.length > 0)
      assert.equal(dayDepartureTime(saved, saved.days[1].id), '08:00', 'no fabricated compatible hour wraps past midnight')
    }
  } finally { database.close() }
})

function idFactory() {
  let index = 0
  return () => `travel-mode-${index++}`
}

function customTrip() {
  const bundle = createGenericTripBundle()
  bundle.settings.stages[0] = {
    ...bundle.settings.stages[0], pausePlanMode: 'custom',
    pauses: [{ ...bundle.settings.stages[0].pauses[0], origin: 'custom', durationSeconds: 1800 }],
  }
  return bundle
}

test('historical trips remain cycling without normalization, timing mutation or a mode-only save', () => {
  const bundle = createGenericTripBundle()
  const before = structuredClone(bundle)
  assert.equal(selectTravelMode(bundle), 'cycling')
  assert.equal(Object.hasOwn(bundle.settings.global, 'travelMode'), false)
  assert.equal(validateTripBundle(bundle).ok, true)
  assert.equal(tripPreferencesUpdateIsNoop(bundle, { travelMode: 'cycling' }), true)
  assert.equal(applyTripPreferences(bundle, { travelMode: 'cycling' }, UPDATED), bundle)
  assert.deepEqual(bundle, before)
})

test('unknown travel modes are rejected by bundle and preference validation', () => {
  for (const travelMode of ['running', 'bike', '', null, 3]) {
    const bundle = createGenericTripBundle()
    bundle.settings.global.travelMode = travelMode
    const result = validateTripBundle(bundle)
    assert.equal(result.ok, false)
    assert.ok(result.issues.some(issue => issue.path === 'settings.global.travelMode'))
    assert.ok(validateTripPreferencesUpdate({ travelMode }).some(issue => issue.field === 'travelMode'))
  }
})

test('changing mode selects its reference pace and recalculates duration while preserving source and manual data', () => {
  const bundle = customTrip()
  const walking = applyTripPreferences(bundle, { travelMode: 'walking' }, UPDATED, idFactory())
  assert.equal(selectTravelMode(walking), 'walking')
  assert.equal(walking.settings.global.referenceSpeedKph, 4.5)
  assert.ok(walking.stages[0].movingDurationSeconds > bundle.stages[0].movingDurationSeconds)
  assert.equal(walking.stages[0].pauseDurationSeconds, bundle.stages[0].pauseDurationSeconds)
  assert.equal(walking.stages[0].totalDurationSeconds, walking.stages[0].movingDurationSeconds + walking.stages[0].pauseDurationSeconds)
  assert.equal(walking.settings.stages, bundle.settings.stages)
  for (const key of ['routes', 'routePoints', 'climbs', 'sourceFiles', 'practicalPlaces', 'accommodations', 'overrides']) {
    assert.equal(walking[key], bundle[key], `${key} is retained exactly`)
  }
  assert.equal(walking.calendar, bundle.calendar)
  assert.equal(walking.days, bundle.days)
  assert.equal(walking.metadata.id, bundle.metadata.id)
  assert.equal(walking.metadata.updatedAt, UPDATED)
  assert.deepEqual(walking.weather, [], 'the old ETA-associated forecast is invalidated')

  const cycling = applyTripPreferences(walking, { travelMode: 'cycling' }, UPDATED, idFactory())
  assert.equal(selectTravelMode(cycling), 'cycling')
  assert.equal(cycling.settings.global.referenceSpeedKph, 18)
  assert.ok(cycling.stages[0].movingDurationSeconds < walking.stages[0].movingDurationSeconds)
  assert.equal(cycling.settings.stages, bundle.settings.stages)
})

test('an explicit pace is used with the chosen mode instead of being silently reset to its default', () => {
  const bundle = customTrip()
  const walking = applyTripPreferences(bundle, { travelMode: 'walking', referenceSpeedKph: 5 }, UPDATED, idFactory())
  assert.equal(walking.settings.global.referenceSpeedKph, 5)
  const defaultWalking = applyTripPreferences(bundle, { travelMode: 'walking' }, UPDATED, idFactory())
  assert.ok(walking.stages[0].movingDurationSeconds < defaultWalking.stages[0].movingDurationSeconds)
})

test('pace validation follows the target mode and can inherit the persisted walking mode', () => {
  assert.deepEqual(validateTripPreferencesUpdate({ travelMode: 'walking', referenceSpeedKph: 4.5 }), [])
  assert.deepEqual(validateTripPreferencesUpdate({ referenceSpeedKph: 5 }, 'walking'), [])
  assert.deepEqual(validateTripPreferencesUpdate({ travelMode: 'cycling', referenceSpeedKph: 18 }, 'walking'), [])
  assert.equal(validateTripPreferencesUpdate({ referenceSpeedKph: 4.5 })[0].field, 'referenceSpeedKph')
  for (const speed of [1.5, 8, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(validateTripPreferencesUpdate({ referenceSpeedKph: speed }, 'walking')[0].field, 'referenceSpeedKph')
  }
})

test('the historical cycling no-op preserves the saved bundle and never asks for a new timestamp', async () => {
  const database = await openTestDatabase()
  try {
    const repository = createTripRepository(database)
    const bundle = createGenericTripBundle()
    await repository.saveTripBundle(bundle)
    const result = await updateTripPreferences({ database, tripId: bundle.metadata.id, update: { travelMode: 'cycling' }, now: () => assert.fail('no-op must not get a timestamp') })
    assert.equal(result.ok, true)
    assert.equal(result.noop, true)
    assert.equal(result.invalidation, null)
    assert.deepEqual(await repository.loadTripBundle(bundle.metadata.id), bundle)
  } finally { database.close() }
})

test('walking mode persists through IndexedDB and a later pace edit needs no repeated mode field', async () => {
  const database = await openTestDatabase()
  try {
    const repository = createTripRepository(database)
    const bundle = customTrip()
    await repository.saveTripBundle(bundle)
    const initial = await updateTripPreferences({ database, tripId: bundle.metadata.id, update: { travelMode: 'walking' }, now: () => UPDATED, idFactory: idFactory() })
    assert.equal(initial.ok, true, initial.message)
    assert.equal(initial.noop, false)
    assert.equal(initial.invalidation.timingChanged, true)
    assert.equal(initial.invalidation.postpassChanged, false)
    const loaded = await repository.loadTripBundle(bundle.metadata.id)
    assert.equal(selectTravelMode(loaded), 'walking')
    assert.equal(loaded.settings.global.referenceSpeedKph, 4.5)
    assert.deepEqual(loaded.settings.stages, bundle.settings.stages)
    assert.deepEqual(loaded.practicalPlaces, bundle.practicalPlaces)

    const faster = await updateTripPreferences({ database, tripId: bundle.metadata.id, update: { referenceSpeedKph: 5 }, now: () => '2027-02-02T10:00:00.000Z' })
    assert.equal(faster.ok, true, faster.message)
    const reread = await repository.loadTripBundle(bundle.metadata.id)
    assert.equal(selectTravelMode(reread), 'walking')
    assert.equal(reread.settings.global.referenceSpeedKph, 5)
    assert.ok(reread.stages[0].movingDurationSeconds < loaded.stages[0].movingDurationSeconds)
    assert.deepEqual(reread.settings.stages, bundle.settings.stages)
  } finally { database.close() }
})

test('invalid mode or walking pace never replaces an existing saved trip', async () => {
  const database = await openTestDatabase()
  try {
    const repository = createTripRepository(database)
    const walking = applyTripPreferences(customTrip(), { travelMode: 'walking' }, UPDATED, idFactory())
    await repository.saveTripBundle(walking)
    for (const update of [{ travelMode: 'running' }, { travelMode: null }, { referenceSpeedKph: 18 }, { referenceSpeedKph: Number.NaN }]) {
      const result = await updateTripPreferences({ database, tripId: walking.metadata.id, update, now: () => assert.fail('invalid input must not obtain a timestamp') })
      assert.equal(result.ok, false)
      assert.equal(result.code, 'invalid-input')
      assert.deepEqual(await repository.loadTripBundle(walking.metadata.id), walking)
    }
  } finally { database.close() }
})

test('full GPX import defaults walking to 4.5 km/h and persists its independently calculated stage duration', async () => {
  const file = toGpxImportFile(buildGpxXml({ tracks: [{ segments: [[{ lat: 45, lon: 6 }, { lat: 45.015, lon: 6 }, { lat: 45.03, lon: 6 }]] }] }))
  const walking = await runImport([file], { travelMode: 'walking', totalBreakMinutes: 0 })
  const cycling = await runImport([file], { totalBreakMinutes: 0 })
  try {
    assert.equal(walking.result.ok, true, walking.result.error?.message)
    assert.equal(cycling.result.ok, true, cycling.result.error?.message)
    const bundle = walking.result.bundle
    assert.equal(selectTravelMode(bundle), 'walking')
    assert.equal(bundle.settings.global.referenceSpeedKph, 4.5)
    const stage = bundle.stages[0]
    assert.equal(stage.movingDurationSeconds, Math.round(stage.distanceKm / 4.5 * 3600), 'altitude-free fallback uses the selected flat pace')
    assert.ok(stage.movingDurationSeconds > cycling.result.bundle.stages[0].movingDurationSeconds * 3.9)
    assert.equal(validateTripBundle(bundle).ok, true)
    assert.deepEqual(await createTripRepository(walking.database).loadTripBundle(bundle.metadata.id), bundle)
  } finally { walking.database.close(); cycling.database.close() }
})

test('an unsupported travel mode fails GPX import without adding a trip', async () => {
  const file = toGpxImportFile(buildGpxXml({ tracks: [{ segments: [[{ lat: 45, lon: 6 }, { lat: 45.03, lon: 6 }]] }] }))
  const { result, database } = await runImport([file], { travelMode: 'running' })
  try {
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'validation-error')
    assert.deepEqual(await createTripRepository(database).listTrips(), [])
  } finally { database.close() }
})

test('a complete backup and copy restoration keep walking pace and manual pauses without changing the original', async () => {
  const database = await openTestDatabase()
  try {
    const repository = createTripRepository(database)
    const walking = applyTripPreferences(customTrip(), { travelMode: 'walking', referenceSpeedKph: 5 }, UPDATED, idFactory())
    await repository.saveTripBundle(walking)
    const backup = await createTripBackup(database, UPDATED)
    const prepared = await prepareTripBackupRestore(backup.file)
    const restoredIds = await restorePreparedTripBackup(database, prepared, idFactory(), UPDATED)
    assert.equal(restoredIds.length, 1)
    const restored = await repository.loadTripBundle(restoredIds[0])
    assert.notEqual(restored.metadata.id, walking.metadata.id)
    assert.equal(selectTravelMode(restored), 'walking')
    assert.equal(restored.settings.global.referenceSpeedKph, 5)
    assert.deepEqual(restored.settings.stages, walking.settings.stages)
    assert.deepEqual(restored.stages, walking.stages)
    assert.deepEqual(await repository.loadTripBundle(walking.metadata.id), walking)
  } finally { database.close() }
})
