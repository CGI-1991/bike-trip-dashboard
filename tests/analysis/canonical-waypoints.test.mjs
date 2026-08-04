import assert from 'node:assert/strict'
import test from 'node:test'

import { buildCanonicalWaypoints, canonicalWaypointPriority } from '../../src/analysis/canonical-waypoints.ts'

function baseGeometry() {
  return [
    { latitude: 45, longitude: 6, altitudeM: 100 },
    { latitude: 45, longitude: 6.0635, altitudeM: 300 },
    { latitude: 45, longitude: 6.127, altitudeM: 500 },
    { latitude: 45, longitude: 6.1905, altitudeM: 470 },
    { latitude: 45, longitude: 6.254, altitudeM: 400 },
  ]
}

function route(overrides = {}) {
  return {
    id: 'route-test', sourceFileId: 'source-test',
    segments: [{ index: 0, name: null, distanceKm: null, elevationGainM: null, elevationLossM: null }],
    geometry: { full: baseGeometry(), simplified: null }, profile: null, parsingStatus: 'success', parsingErrors: [],
    provenance: { sourceType: 'gpx', sourceId: 'source-test', fetchedAt: null, engineVersion: 'test', confidence: 'high', manuallyOverridden: false },
    ...overrides,
  }
}

function stage(overrides = {}) {
  return {
    id: 'stage-test', dayId: 'day-test', sourceRouteId: 'route-test', name: 'Étape test',
    startLocationName: 'Départ village', endLocationName: 'Arrivée ville', distanceKm: 20, elevationGainM: 400, elevationLossM: 100,
    minAltitudeM: 100, maxAltitudeM: 500, movingDurationSeconds: 3_600, pauseDurationSeconds: 600, totalDurationSeconds: 4_200,
    estimatedAverageSpeedKph: 18, validationStatus: 'valid', metricsProvenance: null, climbIds: [], routePointIds: [],
    weatherRecordIds: [],
    ...overrides,
  }
}

function point(overrides = {}) {
  return {
    id: 'point-test', routeId: 'route-test', type: 'passage', name: 'Point', latitude: 45, longitude: 6.1, elevationM: 300,
    trackDistanceKm: 5, osmFeatureType: null, lateralDistanceKm: null,
    provenance: { sourceType: 'osm', sourceId: null, fetchedAt: null, engineVersion: 'route-enrichment@4', confidence: 'high', manuallyOverridden: false },
    ...overrides,
  }
}

function climb(overrides = {}) {
  return {
    id: 'climb-test', routeId: 'route-test', name: 'Montée 1', startDistanceKm: 0, endDistanceKm: 9.5, elevationGainM: 380,
    averageGradientPercent: 4, maxGradientPercent: 8, startAltitudeM: 100, endAltitudeM: 480, confidence: 'probable',
    provenance: { sourceType: 'generated', sourceId: null, fetchedAt: null, engineVersion: 'test', confidence: 'medium', manuallyOverridden: false },
    ...overrides,
  }
}

test('start and end come from stage locations and route geometry endpoints when there is nothing else', () => {
  const waypoints = buildCanonicalWaypoints({ stage: stage(), route: route(), routePoints: [], climbs: [] })
  assert.equal(waypoints.length, 2)
  assert.equal(waypoints[0].kind, 'start')
  assert.equal(waypoints[0].name, 'Départ village')
  assert.equal(waypoints[0].trackDistanceKm, 0)
  assert.equal(waypoints[0].importance, 'major')
  assert.equal(waypoints[0].visibleByDefault, true)
  assert.equal(waypoints[1].kind, 'end')
  assert.equal(waypoints[1].name, 'Arrivée ville')
  assert.ok(waypoints[1].trackDistanceKm > 0)
})

test('falls back to generic labels when the stage has no known location name', () => {
  const waypoints = buildCanonicalWaypoints({
    stage: stage({ startLocationName: null, endLocationName: null }), route: route(), routePoints: [], climbs: [],
  })
  assert.equal(waypoints[0].name, 'Départ')
  assert.equal(waypoints[1].name, 'Arrivée')
})

