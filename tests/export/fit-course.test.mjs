import '../storage/indexeddb/support/setup-fake-indexeddb.mjs'
import '../ui/support/dom-shim.mjs'
import { installMinimalDOMParser } from '../support/minimal-dom-parser.mjs'
installMinimalDOMParser()
import test from 'node:test'
import assert from 'node:assert/strict'
import FitParser from 'fit-file-parser'
import { readFitMessages } from 'fit-file-parser/raw'
import { importGpxTrip } from '../../src/import/gpx/import-gpx-trip.ts'
import { buildGpxXml, toGpxImportFile } from '../import/gpx/support/fixtures.mjs'
import { createIdFactory, fixedNow, openImportTestDatabase } from '../import/gpx/support/run-import.mjs'
import { applyRaceBounds, buildRaceCourse } from '../../src/analysis/race-bounds.ts'
import { applyRaceSegmentChange } from '../../src/analysis/race-segments.ts'
import { computeStageTimingCurve } from '../../src/analysis/waypoint-timeline.ts'
import { buildFitCourse } from '../../src/export/fit-course.ts'
import { renderStageGpxActions } from '../../src/ui/trips/gpx-export-actions.ts'
import { buildEnrichedGpx } from '../../src/export/enriched-gpx.ts'
import { parseGpxXml } from '../../src/import/gpx/gpx-xml.ts'

// Native XML serialization is also exercised through the compiled browser app.
globalThis.XMLSerializer = class { serializeToString(node) { return node.rawXml } }

