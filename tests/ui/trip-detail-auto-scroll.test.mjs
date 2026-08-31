import assert from 'node:assert/strict'
import test from 'node:test'

import { createTripDetailAutoScrollSession, scrollTripDayCardIntoView } from '../../src/ui/trip-detail-auto-scroll.ts'

// --- createTripDetailAutoScrollSession: a one-shot gate — a real
// navigation into Voyage arms it, and the very next render of that trip
// consumes it; any later render (weather refresh, an enrichment patch, a
// pause edit, a plain rerender) must NOT re-trigger the scroll (CDC D1
// section 4/test J). --------------------------------------------------------

test('I: entering a trip arms the session, and the first render of that trip consumes it exactly once', () => {
  const session = createTripDetailAutoScrollSession()
  session.enter('trip-1')
  assert.equal(session.consume('trip-1'), true)
  assert.equal(session.consume('trip-1'), false, 'J: a second render (rerender/refresh) must not re-consume — no scroll left to steal')
})

test('J: a render for a different trip does not consume a pending scroll armed for another trip', () => {
  const session = createTripDetailAutoScrollSession()
  session.enter('trip-1')
  assert.equal(session.consume('trip-2'), false)
  // The trip-1 scroll is still pending — an unrelated render never burns it.
  assert.equal(session.consume('trip-1'), true)
})

test('consume() before any enter() never fires', () => {
  const session = createTripDetailAutoScrollSession()
  assert.equal(session.consume('trip-1'), false)
})

test('entering a new trip supersedes a still-pending scroll for a previous one', () => {
  const session = createTripDetailAutoScrollSession()
  session.enter('trip-1')
  session.enter('trip-2')
  assert.equal(session.consume('trip-1'), false, 'the trip-1 arm was replaced, not queued')
  assert.equal(session.consume('trip-2'), true)
})

// --- scrollTripDayCardIntoView: finds the target card by its day id and
// scrolls it into a comfortable position (`block: 'start'`, not snapped to
// the very bottom edge) — never throws when the target is missing. --------

function fakeRoot(elements) {
  return {
    querySelector(selector) {
      const id = selector.match(/data-day-id="([^"]*)"/)?.[1] ?? null
      return elements.find((element) => element.dataset.dayId === id) ?? null
    },
  }
}

function fakeCard(dayId) {
  const calls = []
  return { dataset: { dayId }, scrollIntoView: (options) => calls.push(options), calls }
}

test('M/I: scrolls the matching card into view, aligned to the top rather than the bottom edge', () => {
  const card = fakeCard('day-bravo')
  const root = fakeRoot([fakeCard('day-alpha'), card])
  assert.equal(scrollTripDayCardIntoView(root, 'day-bravo'), true)
  assert.deepEqual(card.calls, [{ block: 'start', behavior: 'auto' }])
})

test('returns false and never throws when the target day card is not in the DOM', () => {
  const root = fakeRoot([fakeCard('day-alpha')])
  assert.equal(scrollTripDayCardIntoView(root, 'day-missing'), false)
})
