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

test('places contextual pauses on existing GPX profile positions', () => {
  const positions = [0, 20, 40, 60, 80, 100].map((weightedDistanceKm) => ({ weightedDistanceKm, distanceKm: weightedDistanceKm, latitude: weightedDistanceKm, longitude: 0, sourceFileNumber: 1, sourceFileName: 'x.gpx', elevationGainM: 0, elevationLossM: 0, altitudeM: 0, localSlopePercent: 0, speedMultiplier: 1 }))
  const profile = { summary: { weightedDistanceKm: 100 }, waypointSeeds: positions.map((position, index) => ({ id: String(index), type: 'time-marker', name: String(index), position })), segments: [{ startPosition: positions[0], endPosition: positions.at(-1) }] }
  const anchors = createContextualPauseAnchors(profile, 12.5)
  assert.equal(anchors.length, 4)
  assert.ok(anchors.every(({ position }) => positions.includes(position)))
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
  assert.equal(anchors[0].position.distanceKm, 60)
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
  const route = scheduleRouteTimeline({ ...base, pauseAnchors: anchors }, { averageSpeedKph: 20, departureTime: '08:00', totalBreakMinutes: 45 })
  assert.equal(route.summary.distanceKm, 100)
  assert.equal(route.summary.pauseDurationMinutes, 45)
  assert.equal(route.summary.arrivalTimeMinutes, route.summary.departureTimeMinutes + route.summary.movingDurationMinutes + 45)
  assert.equal(route.pauses[0].distanceKm, 50)
})
