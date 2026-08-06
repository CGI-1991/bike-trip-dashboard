import assert from 'node:assert/strict'
import test from 'node:test'

import { computeStageWaypoints, resolveStagePauseSettings } from '../../src/analysis/waypoint-timeline.ts'

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

// --- manual pause mode (CDC Jalon B4 section 15) ---------------------------

test('a manual pause anchored on a real waypoint sets its duration instead of the automatic budget', () => {
  const waypoints = computeStageWaypoints({
    stage: stage({ pauseDurationSeconds: 9_999, routePointIds: ['city1'] }), route: route(), climbs: [],
    routePoints: [point({ id: 'city1', trackDistanceKm: 8 })],
    settings, manualPauses: [{ id: 'manual-1', routePointId: 'city1', durationMinutes: 15, order: 0 }],
  })
  const anchor = waypoints.find((waypoint) => waypoint.id === 'city1')
  assert.equal(anchor.pauseDurationMinutes, 15)
  assert.ok(waypoints.every((waypoint) => waypoint.kind !== 'pause'), 'no synthetic pause waypoint when every manual pause has a real anchor')
})

test('a manual pause referencing an unknown routePointId is silently dropped, never crashes', () => {
  const waypoints = computeStageWaypoints({
    stage: stage(), route: route(), routePoints: [], climbs: [],
    settings, manualPauses: [{ id: 'manual-ghost', routePointId: 'does-not-exist', durationMinutes: 20, order: 0 }],
  })
  assert.ok(waypoints.every((waypoint) => waypoint.pauseDurationMinutes === null))
})

test('manual mode ignores the automatic pause budget entirely — duration comes only from the manual entry', () => {
  const waypoints = computeStageWaypoints({
    stage: stage({ pauseDurationSeconds: 1_200, routePointIds: ['city1'] }), route: route(), climbs: [],
    routePoints: [point({ id: 'city1', trackDistanceKm: 8 })],
    settings, manualPauses: [{ id: 'manual-1', routePointId: 'city1', durationMinutes: 5, order: 0 }],
  })
  const anchor = waypoints.find((waypoint) => waypoint.id === 'city1')
  assert.equal(anchor.pauseDurationMinutes, 5)
})

test('the arrival time reflects the sum of manual pause durations, same as automatic mode does for its own budget', () => {
  const routePoints = [point({ id: 'city1', trackDistanceKm: 8 })]
  const withoutPause = computeStageWaypoints({ stage: stage({ routePointIds: ['city1'] }), route: route(), routePoints, climbs: [], settings, manualPauses: [] })
  const withPause = computeStageWaypoints({ stage: stage({ routePointIds: ['city1'] }), route: route(), routePoints, climbs: [], settings, manualPauses: [{ id: 'manual-1', routePointId: 'city1', durationMinutes: 12, order: 0 }] })
  const endWithout = withoutPause.find((waypoint) => waypoint.kind === 'end')
  const endWith = withPause.find((waypoint) => waypoint.kind === 'end')
  assert.ok(Math.abs((endWith.elapsedMinutes - endWithout.elapsedMinutes) - 12) < 0.01)
})

// --- resolveStagePauseSettings ----------------------------------------------

test('resolveStagePauseSettings defaults to automatic when nothing overrides it', () => {
  assert.deepEqual(resolveStagePauseSettings('automatic', undefined), { mode: 'automatic', manualPauses: [] })
})

test('resolveStagePauseSettings: a stage-level null pausePlanMode inherits the trip-wide default', () => {
  const stageSettings = { stageId: 'stage-test', pausePlanMode: null, pauses: [] }
  assert.deepEqual(resolveStagePauseSettings('automatic', stageSettings), { mode: 'automatic', manualPauses: [] })
})

test('resolveStagePauseSettings: a stage-level override wins over the trip-wide default in both directions', () => {
  const toCustom = { stageId: 'stage-test', pausePlanMode: 'custom', pauses: [] }
  const toAutomatic = { stageId: 'stage-test', pausePlanMode: 'automatic', pauses: [{ id: 'p1', active: true, routePointId: 'city1', durationSeconds: 600, order: 0, origin: 'custom' }] }
  assert.equal(resolveStagePauseSettings('automatic', toCustom).mode, 'custom')
  assert.equal(resolveStagePauseSettings('custom', toAutomatic).mode, 'automatic')
})

test('resolveStagePauseSettings: only active pauses with a real routePointId become manual pauses, ordered and in minutes', () => {
  const stageSettings = {
    stageId: 'stage-test', pausePlanMode: 'custom',
    pauses: [
      { id: 'p2', active: true, routePointId: 'city2', durationSeconds: 300, order: 1, origin: 'custom' },
      { id: 'p1', active: true, routePointId: 'city1', durationSeconds: 900, order: 0, origin: 'custom' },
      { id: 'p-inactive', active: false, routePointId: 'city3', durationSeconds: 600, order: 2, origin: 'custom' },
      { id: 'p-null', active: true, routePointId: null, durationSeconds: 600, order: 3, origin: 'custom' },
    ],
  }
  const resolution = resolveStagePauseSettings('automatic', stageSettings)
  assert.equal(resolution.mode, 'custom')
  assert.deepEqual(resolution.manualPauses, [
    { id: 'p1', routePointId: 'city1', durationMinutes: 15, order: 0 },
    { id: 'p2', routePointId: 'city2', durationMinutes: 5, order: 1 },
  ])
})
