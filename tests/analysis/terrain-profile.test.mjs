import assert from 'node:assert/strict'
import test from 'node:test'

import { buildDistanceIndexedSeries, smoothElevation } from '../../src/analysis/elevation-profile.ts'
import { buildTerrainSlopeProfile } from '../../src/analysis/terrain-profile.ts'

function point(latitude, longitude, elevationM) {
  return { latitude, longitude, elevationM }
}

function seriesFor(points) {
  return smoothElevation(buildDistanceIndexedSeries(points))
}

test('returns null for fewer than 2 points', () => {
  assert.equal(buildTerrainSlopeProfile(seriesFor([point(45, 6, 1000)])), null)
})

test('returns null when total distance is not strictly positive', () => {
  assert.equal(buildTerrainSlopeProfile(seriesFor([point(45, 6, 1000), point(45, 6, 1000)])), null)
})

test('produces a non-null, non-negative elevation and grade at every resampled point', () => {
  const points = []
  for (let i = 0; i <= 40; i++) points.push(point(45 + i * 0.001, 6 + i * 0.001, 1000 + i * 5))
  const profile = buildTerrainSlopeProfile(seriesFor(points))
  assert.ok(profile.length > 1)
  for (const sample of profile) {
    assert.equal(typeof sample.elevationM, 'number')
    assert.ok(Number.isFinite(sample.elevationM))
    assert.equal(typeof sample.smoothedGradePercent, 'number')
    assert.ok(Number.isFinite(sample.smoothedGradePercent))
  }
})

test('resamples at the default 50 m interval and covers the full distance', () => {
  const points = []
  for (let i = 0; i <= 60; i++) points.push(point(45 + i * 0.001, 6, 1000 + i * 2))
  const profile = buildTerrainSlopeProfile(seriesFor(points))
  const totalDistanceKm = profile[profile.length - 1].distanceKm
  assert.equal(profile[0].distanceKm, 0)
  for (let i = 1; i < profile.length - 1; i++) {
    assert.ok(Math.abs(profile[i].distanceKm - profile[i - 1].distanceKm - 0.05) < 1e-6)
  }
  assert.ok(profile[profile.length - 1].distanceKm <= totalDistanceKm + 1e-9)
})

test('a positive slope over a climb yields a positive smoothedGradePercent', () => {
  const points = []
  for (let i = 0; i <= 40; i++) points.push(point(45 + i * 0.001, 6, 1000 + i * 10))
  const profile = buildTerrainSlopeProfile(seriesFor(points))
  const midpoint = profile[Math.floor(profile.length / 2)]
  assert.ok(midpoint.smoothedGradePercent > 0)
})

test('a descent yields a negative smoothedGradePercent', () => {
  const points = []
  for (let i = 0; i <= 40; i++) points.push(point(45 + i * 0.001, 6, 1500 - i * 10))
  const profile = buildTerrainSlopeProfile(seriesFor(points))
  const midpoint = profile[Math.floor(profile.length / 2)]
  assert.ok(midpoint.smoothedGradePercent < 0)
})

test('never mutates the input smoothed series', () => {
  const points = []
  for (let i = 0; i <= 20; i++) points.push(point(45 + i * 0.001, 6, 1000 + i * 5))
  const smoothed = seriesFor(points)
  const snapshot = JSON.parse(JSON.stringify(smoothed))
  buildTerrainSlopeProfile(smoothed)
  assert.deepEqual(smoothed, snapshot)
})

test('a small interior altitude gap (fewer points than the coverage threshold would reject) is bridged without a null in the output', () => {
  const points = []
  for (let i = 0; i <= 40; i++) points.push(point(45 + i * 0.001, 6, i === 20 ? null : 1000 + i * 5))
  const profile = buildTerrainSlopeProfile(seriesFor(points))
  assert.ok(profile.every((sample) => sample.elevationM !== null && Number.isFinite(sample.elevationM)))
})
