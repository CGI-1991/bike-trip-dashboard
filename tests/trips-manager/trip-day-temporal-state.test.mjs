import assert from 'node:assert/strict'
import test from 'node:test'

import {
  computeRideArrivalEta,
  deriveTripTemporalState,
  getTripDayTemporalState,
  isTripDayCompleted,
  resolveAdjacentTripDayId,
} from '../../src/trips-manager/trip-day-temporal-state.ts'
import { createGenericTripBundle } from '../trip-core/support/generic-trip-fixture.mjs'

// --- isTripDayCompleted: the single D1 completion rule (CDC D1 section 1),
// exercised directly with synthetic inputs — no bundle/ETA machinery needed
// for the ride/date cases (tests A-E from the CDC's own list). --------------

test('A: a ride day dated strictly before today is completed, regardless of ETA', () => {
  assert.equal(isTripDayCompleted({
    day: { date: '2027-05-09', type: 'ride' }, localDate: '2027-05-10', localMinutes: 600, arrivalEtaMinutes: null,
  }), true)
})

test('B: a ride day dated today, ETA 17:00, now 15:00 — not yet completed', () => {
  assert.equal(isTripDayCompleted({
    day: { date: '2027-05-10', type: 'ride' }, localDate: '2027-05-10', localMinutes: 15 * 60, arrivalEtaMinutes: 17 * 60,
  }), false)
})

test('C: a ride day dated today, ETA 17:00, now 17:01 — completed', () => {
  assert.equal(isTripDayCompleted({
    day: { date: '2027-05-10', type: 'ride' }, localDate: '2027-05-10', localMinutes: 17 * 60 + 1, arrivalEtaMinutes: 17 * 60,
  }), true)
})

test('C bis: exactly at the ETA minute (>=, not >) already counts as completed', () => {
  assert.equal(isTripDayCompleted({
    day: { date: '2027-05-10', type: 'ride' }, localDate: '2027-05-10', localMinutes: 17 * 60, arrivalEtaMinutes: 17 * 60,
  }), true)
})

test('D: a ride day dated today with an unknown ETA never auto-completes, however late it is', () => {
  assert.equal(isTripDayCompleted({
    day: { date: '2027-05-10', type: 'ride' }, localDate: '2027-05-10', localMinutes: 23 * 60, arrivalEtaMinutes: null,
  }), false)
})

test('E: a ride day dated tomorrow is never completed', () => {
  assert.equal(isTripDayCompleted({
    day: { date: '2027-05-11', type: 'ride' }, localDate: '2027-05-10', localMinutes: 60, arrivalEtaMinutes: 17 * 60,
  }), false)
})

test('an OFF/transfer day never checks an ETA — only its own calendar date decides completion', () => {
  const day = { date: '2027-05-10', type: 'off' }
  assert.equal(isTripDayCompleted({ day, localDate: '2027-05-09', localMinutes: 0, arrivalEtaMinutes: null }), false, 'future date: not completed')
  assert.equal(isTripDayCompleted({ day, localDate: '2027-05-10', localMinutes: 23 * 59, arrivalEtaMinutes: null }), false, 'today: never auto-completes mid-day, whatever the hour')
  assert.equal(isTripDayCompleted({ day, localDate: '2027-05-11', localMinutes: 0, arrivalEtaMinutes: null }), true, 'strictly past date: completed')
})

test('an undated day (date === null) is never considered completed', () => {
  assert.equal(isTripDayCompleted({
    day: { date: null, type: 'ride' }, localDate: '2027-05-10', localMinutes: 600, arrivalEtaMinutes: null,
  }), false)
})

test('an unresolved local clock (localDate === null) never marks anything completed', () => {
  assert.equal(isTripDayCompleted({
    day: { date: '2027-01-01', type: 'ride' }, localDate: null, localMinutes: null, arrivalEtaMinutes: null,
  }), false)
})

