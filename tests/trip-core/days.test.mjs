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

test('two ride stages for the same day are rejected', () => {
  const bundle = createGenericTripBundle()
  bundle.stages[1].dayId = bundle.stages[0].dayId
  const codes = issueCodes(validateTripBundle(bundle))
  assert.ok(codes.includes('duplicate-stage-for-day'))
})
