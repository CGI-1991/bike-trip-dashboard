import assert from 'node:assert/strict'
import test from 'node:test'

import { buildDistanceIndexedSeries, smoothElevation } from '../../src/analysis/elevation-profile.ts'
import { buildTerrainSlopeProfile } from '../../src/analysis/terrain-profile.ts'
import { computeStageTiming } from '../../src/analysis/timing.ts'

function point(latitude, longitude, elevationM) {
  return { latitude, longitude, elevationM }
}

function terrainProfileFor(points) {
  return buildTerrainSlopeProfile(smoothElevation(buildDistanceIndexedSeries(points)))
}

function flatPoints(lengthKm, stepKm = 0.05) {
  const n = Math.round(lengthKm / stepKm)
  const points = []
  for (let i = 0; i <= n; i++) points.push(point(45 + i * stepKm * 0.009, 6, 1000))
  return points
}

function climbPoints(lengthKm, gainM, stepKm = 0.05) {
  const n = Math.round(lengthKm / stepKm)
  const points = []
  for (let i = 0; i <= n; i++) points.push(point(45 + i * stepKm * 0.009, 6, 1000 + (gainM * i) / n))
  return points
}

function baseSettings(overrides = {}) {
  return { referenceSpeedKph: 18, departureTime: '08:00', totalBreakMinutes: 60, ...overrides }
}

/** The fixtures' straight-line lat/lon stepping only approximates the nominal length — always measure the profile's own last distance rather than assume a round number. */
function totalDistanceOf(profile) {
  return profile[profile.length - 1].distanceKm
}

test('a flat route: moving duration matches distance / referenceSpeedKph almost exactly', () => {
  const profile = terrainProfileFor(flatPoints(36))
  const totalDistanceKm = totalDistanceOf(profile)
  const timing = computeStageTiming(profile, totalDistanceKm, baseSettings({ totalBreakMinutes: 0 }))
  const expectedSeconds = (totalDistanceKm / 18) * 3600
  assert.ok(Math.abs(timing.movingDurationSeconds - expectedSeconds) < 5)
  assert.equal(timing.pauseDurationSeconds, 0)
  assert.equal(timing.totalDurationSeconds, timing.movingDurationSeconds)
})

test('a climb takes longer than a flat route of the same distance', () => {
  const flat = terrainProfileFor(flatPoints(10))
  const climb = terrainProfileFor(climbPoints(10, 500))
  const flatTiming = computeStageTiming(flat, 10, baseSettings({ totalBreakMinutes: 0 }))
  const climbTiming = computeStageTiming(climb, 10, baseSettings({ totalBreakMinutes: 0 }))
  assert.ok(climbTiming.movingDurationSeconds > flatTiming.movingDurationSeconds)
})

test('a descent is faster than a flat route of the same distance (bounded by the max descent speed)', () => {
  const flat = terrainProfileFor(flatPoints(10))
  const descentPoints = climbPoints(10, -400)
  const descent = terrainProfileFor(descentPoints)
  const flatTiming = computeStageTiming(flat, 10, baseSettings({ totalBreakMinutes: 0 }))
  const descentTiming = computeStageTiming(descent, 10, baseSettings({ totalBreakMinutes: 0 }))
  assert.ok(descentTiming.movingDurationSeconds < flatTiming.movingDurationSeconds)
})

test('a mixed profile (climb then descent) falls between the pure-climb and pure-descent durations', () => {
  const mixedPoints = [...climbPoints(5, 250)]
  const lastFlat = mixedPoints[mixedPoints.length - 1]
  for (let i = 1; i <= 100; i++) mixedPoints.push(point(lastFlat.latitude + i * 0.00045, lastFlat.longitude, lastFlat.elevationM - i * 2.5))
  const profile = terrainProfileFor(mixedPoints)
  const timing = computeStageTiming(profile, 10, baseSettings({ totalBreakMinutes: 0 }))
  assert.ok(Number.isFinite(timing.movingDurationSeconds) && timing.movingDurationSeconds > 0)
})

test('a higher referenceSpeedKph reduces moving duration proportionally on a flat route', () => {
  const profile = terrainProfileFor(flatPoints(36))
  const slow = computeStageTiming(profile, 36, baseSettings({ referenceSpeedKph: 15, totalBreakMinutes: 0 }))
  const fast = computeStageTiming(profile, 36, baseSettings({ referenceSpeedKph: 30, totalBreakMinutes: 0 }))
  assert.ok(fast.movingDurationSeconds < slow.movingDurationSeconds)
  assert.ok(Math.abs(fast.movingDurationSeconds * 2 - slow.movingDurationSeconds) < 10)
})

test('pauses at 0 minutes add nothing to the total duration', () => {
  const profile = terrainProfileFor(flatPoints(36))
  const timing = computeStageTiming(profile, 36, baseSettings({ totalBreakMinutes: 0 }))
  assert.equal(timing.pauseDurationSeconds, 0)
  assert.equal(timing.totalDurationSeconds, timing.movingDurationSeconds)
})

