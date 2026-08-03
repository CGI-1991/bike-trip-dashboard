import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CLIMB_MAX_FLAT_KM,
  CLIMB_SIGNIFICANCE_PROFILES,
  CLIMB_TOLERATED_LOSS_M,
  detectClimbs,
  isSignificantClimb,
} from '../../src/analysis/climb-detection.ts'
import { routeId } from '../../src/trip-core/index.ts'
import { buildTerrainProfile, concatElevations, flatElevations, rampElevations } from './support/profile-fixtures.mjs'

function idFactory(prefix = 'climb') {
  let counter = 0
  return () => `${prefix}-${counter++}`
}

function detect(elevations, waypoints = []) {
  return detectClimbs(buildTerrainProfile(elevations), waypoints, routeId('route-1'), idFactory(), 'test-engine@1')
}

test('a flat profile detects zero climbs', () => {
  assert.deepEqual(detect(flatElevations(5)), [])
})

test('a clean, continuous valid climb (2 km, 200 m, 10%) is detected', () => {
  const climbs = detect(rampElevations(2, 200))
  assert.equal(climbs.length, 1)
  assert.equal(climbs[0].startDistanceKm, 0)
  assert.equal(climbs[0].endDistanceKm, 2)
  assert.equal(climbs[0].elevationGainM, 200)
  assert.equal(Math.round(climbs[0].averageGradientPercent * 10) / 10, 10)
  assert.equal(climbs[0].name, 'Montée 1')
  assert.equal(climbs[0].confidence, 'probable')
  assert.equal(climbs[0].provenance.sourceType, 'generated')
  assert.equal(climbs[0].provenance.confidence, 'medium')
})

test('the V1 significance profiles are centralized for long, intermediate, and short-steep climbs', () => {
  assert.deepEqual(CLIMB_SIGNIFICANCE_PROFILES, [
    { terrain: 'long', minLengthKm: 1.5, minElevationGainM: 100, minAverageGradientPercent: 2 },
    { terrain: 'intermediate', minLengthKm: 1, minElevationGainM: 60, minAverageGradientPercent: 3 },
    { terrain: 'short-steep', minLengthKm: 0.5, minElevationGainM: 40, minAverageGradientPercent: 4 },
  ])
})

test('significance profiles are alternatives, with all thresholds mandatory inside each profile', () => {
  for (const metrics of [
    { lengthKm: 3, elevationGainM: 120, averageGradientPercent: 4 },
    { lengthKm: 1.2, elevationGainM: 75, averageGradientPercent: 6 },
    { lengthKm: 0.7, elevationGainM: 55, averageGradientPercent: 8 },
  ]) assert.equal(isSignificantClimb(metrics), true)

  for (const metrics of [
    { lengthKm: 0.4, elevationGainM: 30, averageGradientPercent: 7 },
    { lengthKm: 1, elevationGainM: 25, averageGradientPercent: 2.5 },
    { lengthKm: 2, elevationGainM: 40, averageGradientPercent: 2 },
  ]) assert.equal(isSignificantClimb(metrics), false)
})

const syntheticMultiTerrainCases = [
  { name: 'short Belgian climb', lengthKm: 0.7, gainM: 55, expectedCount: 1 },
  { name: 'boundary Belgian climb', lengthKm: 0.5, gainM: 40, expectedCount: 1 },
  { name: 'too-short steep climb', lengthKm: 0.4, gainM: 45, expectedCount: 0 },
  { name: 'intermediate climb', lengthKm: 1.2, gainM: 75, expectedCount: 1 },
  { name: 'false flat', lengthKm: 2, gainM: 40, expectedCount: 0 },
  { name: 'long mountain climb', lengthKm: 5, gainM: 350, expectedCount: 1 },
]

for (const fixture of syntheticMultiTerrainCases) {
  test(`multi-terrain calibration: ${fixture.name}`, () => {
    assert.equal(detect(rampElevations(fixture.lengthKm, fixture.gainM)).length, fixture.expectedCount)
  })
}

test('rolling terrain made of 200-400 m undulations with 10-30 m D+ detects no climb', () => {
  const elevations = concatElevations(
    rampElevations(0.2, 10),
    rampElevations(0.2, -10),
    rampElevations(0.3, 20),
    rampElevations(0.3, -20),
    rampElevations(0.4, 30),
    rampElevations(0.4, -30),
  )
  assert.deepEqual(detect(elevations), [])
})

test('a short flat section (< 1 km) inside an otherwise-continuous climb does not split it', () => {
  const elevations = concatElevations(rampElevations(1.5, 150), flatElevations(0.5), rampElevations(1.5, 150))
  const climbs = detect(elevations)
  assert.equal(climbs.length, 1)
  assert.equal(climbs[0].startDistanceKm, 0)
  assert.equal(climbs[0].endDistanceKm, 3.5)
  assert.equal(climbs[0].elevationGainM, 300)
})

test('a short intermediate descent (< 25 m loss) inside an otherwise-continuous climb does not split it', () => {
  const elevations = concatElevations(rampElevations(1.5, 150), rampElevations(0.2, -20), rampElevations(1.5, 150))
  const climbs = detect(elevations)
  assert.equal(climbs.length, 1)
  assert.equal(climbs[0].startDistanceKm, 0)
  assert.ok(climbs[0].endDistanceKm > 3)
  // Cumulative D+ counts every positive delta, including the re-ascent after the dip.
  assert.equal(climbs[0].elevationGainM, 300)
  // Average grade remains the net valley-to-peak rise (280 m), so the tolerated
  // loss does not inflate it to the cumulative-D+ ratio (300 m / 3.2 km).
  assert.equal(Math.round(climbs[0].averageGradientPercent * 100) / 100, 8.75)
  assert.ok(climbs[0].averageGradientPercent < (climbs[0].elevationGainM / 3_200) * 100)
})