const NOW = '2027-05-09T06:00:00.000Z'
const close = (actual, expected, tolerance = .011) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`)
const parse = bytes => new FitParser({ force: false, strict: true, mode: 'list', lengthUnit: 'm' }).parseAsync(bytes.buffer)
async function fixture({ mode = 'league', altitude = true, points, travelMode = 'cycling', bounded = true } = {}) {
  const database = await openImportTestDatabase()
  const xml = buildGpxXml({ tracks: [{ segments: [points ?? Array.from({ length: 201 }, (_, i) => ({ lat: 45 + i * .001, lon: 6, ...(altitude ? { ele: 200 + i * 2 } : {}) }))] }] })
  const imported = await importGpxTrip({ database, files: [toGpxImportFile(xml, 'source.gpx')],
    options: { tripId: 'fit', slug: 'fit', name: 'FIT', organizationMode: mode, travelMode, startDate: '2027-05-10', timezone: 'Europe/Brussels', importedAt: NOW, engineVersion: 'test' },
    dayStructure: [{ kind: 'ride', eventDate: '2027-05-10', departureTime: '08:30' }], idFactory: createIdFactory('fit'), now: fixedNow() })
  assert.equal(imported.ok, true, imported.error?.message)
  let bundle = imported.bundle
  if (mode !== 'voyage' && bounded) {
    const stage = bundle.stages[0], fingerprint = buildRaceCourse(bundle, stage).fingerprint
    bundle = applyRaceBounds(bundle, stage.id, { routeFingerprint: fingerprint, startOffsetM: 1000, finishOffsetM: 12000 }, fingerprint, NOW)
  }
  return { database, bundle, xml }
}
function add(bundle, id, type, start, end, alerts = {}) {
  const stage = bundle.stages[0]
  return applyRaceSegmentChange(bundle, stage.id, { kind: 'add', id, fields: { type, name: id, startOffsetM: start, endOffsetM: end,
    alerts: { beforeEnabled: true, beforeM: 500, atStart: true, atEnd: false, ...alerts } } }, buildRaceCourse(bundle, stage).fingerprint, NOW)
}

for (const mode of ['league', 'tour']) test(`${mode}: FIT keeps every GPX vertex and absolute chainage, with extra real-course markers`, async () => {
  const { database, bundle } = await fixture({ mode })
  try {
    const before = structuredClone(bundle), stage = bundle.stages[0], course = buildRaceCourse(bundle, stage)
    const result = await buildFitCourse(bundle, stage, new Date(NOW)), decoded = await parse(result.bytes)
    assert.equal(decoded.file_ids[0].type, 'course')
    assert.equal(decoded.course.sport, 'cycling')
    assert.equal(decoded.messages.activity, undefined)
    assert.equal(decoded.messages.session, undefined)
    close(result.distanceM, course.indexed.lengthKm * 1000)
    close(decoded.records[0].distance, 0); close(decoded.records.at(-1).distance, result.distanceM)
    close(decoded.records[0].position_lat, course.indexed.points[0].latitude, 1e-6)
    close(decoded.records.at(-1).position_lat, course.indexed.points.at(-1).latitude, 1e-6)
    assert.equal(decoded.records.length, result.recordCount)
    assert.equal(result.recordCount, course.indexed.points.length)
    for (const [i, point] of course.indexed.points.entries()) {
      close(decoded.records[i].position_lat, point.latitude, 180 / 2 ** 31)
      close(decoded.records[i].position_long, point.longitude, 180 / 2 ** 31)
      close(decoded.records[i].altitude, point.altitudeM, .101)
      close(decoded.records[i].distance, course.indexed.distancesKm[i] * 1000)
    }
    assert.deepEqual(decoded.course_points.map(point => point.name), ['START GPX', 'RACE START', 'RACE FINISH', 'FINISH GPX'])
    close(decoded.course_points[1].distance, 1000); close(decoded.course_points[2].distance, 12000)
    close(decoded.course_points[1].position_lat, course.geometry[0].latitude, 180 / 2 ** 31)
    close(decoded.course_points[2].position_lat, course.geometry.at(-1).latitude, 180 / 2 ** 31)
    const curve = computeStageTimingCurve({ stage, route: bundle.routes[0], routePoints: bundle.routePoints, climbs: bundle.climbs, raceCourse: course,
      settings: { referenceSpeedKph: bundle.settings.global.referenceSpeedKph, travelMode: 'cycling', departureTime: '00:00' }, manualPauses: [], automaticPausesAllowed: false })
    const normal = computeStageTimingCurve({ stage, route: bundle.routes[0], routePoints: bundle.routePoints, climbs: bundle.climbs,
      settings: { referenceSpeedKph: bundle.settings.global.referenceSpeedKph, travelMode: 'cycling', departureTime: '00:00' }, manualPauses: [], automaticPausesAllowed: false })
    close(decoded.laps[0].total_timer_time, (curve.elapsedMinutesAt(12) + normal.elapsedMinutesAt(course.indexed.lengthKm) - normal.elapsedMinutesAt(12)) * 60, .001)
    close((decoded.course_points[1].timestamp - decoded.records[0].timestamp) / 1000, curve.elapsedMinutesAt(1) * 60, .51)
    close((decoded.course_points[2].timestamp - decoded.records[0].timestamp) / 1000, curve.elapsedMinutesAt(12) * 60, .51)
    assert.equal(decoded.records[0].timestamp.toISOString(), NOW)
    assert.ok(decoded.records.every((record, i, records) => !i || record.distance >= records[i - 1].distance && record.timestamp >= records[i - 1].timestamp))
    assert.equal(readFitMessages(result.bytes).protocolVersion, 0x10)
    assert.deepEqual(bundle, before, 'no bundle, settings, date, POI, weather or source mutation')
  } finally { database.close() }
})

test('explicit alerts keep original GPX offsets, types, overlap, overrides and omitted pre-race points', async () => {
  const { database, bundle: initial } = await fixture()
  try {
    let bundle = add(initial, 'Near', 'sprint', 1200, 1800)
    bundle = add(bundle, 'Hill', 'climb', 3000, 6000, { beforeM: 1000, atEnd: true })
    bundle = add(bundle, 'Flandres', 'flandrien', 4000, 5000, { beforeEnabled: false, atStart: false, atEnd: true })
    const result = await buildFitCourse(bundle, bundle.stages[0], new Date(NOW)), decoded = await parse(result.bytes)
    assert.equal(result.warnings.length, 1); assert.match(result.warnings[0], /Near.*omise/)
    assert.deepEqual(decoded.course_points.map(({ name, distance }) => [name, distance]), [
      ['START GPX', 0], ['RACE START', 1000], ['SPRINT1 START', 1200], ['CLIMB1 1000m', 2000], ['CLIMB1 START', 3000],
      ['FLAND1 END', 5000], ['CLIMB1 END', 6000], ['RACE FINISH', 12000], ['FINISH GPX', Math.round(result.distanceM * 100) / 100],
    ])
    assert.equal(decoded.course_points.find(point => point.name === 'CLIMB1 START').type, 'segment_start')
    assert.equal(decoded.course_points.find(point => point.name === 'CLIMB1 END').type, 'segment_end')
    assert.equal(result.coursePointCount, 9)
    assert.ok(decoded.course_points.every(point => point.distance >= 0 && point.distance <= result.distanceM + .01))
  } finally { database.close() }
})

test('zero-distance pre-alerts do not double a start alert; disabled alerts stay absent', async () => {
  const { database, bundle: initial } = await fixture()
  try {
    let bundle = add(initial, 'Zero', 'sprint', 2000, 3000, { beforeM: 0 })
    bundle = add(bundle, 'Off', 'climb', 4000, 5000, { beforeEnabled: false, atStart: false, atEnd: false })
    const decoded = await parse((await buildFitCourse(bundle, bundle.stages[0], new Date(NOW))).bytes)
    assert.deepEqual(decoded.course_points.map(point => point.name), ['START GPX', 'RACE START', 'SPRINT1 START', 'RACE FINISH', 'FINISH GPX'])
  } finally { database.close() }
})

test('unknown or out-of-range elevations never become false zero metres', async () => {
  for (const altitude of [false, -800, 15000]) {
    const { database, bundle } = await fixture({ altitude, ...(typeof altitude === 'number' ? { points: Array.from({ length: 201 }, (_, i) => ({ lat: 45 + i * .001, lon: 6, ele: altitude })) } : {}) })
    try {
      const result = await buildFitCourse(bundle, bundle.stages[0], new Date(NOW)), decoded = await parse(result.bytes)
      assert.ok(decoded.records.every(record => record.altitude == null))
      assert.equal(result.warnings.length, altitude === false ? 0 : 1)
    } finally { database.close() }
  }
})

test('League uses GPX defaults; stale bounds, stale/outside segments and Voyage cannot be exported', async () => {
  for (const mode of ['league', 'voyage']) {
    const { database, bundle: initial } = await fixture({ mode, bounded: false })
    try {
      if(mode==='league') assert.ok((await buildFitCourse(initial,initial.stages[0])).distanceM>22000)
      else await assert.rejects(buildFitCourse(initial,initial.stages[0]),/League ou Tour/)
    } finally { database.close() }
  }
  const { database, bundle: initial } = await fixture()
  try {
    const stage = initial.stages[0]
    const stale = { ...stage, raceBounds: { ...stage.raceBounds, routeFingerprint: 'obsolete' } }
    await assert.rejects(buildFitCourse(initial, stale), /limites de course/)
    const outside = add(initial, 'Outside', 'climb', 900, 2000)
    await assert.rejects(buildFitCourse(outside, outside.stages[0]), /segments/)
    const valid = add(initial, 'Stale', 'sprint', 2000, 3000)
    await assert.rejects(buildFitCourse(valid, { ...valid.stages[0], raceSegments: valid.stages[0].raceSegments.map(segment => ({ ...segment, routeFingerprint: 'obsolete' })) }), /segments/)
  } finally { database.close() }
})

test('Tour supports the full track and hiking sport with the walking timing model', async () => {
  const { database, bundle } = await fixture({ mode: 'tour', bounded: false, travelMode: 'walking' })
  try {
    const result = await buildFitCourse(bundle, bundle.stages[0], new Date(NOW)), decoded = await parse(result.bytes)
    assert.equal(decoded.course.sport, 'hiking')
    close(decoded.laps[0].total_distance, buildRaceCourse(bundle, bundle.stages[0]).indexed.lengthKm * 1000)
    assert.equal(result.recordCount, 201)
  } finally { database.close() }
})

test('long UTF-8 course names are safely truncated in a 16-byte FIT field, without altering the saved name', async () => {
  const { database, bundle: initial } = await fixture()
  try {
    for (const name of ['Été 🚲 dans les Alpes', '🥾'.repeat(100), 'Nom\u0000avec\ncontrôles']) {
      const stage = { ...initial.stages[0], customName: name }
      const result = await buildFitCourse(initial, stage, new Date(NOW)), decoded = await parse(result.bytes)
      assert.ok(Buffer.byteLength(decoded.course.name) <= 15)
      assert.doesNotMatch(decoded.course.name, /�|[\u0000-\u001f]/)
      assert.equal(stage.customName, name)
    }
  } finally { database.close() }
})

test('loop alerts retain distinct chainages when the same location is crossed twice', async () => {
  const a = { lat: 45, lon: 6, ele: 200 }, b = { lat: 45.03, lon: 6, ele: 250 }
  const { database, bundle: initial } = await fixture({ mode: 'tour', bounded: false, points: [a, b, a, b] })
  try {
    let bundle = add(initial, 'First', 'sprint', 1000, 1500)
    bundle = add(bundle, 'Second', 'sprint', 1000 + 2 * buildRaceCourse(initial, initial.stages[0]).indexed.lengthKm * 1000 / 3, 8500)
    const decoded = await parse((await buildFitCourse(bundle, bundle.stages[0], new Date(NOW))).bytes)
    const [first, second] = decoded.course_points.filter(point => point.name.endsWith('START') && point.name.startsWith('SPRINT'))
    close(first.position_lat, second.position_lat, 1e-6)
    assert.ok(second.distance > first.distance + 6000)
  } finally { database.close() }
})

test('coordinates at the 180th meridian remain valid semicircles instead of FIT invalid sentinels', async () => {
  const { database, bundle } = await fixture({ mode: 'tour', bounded: false, points: [
    { lat: 45, lon: 180, ele: 200 }, { lat: 45.01, lon: 179.99999995, ele: 250 }, { lat: 45.02, lon: 180, ele: 300 },
  ] })
  try {
    const decoded = await parse((await buildFitCourse(bundle, bundle.stages[0], new Date(NOW))).bytes)
    assert.ok(decoded.records.every(point => Number.isFinite(point.position_long)))
    assert.ok(decoded.records.every(point => Math.abs(Math.abs(point.position_long) - 180) < 1e-6))
  } finally { database.close() }
})

test('export state is independent across simultaneous files and strict readers reject a corrupted CRC', async () => {
  const { database, bundle } = await fixture()
  try {
    const [a, b] = await Promise.all(['Course A', 'Course B'].map(customName => buildFitCourse(bundle, { ...bundle.stages[0], customName }, new Date(NOW))))
    assert.equal((await parse(a.bytes)).course.name, 'Course A')
    assert.equal((await parse(b.bytes)).course.name, 'Course B')
    assert.notEqual((await parse(a.bytes)).file_ids[0].serial_number, (await parse(b.bytes)).file_ids[0].serial_number)
    const corrupt = a.bytes.slice(); corrupt[corrupt.length - 3] ^= 1
    assert.throws(() => readFitMessages(corrupt), /CRC|crc/)
  } finally { database.close() }
})

test('a dense 166 km course retains its vertices and yields during preparation', async () => {
  const { database, bundle } = await fixture({ mode: 'tour', bounded: false, points: Array.from({ length: 15001 }, (_, i) => ({ lat: 45 + i * .0001, lon: 6, ele: 200 + i % 50 })) })
  try {
    let yielded = false
    setTimeout(() => { yielded = true }, 0)
    const result = await buildFitCourse(bundle, bundle.stages[0], new Date(NOW))
    assert.equal(yielded, true)
    assert.equal(result.recordCount, 15001)
    assert.ok(result.distanceM > 160000)
    assert.equal((await parse(result.bytes)).records.length, 15001)
  } finally { database.close() }
})

test('FIT action follows the same bounds guards as GPX and clearly remains an on-device trial', async () => {
  const { database, bundle } = await fixture()
  try {
    assert.match(renderStageGpxActions(bundle, bundle.stages[0]), /data-action="download-fit-course">FIT Garmin · essai/)
    assert.doesNotMatch(renderStageGpxActions(bundle, { ...bundle.stages[0], raceBounds: undefined }), /data-action="download-fit-course" disabled/)
    assert.match(renderStageGpxActions(bundle, { ...bundle.stages[0], raceBounds: {...bundle.stages[0].raceBounds,routeFingerprint:'old'} }), /data-action="download-fit-course" disabled/)
    assert.match(renderStageGpxActions(bundle, bundle.stages[0]), /À valider sur votre Garmin/)
  } finally { database.close() }
})

test('original GPX, enriched GPX and FIT retain the same complete vertex sequence when bounds and segments change', async () => {
  for (const travelMode of ['cycling', 'walking']) {
    const { database, bundle: initial, xml } = await fixture({ travelMode })
    try {
      const bundle = add(initial, 'Extra points', 'climb', 3000, 6000, { atEnd: true })
      const stage = bundle.stages[0], course = buildRaceCourse(bundle, stage)
      const before = structuredClone(bundle)
      const enriched = await buildEnrichedGpx(bundle, stage, xml)
      const vertices = source => parseGpxXml(source).tracks.flatMap(track => track.segments.flatMap(segment => segment.points))
      assert.deepEqual(vertices(enriched.xml), vertices(xml))
      const decoded = await parse((await buildFitCourse(bundle, stage, new Date(NOW))).bytes)
      const original = vertices(xml)
      assert.equal(decoded.records.length, original.length)
      for (const [i, point] of original.entries()) {
        close(decoded.records[i].position_lat, point.latitude, 180 / 2 ** 31)
        close(decoded.records[i].position_long, point.longitude, 180 / 2 ** 31)
        close(decoded.records[i].altitude, point.elevationM, .101)
      }
      const changed = applyRaceBounds(bundle, stage.id, { routeFingerprint: course.fingerprint, startOffsetM: 2000, finishOffsetM: 10000 }, course.fingerprint, NOW)
      const changedFit = await parse((await buildFitCourse(changed, changed.stages[0], new Date(NOW))).bytes)
      const geometry = fit => fit.records.map(({ position_lat, position_long, altitude, distance }) => [position_lat, position_long, altitude, distance])
      assert.deepEqual(geometry(changedFit), geometry(decoded), 'moving real boundaries changes markers and pace, never GPX geometry')
      assert.deepEqual(bundle, before)
    } finally { database.close() }
  }
})

test('full GPX timing includes the slower approach, course and suffix while course statistics stay bounded', async () => {
  const { database, bundle } = await fixture({ altitude: false })
  try {
    const stage = bundle.stages[0], course = buildRaceCourse(bundle, stage)
    const result = await buildFitCourse(bundle, stage, new Date(NOW)), decoded = await parse(result.bytes)
    for (const record of decoded.records) {
      const km = record.distance / 1000
      const seconds = (Math.min(km, 1) / 15 + Math.max(0, km - 1) / 18) * 3600
      close((record.timestamp - new Date(NOW)) / 1000, seconds, .51)
    }
    close(decoded.laps[0].total_timer_time, (1 / 15 + (course.indexed.lengthKm - 1) / 18) * 3600, .001)
    assert.equal(stage.raceBounds.finishOffsetM - stage.raceBounds.startOffsetM, 11000)
    assert.ok(result.distanceM > 22000)
    const finish = decoded.course_points.find(point => point.name === 'RACE FINISH')
    assert.ok(decoded.records.at(-1).timestamp > finish.timestamp, 'time continues after the race finish')
  } finally { database.close() }
})

test('loops and coincident GPX points are retained even at the first and last real boundaries', async () => {
  const a = { lat: 45, lon: 6, ele: 200 }, b = { lat: 45.03, lon: 6.01, ele: 250 }, c = { lat: 45.01, lon: 6.02, ele: 220 }
  const points = [a, a, b, a, c, c]
  const { database, bundle: initial } = await fixture({ bounded: false, points })
  try {
    const stage = initial.stages[0], course = buildRaceCourse(initial, stage)
    const bundle = applyRaceBounds(initial, stage.id, { routeFingerprint: course.fingerprint, startOffsetM: 0, finishOffsetM: course.indexed.lengthKm * 1000 }, course.fingerprint, NOW)
    const decoded = await parse((await buildFitCourse(bundle, bundle.stages[0], new Date(NOW))).bytes)
    assert.equal(decoded.records.length, points.length)
    for (const [i, point] of points.entries()) {
      close(decoded.records[i].position_lat, point.lat, 180 / 2 ** 31)
      close(decoded.records[i].position_long, point.lon, 180 / 2 ** 31)
    }
    assert.equal(decoded.records[0].distance, decoded.records[1].distance)
    assert.equal(decoded.records.at(-1).distance, decoded.records.at(-2).distance)
    assert.deepEqual(decoded.course_points.map(point => point.name), ['START GPX', 'RACE START', 'RACE FINISH', 'FINISH GPX'])
  } finally { database.close() }
})