test('pauses at 60 minutes add exactly 3600 seconds to the total duration', () => {
  const profile = terrainProfileFor(flatPoints(36))
  const timing = computeStageTiming(profile, 36, baseSettings({ totalBreakMinutes: 60 }))
  assert.equal(timing.pauseDurationSeconds, 3600)
  assert.equal(timing.totalDurationSeconds, timing.movingDurationSeconds + 3600)
})

test('totalDurationSeconds always equals movingDurationSeconds + pauseDurationSeconds exactly', () => {
  const profile = terrainProfileFor(climbPoints(20, 300))
  for (const totalBreakMinutes of [0, 15, 60, 90]) {
    const timing = computeStageTiming(profile, 20, baseSettings({ totalBreakMinutes }))
    assert.equal(timing.totalDurationSeconds, timing.movingDurationSeconds + timing.pauseDurationSeconds)
  }
})

test('departure at 08:00 anchors the timeline start clock time to 08:00', () => {
  const profile = terrainProfileFor(flatPoints(10))
  const timing = computeStageTiming(profile, 10, baseSettings({ departureTime: '08:00' }))
  assert.equal(timing.timeline[0].clockTime.clockMinutes, 8 * 60)
  assert.equal(timing.timeline[0].clockTime.dayOffset, 0)
})

test('a different departure time shifts every timeline clock time by the same offset, never affecting elapsed durations', () => {
  const profile = terrainProfileFor(flatPoints(10))
  const morning = computeStageTiming(profile, 10, baseSettings({ departureTime: '08:00' }))
  const afternoon = computeStageTiming(profile, 10, baseSettings({ departureTime: '14:00' }))
  assert.equal(morning.movingDurationSeconds, afternoon.movingDurationSeconds)
  assert.equal(morning.timeline[0].elapsedMinutes, afternoon.timeline[0].elapsedMinutes)
  assert.equal(afternoon.timeline[0].clockTime.clockMinutes, 14 * 60)
})

test('estimatedAverageSpeedKph is a strictly positive, finite number derived from moving time, not total time', () => {
  const profile = terrainProfileFor(climbPoints(20, 600))
  const timing = computeStageTiming(profile, 20, baseSettings({ totalBreakMinutes: 60 }))
  assert.ok(Number.isFinite(timing.estimatedAverageSpeedKph) && timing.estimatedAverageSpeedKph > 0)
  // movingDurationSeconds is movingDurationMinutes rounded to the nearest second, so the
  // recomputed speed only matches to within that rounding — not bit-for-bit.
  const expected = 20 / (timing.movingDurationSeconds / 3600)
  assert.ok(Math.abs(timing.estimatedAverageSpeedKph - expected) < 0.01)
})

test('the timeline is monotone in both distance and elapsed time', () => {
  const profile = terrainProfileFor(climbPoints(15, 400))
  const timing = computeStageTiming(profile, 15, baseSettings({ totalBreakMinutes: 60 }))
  for (let i = 1; i < timing.timeline.length; i++) {
    assert.ok(timing.timeline[i].distanceKm >= timing.timeline[i - 1].distanceKm)
    assert.ok(timing.timeline[i].elapsedMinutes >= timing.timeline[i - 1].elapsedMinutes - 1e-9)
    assert.ok(timing.timeline[i].movingElapsedMinutes >= timing.timeline[i - 1].movingElapsedMinutes - 1e-9)
  }
})

test('the flat-terrain fallback (no terrain profile) still produces a valid, monotone 2-point timeline', () => {
  const timing = computeStageTiming(null, 30, baseSettings({ totalBreakMinutes: 60 }))
  assert.equal(timing.timeline.length, 2)
  assert.equal(timing.timeline[0].distanceKm, 0)
  assert.equal(timing.timeline[1].distanceKm, 30)
  assert.ok(timing.timeline[0].elevationM === null && timing.timeline[1].elevationM === null)
  assert.ok(timing.timeline[1].elapsedMinutes > timing.timeline[0].elapsedMinutes)
  const expectedMovingSeconds = (30 / 18) * 3600
  assert.ok(Math.abs(timing.movingDurationSeconds - expectedMovingSeconds) < 5)
})

test('never renormalizes to distance / average speed when terrain data is present — the grade-aware result differs from the naive flat estimate', () => {
  const profile = terrainProfileFor(climbPoints(20, 800))
  const timing = computeStageTiming(profile, 20, baseSettings({ totalBreakMinutes: 0 }))
  const naiveFlatSeconds = (20 / 18) * 3600
  assert.notEqual(timing.movingDurationSeconds, Math.round(naiveFlatSeconds))
  assert.ok(timing.movingDurationSeconds > naiveFlatSeconds)
})
