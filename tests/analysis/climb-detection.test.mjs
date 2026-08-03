import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CLIMB_MAX_FLAT_KM,
  CLIMB_MIN_AVERAGE_GRADE_PERCENT,
  CLIMB_MIN_ELEVATION_GAIN_M,
  CLIMB_MIN_LENGTH_KM,
  CLIMB_TOLERATED_LOSS_M,
  detectClimbs,
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

test('a climb shorter than the minimum length is rejected even with enough D+ and grade', () => {
  // 1 km, 150 m => 15% grade, well above the D+/grade thresholds, but length < 1.5 km.
  assert.ok(CLIMB_MIN_LENGTH_KM > 1, 'sanity: the fixture length below must actually be under the threshold')
  assert.deepEqual(detect(rampElevations(1, 150)), [])
})

test('a climb with insufficient D+ is rejected even with enough length and grade', () => {
  // 2 km at exactly the grade threshold value would give 100 m (2% of 2000 m) — use a shorter climb
  // with high grade but a D+ that stays under 100 m: 1.6 km at 5% = 80 m.
  assert.ok(80 < CLIMB_MIN_ELEVATION_GAIN_M)
  assert.deepEqual(detect(rampElevations(1.6, 80)), [])
})

test('a climb with insufficient average grade is rejected even with enough length and D+', () => {
  // 6 km, 100 m => grade ~1.67%, under the 2% threshold, D+ exactly at the minimum.
  const climbs = detect(rampElevations(6, 100))
  assert.deepEqual(climbs, [])
})

test('boundary: exactly the minimum length/D+/grade all pass', () => {
  // 1.5 km at exactly 100 m => grade = 100 / 1500 * 100 = 6.667 % (>= 2%).
  const climbs = detect(rampElevations(CLIMB_MIN_LENGTH_KM, CLIMB_MIN_ELEVATION_GAIN_M))
  assert.equal(climbs.length, 1)
  assert.equal(climbs[0].endDistanceKm, CLIMB_MIN_LENGTH_KM)
  assert.equal(climbs[0].elevationGainM, CLIMB_MIN_ELEVATION_GAIN_M)
})

test('boundary: just below the minimum length rejects', () => {
  const climbs = detect(rampElevations(CLIMB_MIN_LENGTH_KM - 0.05, CLIMB_MIN_ELEVATION_GAIN_M))
  assert.deepEqual(climbs, [])
})

test('boundary: just below the minimum average grade rejects (length and D+ both otherwise generous)', () => {
  // 6 km at 100 m gives ~1.67 % — comfortably under 2 % while length/D+ are both ample.
  assert.ok(100 / (6 * 1000) * 100 < CLIMB_MIN_AVERAGE_GRADE_PERCENT)
  assert.deepEqual(detect(rampElevations(6, 100)), [])
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
