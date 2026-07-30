import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildTerrainProfileSeries,
  createTerrainTiming,
  getTerrainSpeedFactor,
  interpolateTerrainTiming,
  MAX_DESCENT_SPEED_KPH,
  MIN_LOCAL_SPEED_KPH,
} from '../../src/route/terrain-profile.ts'

function sourceFromElevations(elevations) {
  return elevations.map((altitudeM, index) => ({
    latitude: 46 + index / 1000,
    longitude: 6,
    sourceFileNumber: 1,
    sourceFileName: 'fixture.gpx',
    distanceKm: index,
    elevationGainM: 0,
    elevationLossM: 0,
    altitudeM,
    localSlopePercent: 0,
    speedMultiplier: 1,
    weightedDistanceKm: index,
  }))
}

test('terrain series is regular, keeps both endpoints and computes a stable centered grade', () => {
  const series = buildTerrainProfileSeries(sourceFromElevations([500, 500, 600, 700, 700]), 0.075, 0.15, 0.5)
  assert.equal(series[0].distanceKm, 0)
  assert.equal(series.at(-1).distanceKm, 4)
  assert.ok(series.length > 50)
  for (let index = 1; index < series.length; index++) {
    assert.ok(series[index].distanceKm > series[index - 1].distanceKm)
    assert.ok(series[index].distanceKm - series[index - 1].distanceKm <= 0.075000001)
  }
  assert.ok(series.find((point) => Math.abs(point.distanceKm - 2) < 0.05).smoothedGradePercent > 0)
  assert.ok(series.every((point) => Object.values(point).every(Number.isFinite)))
})

for (const referenceSpeedKph of [18, 13.2]) {
  test(`a flat route takes distance/${referenceSpeedKph} km/h — the reference speed applies directly with no relief to modulate it`, () => {
    const totalDistanceKm = 4
    const timing = createTerrainTiming(buildTerrainProfileSeries(sourceFromElevations([500, 500, 500, 500, 500])), totalDistanceKm, referenceSpeedKph)
    const flatEstimateMinutes = totalDistanceKm / referenceSpeedKph * 60
    assert.ok(Math.abs(timing.totalMovingMinutes - flatEstimateMinutes) < 1 / 60)
    assert.ok(Math.abs(timing.points.at(-1).movingElapsedMinutes - flatEstimateMinutes) < 1 / 60)
    assert.ok(timing.points.every((point) => Number.isFinite(point.localSpeedKph) && point.localSpeedKph > 0 && Number.isFinite(point.movingElapsedMinutes) && point.movingElapsedMinutes >= 0))
  })
}

test('a symmetric climb-then-descent route of the same distance takes real relief-driven time, never renormalized back to distance/reference-speed', () => {
  const totalDistanceKm = 4
  const flat = createTerrainTiming(buildTerrainProfileSeries(sourceFromElevations([500, 500, 500, 500, 500])), totalDistanceKm, 18)
  const hilly = createTerrainTiming(buildTerrainProfileSeries(sourceFromElevations([500, 700, 900, 700, 500])), totalDistanceKm, 18)
  const flatEstimateMinutes = totalDistanceKm / 18 * 60

  assert.ok(Math.abs(flat.totalMovingMinutes - flatEstimateMinutes) < 1 / 60, 'the flat route is the only one close to the naive estimate')
  assert.ok(hilly.totalMovingMinutes - flatEstimateMinutes > 5, 'the climb must add real minutes — this is not a renormalized redistribution of a fixed total')
  assert.ok(Math.abs(hilly.totalMovingMinutes - 23.22) < 0.05, 'relief-driven duration must match the deterministic grade-factor computation')

  const hillyResultingAverageKph = totalDistanceKm / (hilly.totalMovingMinutes / 60)
  assert.ok(Math.abs(hillyResultingAverageKph - 18) > 2, 'the resulting average on hilly terrain must differ meaningfully from the configured reference speed')
})

for (const [fastKph, slowKph] of [[18, 13.2]]) {
  test(`changing the reference speed from ${fastKph} to ${slowKph} km/h scales the same hilly route's duration proportionally, not to a flat re-estimate`, () => {
    const totalDistanceKm = 4
    const series = buildTerrainProfileSeries(sourceFromElevations([500, 700, 900, 700, 500]))
    const fast = createTerrainTiming(series, totalDistanceKm, fastKph)
    const slow = createTerrainTiming(series, totalDistanceKm, slowKph)

    assert.ok(slow.totalMovingMinutes > fast.totalMovingMinutes, 'a lower reference speed takes longer on identical relief')
    assert.ok(Math.abs(fast.totalMovingMinutes / slow.totalMovingMinutes - slowKph / fastKph) < 1e-6, 'the grade factors are speed-independent, so duration scales exactly with the reference speed')
  })
}

test('the deterministic relief curve makes climbs slower and descents faster without absurd factors', () => {
  assert.ok(getTerrainSpeedFactor(9) < getTerrainSpeedFactor(6))
  assert.ok(getTerrainSpeedFactor(6) < getTerrainSpeedFactor(0))
  assert.ok(getTerrainSpeedFactor(0) < getTerrainSpeedFactor(-4))
  assert.ok(getTerrainSpeedFactor(-4) < getTerrainSpeedFactor(-15))
  for (const grade of [-Infinity, -100, -15, -8, 0, 9, 15, 100, Infinity, Number.NaN]) {
    const factor = getTerrainSpeedFactor(grade)
    assert.ok(Number.isFinite(factor) && factor > 0 && factor <= 2.2)
  }
})

test('timing interpolation includes first and last positions and continuously interpolates time and grade', () => {
  const timing = createTerrainTiming(buildTerrainProfileSeries(sourceFromElevations([500, 600, 700])), 2, 18)
  const first = interpolateTerrainTiming(timing, 0)
  const middle = interpolateTerrainTiming(timing, 1.025)
  const last = interpolateTerrainTiming(timing, 2)
  assert.equal(first.movingElapsedMinutes, 0)
  assert.ok(middle.movingElapsedMinutes > first.movingElapsedMinutes)
  assert.ok(last.movingElapsedMinutes > middle.movingElapsedMinutes)
  // This route climbs steadily (10%), so its real duration is longer than the
  // flat distance/reference-speed estimate — interpolation must land on the
  // engine's own computed total, not on that unrelated flat estimate.
  assert.ok(Math.abs(last.movingElapsedMinutes - timing.totalMovingMinutes) < 1e-9)
  assert.ok(last.movingElapsedMinutes > 2 / 18 * 60, 'the climb makes the real duration longer than the flat estimate')
  assert.ok([first, middle, last].every((point) => Object.values(point).every(Number.isFinite)))
})

test('guardrails: the descent speed cap and minimum climb speed are respected, and no time/speed is ever infinite or negative', () => {
  const steepSeries = buildTerrainProfileSeries(sourceFromElevations([1_000, 1_000, 100, 100]))
  for (const referenceSpeedKph of [8, 18, 40]) {
    const timing = createTerrainTiming(steepSeries, 3, referenceSpeedKph)
    for (const point of timing.points) {
      assert.ok(point.localSpeedKph >= MIN_LOCAL_SPEED_KPH - 1e-9, 'local speed must never drop below the minimum climb guardrail')
      assert.ok(point.localSpeedKph <= MAX_DESCENT_SPEED_KPH + 1e-9, 'local speed must never exceed the descent cap')
      assert.ok(Number.isFinite(point.localSpeedKph) && Number.isFinite(point.movingElapsedMinutes))
    }
    assert.ok(Number.isFinite(timing.totalMovingMinutes) && timing.totalMovingMinutes > 0)
  }
})
