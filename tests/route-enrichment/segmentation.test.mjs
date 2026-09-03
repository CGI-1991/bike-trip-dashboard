import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildRouteSegments,
  MAX_POSTPASS_SEGMENT_KM,
  POSTPASS_SEGMENT_OVERLAP_KM,
  RETRY_POSTPASS_SEGMENT_KM,
} from '../../src/route-enrichment/segmentation.ts'

/**
 * DER-DES-DER sections 41-49. A straight north-south line at longitude 6 is
 * the simplest deterministic way to build a route of an EXACT length: the
 * equirectangular formula `chunking.ts` uses reduces to `latitudeDelta × R`
 * when the longitude never changes, so the total length is exact rather than
 * approximate — which is what lets these tests assert the CDC's own 0-60 /
 * 55-115 / 110-170 / 165-205 boundaries to the kilometre.
 */
const KM_PER_DEGREE_LATITUDE = (Math.PI / 180) * 6_371 // the exact constant `chunking.ts` derives from

function lineOfLengthKm(lengthKm, pointCount = 300) {
  const deltaDegrees = lengthKm / (pointCount - 1) / KM_PER_DEGREE_LATITUDE
  return Array.from({ length: pointCount }, (_value, index) => ({
    latitude: 45 + index * deltaDegrees,
    longitude: 6,
    altitudeM: 200,
  }))
}

function totalKm(segments) {
  return segments[segments.length - 1].endDistanceKm
}

test('the published constants match the CDC exactly (sections 42/44/49)', () => {
  assert.equal(MAX_POSTPASS_SEGMENT_KM, 60)
  assert.equal(POSTPASS_SEGMENT_OVERLAP_KM, 5)
  assert.equal(RETRY_POSTPASS_SEGMENT_KM, 30)
})

test('AU: a 50 km stage is a single segment covering the whole route', () => {
  const segments = buildRouteSegments(lineOfLengthKm(50))
  assert.equal(segments.length, 1)
  assert.equal(segments[0].startDistanceKm, 0)
  assert.ok(Math.abs(totalKm(segments) - 50) < 0.01)
})

test('AV: a 60 km stage is still a single segment — the limit itself never splits', () => {
  const segments = buildRouteSegments(lineOfLengthKm(60))
  assert.equal(segments.length, 1)
})

test('AW: a 61 km stage is split into more than one segment', () => {
  const segments = buildRouteSegments(lineOfLengthKm(61))
  assert.ok(segments.length > 1, `expected a split, got ${segments.length} segment(s)`)
})

test('AX: a 205 km stage splits into segments that are each at most 60 km long', () => {
  const segments = buildRouteSegments(lineOfLengthKm(205))
  assert.ok(segments.length >= 4)
  for (const segment of segments) {
    assert.ok(segment.endDistanceKm - segment.startDistanceKm <= MAX_POSTPASS_SEGMENT_KM + 0.001, `segment ${segment.index} is ${segment.endDistanceKm - segment.startDistanceKm} km`)
  }
  assert.equal(segments[0].startDistanceKm, 0)
  assert.ok(Math.abs(totalKm(segments) - 205) < 0.01, 'the last segment reaches the end of the route')
})

test('AX: the 205 km worked example produces exactly the CDC\'s 0-60 / 55-115 / 110-170 / 165-end boundaries', () => {
  const segments = buildRouteSegments(lineOfLengthKm(205))
  assert.deepEqual(segments.map((segment) => Math.round(segment.startDistanceKm)), [0, 55, 110, 165])
  assert.deepEqual(segments.slice(0, 3).map((segment) => Math.round(segment.endDistanceKm)), [60, 115, 170])
})

test('AY: consecutive segments overlap by 5 km, so nothing can fall between them', () => {
  const segments = buildRouteSegments(lineOfLengthKm(205))
  for (let index = 1; index < segments.length; index++) {
    const overlap = segments[index - 1].endDistanceKm - segments[index].startDistanceKm
    assert.ok(Math.abs(overlap - POSTPASS_SEGMENT_OVERLAP_KM) < 0.001, `overlap between ${index - 1} and ${index} is ${overlap} km`)
  }
})

test('AY: the segments together cover the whole route with no gap at all', () => {
  const segments = buildRouteSegments(lineOfLengthKm(205))
  for (let index = 1; index < segments.length; index++) {
    assert.ok(segments[index].startDistanceKm < segments[index - 1].endDistanceKm, 'each segment starts before the previous one ends')
  }
})

test('AZ: segment keys are unique, so each segment caches independently (section 48\'s free per-segment retry)', () => {
  const segments = buildRouteSegments(lineOfLengthKm(205))
  const keys = segments.map((segment) => segment.key)
  assert.equal(new Set(keys).size, keys.length)
})

test('section 43: segmentation is deterministic — the same geometry always yields the exact same boundaries', () => {
  const geometry = lineOfLengthKm(205)
  assert.deepEqual(buildRouteSegments(geometry), buildRouteSegments(geometry))
})

test('BF: the retry length (30 km) genuinely produces smaller segments than the normal pass', () => {
  const geometry = lineOfLengthKm(205)
  const normal = buildRouteSegments(geometry)
  const retry = buildRouteSegments(geometry, RETRY_POSTPASS_SEGMENT_KM)
  assert.ok(retry.length > normal.length, 'a retry sends more, smaller queries — never the same slow one again')
  for (const segment of retry) {
    assert.ok(segment.endDistanceKm - segment.startDistanceKm <= RETRY_POSTPASS_SEGMENT_KM + 0.001)
  }
})

test('every segment carries a usable line (at least two points), never a degenerate single point', () => {
  for (const segment of buildRouteSegments(lineOfLengthKm(205))) {
    assert.ok(segment.geometry.length >= 2, `segment ${segment.index} has ${segment.geometry.length} point(s)`)
  }
})

test('a geometry too short to describe a line yields no segment at all', () => {
  assert.deepEqual(buildRouteSegments([]), [])
  assert.deepEqual(buildRouteSegments([{ latitude: 45, longitude: 6, altitudeM: null }]), [])
})
