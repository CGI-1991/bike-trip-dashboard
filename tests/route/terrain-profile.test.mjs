import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildTerrainProfileSeries,
  createNormalizedTerrainTiming,
  getTerrainSpeedFactor,
  interpolateTerrainTiming,
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

for (const averageSpeedKph of [18, 13.2]) {
  test(`normalized terrain timing preserves exactly ${averageSpeedKph} km/h on flat and relief routes`, () => {
    for (const elevations of [[500, 500, 500, 500, 500], [500, 700, 900, 700, 500]]) {
      const totalDistanceKm = elevations.length - 1
      const timing = createNormalizedTerrainTiming(buildTerrainProfileSeries(sourceFromElevations(elevations)), totalDistanceKm, averageSpeedKph)
      const expectedMinutes = totalDistanceKm / averageSpeedKph * 60
      assert.ok(Math.abs(timing.totalMovingMinutes - expectedMinutes) < 1 / 60)
      assert.ok(Math.abs(timing.points.at(-1).movingElapsedMinutes - expectedMinutes) < 1 / 60)
      assert.ok(Math.abs(totalDistanceKm / (timing.totalMovingMinutes / 60) - averageSpeedKph) < 1e-9)
      assert.ok(timing.points.every((point) => Number.isFinite(point.localSpeedKph) && point.localSpeedKph > 0 && Number.isFinite(point.movingElapsedMinutes) && point.movingElapsedMinutes >= 0))
    }
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
  const timing = createNormalizedTerrainTiming(buildTerrainProfileSeries(sourceFromElevations([500, 600, 700])), 2, 18)
  const first = interpolateTerrainTiming(timing, 0)
  const middle = interpolateTerrainTiming(timing, 1.025)
  const last = interpolateTerrainTiming(timing, 2)
  assert.equal(first.movingElapsedMinutes, 0)
  assert.ok(middle.movingElapsedMinutes > first.movingElapsedMinutes)
  assert.ok(last.movingElapsedMinutes > middle.movingElapsedMinutes)
  assert.ok(Math.abs(last.movingElapsedMinutes - 2 / 18 * 60) < 1 / 60)
  assert.ok([first, middle, last].every((point) => Object.values(point).every(Number.isFinite)))
})