test('returns no waypoints when the route has no usable geometry', () => {
  assert.deepEqual(buildCanonicalWaypoints({ stage: stage(), route: route({ geometry: null }), routePoints: [], climbs: [] }), [])
  assert.deepEqual(buildCanonicalWaypoints({ stage: stage(), route: route({ geometry: { full: null, simplified: null } }), routePoints: [], climbs: [] }), [])
})

test('only structural (Postpass) points are kept; a manual/practical route point is ignored and points are ordered by distance', () => {
  const city = point({ id: 'city1', name: 'Ville', osmFeatureType: 'city', trackDistanceKm: 3 })
  const manual = point({ id: 'manual1', name: 'Ravito', type: 'resupply', osmFeatureType: null, trackDistanceKm: 1 })
  const waypoints = buildCanonicalWaypoints({
    stage: stage({ routePointIds: ['city1', 'manual1'] }), route: route(), routePoints: [city, manual], climbs: [],
  })
  assert.deepEqual(waypoints.map((waypoint) => waypoint.id), ['stage-test:start', 'city1', 'stage-test:end'])
  assert.equal(waypoints[1].kind, 'city')
  assert.equal(waypoints[1].importance, 'major')
})

test('a climb merges into a same-named mountain-pass within 1 km into a single waypoint', () => {
  const pass = point({ id: 'pass1', name: 'Col Test', osmFeatureType: 'mountain-pass', trackDistanceKm: 9.8 })
  const theClimb = climb({ name: 'Col Test', endDistanceKm: 9.5 })
  const waypoints = buildCanonicalWaypoints({
    stage: stage({ routePointIds: ['pass1'], climbIds: ['climb-test'] }), route: route(), routePoints: [pass], climbs: [theClimb],
  })
  const middle = waypoints.filter((waypoint) => waypoint.kind !== 'start' && waypoint.kind !== 'end')
  assert.equal(middle.length, 1)
  assert.equal(middle[0].id, 'pass1')
  assert.equal(middle[0].kind, 'mountain-pass')
  assert.equal(middle[0].climbId, 'climb-test')
  assert.equal(middle[0].name, 'Col Test')
})

test('a significant climb with no matching landmark becomes its own climb waypoint', () => {
  const theClimb = climb()
  const waypoints = buildCanonicalWaypoints({
    stage: stage({ climbIds: ['climb-test'] }), route: route(), routePoints: [], climbs: [theClimb],
  })
  const middle = waypoints.filter((waypoint) => waypoint.kind !== 'start' && waypoint.kind !== 'end')
  assert.equal(middle.length, 1)
  assert.equal(middle[0].kind, 'climb')
  assert.equal(middle[0].id, 'climb-test')
  assert.equal(middle[0].climbId, 'climb-test')
  assert.equal(middle[0].name, 'Montée 1')
})

test('a landmark beyond 1 km, or with a different name, never merges — both waypoints stay distinct', () => {
  const farPass = point({ id: 'pass-far', name: 'Col Test', osmFeatureType: 'mountain-pass', trackDistanceKm: 15 })
  const differentNamePass = point({ id: 'pass-diff', name: 'Autre Col', osmFeatureType: 'mountain-pass', trackDistanceKm: 9.8 })

  const farResult = buildCanonicalWaypoints({
    stage: stage({ routePointIds: ['pass-far'], climbIds: ['climb-test'] }), route: route(), routePoints: [farPass], climbs: [climb()],
  }).filter((waypoint) => waypoint.kind !== 'start' && waypoint.kind !== 'end')
  assert.deepEqual(farResult.map((waypoint) => waypoint.kind).sort(), ['climb', 'mountain-pass'])

  const diffResult = buildCanonicalWaypoints({
    stage: stage({ routePointIds: ['pass-diff'], climbIds: ['climb-test'] }), route: route(), routePoints: [differentNamePass], climbs: [climb()],
  }).filter((waypoint) => waypoint.kind !== 'start' && waypoint.kind !== 'end')
  assert.deepEqual(diffResult.map((waypoint) => waypoint.kind).sort(), ['climb', 'mountain-pass'])
})

