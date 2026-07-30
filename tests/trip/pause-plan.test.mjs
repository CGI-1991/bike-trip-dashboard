import assert from 'node:assert/strict'
import test from 'node:test'

import { createContextualPauseAnchors, createCustomPauseAnchors, getPauseCount, getPauseDurationShares, loadPausePlan, pausePlanStorageKey, removePauseDayPlan, savePausePlan, upsertPauseDayPlan } from '../../src/trip/pause-plan.ts'
import { scheduleRouteTimeline } from '../../src/route/engine.ts'

test('derives pause count from estimated moving time', () => {
  assert.equal(getPauseCount(239), 1)
  assert.equal(getPauseCount(240), 2)
  assert.equal(getPauseCount(360), 3)
  assert.equal(getPauseCount(480), 4)
})

test('uses the confirmed duration distributions', () => {
  assert.deepEqual(getPauseDurationShares(1), [1])
  assert.deepEqual(getPauseDurationShares(2), [0.35, 0.65])
  assert.deepEqual(getPauseDurationShares(3), [0.25, 0.5, 0.25])
  assert.deepEqual(getPauseDurationShares(4), [0.15, 0.35, 0.35, 0.15])
})

test('places contextual pauses on the nearest documented point to each theoretical target, never on a raw GPX waypoint seed', () => {
  const positions = [0, 20, 40, 60, 80, 100].map((weightedDistanceKm) => ({ weightedDistanceKm, distanceKm: weightedDistanceKm, latitude: weightedDistanceKm, longitude: 0, sourceFileNumber: 1, sourceFileName: 'x.gpx', elevationGainM: 0, elevationLossM: 0, altitudeM: 0, localSlopePercent: 0, speedMultiplier: 1 }))
  const profile = { summary: { weightedDistanceKm: 100 }, waypointSeeds: positions.map((position, index) => ({ id: String(index), type: 'time-marker', name: String(index), position })), segments: [{ startPosition: positions[0], endPosition: positions.at(-1) }] }
  // Targets for 4 pauses (18/40/65/84 % of 100 km) land nearest to the documented
  // places below (20/40/60/80 km) — never on the underlying time-marker seeds.
  const places = [
    { id: 'p1', name: 'P1', trackDistanceKm: 20, offRoute: false },
    { id: 'p2', name: 'P2', trackDistanceKm: 40, offRoute: false },
    { id: 'p3', name: 'P3', trackDistanceKm: 60, offRoute: false },
    { id: 'p4', name: 'P4', trackDistanceKm: 80, offRoute: false },
  ]
  const anchors = createContextualPauseAnchors(profile, 12.5, places)
  assert.equal(anchors.length, 4)
  assert.deepEqual(anchors.map(({ pointId }) => pointId), ['p1', 'p2', 'p3', 'p4'])
  assert.deepEqual(anchors.map(({ name }) => name), ['P1', 'P2', 'P3', 'P4'])
  assert.deepEqual(anchors.map(({ position }) => position.distanceKm), [20, 40, 60, 80])
})

test('automatic pauses never pick the same documented place twice, even with fewer places than pause slots', () => {
  const positions = [0, 25, 50, 75, 100].map((weightedDistanceKm) => ({ weightedDistanceKm, distanceKm: weightedDistanceKm, latitude: weightedDistanceKm, longitude: 0, sourceFileNumber: 1, sourceFileName: 'x.gpx', elevationGainM: 0, elevationLossM: 0, altitudeM: 0, localSlopePercent: 0, speedMultiplier: 1 }))
  const profile = { summary: { weightedDistanceKm: 100 }, waypointSeeds: positions.map((position, index) => ({ id: String(index), type: 'time-marker', name: String(index), position })), segments: [{ startPosition: positions[0], endPosition: positions.at(-1) }] }
  const places = [
    { id: 'only-one', name: 'Seul lieu', trackDistanceKm: 50, offRoute: false },
  ]
  const anchors = createContextualPauseAnchors(profile, 12.5, places)
  assert.equal(anchors.length, 1)
  assert.equal(anchors[0].pointId, 'only-one')
})

