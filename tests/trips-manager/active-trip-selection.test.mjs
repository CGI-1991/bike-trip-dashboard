import assert from 'node:assert/strict'
import test from 'node:test'

import { resolvePreferredActiveTripId, selectMostRelevantTrip } from '../../src/trips-manager/active-trip-selection.ts'

function trip(id, startDate, endDate) {
  return { id, startDate, endDate }
}

const TODAY = '2027-06-15'

test('a trip currently in progress is selected first', () => {
  const trips = [trip('past', '2027-01-01', '2027-01-10'), trip('current', '2027-06-10', '2027-06-20'), trip('future', '2027-09-01', '2027-09-10')]
  assert.equal(selectMostRelevantTrip(trips, TODAY, null), 'current')
})

test('today exactly on the boundary (startDate or endDate) still counts as in progress', () => {
  assert.equal(selectMostRelevantTrip([trip('a', TODAY, '2027-06-20')], TODAY, null), 'a')
  assert.equal(selectMostRelevantTrip([trip('b', '2027-06-01', TODAY)], TODAY, null), 'b')
})

test('with no trip in progress, the nearest upcoming trip is selected', () => {
  const trips = [trip('far', '2027-12-01', '2027-12-10'), trip('near', '2027-07-01', '2027-07-10'), trip('past', '2027-01-01', '2027-01-10')]
  assert.equal(selectMostRelevantTrip(trips, TODAY, null), 'near')
})

test('with no in-progress and no upcoming trip, the last active trip id is used if it still exists', () => {
  const trips = [trip('past-a', '2027-01-01', '2027-01-10'), trip('past-b', '2027-02-01', '2027-02-10')]
  assert.equal(selectMostRelevantTrip(trips, TODAY, 'past-b'), 'past-b')
})

test('a stale lastActiveTripId that no longer exists among the trips is never returned', () => {
  const trips = [trip('past-a', '2027-01-01', '2027-01-10')]
  assert.equal(selectMostRelevantTrip(trips, TODAY, 'deleted-trip'), null)
})

test('with nothing in progress, nothing upcoming, and no valid lastActiveTripId, returns null', () => {
  const trips = [trip('past-a', '2027-01-01', '2027-01-10')]
  assert.equal(selectMostRelevantTrip(trips, TODAY, null), null)
})

test('an empty trip list always returns null', () => {
  assert.equal(selectMostRelevantTrip([], TODAY, 'anything'), null)
})

test('undated trips are never selected as in-progress or upcoming, but can still be the last active trip', () => {
  const trips = [trip('undated', null, null)]
  assert.equal(selectMostRelevantTrip(trips, TODAY, null), null)
  assert.equal(selectMostRelevantTrip(trips, TODAY, 'undated'), 'undated')
})

test('does not depend on Date.now — the same inputs always produce the same output regardless of when the test runs', () => {
  const trips = [trip('current', '2027-06-10', '2027-06-20')]
  const first = selectMostRelevantTrip(trips, TODAY, null)
  const second = selectMostRelevantTrip(trips, TODAY, null)
  assert.equal(first, second)
  assert.equal(first, 'current')
})

test('multiple trips in progress at once (overlapping) resolve deterministically to the earliest start, tie-broken by id', () => {
  const trips = [trip('b', '2027-06-01', '2027-06-30'), trip('a', '2027-06-01', '2027-06-30')]
  assert.equal(selectMostRelevantTrip(trips, TODAY, null), 'a')
})

test('multiple upcoming trips resolve to the nearest one, tie-broken by id on the same startDate', () => {
  const trips = [trip('z', '2027-07-01', '2027-07-05'), trip('a', '2027-07-01', '2027-07-05')]
  assert.equal(selectMostRelevantTrip(trips, TODAY, null), 'a')
})

test('never mutates the input trips array', () => {
  const trips = [trip('b', '2027-07-01', '2027-07-05'), trip('a', '2027-01-01', '2027-01-05')]
  const snapshot = JSON.parse(JSON.stringify(trips))
  selectMostRelevantTrip(trips, TODAY, null)
  assert.deepEqual(trips, snapshot)
})

// --- resolvePreferredActiveTripId (CDC Jalon B4.4 sections 2-3/36: the
// "wrong trip opens" bug fix — an explicit choice must always win over
// automatic selection, never the other way around) -------------------------

test('an explicit choice (stored active trip) wins even when a nearer/in-progress trip exists — CDC B4.4 section 36 test 1', () => {
  const trips = [trip('near', '2027-06-20', '2027-06-25'), trip('far', '2027-09-01', '2027-09-10')]
  // Both are upcoming relative to TODAY; selectMostRelevantTrip alone would
  // pick "near". The user explicitly chose "far" (e.g. clicked its card).
  assert.equal(selectMostRelevantTrip(trips, TODAY, null), 'near', 'sanity check: the automatic fallback alone would pick the nearer trip')
  assert.equal(resolvePreferredActiveTripId(trips, TODAY, 'far'), 'far', 'the explicit choice must survive even though it is not the nearest upcoming trip')
})

test('an explicit choice wins even over a trip currently in progress — CDC B4.4 section 36 test 2', () => {
  const trips = [trip('in-progress', '2027-06-10', '2027-06-20'), trip('chosen', '2027-08-01', '2027-08-10')]
  assert.equal(selectMostRelevantTrip(trips, TODAY, null), 'in-progress', 'sanity check: the automatic fallback alone would pick the in-progress trip')
  assert.equal(resolvePreferredActiveTripId(trips, TODAY, 'chosen'), 'chosen', 'the user\'s explicit pick must win over an in-progress trip they did not choose')
})

test('a stored active trip id that no longer exists (deleted trip) falls back to automatic selection — CDC B4.4 section 36 test 3', () => {
  const trips = [trip('near', '2027-06-20', '2027-06-25'), trip('far', '2027-09-01', '2027-09-10')]
  assert.equal(resolvePreferredActiveTripId(trips, TODAY, 'deleted-trip'), 'near', 'only a genuinely invalid stored id falls through to the automatic fallback')
})

test('no stored active trip id at all (first launch) falls back to automatic selection', () => {
  const trips = [trip('near', '2027-06-20', '2027-06-25'), trip('far', '2027-09-01', '2027-09-10')]
  assert.equal(resolvePreferredActiveTripId(trips, TODAY, null), 'near')
})

test('an explicit choice with no in-progress/upcoming trips at all still wins (an entirely past trip, deliberately reopened)', () => {
  const trips = [trip('past-a', '2027-01-01', '2027-01-10'), trip('past-b', '2027-02-01', '2027-02-10')]
  assert.equal(resolvePreferredActiveTripId(trips, TODAY, 'past-a'), 'past-a')
})
