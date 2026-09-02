import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizePauseDurationMinutes, PAUSE_DURATION_STEP_MINUTES } from '../../src/analysis/pause-duration.ts'

test('PAUSE_DURATION_STEP_MINUTES is 5 (CDC R3 section 9)', () => {
  assert.equal(PAUSE_DURATION_STEP_MINUTES, 5)
})

test('I: 39 normalizes to 40', () => {
  assert.equal(normalizePauseDurationMinutes(39), 40)
})

test('J: 77 normalizes to 75', () => {
  assert.equal(normalizePauseDurationMinutes(77), 75)
})

test('the CDC\'s own worked examples: 37→35, 38→40, 42→40, 43→45', () => {
  assert.equal(normalizePauseDurationMinutes(37), 35)
  assert.equal(normalizePauseDurationMinutes(38), 40)
  assert.equal(normalizePauseDurationMinutes(42), 40)
  assert.equal(normalizePauseDurationMinutes(43), 45)
})

test('an already-normalized multiple of 5 stays exactly as-is', () => {
  for (const minutes of [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95]) {
    assert.equal(normalizePauseDurationMinutes(minutes), minutes)
  }
})

test('0 always stays 0 — a genuine "no pause" is never rounded up to a fabricated 5', () => {
  assert.equal(normalizePauseDurationMinutes(0), 0)
})

test('a negative or non-finite value is clamped to 0, never fabricated', () => {
  assert.equal(normalizePauseDurationMinutes(-5), 0)
  assert.equal(normalizePauseDurationMinutes(NaN), 0)
  assert.equal(normalizePauseDurationMinutes(Infinity), 0)
})

test('durations well past 60 min still normalize correctly (65/75/90/95)', () => {
  assert.equal(normalizePauseDurationMinutes(63), 65)
  assert.equal(normalizePauseDurationMinutes(74), 75)
  assert.equal(normalizePauseDurationMinutes(88), 90)
  assert.equal(normalizePauseDurationMinutes(97), 95)
})

test('1-4 minutes round down to 0 rather than up to a fabricated 5', () => {
  assert.equal(normalizePauseDurationMinutes(1), 0)
  assert.equal(normalizePauseDurationMinutes(2), 0)
})

test('3-4 minutes round up to 5', () => {
  assert.equal(normalizePauseDurationMinutes(3), 5)
  assert.equal(normalizePauseDurationMinutes(4), 5)
})