test('a hamlet/peak RoutePoint (read-compatibility with an old TripBundle) is never surfaced as a waypoint', () => {
  const hamlet = point({ id: 'hamlet1', name: 'Hameau', osmFeatureType: 'hamlet', trackDistanceKm: 4 })
  const peak = point({ id: 'peak1', name: 'Montée 1', osmFeatureType: 'peak', trackDistanceKm: 9.6 })
  const waypoints = buildCanonicalWaypoints({
    stage: stage({ routePointIds: ['hamlet1', 'peak1'], climbIds: ['climb-test'] }), route: route(), routePoints: [hamlet, peak], climbs: [climb()],
  }).filter((waypoint) => waypoint.kind !== 'start' && waypoint.kind !== 'end')
  // The peak never merges into the climb either — with peak filtered out
  // entirely, the climb surfaces on its own as a `climb` waypoint.
  assert.deepEqual(waypoints.map((waypoint) => waypoint.kind), ['climb'])
})

test('importance/visibility hierarchy: village is secondary and hidden by default, city/town/mountain-pass/saddle are major and visible', () => {
  const types = ['city', 'town', 'village', 'mountain-pass', 'saddle']
  const points = types.map((type, index) => point({ id: `p-${type}`, name: `N-${type}`, osmFeatureType: type, trackDistanceKm: index + 1 }))
  const waypoints = buildCanonicalWaypoints({
    stage: stage({ routePointIds: points.map((candidate) => candidate.id) }), route: route(), routePoints: points, climbs: [],
  })
  const byKind = new Map(waypoints.map((waypoint) => [waypoint.kind, waypoint]))
  assert.equal(byKind.get('village').visibleByDefault, false)
  assert.equal(byKind.get('village').importance, 'secondary')
  for (const type of ['city', 'town', 'mountain-pass', 'saddle']) {
    assert.equal(byKind.get(type).visibleByDefault, true, `${type} should be visible by default`)
    assert.equal(byKind.get(type).importance, 'major')
  }
})

test('waypoints are sorted by track distance regardless of input order', () => {
  const far = point({ id: 'far', name: 'Far', osmFeatureType: 'town', trackDistanceKm: 15 })
  const near = point({ id: 'near', name: 'Near', osmFeatureType: 'city', trackDistanceKm: 2 })
  const waypoints = buildCanonicalWaypoints({
    stage: stage({ routePointIds: ['far', 'near'] }), route: route(), routePoints: [far, near], climbs: [],
  })
  assert.deepEqual(waypoints.map((waypoint) => waypoint.id), ['stage-test:start', 'near', 'far', 'stage-test:end'])
})

test('canonicalWaypointPriority orders start/end and mountain-pass ahead of the rest, village and pause last', () => {
  assert.ok(canonicalWaypointPriority('start') < canonicalWaypointPriority('mountain-pass'))
  assert.ok(canonicalWaypointPriority('mountain-pass') < canonicalWaypointPriority('city'))
  assert.ok(canonicalWaypointPriority('city') < canonicalWaypointPriority('village'))
  assert.ok(canonicalWaypointPriority('village') < canonicalWaypointPriority('pause'))
})

test('pauseDurationMinutes/elapsedMinutes/clockTime are always null — this module never places pauses or ETA', () => {
  const city = point({ id: 'city1', name: 'Ville', osmFeatureType: 'city', trackDistanceKm: 3 })
  const waypoints = buildCanonicalWaypoints({
    stage: stage({ routePointIds: ['city1'] }), route: route(), routePoints: [city], climbs: [],
  })
  for (const waypoint of waypoints) {
    assert.equal(waypoint.pauseDurationMinutes, null)
    assert.equal(waypoint.elapsedMinutes, null)
    assert.equal(waypoint.clockTime, null)
  }
})
