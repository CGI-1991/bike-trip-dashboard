import assert from 'node:assert/strict'
import test from 'node:test'

import { validateTripBundle } from '../../src/trip-core/validation/trip-bundle.ts'
import { createGenericTripBundle } from './support/generic-trip-fixture.mjs'

function issueCodes(result) {
  assert.equal(result.ok, false)
  return result.issues.map((issue) => issue.code)
}

test('a duplicated day index is rejected', () => {
  const bundle = createGenericTripBundle()
  bundle.days[2].index = bundle.days[1].index
  const codes = issueCodes(validateTripBundle(bundle))
  assert.ok(codes.includes('non-contiguous-index'))
})

test('a non-contiguous day index sequence is rejected', () => {
  const bundle = createGenericTripBundle()
  bundle.days[3].index = 7
  const codes = issueCodes(validateTripBundle(bundle))
  assert.ok(codes.includes('non-contiguous-index'))
})

test('days out of ascending order are rejected', () => {
  const bundle = createGenericTripBundle()
  const [first, second, ...rest] = bundle.days
  bundle.days = [second, first, ...rest]
  const codes = issueCodes(validateTripBundle(bundle))
  assert.ok(codes.includes('non-contiguous-index'))
})

test('a ride day without a stageId is rejected', () => {
  const bundle = createGenericTripBundle()
  bundle.days[0].stageId = null
  const codes = issueCodes(validateTripBundle(bundle))
  assert.ok(codes.includes('missing-required'))
})

test('an off day referencing a stage is rejected', () => {
  const bundle = createGenericTripBundle()
  bundle.days[1].stageId = bundle.stages[0].id
  const codes = issueCodes(validateTripBundle(bundle))
  assert.ok(codes.includes('unexpected-value'))
})

test('a stage linked to an off day is rejected', () => {
  const bundle = createGenericTripBundle()
  bundle.stages[1].dayId = bundle.days[1].id // day 1 is an off day
  const codes = issueCodes(validateTripBundle(bundle))
  assert.ok(codes.includes('invalid-reference'))
})

test('a transfer day referencing a stage is rejected — v1 has no transfer stage model', () => {
  const bundle = createGenericTripBundle()
  bundle.days[2].stageId = bundle.stages[0].id // day 2 is a transfer day
  const codes = issueCodes(validateTripBundle(bundle))
  assert.ok(codes.includes('unexpected-value'))
})

test('a stage linked to a transfer day is rejected, exactly like an off day', () => {
  const bundle = createGenericTripBundle()
  bundle.stages[1].dayId = bundle.days[2].id // day 2 is a transfer day
  const codes = issueCodes(validateTripBundle(bundle))
  assert.ok(codes.includes('invalid-reference'))
})

test('two ride stages for the same day are rejected', () => {
  const bundle = createGenericTripBundle()
  bundle.stages[1].dayId = bundle.stages[0].dayId
  const codes = issueCodes(validateTripBundle(bundle))
  assert.ok(codes.includes('duplicate-stage-for-day'))
})

// --- R2 section 2: transferMode/transferDepartureTime/transferArrivalTime —
// purely additive, permissive like transferTiming (no `type === 'transfer'`
// gate), so an old bundle that never had these fields stays valid as-is.

test('a bundle with no transferMode/transferDepartureTime/transferArrivalTime at all (an old/current bundle) validates as-is', () => {
  const bundle = createGenericTripBundle()
  assert.equal(validateTripBundle(bundle).ok, true)
})

test('a transfer day with a valid mode and HH:MM times validates', () => {
  const bundle = createGenericTripBundle()
  bundle.days[2].transferMode = 'Train'
  bundle.days[2].transferDepartureTime = '09:20'
  bundle.days[2].transferArrivalTime = '12:05'
  assert.equal(validateTripBundle(bundle).ok, true)
})

test('an empty-string transferMode is rejected — use undefined to leave it unset', () => {
  const bundle = createGenericTripBundle()
  bundle.days[2].transferMode = ''
  const codes = issueCodes(validateTripBundle(bundle))
  assert.ok(codes.includes('invalid-value'))
})

test('a malformed transferDepartureTime/transferArrivalTime (not HH:MM) is rejected', () => {
  const bundleBadDeparture = createGenericTripBundle()
  bundleBadDeparture.days[2].transferDepartureTime = '9:20am'
  assert.ok(issueCodes(validateTripBundle(bundleBadDeparture)).includes('invalid-value'))

  const bundleBadArrival = createGenericTripBundle()
  bundleBadArrival.days[2].transferArrivalTime = 'noon'
  assert.ok(issueCodes(validateTripBundle(bundleBadArrival)).includes('invalid-value'))
})
