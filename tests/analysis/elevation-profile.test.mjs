import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MINIMUM_ALTITUDE_COVERAGE_RATIO,
  assessAltitudeQuality,
  buildDistanceIndexedSeries,
  smoothElevation,
} from '../../src/analysis/elevation-profile.ts'

function point(latitude, longitude, elevationM) {
  return { latitude, longitude, elevationM }
}

test('buildDistanceIndexedSeries never mutates the input points', () => {
  const points = [point(45, 6, 1000), point(45.01, 6.01, 1050)]
  const snapshot = JSON.parse(JSON.stringify(points))
  buildDistanceIndexedSeries(points)
  assert.deepEqual(points, snapshot)
})

test('buildDistanceIndexedSeries starts at distance 0 and accumulates positively', () => {
  const points = [point(45, 6, 1000), point(45.01, 6.01, 1050), point(45.02, 6.02, 1100)]
  const series = buildDistanceIndexedSeries(points)
  assert.equal(series[0].distanceKm, 0)
  assert.ok(series[1].distanceKm > 0)
  assert.ok(series[2].distanceKm > series[1].distanceKm)
})

test('buildDistanceIndexedSeries preserves elevationM exactly, including null', () => {
  const points = [point(45, 6, 1000), point(45.01, 6.01, null), point(45.02, 6.02, 1100)]
  const series = buildDistanceIndexedSeries(points)
  assert.deepEqual(series.map((p) => p.elevationM), [1000, null, 1100])
})

test('assessAltitudeQuality reports full coverage for a fully-altituded series', () => {
  const series = buildDistanceIndexedSeries([point(45, 6, 1000), point(45.01, 6.01, 1050)])
  const quality = assessAltitudeQuality(series)
  assert.equal(quality.coverageRatio, 1)
  assert.equal(quality.isSufficient, true)
})

test('assessAltitudeQuality flags insufficient coverage below the threshold', () => {
  const series = buildDistanceIndexedSeries([
    point(45, 6, 1000),
    point(45.01, 6.01, null),
    point(45.02, 6.02, null),
    point(45.03, 6.03, null),
  ])
  const quality = assessAltitudeQuality(series)
  assert.ok(quality.coverageRatio < MINIMUM_ALTITUDE_COVERAGE_RATIO)
  assert.equal(quality.isSufficient, false)
})

test('assessAltitudeQuality treats a single altitude reading as insufficient (cannot compute any slope)', () => {
  const series = buildDistanceIndexedSeries([point(45, 6, 1000), point(45.01, 6.01, null)])
  const quality = assessAltitudeQuality(series)
  assert.equal(quality.isSufficient, false)
})

test('assessAltitudeQuality handles zero altitude entirely', () => {
  const series = buildDistanceIndexedSeries([point(45, 6, null), point(45.01, 6.01, null)])
  const quality = assessAltitudeQuality(series)
  assert.equal(quality.pointsWithAltitude, 0)
  assert.equal(quality.coverageRatio, 0)
  assert.equal(quality.isSufficient, false)
})

test('smoothElevation never mutates its input and returns a new array', () => {
  const series = buildDistanceIndexedSeries([point(45, 6, 1000), point(45.01, 6.01, 1100), point(45.02, 6.02, 1000)])
  const snapshot = JSON.parse(JSON.stringify(series))
  const smoothed = smoothElevation(series)
  assert.deepEqual(series, snapshot)
  assert.notEqual(smoothed, series)
})

test('smoothElevation dampens a single-point spike relative to its neighbours', () => {
  const points = []
  for (let i = 0; i <= 20; i++) points.push(point(45 + i * 0.001, 6, 1000))
  points[10] = point(points[10].latitude, points[10].longitude, 1000 + 500) // one spurious spike
  const series = buildDistanceIndexedSeries(points)
  const smoothed = smoothElevation(series, 300)
  assert.ok(smoothed[10].elevationM < 1500, 'the spike is diluted by its flat neighbours')
  assert.ok(smoothed[10].elevationM > 1000)
})

test('smoothElevation never invents an altitude where none of the neighbours in its window have one', () => {
  const points = [point(45, 6, null), point(45.01, 6.01, null)]
  const series = buildDistanceIndexedSeries(points)
  const smoothed = smoothElevation(series, 50)
  assert.ok(smoothed.every((point) => point.elevationM === null))
})
