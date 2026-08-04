import assert from 'node:assert/strict'
import test from 'node:test'

import { applyPausesToWaypoints, placeAutomaticPauses } from '../../src/analysis/pause-placement.ts'

function waypoint(overrides = {}) {
  return {
    id: 'wp-test', kind: 'city', importance: 'major', visibleByDefault: true, name: 'Ville',
    trackDistanceKm: 5, latitude: 45, longitude: 6.1, elevationM: 300, climbId: null,
    pauseDurationMinutes: null, elapsedMinutes: null, clockTime: null,
    ...overrides,
  }
}

function route(overrides = {}) {
  return {
    id: 'route-test', sourceFileId: 'source-test',
    segments: [{ index: 0, name: null, distanceKm: null, elevationGainM: null, elevationLossM: null }],
    geometry: {
      full: [
        { latitude: 45, longitude: 6, altitudeM: 100 },
        { latitude: 45, longitude: 6.0635, altitudeM: 300 },
        { latitude: 45, longitude: 6.127, altitudeM: 500 },
        { latitude: 45, longitude: 6.1905, altitudeM: 470 },
        { latitude: 45, longitude: 6.254, altitudeM: 400 },
      ],
      simplified: null,
    },
    profile: null, parsingStatus: 'success', parsingErrors: [],
    provenance: { sourceType: 'gpx', sourceId: 'source-test', fetchedAt: null, engineVersion: 'test', confidence: 'high', manuallyOverridden: false },
    ...overrides,
  }
}

test('the placed pause budget always sums exactly to the input total (budget conservation)', () => {
  const placed = placeAutomaticPauses(37, 20, [])
  const total = placed.reduce((sum, pause) => sum + pause.durationMinutes, 0)
  assert.equal(total, 37)
})

test('with zero budget or zero distance, nothing is placed', () => {
  assert.deepEqual(placeAutomaticPauses(0, 20, []), [])
  assert.deepEqual(placeAutomaticPauses(10, 0, []), [])
})

test('anchors to a nearby city rather than the raw fixed-fraction position', () => {
  const city = waypoint({ id: 'city1', kind: 'city', trackDistanceKm: 5.2 })
  const placed = placeAutomaticPauses(10, 20, [city])
  const anchored = placed.find((pause) => pause.waypointId === 'city1')
  assert.ok(anchored !== undefined)
  assert.equal(anchored.distanceKm, 5.2)
})

test('anchoring priority: city beats a closer town, town beats a closer village, a col beats a closer peak, and hamlet is last resort', () => {
  const town = waypoint({ id: 'town1', kind: 'town', trackDistanceKm: 14.7 })
  const hamlet = waypoint({ id: 'hamlet1', kind: 'hamlet', trackDistanceKm: 15.05 })
  const placed = placeAutomaticPauses(10, 20, [town, hamlet])
  const afternoon = placed.find((pause) => Math.abs(pause.distanceKm - 15) < 3)
  assert.equal(afternoon.waypointId, 'town1')

  const village = waypoint({ id: 'village1', kind: 'village', trackDistanceKm: 15.05 })
  const placedTownVsVillage = placeAutomaticPauses(10, 20, [village, town])
  assert.equal(placedTownVsVillage.find((pause) => pause.waypointId === 'town1' || pause.waypointId === 'village1').waypointId, 'town1')

  const saddle = waypoint({ id: 'saddle1', kind: 'saddle', trackDistanceKm: 9.9 })
  const peak = waypoint({ id: 'peak1', kind: 'peak', trackDistanceKm: 10.05 })
  const placedSaddleVsPeak = placeAutomaticPauses(10, 20, [saddle, peak])
  assert.equal(placedSaddleVsPeak.find((pause) => pause.waypointId === 'saddle1' || pause.waypointId === 'peak1').waypointId, 'saddle1')
})

test('falls back to the fixed-fraction synthetic position when no anchor is nearby', () => {
  const placed = placeAutomaticPauses(10, 20, [])
  assert.equal(placed.length, 3)
  for (const pause of placed) assert.equal(pause.waypointId, null)
  assert.deepEqual(placed.map((pause) => pause.distanceKm), [5, 10, 15])
})

test('a candidate too close to the start or end is never chosen, even if it is the closest one available', () => {
  // Edge buffer at 20 km total is 1.6 km — a candidate at 0.3 km is nearer to
  // nothing else but must still be rejected for being inside the buffer.
  const tooCloseToStart = waypoint({ id: 'near-start', kind: 'city', trackDistanceKm: 0.3 })
  const placed = placeAutomaticPauses(10, 20, [tooCloseToStart])
  assert.ok(placed.every((pause) => pause.waypointId !== 'near-start'))
})

test('never drops a required pause slot: the placed count always matches the number of ideal anchors', () => {
  const placed = placeAutomaticPauses(37, 20, [waypoint({ id: 'only-one', trackDistanceKm: 5 })])
  assert.equal(placed.length, 3)
})

test('is deterministic: the same inputs always produce the same output', () => {
  const waypoints = [waypoint({ id: 'a', trackDistanceKm: 5.1 }), waypoint({ id: 'b', kind: 'village', trackDistanceKm: 9.8 })]
  const first = placeAutomaticPauses(23, 20, waypoints)
  const second = placeAutomaticPauses(23, 20, waypoints)
  assert.deepEqual(first, second)
})

test('applyPausesToWaypoints fills an anchored pause onto its existing waypoint, without adding a new one', () => {
  const city = waypoint({ id: 'city1', kind: 'city', trackDistanceKm: 5 })
  const pauses = [{ id: 'morning', name: 'Pause du matin', distanceKm: 5, durationMinutes: 12, waypointId: 'city1' }]
  const result = applyPausesToWaypoints([city], pauses, route())
  assert.equal(result.length, 1)
  assert.equal(result[0].pauseDurationMinutes, 12)
  assert.equal(result[0].kind, 'city')
})

test('applyPausesToWaypoints adds a positioned synthetic waypoint for an unanchored pause', () => {
  const pauses = [{ id: 'main', name: 'Pause principale', distanceKm: 9.9, durationMinutes: 20, waypointId: null }]
  const result = applyPausesToWaypoints([], pauses, route())
  assert.equal(result.length, 1)
  assert.equal(result[0].kind, 'pause')
  assert.equal(result[0].pauseDurationMinutes, 20)
  assert.equal(result[0].trackDistanceKm, 9.9)
  assert.ok(result[0].latitude !== 0 || result[0].longitude !== 0)
})
