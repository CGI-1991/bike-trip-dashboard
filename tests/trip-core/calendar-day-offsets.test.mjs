import assert from 'node:assert/strict'
import test from 'node:test'

import { calendarDayOffsets, calendarDaySpan, lastCalendarDayOffset } from '../../src/trip-core/calendar/day-offsets.ts'
import { shiftTripStartDate } from '../../src/trips-manager/trip-preferences.ts'
import { validateTripBundle } from '../../src/trip-core/index.ts'
import { createLinkedTripBundle } from '../trips-manager/support/linked-trip-fixture.mjs'

test('with nothing linked, the offsets are exactly the historical day indexes', () => {
  const days = [{}, {}, {}, {}]
  assert.deepEqual(calendarDayOffsets(days), [0, 1, 2, 3])
  assert.equal(lastCalendarDayOffset(days), 3)
  assert.equal(calendarDaySpan(days), 4)
})

test('a linked day does not advance the calendar', () => {
  const days = [{}, { sameCalendarDayAsPrevious: true }, {}, { sameCalendarDayAsPrevious: true }, { sameCalendarDayAsPrevious: true }]
  assert.deepEqual(calendarDayOffsets(days), [0, 0, 1, 1, 1])
  assert.equal(calendarDaySpan(days), 2)
})

test('a flag on the very first day is ignored — there is nothing before it to share a date with', () => {
  assert.deepEqual(calendarDayOffsets([{ sameCalendarDayAsPrevious: true }, {}]), [0, 1])
})

test('an empty trip has no span at all', () => {
  assert.deepEqual(calendarDayOffsets([]), [])
  assert.equal(calendarDaySpan([]), 0)
  assert.equal(lastCalendarDayOffset([]), 0)
})

test('shifting the start date keeps a group on one date and the whole trip valid', () => {
  const bundle = createLinkedTripBundle({ rideCount: 3, links: [1] })
  const shifted = shiftTripStartDate(bundle, '2028-09-10')
  assert.deepEqual(shifted.days.map((day) => day.date), ['2028-09-10', '2028-09-10', '2028-09-11'])
  assert.equal(shifted.calendar.endDate, '2028-09-11')
  assert.equal(shifted.metadata.endDate, '2028-09-11')
  assert.equal(validateTripBundle(shifted).ok, true)
})

test('shifting an unlinked trip behaves exactly as it always did', () => {
  const bundle = createLinkedTripBundle({ rideCount: 3 })
  const shifted = shiftTripStartDate(bundle, '2028-09-10')
  assert.deepEqual(shifted.days.map((day) => day.date), ['2028-09-10', '2028-09-11', '2028-09-12'])
  assert.equal(shifted.calendar.endDate, '2028-09-12')
  assert.equal(validateTripBundle(shifted).ok, true)
})
