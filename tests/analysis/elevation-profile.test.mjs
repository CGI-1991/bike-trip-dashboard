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

test('smoothElevation sliding window matches the original centred-window semantics on irregular distances and missing altitude', () => {
  const series = [
    { distanceKm: 0, latitude: 45, longitude: 6, elevationM: 1000 },
    { distanceKm: 0.03, latitude: 45, longitude: 6, elevationM: 1010 },
    { distanceKm: 0.075, latitude: 45, longitude: 6, elevationM: null },
    { distanceKm: 0.11, latitude: 45, longitude: 6, elevationM: 1030 },
    { distanceKm: 0.19, latitude: 45, longitude: 6, elevationM: 1040 },
    { distanceKm: 0.26, latitude: 45, longitude: 6, elevationM: 1025 },
  ]
  const windowMeters = 150
  const halfWindowKm = windowMeters / 1000 / 2
  const expected = series.map((point) => {
    const elevations = series
      .filter((candidate) => Math.abs(candidate.distanceKm - point.distanceKm) <= halfWindowKm && candidate.elevationM !== null)
      .map((candidate) => candidate.elevationM)
    return elevations.length === 0 ? null : elevations.reduce((sum, elevation) => sum + elevation, 0) / elevations.length
  })
  const actual = smoothElevation(series, windowMeters).map((point) => point.elevationM)

  actual.forEach((value, index) => {
    const reference = expected[index]
    if (reference === null) assert.equal(value, null)
    else assert.ok(value !== null && Math.abs(value - reference) < 1e-9)
  })
})
