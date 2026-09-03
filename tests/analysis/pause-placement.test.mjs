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

// R3 sections 9-11: each placed pause's own duration is normalized to the
// nearest 5-minute step (via `distributeAutomaticPauses`) — the budget no
// longer needs to sum exactly any more (the CDC explicitly sanctions the
// resulting small drift). Every placed duration is a multiple of 5 instead.
test('every placed pause duration is a multiple of 5 minutes, and the budget stays reasonably close to the input total', () => {
  const three = [
    waypoint({ id: 'a', kind: 'city', trackDistanceKm: 5 }),
    waypoint({ id: 'b', kind: 'city', trackDistanceKm: 10 }),
    waypoint({ id: 'c', kind: 'city', trackDistanceKm: 15 }),
  ]
  const placed = placeAutomaticPauses(37, 20, three)
  for (const pause of placed) assert.equal(pause.durationMinutes % 5, 0, `${pause.waypointId}: ${pause.durationMinutes} min`)
  const total = placed.reduce((sum, pause) => sum + pause.durationMinutes, 0)
  assert.ok(Math.abs(total - 37) <= 3 * 2.5, `total ${total} too far from 37`)
})

// --- DER-DES-DER sections 7/12/21-23: a pause is always a real place -------

test('B/C/K/L/M/O: with no structural waypoint at all, NO pause is placed — never a synthetic "Pause du matin"/"principale"/"de l\'après-midi"', () => {
  const placed = placeAutomaticPauses(30, 20, [])
  assert.deepEqual(placed, [], 'a stage whose structural enrichment has not landed yet simply has no automatic pause')
})

test('O: no automatic pause ever carries a null waypointId — every one anchors to a real canonical waypoint', () => {
  const placed = placeAutomaticPauses(37, 20, [
    waypoint({ id: 'a', kind: 'city', trackDistanceKm: 5 }),
    waypoint({ id: 'b', kind: 'village', trackDistanceKm: 10 }),
  ])
  assert.ok(placed.length > 0)
  for (const pause of placed) assert.notEqual(pause.waypointId, null)
})

test('I: a real village near a slot is used as that slot\'s pause anchor', () => {
  const village = waypoint({ id: 'village1', kind: 'village', trackDistanceKm: 9.8 })
  const placed = placeAutomaticPauses(30, 20, [village])
  const anchored = placed.find((pause) => pause.waypointId === 'village1')
  assert.ok(anchored !== undefined)
  assert.equal(anchored.distanceKm, 9.8)
})

test('J: a slot with no real place nearby yields no pause for that slot, while the other slots still get theirs', () => {
  // Only one usable anchor, near the first slot (5 km of 20). The other two
  // slots (10 km, 15 km) are outside its ±2.4 km search window.
  const placed = placeAutomaticPauses(30, 20, [waypoint({ id: 'only-one', kind: 'city', trackDistanceKm: 5 })])
  assert.equal(placed.length, 1, 'exactly one real place → exactly one pause, never three')
  assert.equal(placed[0].waypointId, 'only-one')
})

test('section 23: the dropped slots\' minutes are redistributed over the pauses that did find a real place', () => {
  // Budget 30 min normally splits 10/15/5 across three slots. With a single
  // usable anchor, that whole budget lands on the one real pause instead of
  // silently shrinking the day's break time to 10 minutes.
  const placed = placeAutomaticPauses(30, 20, [waypoint({ id: 'only-one', kind: 'city', trackDistanceKm: 5 })])
  assert.equal(placed.length, 1)
  assert.equal(placed[0].durationMinutes, 30)
  assert.equal(placed[0].durationMinutes % 5, 0)
})

test('section 23: two real places out of three slots → two pauses, together carrying the full budget', () => {
  const placed = placeAutomaticPauses(30, 20, [
    waypoint({ id: 'a', kind: 'city', trackDistanceKm: 5 }),
    waypoint({ id: 'b', kind: 'city', trackDistanceKm: 10 }),
  ])
  assert.equal(placed.length, 2)
  assert.equal(placed.reduce((sum, pause) => sum + pause.durationMinutes, 0), 30)
  for (const pause of placed) assert.equal(pause.durationMinutes % 5, 0)
})

