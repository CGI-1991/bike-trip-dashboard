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

test('a dated day whose date does not match calendar.startDate + index is rejected', () => {
  const bundle = createGenericTripBundle()
  bundle.days[3].date = '2028-01-01'
  assert.ok(issueCodes(validateTripBundle(bundle)).includes('inconsistent-day-date'))
})

test('a day carrying a date while the trip has no calendar is rejected — no false temporal state', () => {
  const bundle = createGenericTripBundle({ dated: false })
  bundle.days[0].date = '2027-05-10'
  assert.ok(issueCodes(validateTripBundle(bundle)).includes('inconsistent-calendar'))
})

// --- metadata / calendar consistency (calendar is the operational structure;
// metadata.startDate/endDate/timezone are a required, always-consistent projection) ---

test('identical metadata and calendar dates/timezone validate with no consistency issue', () => {
  const dated = validateTripBundle(createGenericTripBundle({ dated: true }))
  const undated = validateTripBundle(createGenericTripBundle({ dated: false }))
  assert.equal(dated.ok, true)
  assert.equal(undated.ok, true)
})

test('a metadata.startDate that differs from calendar.startDate is rejected', () => {
  const bundle = createGenericTripBundle()
  bundle.metadata.startDate = '2027-05-11'
  assert.ok(issueCodes(validateTripBundle(bundle)).includes('inconsistent-metadata-calendar'))
})

test('a metadata.endDate that differs from calendar.endDate is rejected', () => {
  const bundle = createGenericTripBundle()
  bundle.metadata.endDate = '2027-05-20'
  assert.ok(issueCodes(validateTripBundle(bundle)).includes('inconsistent-metadata-calendar'))
})

test('a metadata.timezone that differs from calendar.timezone is rejected', () => {
  const bundle = createGenericTripBundle()
  bundle.metadata.timezone = 'America/Chicago'
  assert.ok(issueCodes(validateTripBundle(bundle)).includes('inconsistent-metadata-calendar'))
})

test('null metadata/calendar dates and timezone are consistent (undated trip)', () => {
  const bundle = createGenericTripBundle({ dated: false })
  assert.equal(bundle.metadata.startDate, null)
  assert.equal(bundle.calendar.startDate, null)
  const result = validateTripBundle(bundle)
  assert.equal(result.ok, true)
})

// --- full dated/undated calendar contract (v1 supports exactly these two states) ---

test('a dated trip requires calendar.endDate whenever calendar.startDate is set', () => {
  const bundle = createGenericTripBundle()
  bundle.calendar.endDate = null
  bundle.metadata.endDate = null // keep metadata/calendar consistent to isolate this check
  const codes = issueCodes(validateTripBundle(bundle))
  assert.ok(codes.includes('missing-required'))
})

test('a dated trip requires calendar.timezone whenever calendar.startDate is set', () => {
  const bundle = createGenericTripBundle()
  bundle.calendar.timezone = null
  bundle.metadata.timezone = null
  const codes = issueCodes(validateTripBundle(bundle))
  assert.ok(codes.includes('missing-required'))
})

test('calendar.endDate set without calendar.startDate is rejected — no ambiguous partial calendar', () => {
  const bundle = createGenericTripBundle({ dated: false })
  bundle.calendar.endDate = '2027-05-13'
  bundle.metadata.endDate = '2027-05-13'
  const codes = issueCodes(validateTripBundle(bundle))
  assert.ok(codes.includes('missing-required'))
})

test('every day gets the exact date derived from calendar.startDate + index civil days', () => {
  const bundle = createGenericTripBundle({ dated: true })
  assert.deepEqual(
    bundle.days.map((day) => day.date),
    ['2027-05-10', '2027-05-11', '2027-05-12', '2027-05-13'],
  )
  assert.equal(validateTripBundle(bundle).ok, true)
})

test('a missing day date on a dated trip is rejected', () => {
  const bundle = createGenericTripBundle()
  bundle.days[1].date = null
  const codes = issueCodes(validateTripBundle(bundle))
  assert.ok(codes.includes('missing-required'))
})

test("calendar.endDate must match the trip's actual duration (startDate + days.length - 1)", () => {
  const bundle = createGenericTripBundle()
  // Days keep their correctly derived dates (2027-05-10..13); only endDate is pushed out —
  // this isolates the calendar-duration check from the per-day exact-date check.
  bundle.calendar.endDate = '2027-05-14'
  bundle.metadata.endDate = '2027-05-14' // keep metadata/calendar consistent to isolate this check
  const codes = issueCodes(validateTripBundle(bundle))
  assert.ok(codes.includes('inconsistent-duration'))
})
