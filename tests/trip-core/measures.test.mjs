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

test('totalDurationSeconds must equal movingDurationSeconds + pauseDurationSeconds when all three are present', () => {
  const bundle = createGenericTripBundle()
  assert.equal(
    bundle.stages[0].totalDurationSeconds,
    bundle.stages[0].movingDurationSeconds + bundle.stages[0].pauseDurationSeconds,
  )
  assert.equal(validateTripBundle(bundle).ok, true)

  bundle.stages[0].totalDurationSeconds += 1
  assert.ok(issueCodes(validateTripBundle(bundle)).includes('inconsistent-duration'))
})

test('duration coherence is not checked when one of the three values is still null', () => {
  const bundle = createGenericTripBundle()
  bundle.stages[0].pauseDurationSeconds = null
  // totalDurationSeconds no longer matches movingDurationSeconds alone, but with
  // pauseDurationSeconds null the coherence check must not fire (nothing to compare).
  const result = validateTripBundle(bundle)
  assert.equal(result.ok, true)
})

test('estimatedAverageSpeedKph must be strictly positive, not merely non-negative', () => {
  const bundle = createGenericTripBundle()
  bundle.stages[0].estimatedAverageSpeedKph = 0
  assert.ok(issueCodes(validateTripBundle(bundle)).includes('invalid-value'))
})

test('a negative estimatedAverageSpeedKph is rejected', () => {
  const bundle = createGenericTripBundle()
  bundle.stages[0].estimatedAverageSpeedKph = -5
  assert.ok(issueCodes(validateTripBundle(bundle)).includes('invalid-value'))
})