test('a staircase climb (several small tolerated dips) is merged into one climb, peak tracked correctly', () => {
  const elevations = concatElevations(
    rampElevations(0.6, 60),
    rampElevations(0.15, -10),
    rampElevations(0.6, 60),
    rampElevations(0.15, -15),
    rampElevations(0.6, 60),
  )
  const climbs = detect(elevations)
  assert.equal(climbs.length, 1)
  assert.equal(climbs[0].startDistanceKm, 0)
  assert.equal(climbs[0].elevationGainM, 180)
})

test('two climbs separated by a large descent (beyond both tolerances) are detected independently', () => {
  const elevations = concatElevations(rampElevations(1.6, 160), rampElevations(2, -300), rampElevations(1.6, 160))
  const climbs = detect(elevations)
  assert.equal(climbs.length, 2)
  assert.equal(climbs[0].name, 'Montée 1')
  assert.equal(climbs[1].name, 'Montée 2')
  assert.ok(climbs[0].endDistanceKm < climbs[1].startDistanceKm)
})

test('two climbs separated by a descent longer than the tolerated flat distance (but a shallow loss) are still detected independently', () => {
  // Loss stays within CLIMB_TOLERATED_LOSS_M but the flat/descent distance exceeds CLIMB_MAX_FLAT_KM.
  const lossM = CLIMB_TOLERATED_LOSS_M - 5
  const elevations = concatElevations(rampElevations(1.6, 160), rampElevations(CLIMB_MAX_FLAT_KM + 0.5, -lossM), rampElevations(1.6, 160))
  const climbs = detect(elevations)
  assert.equal(climbs.length, 2)
})

test('a climb that continues all the way to the end of the trace (arrival in a climb) is still detected', () => {
  const climbs = detect(rampElevations(2, 200))
  assert.equal(climbs.length, 1)
  assert.equal(climbs[0].endDistanceKm, 2)
  assert.equal(climbs[0].endAltitudeM, 200)
})

test('a false summit (a small lower bump right after the true summit) never moves the recorded peak backward', () => {
  const elevations = concatElevations(rampElevations(2, 200), rampElevations(0.3, -15), rampElevations(0.3, 10))
  const climbs = detect(elevations)
  assert.equal(climbs.length, 1)
  // The true summit (distance 2 km, 200 m) is preserved — the smaller bump afterwards (195 m) never replaces it.
  assert.equal(climbs[0].endDistanceKm, 2)
  assert.equal(climbs[0].endAltitudeM, 200)
})

test('an all-descending profile detects zero climbs', () => {
  assert.deepEqual(detect(rampElevations(3, -200)), [])
})

test('each route numbers its own climbs starting at 1, regardless of how many were found', () => {
  const elevations = concatElevations(rampElevations(1.6, 160), rampElevations(2, -300), rampElevations(1.6, 160), rampElevations(2, -300), rampElevations(1.6, 160))
  const climbs = detect(elevations)
  assert.equal(climbs.length, 3)
  assert.deepEqual(climbs.map((climb) => climb.name), ['Montée 1', 'Montée 2', 'Montée 3'])
})

test('a named GPX waypoint close to the detected peak supplies the climb name with confirmed confidence', () => {
  const profile = buildTerrainProfile(rampElevations(2, 200))
  const peak = profile[profile.length - 1]
  const waypoints = [{ name: 'Col du Test', latitude: peak.latitude, longitude: peak.longitude }]
  const climbs = detectClimbs(profile, waypoints, routeId('route-1'), idFactory(), 'test-engine@1')
  assert.equal(climbs.length, 1)
  assert.equal(climbs[0].name, 'Col du Test')
  assert.equal(climbs[0].confidence, 'confirmed')
  assert.equal(climbs[0].provenance.confidence, 'high')
})

test('a named waypoint far from the peak is never used, and never invents a col name', () => {
  const profile = buildTerrainProfile(rampElevations(2, 200))
  const waypoints = [{ name: 'Somewhere else entirely', latitude: 10, longitude: 10 }]
  const climbs = detectClimbs(profile, waypoints, routeId('route-1'), idFactory(), 'test-engine@1')
  assert.equal(climbs.length, 1)
  assert.equal(climbs[0].name, 'Montée 1')
  assert.equal(climbs[0].confidence, 'probable')
})

test('maxGradientPercent reflects the steepest smoothed segment within the climb, not the average', () => {
  // A climb with a genuinely steeper section in its second half.
  const elevations = concatElevations(rampElevations(1, 40), rampElevations(1, 160))
  const climbs = detect(elevations)
  assert.equal(climbs.length, 1)
  assert.ok(climbs[0].maxGradientPercent > climbs[0].averageGradientPercent)
})

test('routeId is attached to every detected climb, and ids are unique', () => {
  const elevations = concatElevations(rampElevations(1.6, 160), rampElevations(2, -300), rampElevations(1.6, 160))
  const climbs = detect(elevations)
  assert.ok(climbs.every((climb) => climb.routeId === 'route-1'))
  assert.equal(new Set(climbs.map((climb) => climb.id)).size, climbs.length)
})
