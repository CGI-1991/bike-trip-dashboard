import assert from 'node:assert/strict'
import test from 'node:test'

import { estimateAutomaticBreakBudget } from '../../src/analysis/pause-budget.ts'

test('zero or negative distance/duration yields zero break budget', () => {
  assert.equal(estimateAutomaticBreakBudget(0, 100, 0), 0)
  assert.equal(estimateAutomaticBreakBudget(50, 0, 0), 0)
  assert.equal(estimateAutomaticBreakBudget(-5, 100, 0), 0)
  assert.equal(estimateAutomaticBreakBudget(50, -10, 0), 0)
})

test('~50 km at reference speed lands close to the annexe example (~20 min)', () => {
  const movingMinutes = (50 / 18) * 60
  const budget = estimateAutomaticBreakBudget(50, movingMinutes, 0)
  assert.ok(Math.abs(budget - 20) <= 10, `expected close to 20, got ${budget}`)
})

test('~100 km at reference speed lands close to the annexe example (~60 min)', () => {
  const movingMinutes = (100 / 18) * 60
  const budget = estimateAutomaticBreakBudget(100, movingMinutes, 0)
  assert.ok(Math.abs(budget - 60) <= 15, `expected close to 60, got ${budget}`)
})

test('a longer ride gets proportionally more break, not just linearly more', () => {
  const short = estimateAutomaticBreakBudget(50, (50 / 18) * 60, 0)
  const long = estimateAutomaticBreakBudget(150, (150 / 18) * 60, 0)
  const ratio = long / short
  // If the budget were purely linear in distance, ratio would be exactly 3 —
  // the progressive rate must push it above that.
  assert.ok(ratio > 3, `expected more than linear growth, got ratio ${ratio}`)
})

test('a mountainous stage (high D+ per km) gets more break than a flat stage of the same distance/duration', () => {
  const movingMinutes = (80 / 18) * 60
  const flat = estimateAutomaticBreakBudget(80, movingMinutes, 200)
  const mountainous = estimateAutomaticBreakBudget(80, movingMinutes, 2500)
  assert.ok(mountainous > flat)
})

test('elevation gain of null is treated like zero, never throwing', () => {
  assert.doesNotThrow(() => estimateAutomaticBreakBudget(80, 200, null))
  assert.equal(estimateAutomaticBreakBudget(80, 200, null), estimateAutomaticBreakBudget(80, 200, 0))
})

test('the difficulty factor is capped: an absurdly steep stage does not blow up the budget', () => {
  const movingMinutes = (80 / 18) * 60
  const veryMountainous = estimateAutomaticBreakBudget(80, movingMinutes, 8000)
  const extremelyMountainous = estimateAutomaticBreakBudget(80, movingMinutes, 80000)
  assert.equal(veryMountainous, extremelyMountainous, 'both exceed the cap and must clamp to the same value')
})

test('the result never exceeds the 240-minute hard cap even for a very long, very steep day', () => {
  const budget = estimateAutomaticBreakBudget(300, 1200, 12000)
  assert.ok(budget <= 240)
})

test('is monotonically non-decreasing in moving duration, all else equal', () => {
  const distanceKm = 80
  let previous = 0
  for (const hours of [1, 2, 3, 4, 5, 6, 8, 10]) {
    const budget = estimateAutomaticBreakBudget(distanceKm, hours * 60, 0)
    assert.ok(budget >= previous, `expected non-decreasing, ${budget} < ${previous} at ${hours}h`)
    previous = budget
  }
})

test('rounds to the nearest 5 minutes for a clean UX value', () => {
  const budget = estimateAutomaticBreakBudget(73, 250, 300)
  assert.equal(budget % 5, 0)
})

test('is deterministic', () => {
  const a = estimateAutomaticBreakBudget(87.3, 245.7, 1234)
  const b = estimateAutomaticBreakBudget(87.3, 245.7, 1234)
  assert.equal(a, b)
})