test('automatic pauses produce nothing rather than an invented location when no documented place exists', () => {
  const positions = [0, 100].map((weightedDistanceKm) => ({ weightedDistanceKm, distanceKm: weightedDistanceKm, latitude: weightedDistanceKm, longitude: 0, sourceFileNumber: 1, sourceFileName: 'x.gpx', elevationGainM: 0, elevationLossM: 0, altitudeM: 0, localSlopePercent: 0, speedMultiplier: 1 }))
  const profile = { summary: { weightedDistanceKm: 100 }, waypointSeeds: positions.map((position, index) => ({ id: String(index), type: 'time-marker', name: String(index), position })), segments: [{ startPosition: positions[0], endPosition: positions.at(-1) }] }
  const anchors = createContextualPauseAnchors(profile, 12.5, [])
  assert.deepEqual(anchors, [])
})

test('persists one custom day without changing the others', () => {
  const values = new Map()
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }
  const j6 = { dayId: 'J6', mode: 'custom', pauses: [{ id: 'lunch', active: true, placeId: 'val-isere', placeName: 'Val-d’Isère', durationMinutes: 35, order: 0, origin: 'custom' }] }
  const plan = upsertPauseDayPlan({ version: 1, days: [] }, j6)
  assert.equal(savePausePlan(plan, storage), true)
  assert.ok(values.has(pausePlanStorageKey))
  assert.deepEqual(loadPausePlan(storage), plan)
  assert.deepEqual(removePauseDayPlan(plan, 'J6'), { version: 1, days: [] })
})

test('falls back cleanly when persisted pause data is invalid', () => {
  const storage = { getItem: () => '{"version":1,"days":[{"dayId":"J6","mode":"custom","pauses":[{"durationMinutes":-1}]}]}' }
  assert.deepEqual(loadPausePlan(storage), { version: 1, days: [] })
})

test('custom mode applies active places, durations and order only', () => {
  const positions = [0, 20, 40, 60, 80, 100].map((distanceKm) => ({ weightedDistanceKm: distanceKm, distanceKm, latitude: distanceKm, longitude: 0, sourceFileNumber: 1, sourceFileName: 'x.gpx', elevationGainM: 0, elevationLossM: 0, altitudeM: 0, localSlopePercent: 0, speedMultiplier: 1 }))
  const profile = { summary: { weightedDistanceKm: 100 }, waypointSeeds: positions.map((position, index) => ({ id: String(index), type: 'time-marker', name: String(index), position })), segments: [{ startPosition: positions[0], endPosition: positions.at(-1) }] }
  const plan = { dayId: 'J6', mode: 'custom', pauses: [{ id: 'disabled', active: false, placeId: 'a', placeName: 'A', durationMinutes: 10, order: 0, origin: 'custom' }, { id: 'lunch', active: true, placeId: 'b', placeName: 'B', durationMinutes: 45, order: 1, origin: 'custom' }] }
  const anchors = createCustomPauseAnchors(profile, plan, [{ id: 'a', name: 'A', trackDistanceKm: 20, offRoute: false }, { id: 'b', name: 'B', trackDistanceKm: 63, offRoute: false }])
  assert.equal(anchors.length, 1)
  assert.equal(anchors[0].name, 'B')
  assert.equal(anchors[0].durationShare, 45)
  assert.equal(anchors[0].position.distanceKm, 63)
})

test('a pause saved on a point that no longer exists (suppressed or unknown) resolves to nothing, never a phantom location', () => {
  const positions = [0, 50, 100].map((distanceKm) => ({ weightedDistanceKm: distanceKm, distanceKm, latitude: distanceKm, longitude: 0, sourceFileNumber: 1, sourceFileName: 'x.gpx', elevationGainM: 0, elevationLossM: 0, altitudeM: 0, localSlopePercent: 0, speedMultiplier: 1 }))
  const profile = { summary: { weightedDistanceKm: 100 }, waypointSeeds: positions.map((position, index) => ({ id: String(index), type: 'time-marker', name: String(index), position })), segments: [{ startPosition: positions[0], endPosition: positions.at(-1) }] }
  const plan = { dayId: 'J1', mode: 'custom', pauses: [{ id: 'gone', active: true, placeId: 'j01-passage-bellevaux', placeName: 'Bellevaux', durationMinutes: 20, order: 0, origin: 'custom' }] }
  // `places` reflects the current, real documented points — a suppressed id never appears in it.
  const anchors = createCustomPauseAnchors(profile, plan, [{ id: 'j01-passage-lullin', name: 'Lullin', trackDistanceKm: 30, offRoute: false }])
  assert.deepEqual(anchors, [])
})

