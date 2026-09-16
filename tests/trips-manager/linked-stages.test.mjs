import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ceilToQuarterHour,
  consolidateLinkedLodging,
  dayDepartureTime,
  detectLinkedLodgingConflicts,
  earliestCompatibleDeparture,
  formatDayMinutes,
  groupDayIdsFor,
  groupHeadDayId,
  initialDepartureAfter,
  initializeLinkedGroupDepartures,
  linkedDayGroups,
  resolveDepartureConflict,
  resolveLinkedScheduleConflicts,
  withDayDepartureTime,
} from '../../src/trips-manager/linked-stages.ts'
import { computeRideArrivalEta } from '../../src/trips-manager/trip-day-temporal-state.ts'
import { validateTripBundle } from '../../src/trip-core/index.ts'
import { resolveSharedInfoDayId } from '../../src/analysis/day-location-fill.ts'
import { createLinkedTripBundle, withLodging } from './support/linked-trip-fixture.mjs'

function minutes(clock) {
  const [hours, mins] = clock.split(':').map(Number)
  return hours * 60 + mins
}

function arrivalMinutes(bundle, dayId) {
  const day = bundle.days.find((candidate) => candidate.id === dayId)
  return computeRideArrivalEta(bundle, day).minutesFromDayStart
}

// --- quarter-hour arithmetic (CDC section 4.A) -------------------------------

test('ceilToQuarterHour rounds up, and leaves a time already on a quarter untouched', () => {
  assert.equal(ceilToQuarterHour(minutes('13:07')), minutes('13:15'))
  assert.equal(ceilToQuarterHour(minutes('13:15')), minutes('13:15'))
  assert.equal(ceilToQuarterHour(minutes('13:16')), minutes('13:30'))
  assert.equal(ceilToQuarterHour(minutes('13:00')), minutes('13:00'))
})

test('the departure proposed when a link is created is the previous ETA + 1 h, rounded up to the quarter — ETA 12:07 gives 13:15', () => {
  assert.equal(initialDepartureAfter(minutes('12:07')), '13:15')
  // Already on a quarter: the proposal stays exactly one hour later.
  assert.equal(initialDepartureAfter(minutes('12:15')), '13:15')
  assert.equal(initialDepartureAfter(minutes('12:00')), '13:00')
})

test('formatDayMinutes refuses to wrap past midnight rather than silently returning 00:xx', () => {
  assert.equal(formatDayMinutes(minutes('23:45')), '23:45')
  assert.equal(formatDayMinutes(24 * 60), null)
  assert.equal(formatDayMinutes(24 * 60 + 30), null)
})

// --- the strict conflict rule (CDC section 4.B) ------------------------------

test('a later ETA that still precedes the next departure is not a conflict — ETA 12:50 with a 13:15 departure changes nothing', () => {
  assert.equal(resolveDepartureConflict(minutes('12:50'), minutes('13:15')), null)
})

test('a departure exactly equal to the previous ETA is accepted', () => {
  assert.equal(resolveDepartureConflict(minutes('13:15'), minutes('13:15')), null)
})

test('less than an hour of slack is accepted — the initial hour was a proposal, not a minimum', () => {
  assert.equal(resolveDepartureConflict(minutes('13:00'), minutes('13:05')), null)
})

test('only a strictly earlier departure conflicts, and it moves to the first quarter at or after the ETA — ETA 13:16 gives 13:30', () => {
  assert.deepEqual(resolveDepartureConflict(minutes('13:16'), minutes('13:15')), { repairedTime: '13:30' })
})

test('a previous stage arriving after midnight leaves no compatible same-day departure, and says so', () => {
  assert.equal(resolveDepartureConflict(24 * 60 + 20, minutes('13:15')), 'overflow')
})

// --- groups ------------------------------------------------------------------

test('a group needs two consecutive linked ride days; an unlinked trip has none', () => {
  assert.deepEqual(linkedDayGroups(createLinkedTripBundle({ rideCount: 3 })), [])
  const pair = createLinkedTripBundle({ rideCount: 3, links: [1] })
  assert.deepEqual(linkedDayGroups(pair), [{ headDayId: 'day-0', dayIds: ['day-0', 'day-1'] }])
  const triple = createLinkedTripBundle({ rideCount: 3, links: [1, 2] })
  assert.deepEqual(linkedDayGroups(triple), [{ headDayId: 'day-0', dayIds: ['day-0', 'day-1', 'day-2'] }])
})

test('an unlinked day is its own group of one, and its own head', () => {
  const bundle = createLinkedTripBundle({ rideCount: 3, links: [1] })
  assert.deepEqual(groupDayIdsFor(bundle, 'day-2'), ['day-2'])
  assert.equal(groupHeadDayId(bundle, 'day-2'), 'day-2')
  assert.equal(groupHeadDayId(bundle, 'day-1'), 'day-0')
})

