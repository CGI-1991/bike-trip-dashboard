import assert from 'node:assert/strict'
import test from 'node:test'

import { createTerrainTiming } from '../../src/route/terrain-profile.ts'
import { createTravelTerrainTiming, walkingSpeedFactor, walkingTerrainForGeometry } from '../../src/analysis/travel-timing.ts'
import { computeStageTiming } from '../../src/analysis/timing.ts'
import { computeStageTimingCurve, computeStageWaypoints } from '../../src/analysis/waypoint-timeline.ts'
import { analyzeRouteTerrainClimbsAndTiming } from '../../src/import/gpx/route-analysis.ts'
import { recomputeStageTiming } from '../../src/trips-manager/stage-timing.ts'
import { createGenericTripBundle } from '../trip-core/support/generic-trip-fixture.mjs'

const settings = { referenceSpeedKph: 4.5, travelMode: 'walking', departureTime: '08:00', totalBreakMinutes: 0 }
function terrain(grade, length = 1) {
  return [0, length].map(distanceKm => ({ distanceKm, elevationM: 1000 + distanceKm * grade * 10, smoothedGradePercent: grade, latitude: 45 + distanceKm / 111.195, longitude: 6 }))
}

test('walking reference is the actual flat-ground speed, with pauses added separately', () => {
  assert.equal(walkingSpeedFactor(0), 1)
  const result = computeStageTiming(terrain(0, 9), 9, { ...settings, totalBreakMinutes: 30 })
  assert.equal(result.movingDurationSeconds, 7200)
  assert.equal(result.pauseDurationSeconds, 1800)
  assert.equal(result.totalDurationSeconds, 9000)
  assert.equal(result.estimatedAverageSpeedKph, 4.5)
  const faster = computeStageTiming(terrain(0, 9), 9, { ...settings, referenceSpeedKph: 6 })
  assert.equal(faster.movingDurationSeconds, 5400)
})

test('walking uphill slows down, mild descent helps, and steep descent slows down again', () => {
  const flat = computeStageTiming(terrain(0), 1, settings)
  const uphill = computeStageTiming(terrain(15), 1, settings)
  const mildDescent = computeStageTiming(terrain(-5), 1, settings)
  const steepDescent = computeStageTiming(terrain(-20), 1, settings)
  assert.ok(uphill.movingDurationSeconds > flat.movingDurationSeconds)
  assert.ok(mildDescent.movingDurationSeconds < flat.movingDurationSeconds)
  assert.ok(steepDescent.movingDurationSeconds > flat.movingDurationSeconds)
  assert.ok(steepDescent.movingDurationSeconds > mildDescent.movingDurationSeconds)
})

test('walking uses its own local-speed bounds, including speeds below the cycling minimum', () => {
  const climb = createTravelTerrainTiming(terrain(20), 1, 2, 'walking')
  assert.ok(climb.points.every(point => point.localSpeedKph < 2 && point.localSpeedKph >= 0.5))
  const difficult = createTravelTerrainTiming(terrain(60), 1, 2, 'walking')
  assert.equal(difficult.points[0].localSpeedKph, 0.5)
  const quick = createTravelTerrainTiming(terrain(-5), 1, 7, 'walking')
  assert.ok(quick.points.every(point => point.localSpeedKph <= 8))
})

test('omitted travel mode and explicit cycling preserve historical timing exactly', () => {
  for (const grade of [-20, -5, 0, 6, 20]) {
    const profile = terrain(grade)
    const historical = createTerrainTiming(profile, 1, 18)
    assert.deepEqual(createTravelTerrainTiming(profile, 1, 18), historical)
    assert.deepEqual(createTravelTerrainTiming(profile, 1, 18, 'cycling'), historical)
    assert.deepEqual(computeStageTiming(profile, 1, { ...settings, referenceSpeedKph: 18, travelMode: undefined }), computeStageTiming(profile, 1, { ...settings, referenceSpeedKph: 18, travelMode: 'cycling' }))
  }
})

test('missing altitude retains a flat walking estimate without invented grades', () => {
  const geometry = Array.from({ length: 10 }, (_, i) => ({ latitude: 45 + i * 0.001, longitude: 6, altitudeM: i === 0 ? 1000 : null }))
  const terrain = walkingTerrainForGeometry(geometry)
  assert.equal(terrain.profile, null)
  const result = computeStageTiming(terrain.profile, terrain.lengthKm, settings)
  assert.equal(result.movingDurationSeconds, Math.round(terrain.lengthKm / 4.5 * 3600))
  assert.ok(result.timeline.every(point => point.elevationM === null))
})

function walkingFixture(altitude = true) {
  const bundle = createGenericTripBundle()
  const geometry = Array.from({ length: 201 }, (_, i) => ({ latitude: 45 + i * 0.0001, longitude: 6, altitudeM: altitude ? 1000 + i * 0.5 + Math.sin(i / 15) * 15 : null }))
  const route = { ...bundle.routes[0], geometry: { full: geometry, simplified: null } }
  const lengthKm = walkingTerrainForGeometry(geometry).lengthKm
  const stage = { ...bundle.stages[0], distanceKm: lengthKm, routePointIds: [], climbIds: [], pauseDurationSeconds: 0 }
  bundle.routes = [route]
  bundle.stages = [stage]
  bundle.settings.global = { ...bundle.settings.global, travelMode: 'walking', referenceSpeedKph: 4.5 }
  bundle.settings.days = [{ dayId: stage.dayId, departureTime: '08:00', totalBreakSeconds: 0 }]
  return { bundle, geometry, route, stage, lengthKm }
}

