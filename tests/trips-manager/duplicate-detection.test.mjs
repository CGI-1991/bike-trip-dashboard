import assert from 'node:assert/strict'
import test from 'node:test'

import { SIMILARITY_THRESHOLDS, detectSimilarTraces, detectStrictDuplicates, sampleTracePoints } from '../../src/trips-manager/duplicate-detection.ts'

function candidate(fileName, sha256, startLat, startLon, endLat, endLon, distanceKm, sampledPoints) {
  return { fileName, sha256, startLatitude: startLat, startLongitude: startLon, endLatitude: endLat, endLongitude: endLon, distanceKm, sampledPoints }
}

function line(startLat, startLon, endLat, endLon, count = 5) {
  return Array.from({ length: count }, (_, i) => ({
    latitude: startLat + ((endLat - startLat) * i) / (count - 1),
    longitude: startLon + ((endLon - startLon) * i) / (count - 1),
  }))
}

test('detectStrictDuplicates groups files sharing the exact same hash', () => {
  const files = [
    candidate('a.gpx', 'hash-1', 45, 6, 45.1, 6.1, 10, []),
    candidate('b.gpx', 'hash-1', 45, 6, 45.1, 6.1, 10, []),
    candidate('c.gpx', 'hash-2', 46, 7, 46.1, 7.1, 20, []),
  ]
  const groups = detectStrictDuplicates(files)
  assert.equal(groups.length, 1)
  assert.equal(groups[0].sha256, 'hash-1')
  assert.deepEqual(groups[0].fileNames, ['a.gpx', 'b.gpx'])
})

test('detectStrictDuplicates ignores files with no hash yet and files with a unique hash', () => {
  const files = [
    candidate('a.gpx', null, 45, 6, 45.1, 6.1, 10, []),
    candidate('b.gpx', 'hash-unique', 46, 7, 46.1, 7.1, 20, []),
  ]
  assert.deepEqual(detectStrictDuplicates(files), [])
})

test('detectStrictDuplicates handles three-way duplicates in one group', () => {
  const files = [
    candidate('a.gpx', 'hash-1', 0, 0, 0, 0, 1, []),
    candidate('b.gpx', 'hash-1', 0, 0, 0, 0, 1, []),
    candidate('c.gpx', 'hash-1', 0, 0, 0, 0, 1, []),
  ]
  const groups = detectStrictDuplicates(files)
  assert.equal(groups.length, 1)
  assert.equal(groups[0].fileNames.length, 3)
})

test('detectSimilarTraces flags two different files that plausibly represent the same trace', () => {
  const a = candidate('a.gpx', 'hash-a', 45.0, 6.0, 45.5, 6.5, 50, line(45.0, 6.0, 45.5, 6.5))
  const b = candidate('b.gpx', 'hash-b', 45.001, 6.001, 45.499, 6.499, 50.5, line(45.001, 6.001, 45.499, 6.499))
  const pairs = detectSimilarTraces([a, b])
  assert.equal(pairs.length, 1)
  assert.equal(pairs[0].fileNameA, 'a.gpx')
  assert.equal(pairs[0].fileNameB, 'b.gpx')
})

test('detectSimilarTraces never flags two genuinely different traces', () => {
  const a = candidate('a.gpx', 'hash-a', 45.0, 6.0, 45.5, 6.5, 50, line(45.0, 6.0, 45.5, 6.5))
  const b = candidate('b.gpx', 'hash-b', 50.0, 10.0, 50.5, 10.5, 50, line(50.0, 10.0, 50.5, 10.5))
  assert.deepEqual(detectSimilarTraces([a, b]), [])
})

test('detectSimilarTraces requires start/end proximity even when distance matches', () => {
  const a = candidate('a.gpx', 'hash-a', 45.0, 6.0, 45.5, 6.5, 50, line(45.0, 6.0, 45.5, 6.5))
  const b = candidate('b.gpx', 'hash-b', 46.0, 7.0, 46.5, 7.5, 50, line(46.0, 7.0, 46.5, 7.5))
  assert.deepEqual(detectSimilarTraces([a, b]), [])
})

test('detectSimilarTraces respects the distance relative tolerance', () => {
  const a = candidate('a.gpx', 'hash-a', 45.0, 6.0, 45.5, 6.5, 50, line(45.0, 6.0, 45.5, 6.5))
  const veryDifferentDistance = candidate('b.gpx', 'hash-b', 45.001, 6.001, 45.499, 6.499, 80, line(45.0, 6.0, 45.5, 6.5))
  assert.deepEqual(detectSimilarTraces([a, veryDifferentDistance]), [])
})

test('is a non-blocking signal only — the function itself never throws or marks anything as invalid', () => {
  const a = candidate('a.gpx', 'hash-a', 45.0, 6.0, 45.5, 6.5, 50, line(45.0, 6.0, 45.5, 6.5))
  const b = candidate('b.gpx', 'hash-b', 45.001, 6.001, 45.499, 6.499, 50.2, line(45.001, 6.001, 45.499, 6.499))
  assert.doesNotThrow(() => detectSimilarTraces([a, b]))
})

test('centralized thresholds are used by default and can be overridden explicitly', () => {
  const a = candidate('a.gpx', 'hash-a', 45.0, 6.0, 45.5, 6.5, 50, line(45.0, 6.0, 45.5, 6.5))
  const b = candidate('b.gpx', 'hash-b', 45.2, 6.2, 45.5, 6.5, 50, line(45.0, 6.0, 45.5, 6.5))
  // Default thresholds (0.3 km start proximity) reject this pair (start gap ~28 km).
  assert.deepEqual(detectSimilarTraces([a, b]), [])
  // An extremely loose custom threshold accepts it.
  const loose = { ...SIMILARITY_THRESHOLDS, startProximityKm: 100 }
  assert.equal(detectSimilarTraces([a, b], loose).length, 1)
})

test('sampleTracePoints returns the points as-is when already small', () => {
  const points = [{ latitude: 1, longitude: 1 }, { latitude: 2, longitude: 2 }]
  assert.deepEqual(sampleTracePoints(points, 5), points)
})

test('sampleTracePoints reduces a large point list to an evenly-spaced handful, including both ends', () => {
  const points = Array.from({ length: 1000 }, (_, i) => ({ latitude: i, longitude: i }))
  const sampled = sampleTracePoints(points, 5)
  assert.equal(sampled.length, 5)
  assert.equal(sampled[0].latitude, 0)
  assert.equal(sampled[sampled.length - 1].latitude, 999)
})

test('sampleTracePoints handles an empty list', () => {
  assert.deepEqual(sampleTracePoints([], 5), [])
})