// --- calendar ----------------------------------------------------------------

test('a group of two shares one calendar date, and the rest of the planning shifts with it', () => {
  const bundle = createLinkedTripBundle({ rideCount: 3, links: [1] })
  assert.deepEqual(bundle.days.map((day) => day.date), ['2028-06-01', '2028-06-01', '2028-06-02'])
  assert.equal(bundle.calendar.endDate, '2028-06-02')
  assert.equal(validateTripBundle(bundle).ok, true)
})

test('a group of three shares one calendar date', () => {
  const bundle = createLinkedTripBundle({ rideCount: 3, links: [1, 2] })
  assert.deepEqual(bundle.days.map((day) => day.date), ['2028-06-01', '2028-06-01', '2028-06-01'])
  assert.equal(bundle.calendar.endDate, '2028-06-01')
  assert.equal(validateTripBundle(bundle).ok, true)
})

test('the validator rejects a link on the first day, and a link across a non-ride day', () => {
  const firstDayLinked = createLinkedTripBundle({ rideCount: 2 })
  firstDayLinked.days[0] = { ...firstDayLinked.days[0], sameCalendarDayAsPrevious: true }
  const firstResult = validateTripBundle(firstDayLinked)
  assert.equal(firstResult.ok, false)
  assert.ok(firstResult.issues.some((issue) => issue.path.endsWith('.sameCalendarDayAsPrevious')))

  // An OFF day carrying the flag is equally refused: a group is only ever
  // made of rides.
  const offLinked = createLinkedTripBundle({ rideCount: 2 })
  offLinked.days[1] = { ...offLinked.days[1], type: 'off', stageId: null, sameCalendarDayAsPrevious: true }
  offLinked.stages = offLinked.stages.filter((stage) => stage.dayId !== 'day-1')
  const offResult = validateTripBundle(offLinked)
  assert.equal(offResult.ok, false)
  assert.ok(offResult.issues.some((issue) => issue.path.endsWith('.sameCalendarDayAsPrevious')))
})

// --- schedule initialisation and resolution ----------------------------------

test('linking initialises only the stage that just became linked, leaving the group head alone', () => {
  const before = createLinkedTripBundle({ rideCount: 2 })
  const after = createLinkedTripBundle({ rideCount: 2, links: [1] })
  const initialized = initializeLinkedGroupDepartures(before, after)

  assert.equal(dayDepartureTime(initialized, 'day-0'), '08:00', 'the first stage keeps its own time')
  assert.equal(dayDepartureTime(initialized, 'day-1'), initialDepartureAfter(arrivalMinutes(after, 'day-0')))
})

test('adding a third stage to an existing pair never rewrites the second stage’s own adjusted time', () => {
  const pair = withDayDepartureTime(createLinkedTripBundle({ rideCount: 3, links: [1] }), 'day-1', '11:45')
  const triple = withDayDepartureTime(createLinkedTripBundle({ rideCount: 3, links: [1, 2] }), 'day-1', '11:45')
  const initialized = initializeLinkedGroupDepartures(pair, triple)

  assert.equal(dayDepartureTime(initialized, 'day-1'), '11:45', 'already linked: untouched')
  assert.equal(dayDepartureTime(initialized, 'day-2'), initialDepartureAfter(arrivalMinutes(initialized, 'day-1')))
})

test('a departure equal to the previous ETA is left alone; one minute earlier is moved to the next quarter', () => {
  const bundle = createLinkedTripBundle({ rideCount: 2, links: [1] })
  const arrival = arrivalMinutes(bundle, 'day-0')

  const exact = withDayDepartureTime(bundle, 'day-1', formatDayMinutes(ceilToQuarterHour(arrival)))
  assert.deepEqual(resolveLinkedScheduleConflicts(exact).adjustments, [], 'a departure at or after the ETA never moves')

  const tooEarly = withDayDepartureTime(bundle, 'day-1', formatDayMinutes(Math.floor(arrival) - 1))
  const resolved = resolveLinkedScheduleConflicts(tooEarly)
  assert.equal(resolved.adjustments.length, 1)
  assert.equal(resolved.adjustments[0].dayId, 'day-1')
  assert.equal(resolved.adjustments[0].to, formatDayMinutes(ceilToQuarterHour(arrival)))
})

test('an ETA that moves EARLIER never drags the next departure with it', () => {
  const bundle = createLinkedTripBundle({ rideCount: 2, links: [1] })
  const late = withDayDepartureTime(withDayDepartureTime(bundle, 'day-0', '10:00'), 'day-1', '20:00')
  const earlier = withDayDepartureTime(late, 'day-0', '06:00')
  const resolved = resolveLinkedScheduleConflicts(earlier)
  assert.deepEqual(resolved.adjustments, [])
  assert.equal(dayDepartureTime(resolved.bundle, 'day-1'), '20:00')
})

