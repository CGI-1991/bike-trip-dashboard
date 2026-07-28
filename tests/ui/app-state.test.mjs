import assert from 'node:assert/strict'
import test from 'node:test'

import { getTripPeriod, hashForDay, parseAppHash } from '../../src/ui/app-state.ts'

test('opens Today for an empty or unknown hash', () => {
  assert.equal(parseAppHash('').currentView, 'today')
  assert.equal(parseAppHash('#/unknown').currentView, 'today')
})

test('restores the selected day from a detail hash', () => {
  assert.deepEqual(parseAppHash('#/day/J6'), {
    currentView: 'day-detail',
    selectedDayId: 'J6',
    returnView: 'trip',
  })
  assert.equal(hashForDay('J12'), '#/day/J12')
})

test('selects before, during and after trip periods in Europe/Paris', () => {
  assert.deepEqual(getTripPeriod(new Date('2026-08-01T12:00:00Z')), {
    kind: 'before', dayId: 'J1', daysUntilStart: 11,
  })
  assert.deepEqual(getTripPeriod(new Date('2026-08-17T12:00:00Z')), {
    kind: 'during', dayId: 'J6',
  })
  assert.deepEqual(getTripPeriod(new Date('2026-08-24T12:00:00Z')), {
    kind: 'after', dayId: 'J12',
  })
})

test('keeps OFF days in the calendar selection', () => {
  assert.deepEqual(getTripPeriod(new Date('2026-08-16T12:00:00Z')), {
    kind: 'during', dayId: 'J5',
  })
})
