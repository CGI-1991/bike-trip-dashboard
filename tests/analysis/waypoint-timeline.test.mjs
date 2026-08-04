import assert from 'node:assert/strict'
import test from 'node:test'

import { computeStageWaypoints } from '../../src/analysis/waypoint-timeline.ts'

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

function stage(overrides = {}) {
  return {
    id: 'stage-test', dayId: 'day-test', sourceRouteId: 'route-test', name: 'Étape test',
    startLocationName: 'Départ village', endLocationName: 'Arrivée ville', distanceKm: 20, elevationGainM: 400, elevationLossM: 100,
    minAltitudeM: 100, maxAltitudeM: 500, movingDurationSeconds: 3_600, pauseDurationSeconds: 0, totalDurationSeconds: 3_600,
    estimatedAverageSpeedKph: 18, validationStatus: 'valid', metricsProvenance: null, climbIds: [], routePointIds: [],
    weatherRecordIds: [],
    ...overrides,
  }
}

function point(overrides = {}) {
  return {
    id: 'point-test', routeId: 'route-test', type: 'passage', name: 'Point', latitude: 45, longitude: 6.1, elevationM: 300,
    trackDistanceKm: 5, osmFeatureType: 'city', lateralDistanceKm: null,
    provenance: { sourceType: 'osm', sourceId: null, fetchedAt: null, engineVersion: 'route-enrichment@3', confidence: 'high', manuallyOverridden: false },
    ...overrides,
  }
}

const settings = { referenceSpeedKph: 18, departureTime: '08:00' }

test('the start waypoint departs exactly at the configured departure time', () => {
  const waypoints = computeStageWaypoints({ stage: stage(), route: route(), routePoints: [], climbs: [], settings })
  const start = waypoints.find((waypoint) => waypoint.kind === 'start')
  assert.equal(start.elapsedMinutes, 0)
  assert.equal(start.clockTime, '08:00')
})

test('a later departure time shifts clock times by exactly that offset', () => {
  const early = computeStageWaypoints({ stage: stage(), route: route(), routePoints: [], climbs: [], settings })
  const late = computeStageWaypoints({ stage: stage(), route: route(), routePoints: [], climbs: [], settings: { ...settings, departureTime: '09:30' } })
  const endEarly = early.find((waypoint) => waypoint.kind === 'end')
  const endLate = late.find((waypoint) => waypoint.kind === 'end')
  assert.equal(endEarly.elapsedMinutes, endLate.elapsedMinutes)
  assert.notEqual(endEarly.clockTime, endLate.clockTime)
})

test('elapsed time never decreases along the route, ordered by track distance', () => {
  const waypoints = computeStageWaypoints({
    stage: stage({ routePointIds: ['city1'] }), route: route(), climbs: [],
    routePoints: [point({ id: 'city1', name: 'Ville', osmFeatureType: 'city', trackDistanceKm: 8 })],
    settings,
  })
  for (let index = 1; index < waypoints.length; index++) {
    assert.ok(waypoints[index].elapsedMinutes >= waypoints[index - 1].elapsedMinutes)
  }
})

test('the pause budget is fully reflected in the arrival time, on top of moving time alone', () => {
  const without = computeStageWaypoints({ stage: stage({ pauseDurationSeconds: 0 }), route: route(), routePoints: [], climbs: [], settings })
  const withBreaks = computeStageWaypoints({ stage: stage({ pauseDurationSeconds: 600 }), route: route(), routePoints: [], climbs: [], settings })
  const endWithout = without.find((waypoint) => waypoint.kind === 'end')
  const endWith = withBreaks.find((waypoint) => waypoint.kind === 'end')
  assert.ok(Math.abs((endWith.elapsedMinutes - endWithout.elapsedMinutes) - 10) < 0.01)
})

test('a synthetic pause waypoint is inserted when its budget cannot anchor to a real waypoint', () => {
  const waypoints = computeStageWaypoints({ stage: stage({ pauseDurationSeconds: 600 }), route: route(), routePoints: [], climbs: [], settings })
  assert.ok(waypoints.some((waypoint) => waypoint.kind === 'pause' && waypoint.pauseDurationMinutes !== null))
})

test('returns an empty list when the route has no usable geometry', () => {
  assert.deepEqual(computeStageWaypoints({ stage: stage(), route: route({ geometry: null }), routePoints: [], climbs: [], settings }), [])
})

test('an invalid reference speed leaves pauses placed but never fabricates an ETA', () => {
  const waypoints = computeStageWaypoints({ stage: stage({ pauseDurationSeconds: 600 }), route: route(), routePoints: [], climbs: [], settings: { ...settings, referenceSpeedKph: 0 } })
  assert.ok(waypoints.length > 0)
  for (const waypoint of waypoints) {
    assert.equal(waypoint.elapsedMinutes, null)
    assert.equal(waypoint.clockTime, null)
  }
})

test('is deterministic across repeated calls with the same input', () => {
  const input = { stage: stage({ pauseDurationSeconds: 480, routePointIds: ['city1'] }), route: route(), climbs: [], routePoints: [point({ id: 'city1', trackDistanceKm: 5.1 })], settings }
  assert.deepEqual(computeStageWaypoints(input), computeStageWaypoints(input))
})
