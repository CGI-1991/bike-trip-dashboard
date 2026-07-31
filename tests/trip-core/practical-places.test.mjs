import assert from 'node:assert/strict'
import test from 'node:test'

import { validateTripBundle } from '../../src/trip-core/validation/trip-bundle.ts'
import { createGenericTripBundle } from './support/generic-trip-fixture.mjs'

function issueCodes(result) {
  assert.equal(result.ok, false)
  return result.issues.map((issue) => issue.code)
}

test('a practicalPlace with a valid dayIds array validates with no issue', () => {
  const bundle = createGenericTripBundle()
  assert.deepEqual(bundle.practicalPlaces[0].dayIds, [bundle.days[0].id])
  assert.equal(validateTripBundle(bundle).ok, true)
})

test('an unknown dayId inside a practicalPlace.dayIds is rejected', () => {
  const bundle = createGenericTripBundle()
  bundle.practicalPlaces[0].dayIds = ['day-does-not-exist']
  assert.ok(issueCodes(validateTripBundle(bundle)).includes('unknown-reference'))
})

test('a duplicated dayId inside one practicalPlace.dayIds is rejected', () => {
  const bundle = createGenericTripBundle()
  const dayId = bundle.days[0].id
  bundle.practicalPlaces[0].dayIds = [dayId, dayId]
  assert.ok(issueCodes(validateTripBundle(bundle)).includes('duplicate-reference'))
})

test('a practicalPlace may be associated with more than one day', () => {
  const bundle = createGenericTripBundle()
  bundle.practicalPlaces[0].dayIds = [bundle.days[0].id, bundle.days[3].id]
  assert.equal(validateTripBundle(bundle).ok, true)
})

test('an OFF day association is accepted by the validator when the data actually says so — no invented restriction', () => {
  const bundle = createGenericTripBundle()
  bundle.practicalPlaces[0].dayIds = [bundle.days[1].id] // days[1] is an off day
  assert.equal(validateTripBundle(bundle).ok, true)
})

test('dayIds must be an array of non-empty strings', () => {
  const bundle = createGenericTripBundle()
  bundle.practicalPlaces[0].dayIds = [42]
  assert.ok(issueCodes(validateTripBundle(bundle)).includes('invalid-value'))
})