test('a conflict propagates through the group only as far as it genuinely has to', () => {
  const bundle = createLinkedTripBundle({ rideCount: 3, links: [1, 2] })
  const arrival0 = arrivalMinutes(bundle, 'day-0')
  // day-1 conflicts; day-2 is deliberately far enough ahead to stay valid
  // even after day-1 moves.
  const staged = withDayDepartureTime(
    withDayDepartureTime(bundle, 'day-1', formatDayMinutes(Math.floor(arrival0) - 1)),
    'day-2',
    '23:30',
  )
  const resolved = resolveLinkedScheduleConflicts(staged)
  assert.deepEqual(resolved.adjustments.map((entry) => entry.dayId), ['day-1'], 'only the conflicting stage moved')
  assert.equal(dayDepartureTime(resolved.bundle, 'day-2'), '23:30')
})

test('a group whose sequence runs past midnight is reported, never wrapped back to 00:00', () => {
  const bundle = createLinkedTripBundle({ rideCount: 2, links: [1] })
  const late = withDayDepartureTime(withDayDepartureTime(bundle, 'day-0', '22:00'), 'day-1', '23:30')
  const resolved = resolveLinkedScheduleConflicts(late)
  assert.ok(resolved.overflows.length > 0, 'the incompatibility with a single day is surfaced')
  assert.ok(resolved.adjustments.every((entry) => entry.to >= '00:00' && entry.to <= '23:59'))
})

test('earliestCompatibleDeparture answers null for a day with no linked predecessor', () => {
  const bundle = createLinkedTripBundle({ rideCount: 2, links: [1] })
  assert.equal(earliestCompatibleDeparture(bundle, 'day-0'), null)
  assert.equal(earliestCompatibleDeparture(bundle, 'day-1'), formatDayMinutes(ceilToQuarterHour(arrivalMinutes(bundle, 'day-0'))))
})

// --- lodging -----------------------------------------------------------------

test('a group with one lodging hands it to the group head, and the whole group reads it', () => {
  const before = createLinkedTripBundle({ rideCount: 2 })
  const next = withLodging(createLinkedTripBundle({ rideCount: 2, links: [1] }), 'day-1', { id: 'lodging-a', name: 'Gîte A' })
  const consolidated = consolidateLinkedLodging(before, next, new Map(), () => 'generated-id')

  assert.equal(consolidated.days.find((day) => day.id === 'day-0').accommodationId, 'lodging-a')
  assert.equal(consolidated.days.find((day) => day.id === 'day-1').accommodationId, null)
  assert.equal(resolveSharedInfoDayId(consolidated, consolidated.days[1]), 'day-0', 'the linked stage reads the head’s lodging')
  assert.equal(validateTripBundle(consolidated).ok, true)
})

test('two different lodgings in one group are never merged silently — the caller’s choice decides', () => {
  const before = createLinkedTripBundle({ rideCount: 2 })
  let next = withLodging(createLinkedTripBundle({ rideCount: 2, links: [1] }), 'day-0', { id: 'lodging-a', name: 'Gîte A' })
  next = withLodging(next, 'day-1', { id: 'lodging-b', name: 'Hôtel B' })

  const conflicts = detectLinkedLodgingConflicts(next)
  assert.equal(conflicts.length, 1)
  assert.deepEqual(conflicts[0].options.map((option) => option.accommodationId), ['lodging-a', 'lodging-b'])

  const consolidated = consolidateLinkedLodging(before, next, new Map([['day-0', 'lodging-b']]), () => 'generated-id')
  assert.equal(consolidated.days.find((day) => day.id === 'day-0').accommodationId, 'lodging-b')
  assert.deepEqual(consolidated.accommodations.map((entry) => entry.id), ['lodging-b'], 'the discarded record is pruned, not orphaned')
  assert.equal(validateTripBundle(consolidated).ok, true)
})

test('splitting a group leaves BOTH sub-groups with the lodging, as independent copies', () => {
  const linkedBundle = withLodging(createLinkedTripBundle({ rideCount: 2, links: [1] }), 'day-0', { id: 'lodging-a', name: 'Gîte A' })
  const split = createLinkedTripBundle({ rideCount: 2 })
  const splitWithLodging = withLodging(split, 'day-0', { id: 'lodging-a', name: 'Gîte A' })

  const consolidated = consolidateLinkedLodging(linkedBundle, splitWithLodging, new Map(), () => 'lodging-copy')
  assert.equal(consolidated.days.find((day) => day.id === 'day-0').accommodationId, 'lodging-a')
  assert.equal(consolidated.days.find((day) => day.id === 'day-1').accommodationId, 'lodging-copy', 'the detached stage keeps a copy of its own')
  const copy = consolidated.accommodations.find((entry) => entry.id === 'lodging-copy')
  assert.equal(copy.name, 'Gîte A', 'same content, its own identity — edits diverge from here on')
  assert.equal(validateTripBundle(consolidated).ok, true)
})
