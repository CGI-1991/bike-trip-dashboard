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

test('metricsProvenance is required as soon as distanceKm, elevationGainM or elevationLossM is set', () => {
  const bundle = createGenericTripBundle()
  assert.notEqual(bundle.stages[0].distanceKm, null)
  bundle.stages[0].metricsProvenance = null
  assert.ok(issueCodes(validateTripBundle(bundle)).includes('missing-required'))
})

test('metricsProvenance may stay null when distanceKm/elevationGainM/elevationLossM are all null', () => {
  const bundle = createGenericTripBundle()
  assert.equal(bundle.stages[1].distanceKm, null)
  assert.equal(bundle.stages[1].elevationGainM, null)
  assert.equal(bundle.stages[1].elevationLossM, null)
  assert.equal(bundle.stages[1].metricsProvenance, null)
  assert.equal(validateTripBundle(bundle).ok, true)
})

test('an invalid metricsProvenance object is rejected like any other provenance', () => {
  const bundle = createGenericTripBundle()
  bundle.stages[0].metricsProvenance = { sourceType: 'not-a-real-source', sourceId: null, fetchedAt: null, engineVersion: 'x', confidence: null, manuallyOverridden: false }
  assert.ok(issueCodes(validateTripBundle(bundle)).includes('invalid-enum'))
})
