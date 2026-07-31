import assert from 'node:assert/strict'
import test from 'node:test'

import { validateTripBundle } from '../../src/trip-core/validation/trip-bundle.ts'
import { createGenericTripBundle } from './support/generic-trip-fixture.mjs'

function issueCodes(result) {
  assert.equal(result.ok, false)
  return result.issues.map((issue) => issue.code)
}

test('a negative distance is rejected', () => {
  const bundle = createGenericTripBundle()
  bundle.stages[0].distanceKm = -1
  assert.ok(issueCodes(validateTripBundle(bundle)).includes('invalid-value'))
})

test('a negative elevation gain (D+) is rejected', () => {
  const bundle = createGenericTripBundle()
  bundle.stages[0].elevationGainM = -50
  assert.ok(issueCodes(validateTripBundle(bundle)).includes('invalid-value'))
})

test('a negative duration is rejected', () => {
  const bundle = createGenericTripBundle()
  bundle.stages[0].totalDurationSeconds = -1
  assert.ok(issueCodes(validateTripBundle(bundle)).includes('invalid-value'))
})

test('an out-of-range latitude is rejected', () => {
  const bundle = createGenericTripBundle()
  bundle.routePoints[0].latitude = 95
  assert.ok(issueCodes(validateTripBundle(bundle)).includes('invalid-value'))
})

test('an out-of-range longitude is rejected', () => {
  const bundle = createGenericTripBundle()
  bundle.routePoints[0].longitude = -185
  assert.ok(issueCodes(validateTripBundle(bundle)).includes('invalid-value'))
})

test('NaN is never accepted anywhere a number is expected', () => {
  const bundle = createGenericTripBundle()
  bundle.climbs[0].averageGradientPercent = Number.NaN
  assert.ok(issueCodes(validateTripBundle(bundle)).includes('invalid-value'))
})

test('Infinity is never accepted anywhere a number is expected', () => {
  const bundle = createGenericTripBundle()
  bundle.stages[0].maxAltitudeM = Number.POSITIVE_INFINITY
  assert.ok(issueCodes(validateTripBundle(bundle)).includes('invalid-value'))
})

test('-Infinity is never accepted anywhere a number is expected', () => {
  const bundle = createGenericTripBundle()
  bundle.stages[0].minAltitudeM = Number.NEGATIVE_INFINITY
  assert.ok(issueCodes(validateTripBundle(bundle)).includes('invalid-value'))
})