test('two saved pauses on the same documented point merge into one, durations summed', () => {
  const positions = [0, 50, 100].map((distanceKm) => ({ weightedDistanceKm: distanceKm, distanceKm, latitude: distanceKm, longitude: 0, sourceFileNumber: 1, sourceFileName: 'x.gpx', elevationGainM: 0, elevationLossM: 0, altitudeM: 0, localSlopePercent: 0, speedMultiplier: 1 }))
  const profile = { summary: { weightedDistanceKm: 100 }, waypointSeeds: positions.map((position, index) => ({ id: String(index), type: 'time-marker', name: String(index), position })), segments: [{ startPosition: positions[0], endPosition: positions.at(-1) }] }
  const plan = {
    dayId: 'J6',
    mode: 'custom',
    pauses: [
      { id: 'first', active: true, placeId: 'cluses', placeName: 'Cluses', durationMinutes: 15, order: 0, origin: 'custom' },
      { id: 'duplicate', active: true, placeId: 'cluses', placeName: 'Cluses', durationMinutes: 25, order: 1, origin: 'custom' },
    ],
  }
  const anchors = createCustomPauseAnchors(profile, plan, [{ id: 'cluses', name: 'Cluses', trackDistanceKm: 50, offRoute: false }])
  assert.equal(anchors.length, 1, 'a duplicated pointId must never produce two anchors')
  assert.equal(anchors[0].pointId, 'cluses')
  assert.equal(anchors[0].durationShare, 40, 'durations of the merged duplicates must be summed')
})

test('a negative or zero duration is rejected, never scheduled', () => {
  const positions = [0, 50, 100].map((distanceKm) => ({ weightedDistanceKm: distanceKm, distanceKm, latitude: distanceKm, longitude: 0, sourceFileNumber: 1, sourceFileName: 'x.gpx', elevationGainM: 0, elevationLossM: 0, altitudeM: 0, localSlopePercent: 0, speedMultiplier: 1 }))
  const profile = { summary: { weightedDistanceKm: 100 }, waypointSeeds: positions.map((position, index) => ({ id: String(index), type: 'time-marker', name: String(index), position })), segments: [{ startPosition: positions[0], endPosition: positions.at(-1) }] }
  const plan = {
    dayId: 'J6',
    mode: 'custom',
    pauses: [
      { id: 'negative', active: true, placeId: 'p1', placeName: 'P1', durationMinutes: -10, order: 0, origin: 'custom' },
      { id: 'zero', active: true, placeId: 'p2', placeName: 'P2', durationMinutes: 0, order: 1, origin: 'custom' },
    ],
  }
  const anchors = createCustomPauseAnchors(profile, plan, [
    { id: 'p1', name: 'P1', trackDistanceKm: 30, offRoute: false },
    { id: 'p2', name: 'P2', trackDistanceKm: 60, offRoute: false },
  ])
  assert.deepEqual(anchors, [])
})