test('a full placement is unchanged by redistribution — the ordinary three-anchor split keeps its exact durations', () => {
  const placed = placeAutomaticPauses(30, 20, [
    waypoint({ id: 'a', kind: 'city', trackDistanceKm: 5 }),
    waypoint({ id: 'b', kind: 'city', trackDistanceKm: 10 }),
    waypoint({ id: 'c', kind: 'city', trackDistanceKm: 15 }),
  ])
  assert.deepEqual(placed.map((pause) => pause.durationMinutes), [10, 15, 5])
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

// R3 sections 9-11: `totalBreakMinutes` bumped from 10 to 30 in every call
// below — at 10, the "afternoon" (0.25 share) anchor's own raw allocation
// now normalizes down to 0 minutes and is dropped entirely (`pauses.ts`'s
// own `durationMinutes > 0` filter, unchanged, now reached more easily
// post-normalization) — a real, correct behaviour change, but one that
// breaks this test's own premise of having all three anchors survive to
// compare priority against. 30 keeps every anchor's normalized duration
// positive ([10, 15, 5] minutes) without changing what this test actually
// checks (anchoring priority among nearby candidates).
test('anchoring priority: city beats a closer town, town beats a closer village, a col beats a closer peak, and hamlet is last resort', () => {
  const town = waypoint({ id: 'town1', kind: 'town', trackDistanceKm: 14.7 })
  const hamlet = waypoint({ id: 'hamlet1', kind: 'hamlet', trackDistanceKm: 15.05 })
  const placed = placeAutomaticPauses(30, 20, [town, hamlet])
  const afternoon = placed.find((pause) => Math.abs(pause.distanceKm - 15) < 3)
  assert.equal(afternoon.waypointId, 'town1')

  const village = waypoint({ id: 'village1', kind: 'village', trackDistanceKm: 15.05 })
  const placedTownVsVillage = placeAutomaticPauses(30, 20, [village, town])
  assert.equal(placedTownVsVillage.find((pause) => pause.waypointId === 'town1' || pause.waypointId === 'village1').waypointId, 'town1')

  const saddle = waypoint({ id: 'saddle1', kind: 'saddle', trackDistanceKm: 9.9 })
  const peak = waypoint({ id: 'peak1', kind: 'peak', trackDistanceKm: 10.05 })
  const placedSaddleVsPeak = placeAutomaticPauses(30, 20, [saddle, peak])
  assert.equal(placedSaddleVsPeak.find((pause) => pause.waypointId === 'saddle1' || pause.waypointId === 'peak1').waypointId, 'saddle1')
})

test('a candidate too close to the start or end is never chosen, even if it is the closest one available', () => {
  // Edge buffer at 20 km total is 1.6 km — a candidate at 0.3 km is nearer to
  // nothing else but must still be rejected for being inside the buffer.
  const tooCloseToStart = waypoint({ id: 'near-start', kind: 'city', trackDistanceKm: 0.3 })
  const placed = placeAutomaticPauses(10, 20, [tooCloseToStart])
  assert.ok(placed.every((pause) => pause.waypointId !== 'near-start'))
})


test('is deterministic: the same inputs always produce the same output', () => {
  const waypoints = [waypoint({ id: 'a', trackDistanceKm: 5.1 }), waypoint({ id: 'b', kind: 'village', trackDistanceKm: 9.8 })]
  const first = placeAutomaticPauses(23, 20, waypoints)
  const second = placeAutomaticPauses(23, 20, waypoints)
  assert.deepEqual(first, second)
})

test('applyPausesToWaypoints fills an anchored pause onto its existing waypoint, without adding a new one', () => {
  const city = waypoint({ id: 'city1', kind: 'city', trackDistanceKm: 5 })
  const pauses = [{ id: 'morning', name: 'Ville', distanceKm: 5, durationMinutes: 12, waypointId: 'city1' }]
  const result = applyPausesToWaypoints([city], pauses)
  assert.equal(result.length, 1)
  assert.equal(result[0].pauseDurationMinutes, 12)
  assert.equal(result[0].kind, 'city')
})

// Section 22: the synthetic `kind: 'pause'` waypoint is gone outright. An
// unanchored pause reaching this function (impossible from either placement
// engine now) can never reintroduce a fabricated place.
test('C: applyPausesToWaypoints never creates a "pause" waypoint — an unanchored pause is simply ignored', () => {
  const pauses = [{ id: 'main', name: 'Pause principale', distanceKm: 9.9, durationMinutes: 20, waypointId: null }]
  assert.deepEqual(applyPausesToWaypoints([], pauses), [])
  const city = waypoint({ id: 'city1', kind: 'city', trackDistanceKm: 5 })
  const result = applyPausesToWaypoints([city], pauses)
  assert.equal(result.length, 1)
  assert.equal(result[0].kind, 'city')
  assert.equal(result[0].pauseDurationMinutes, null, 'the untouched city keeps no pause')
})
