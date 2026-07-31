import assert from 'node:assert/strict'
import test from 'node:test'

import { validateTripBundle } from '../../src/trip-core/validation/trip-bundle.ts'
import { createGenericTripBundle } from './support/generic-trip-fixture.mjs'

function issueCodes(result) {
  assert.equal(result.ok, false)
  return result.issues.map((issue) => issue.code)
}

test('a trip with no date at all is a valid, undated trip', () => {
  const result = validateTripBundle(createGenericTripBundle({ dated: false }))
  assert.equal(result.ok, true)
})

test('an invalid calendar date string is rejected', () => {
  const bundle = createGenericTripBundle()
  bundle.calendar.startDate = '2027-02-30' // February has no 30th
  assert.ok(issueCodes(validateTripBundle(bundle)).includes('invalid-date'))
})

test('an end date before the start date is rejected', () => {
  const bundle = createGenericTripBundle()
  bundle.calendar.endDate = '2027-01-01'
  assert.ok(issueCodes(validateTripBundle(bundle)).includes('inconsistent-date-range'))
})

test('an unrecognized IANA timezone is rejected', () => {
  const bundle = createGenericTripBundle()
  bundle.calendar.timezone = 'Not/A_Real_Zone'
  assert.ok(issueCodes(validateTripBundle(bundle)).includes('unknown-timezone'))
})

test('a dated day outside the calendar range is rejected', () => {
  const bundle = createGenericTripBundle()
  bundle.days[3].date = '2028-01-01'
  assert.ok(issueCodes(validateTripBundle(bundle)).includes('date-outside-calendar'))
})

test('a day carrying a date while the trip has no calendar is rejected — no false temporal state', () => {
  const bundle = createGenericTripBundle({ dated: false })
  bundle.days[0].date = '2027-05-10'
  assert.ok(issueCodes(validateTripBundle(bundle)).includes('inconsistent-calendar'))
})
