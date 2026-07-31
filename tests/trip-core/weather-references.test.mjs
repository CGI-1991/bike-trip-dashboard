import assert from 'node:assert/strict'
import test from 'node:test'

import { validateTripBundle } from '../../src/trip-core/validation/trip-bundle.ts'
import { createGenericTripBundle } from './support/generic-trip-fixture.mjs'

function issueCodes(result) {
  assert.equal(result.ok, false)
  return result.issues.map((issue) => issue.code)
}

test('a fully consistent weather record (dated trip) validates with no issue', () => {
  const result = validateTripBundle(createGenericTripBundle({ dated: true }))
  assert.equal(result.ok, true)
})

test('weather is never required for an undated trip', () => {
  const bundle = createGenericTripBundle({ dated: false })
  assert.deepEqual(bundle.weather, [])
  assert.equal(validateTripBundle(bundle).ok, true)
})

test('an unknown weatherRecordId referenced by a stage is rejected', () => {
  const bundle = createGenericTripBundle()
  bundle.stages[0].weatherRecordIds = ['weather-does-not-exist']
  assert.ok(issueCodes(validateTripBundle(bundle)).includes('unknown-reference'))
})

test('a duplicated weatherRecordId within one stage is rejected', () => {
  const bundle = createGenericTripBundle()
  const weatherId = bundle.weather[0].id
  bundle.stages[0].weatherRecordIds = [weatherId, weatherId]
  assert.ok(issueCodes(validateTripBundle(bundle)).includes('duplicate-reference'))
})

test('a weather record whose dayId does not match the referencing stage is rejected', () => {
  const bundle = createGenericTripBundle()
  // weather[0].dayId is day 0 (stage 0's day); attach it to stage 1 (day 3) instead.
  bundle.stages[1].weatherRecordIds = [bundle.weather[0].id]
  assert.ok(issueCodes(validateTripBundle(bundle)).includes('day-mismatch'))
})

test('a weather record whose routePointId belongs to another route is rejected when referenced by that stage', () => {
  const bundle = createGenericTripBundle()
  // weather[0].routePointId (point1) belongs to route1; point it at a weather record
  // still on day0, but retarget its routePointId to point3 (route2) to break the route match.
  bundle.weather[0].routePointId = bundle.routePoints[2].id
  assert.ok(issueCodes(validateTripBundle(bundle)).includes('route-mismatch'))
})

test('temperatureMinC must not exceed temperatureMaxC', () => {
  const bundle = createGenericTripBundle()
  bundle.weather[0].temperatureMinC = 25
  bundle.weather[0].temperatureMaxC = 10
  assert.ok(issueCodes(validateTripBundle(bundle)).includes('inconsistent-range'))
})

test("a weather record's forDate must match the date of the day it belongs to", () => {
  const bundle = createGenericTripBundle()
  bundle.weather[0].forDate = '2027-05-11'
  assert.ok(issueCodes(validateTripBundle(bundle)).includes('inconsistent-day-date'))
})
