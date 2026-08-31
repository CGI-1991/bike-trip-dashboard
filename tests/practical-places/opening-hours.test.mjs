import assert from 'node:assert/strict'
import test from 'node:test'

import { evaluateOpeningAtPassage } from '../../src/practical-places/opening-hours.ts'

const MONDAY = 1
const SUNDAY = 0
const SATURDAY = 6

test('Z: 24/7 is always open, any day, any hour', () => {
  assert.equal(evaluateOpeningAtPassage('24/7', SUNDAY, 3 * 60).status, 'open')
  assert.equal(evaluateOpeningAtPassage('24/7', SATURDAY, 23 * 60 + 59).status, 'open')
})

test('AA: Mo-Fr 08:00-18:00, Monday 12:30 → open', () => {
  const evaluation = evaluateOpeningAtPassage('Mo-Fr 08:00-18:00', MONDAY, 12 * 60 + 30)
  assert.equal(evaluation.status, 'open')
  assert.equal(evaluation.passageLocalTime, '12:30')
})

test('AB: same rule, Monday 19:00 → closed', () => {
  assert.equal(evaluateOpeningAtPassage('Mo-Fr 08:00-18:00', MONDAY, 19 * 60).status, 'closed')
})

test('AC: same rule, Sunday → closed (not in the day selector at all)', () => {
  assert.equal(evaluateOpeningAtPassage('Mo-Fr 08:00-18:00', SUNDAY, 12 * 60).status, 'closed')
})

test('a single-day selector (Sa 08:00-13:00) only opens on Saturday', () => {
  assert.equal(evaluateOpeningAtPassage('Sa 08:00-13:00', SATURDAY, 9 * 60).status, 'open')
  assert.equal(evaluateOpeningAtPassage('Sa 08:00-13:00', MONDAY, 9 * 60).status, 'closed')
})

test('Mo-Sa 07:00-19:00 covers the whole working week plus Saturday', () => {
  assert.equal(evaluateOpeningAtPassage('Mo-Sa 07:00-19:00', SATURDAY, 8 * 60).status, 'open')
  assert.equal(evaluateOpeningAtPassage('Mo-Sa 07:00-19:00', SUNDAY, 8 * 60).status, 'closed')
})

test('a comma-separated day list works alongside a range', () => {
  const rule = 'Mo,We,Fr 09:00-12:00'
  assert.equal(evaluateOpeningAtPassage(rule, MONDAY, 10 * 60).status, 'open')
  assert.equal(evaluateOpeningAtPassage(rule, 2 /* Tuesday */, 10 * 60).status, 'closed')
})

test('multiple time ranges in the same day are all honoured', () => {
  const rule = 'Mo-Fr 08:00-12:00,14:00-18:00'
  assert.equal(evaluateOpeningAtPassage(rule, MONDAY, 13 * 60).status, 'closed', 'lunch break')
  assert.equal(evaluateOpeningAtPassage(rule, MONDAY, 15 * 60).status, 'open')
})

test('AE: complex/unsupported syntax (PH, SH, comments) always yields unknown, never a guess', () => {
  for (const expression of ['Mo-Fr 08:00-18:00; PH off', '24/7; SH closed', 'sunrise-sunset', 'Mo-Fr 08:00-18:00 "on appointment"']) {
    assert.equal(evaluateOpeningAtPassage(expression, MONDAY, 10 * 60).status, 'unknown', expression)
  }
})

test('an empty or missing opening_hours is unknown, never closed', () => {
  assert.equal(evaluateOpeningAtPassage(null, MONDAY, 10 * 60).status, 'unknown')
  assert.equal(evaluateOpeningAtPassage('', MONDAY, 10 * 60).status, 'unknown')
  assert.equal(evaluateOpeningAtPassage('   ', MONDAY, 10 * 60).status, 'unknown')
})

test('AF: unknown never leaks a fabricated rawOpeningHours claim as closed — the raw string is preserved verbatim for display', () => {
  const evaluation = evaluateOpeningAtPassage('Mo-Fr 08:00-18:00; PH off', MONDAY, 19 * 60)
  assert.equal(evaluation.status, 'unknown')
  assert.notEqual(evaluation.status, 'closed')
  assert.equal(evaluation.rawOpeningHours, 'Mo-Fr 08:00-18:00; PH off')
  assert.ok(evaluation.reason)
})

test('an overnight range (end <= start) is never guessed at — unknown', () => {
  assert.equal(evaluateOpeningAtPassage('Mo-Su 22:00-06:00', MONDAY, 23 * 60).status, 'unknown')
})

test('a day-range wrapping the week boundary (Fr-Mo) resolves correctly', () => {
  const rule = 'Fr-Mo 10:00-14:00'
  assert.equal(evaluateOpeningAtPassage(rule, SATURDAY, 12 * 60).status, 'open')
  assert.equal(evaluateOpeningAtPassage(rule, SUNDAY, 12 * 60).status, 'open')
  assert.equal(evaluateOpeningAtPassage(rule, 3 /* Wednesday */, 12 * 60).status, 'closed')
})

test('passageLocalTime is always formatted HH:MM regardless of verdict', () => {
  assert.equal(evaluateOpeningAtPassage('24/7', MONDAY, 7 * 60 + 5).passageLocalTime, '07:05')
  assert.equal(evaluateOpeningAtPassage(null, MONDAY, 7 * 60 + 5).passageLocalTime, '07:05')
})