test('custom-mode anchors are scheduled in distance order regardless of the plan’s own item order', () => {
  const position = (distanceKm) => ({ weightedDistanceKm: distanceKm, distanceKm, latitude: distanceKm, longitude: 0, sourceFileNumber: 1, sourceFileName: 'x.gpx', elevationGainM: 0, elevationLossM: 0, altitudeM: 1_000, localSlopePercent: 0, speedMultiplier: 1 })
  const start = position(0)
  const end = position(100)
  const base = {
    // Intermediate seeds at 20 and 80 so `closestDistance` has an exact match
    // for each anchor's target instead of snapping to the nearest endpoint.
    waypointSeeds: [
      { id: 'start', type: 'route-start', name: 'Départ', position: start },
      { id: 'near-seed', type: 'time-marker', name: 'Repère', position: position(20) },
      { id: 'far-seed', type: 'time-marker', name: 'Repère', position: position(80) },
      { id: 'end', type: 'route-end', name: 'Arrivée', position: end },
    ],
    segments: [{ sourceFileNumber: 1, sourceFileName: 'x.gpx', name: 'Test', startName: 'A', endName: 'B', pointCount: 2, trackSegmentCount: 1, distanceKm: 100, elevationGainM: 0, elevationLossM: 0, minAltitudeM: 1_000, maxAltitudeM: 1_000, startPosition: start, endPosition: end }],
    summary: { sourceGpxCount: 1, sourceTrackSegmentCount: 1, sourcePointCount: 2, distanceKm: 100, elevationGainM: 0, elevationLossM: 0, minAltitudeM: 1_000, maxAltitudeM: 1_000, weightedDistanceKm: 100, isContinuous: true, maximumBoundaryGapKm: 0, firstSourceFileNumber: 1, lastSourceFileNumber: 1 },
  }
  // The user added the far pause (80 km) before the near one (20 km) — order:0 is farther along the track than order:1.
  const plan = {
    dayId: 'J6',
    mode: 'custom',
    pauses: [
      { id: 'far', active: true, placeId: 'far', placeName: 'Far', durationMinutes: 20, order: 0, origin: 'custom' },
      { id: 'near', active: true, placeId: 'near', placeName: 'Near', durationMinutes: 10, order: 1, origin: 'custom' },
    ],
  }
  const anchors = createCustomPauseAnchors(base, plan, [
    { id: 'far', name: 'Far', trackDistanceKm: 80, offRoute: false },
    { id: 'near', name: 'Near', trackDistanceKm: 20, offRoute: false },
  ])
  const route = scheduleRouteTimeline({ ...base, pauseAnchors: anchors }, { referenceSpeedKph: 20, departureTime: '08:00', totalBreakMinutes: 30 })
  const distances = route.pauses.map((pause) => pause.distanceKm)
  assert.deepEqual(distances, [...distances].sort((a, b) => a - b), 'route.pauses must come out sorted by distance')
  const near = route.pauses.find((pause) => pause.pointId === 'near')
  const far = route.pauses.find((pause) => pause.pointId === 'far')
  assert.ok(near.startElapsedMinutes < far.startElapsedMinutes, 'the near pause must be reached, and start, before the far one')
})

test('custom duration recalculates ETA without adding distance for an off-route reference', () => {
  const position = (distanceKm) => ({ weightedDistanceKm: distanceKm, distanceKm, latitude: distanceKm, longitude: 0, sourceFileNumber: 1, sourceFileName: 'x.gpx', elevationGainM: 0, elevationLossM: 0, altitudeM: 1_000, localSlopePercent: 0, speedMultiplier: 1 })
  const start = position(0)
  const middle = position(50)
  const end = position(100)
  const base = {
    waypointSeeds: [{ id: 'start', type: 'route-start', name: 'Départ', position: start }, { id: 'middle', type: 'time-marker', name: 'Repère', position: middle }, { id: 'end', type: 'route-end', name: 'Arrivée', position: end }],
    segments: [{ sourceFileNumber: 1, sourceFileName: 'x.gpx', name: 'Test', startName: 'A', endName: 'B', pointCount: 3, trackSegmentCount: 1, distanceKm: 100, elevationGainM: 0, elevationLossM: 0, minAltitudeM: 1_000, maxAltitudeM: 1_000, startPosition: start, endPosition: end }],
    summary: { sourceGpxCount: 1, sourceTrackSegmentCount: 1, sourcePointCount: 3, distanceKm: 100, elevationGainM: 0, elevationLossM: 0, minAltitudeM: 1_000, maxAltitudeM: 1_000, weightedDistanceKm: 100, isContinuous: true, maximumBoundaryGapKm: 0, firstSourceFileNumber: 1, lastSourceFileNumber: 1 },
  }
  const plan = { dayId: 'J6', mode: 'custom', pauses: [{ id: 'tignes', active: true, placeId: 'tignes', placeName: 'Tignes', durationMinutes: 45, order: 0, origin: 'custom' }] }
  const anchors = createCustomPauseAnchors({ ...base, pauseAnchors: [] }, plan, [{ id: 'tignes', name: 'Tignes', trackDistanceKm: 50, offRoute: true }])
  const route = scheduleRouteTimeline({ ...base, pauseAnchors: anchors }, { referenceSpeedKph: 20, departureTime: '08:00', totalBreakMinutes: 45 })
  assert.equal(route.summary.distanceKm, 100)
  assert.equal(route.summary.pauseDurationMinutes, 45)
  assert.equal(route.summary.arrivalTimeMinutes, route.summary.departureTimeMinutes + route.summary.movingDurationMinutes + 45)
  assert.equal(route.pauses[0].distanceKm, 50)
})