// --- deriveTripTemporalState against the real fixture: the ETA boundary
// flips the priority day forward mid-day, without waiting for the calendar
// date to change, and never skips a following OFF/transfer day looking for
// the next ride (CDC D1 sections 2/H). ---------------------------------

test('the day-alpha stage carries a real, non-null theoretical arrival ETA (sanity check the fixture has route geometry to compute from)', () => {
  const bundle = createGenericTripBundle()
  const day = bundle.days.find((candidate) => candidate.id === 'day-alpha')
  const eta = computeRideArrivalEta(bundle, day)
  assert.notEqual(eta, null)
  assert.ok(eta.minutesFromDayStart > 8 * 60, 'arrives after its own 08:00 departure')
})

function isoClock(totalMinutes) {
  const hours = String(Math.floor(totalMinutes / 60)).padStart(2, '0')
  const minutes = String(totalMinutes % 60).padStart(2, '0')
  return `${hours}:${minutes}`
}

test('I/2: before the ETA on its own day, the ride is current/priority; right after, priority flips to the following OFF day — same calendar date, no day boundary crossed', () => {
  const bundle = createGenericTripBundle()
  const day = bundle.days.find((candidate) => candidate.id === 'day-alpha')
  const eta = computeRideArrivalEta(bundle, day)
  // `minutesFromDayStart` is a real (fractional) ETA — floor/ceil it to get
  // clean whole-minute boundaries strictly before/at-or-after it.
  const justBefore = isoClock(Math.floor(eta.minutesFromDayStart))
  const justAfter = isoClock(Math.ceil(eta.minutesFromDayStart))

  const beforeEta = deriveTripTemporalState(bundle, `2027-05-10T${justBefore}:00-06:00`)
  assert.equal(beforeEta.priorityDayId, 'day-alpha')
  assert.equal(getTripDayTemporalState(beforeEta, 'day-alpha').completed, false)
  assert.equal(getTripDayTemporalState(beforeEta, 'day-alpha').current, true)

  const afterEta = deriveTripTemporalState(bundle, `2027-05-10T${justAfter}:00-06:00`)
  assert.equal(getTripDayTemporalState(afterEta, 'day-alpha').completed, true, 'K: the day\'s ride moves into "completed" once its ETA passes')
  // H: the very next day is OFF (day-bravo) — it must become the priority
  // day immediately, never skipped over while searching for the next ride.
  assert.equal(afterEta.priorityDayId, 'day-bravo')
})

test('after the whole trip is over, priorityDayId is null', () => {
  const bundle = createGenericTripBundle()
  const state = deriveTripTemporalState(bundle, '2027-06-01T00:00:00-06:00')
  assert.equal(state.priorityDayId, null)
  assert.ok(state.days.every((day) => day.completed))
})

// --- resolveAdjacentTripDayId (O): chronological ‹/› navigation traverses
// every day type — ride, OFF, transfer alike — never just ride days. --------

test('O: previous/next traverse ride → OFF → transfer → ride in chronological order', () => {
  const bundle = createGenericTripBundle()
  assert.equal(resolveAdjacentTripDayId(bundle, 'day-alpha', 1), 'day-bravo')
  assert.equal(resolveAdjacentTripDayId(bundle, 'day-bravo', 1), 'day-charlie')
  assert.equal(resolveAdjacentTripDayId(bundle, 'day-charlie', 1), 'day-delta')
  assert.equal(resolveAdjacentTripDayId(bundle, 'day-charlie', -1), 'day-bravo')
  assert.equal(resolveAdjacentTripDayId(bundle, 'day-bravo', -1), 'day-alpha')
})

test('O: disabled properly at both ends of the trip', () => {
  const bundle = createGenericTripBundle()
  assert.equal(resolveAdjacentTripDayId(bundle, 'day-alpha', -1), null)
  assert.equal(resolveAdjacentTripDayId(bundle, 'day-delta', 1), null)
})