for (const altitude of [true, false]) test(`walking import, aggregate recalculation, waypoints and interactive curve agree (${altitude ? 'mixed relief' : 'missing altitude'})`, () => {
  const { bundle, geometry, route, stage, lengthKm } = walkingFixture(altitude)
  const analysis = {
    points: geometry.map(point => ({ latitude: point.latitude, longitude: point.longitude, elevationM: point.altitudeM })),
    distanceKm: lengthKm, elevationGainM: altitude ? 100 : null, waypoints: [],
  }
  let serial = 0
  const imported = analyzeRouteTerrainClimbsAndTiming(analysis, route.id, () => `climb-${serial++}`, 'test', settings, 'walking.gpx')
  const updated = recomputeStageTiming(bundle, stage, 4.5, 0)
  assert.equal(updated.movingDurationSeconds, imported.timing.movingDurationSeconds)
  assert.equal(updated.estimatedAverageSpeedKph, imported.timing.estimatedAverageSpeedKph)
  const input = { stage: updated, route, routePoints: [], climbs: [], manualPauses: [], settings }
  const waypoints = computeStageWaypoints(input)
  const curve = computeStageTimingCurve(input)
  assert.ok(curve)
  const end = waypoints.find(point => point.kind === 'end')
  assert.ok(Math.abs(end.elapsedMinutes * 60 - updated.movingDurationSeconds) <= 0.5)
  assert.equal(curve.clockTimeAt(end.trackDistanceKm), end.clockTime)
  for (const waypoint of waypoints) assert.ok(Math.abs(curve.elapsedMinutesAt(waypoint.trackDistanceKm) - waypoint.elapsedMinutes) < 1e-8)
})

test('a manual pause retains its duration in the walking curve and arrival', () => {
  const { route, stage } = walkingFixture()
  const baseline = { stage, route, routePoints: [], climbs: [], manualPauses: [], settings }
  const initial = computeStageWaypoints(baseline)
  const start = initial.find(point => point.kind === 'start')
  const withPause = { ...baseline, manualPauses: [{ id: 'manual', routePointId: start.id, durationMinutes: 20, order: 0 }] }
  const paused = computeStageWaypoints(withPause)
  const end = paused.find(point => point.kind === 'end')
  const previousEnd = initial.find(point => point.kind === 'end')
  assert.equal(paused.find(point => point.kind === 'start').pauseDurationMinutes, 20)
  assert.ok(Math.abs(end.elapsedMinutes - previousEnd.elapsedMinutes - 20) < 1e-8)
  assert.equal(computeStageTimingCurve(withPause).clockTimeAt(end.trackDistanceKm), end.clockTime)
})

test('a steep walking climb retains grades above the cycling cap at import, recalculation and on the profile timeline', () => {
  const { bundle } = walkingFixture()
  const geometry = Array.from({ length: 401 }, (_, i) => ({ latitude: 45 + i * 0.00002, longitude: 6, altitudeM: 1000 + i * 0.88956 }))
  const terrain = walkingTerrainForGeometry(geometry)
  assert.ok(Math.max(...terrain.profile.map(point => point.smoothedGradePercent)) > 35)
  const route = { ...bundle.routes[0], geometry: { full: geometry, simplified: null } }
  const stage = { ...bundle.stages[0], distanceKm: terrain.lengthKm }
  bundle.routes = [route]
  bundle.stages = [stage]
  const analysis = { points: geometry.map(point => ({ latitude: point.latitude, longitude: point.longitude, elevationM: point.altitudeM })), distanceKm: terrain.lengthKm, elevationGainM: 355, waypoints: [] }
  let serial = 0
  const imported = analyzeRouteTerrainClimbsAndTiming(analysis, route.id, () => `climb-${serial++}`, 'test', settings, 'steep-walking.gpx')
  assert.ok(Math.max(...imported.terrainProfile.map(point => point.smoothedGradePercent)) > 35)
  const cappedAtCyclingGrade = imported.terrainProfile.map(point => ({ ...point, smoothedGradePercent: Math.min(20, point.smoothedGradePercent) }))
  const cappedTiming = computeStageTiming(cappedAtCyclingGrade, terrain.lengthKm, settings)
  assert.ok(imported.timing.movingDurationSeconds > cappedTiming.movingDurationSeconds * 1.5)
  const updated = recomputeStageTiming(bundle, stage, 4.5, 0)
  assert.equal(updated.movingDurationSeconds, imported.timing.movingDurationSeconds)
  const input = { stage: updated, route, routePoints: [], climbs: [], manualPauses: [], settings }
  const end = computeStageWaypoints(input).find(point => point.kind === 'end')
  assert.ok(Math.abs(end.elapsedMinutes * 60 - updated.movingDurationSeconds) <= 0.5)
  assert.equal(computeStageTimingCurve(input).clockTimeAt(end.trackDistanceKm), end.clockTime)
})
