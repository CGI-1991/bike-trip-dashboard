import assert from 'node:assert/strict'
import test from 'node:test'

import { validateTripBundle } from '../../src/trip-core/validation/trip-bundle.ts'
import { createGenericTripBundle } from './support/generic-trip-fixture.mjs'

function issueCodes(result) {
  assert.equal(result.ok, false)
  return result.issues.map((issue) => issue.code)
}

test('a route with a duplicated segment index is rejected', () => {
  const bundle = createGenericTripBundle()
  bundle.routes[0].segments = [
    { index: 0, name: 'a', distanceKm: 10, elevationGainM: 100, elevationLossM: 50 },
    { index: 0, name: 'b', distanceKm: 20, elevationGainM: 100, elevationLossM: 50 },
  ]
  assert.ok(issueCodes(validateTripBundle(bundle)).includes('non-contiguous-index'))
})

test('a route with a non-contiguous segment index sequence is rejected', () => {
  const bundle = createGenericTripBundle()
  bundle.routes[0].segments = [
    { index: 0, name: 'a', distanceKm: 10, elevationGainM: 100, elevationLossM: 50 },
    { index: 2, name: 'b', distanceKm: 20, elevationGainM: 100, elevationLossM: 50 },
  ]
  assert.ok(issueCodes(validateTripBundle(bundle)).includes('non-contiguous-index'))
})

test('route segments in ascending, contiguous order validate with no issue', () => {
  const bundle = createGenericTripBundle()
  bundle.routes[0].segments = [
    { index: 0, name: 'a', distanceKm: 10, elevationGainM: 100, elevationLossM: 50 },
    { index: 1, name: 'b', distanceKm: 20, elevationGainM: 100, elevationLossM: 50 },
  ]
  assert.equal(validateTripBundle(bundle).ok, true)
})

test('a negative segment distance is rejected', () => {
  const bundle = createGenericTripBundle()
  bundle.routes[0].segments = [{ index: 0, name: null, distanceKm: -1, elevationGainM: null, elevationLossM: null }]
  assert.ok(issueCodes(validateTripBundle(bundle)).includes('invalid-value'))
})

test('strictly increasing profile point distances validate with no issue', () => {
  const bundle = createGenericTripBundle()
  bundle.routes[0].profile = {
    resampleIntervalMeters: 50,
    points: [
      { distanceKm: 0, elevationM: 200, gradePercent: 0 },
      { distanceKm: 0.05, elevationM: 202, gradePercent: 4 },
      { distanceKm: 0.1, elevationM: 205, gradePercent: 6 },
    ],
  }
  assert.equal(validateTripBundle(bundle).ok, true)
})

test('a duplicated profile point distance is rejected', () => {
  const bundle = createGenericTripBundle()
  bundle.routes[0].profile = {
    resampleIntervalMeters: 50,
    points: [
      { distanceKm: 0, elevationM: 200, gradePercent: 0 },
      { distanceKm: 0, elevationM: 202, gradePercent: 4 },
    ],
  }
  assert.ok(issueCodes(validateTripBundle(bundle)).includes('non-increasing-distance'))
})

test('a profile point distance that decreases is rejected', () => {
  const bundle = createGenericTripBundle()
  bundle.routes[0].profile = {
    resampleIntervalMeters: 50,
    points: [
      { distanceKm: 0.1, elevationM: 200, gradePercent: 0 },
      { distanceKm: 0.05, elevationM: 202, gradePercent: 4 },
    ],
  }
  assert.ok(issueCodes(validateTripBundle(bundle)).includes('non-increasing-distance'))
})
