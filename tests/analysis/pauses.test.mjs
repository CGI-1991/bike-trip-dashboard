import assert from 'node:assert/strict'
import test from 'node:test'

import { distributeAutomaticPauses } from '../../src/analysis/pauses.ts'

test('zero break minutes yields no pause anchors', () => {
  assert.deepEqual(distributeAutomaticPauses(50, 0), [])
})

test('zero distance yields no pause anchors', () => {
  assert.deepEqual(distributeAutomaticPauses(0, 60), [])
})

// R3 sections 9-11: each anchor's own duration is now normalized to the
// nearest 5-minute step (CDC: "aucune pause auto 39/77/etc.") — the sum no
// longer needs to match `totalBreakMinutes` exactly any more (the CDC
// explicitly sanctions this small drift: "ne pas produire une durée
// non-multiple de 5 uniquement pour tomber exactement sur un budget
// théorique"). Replaces the old exact-sum assertion below.
test('every anchor duration is a multiple of 5 minutes, and the sum stays reasonably close to the requested total', () => {
  for (const totalBreakMinutes of [7, 47, 60, 61, 119]) {
    const anchors = distributeAutomaticPauses(80, totalBreakMinutes)
    for (const anchor of anchors) assert.equal(anchor.durationMinutes % 5, 0, `${anchor.id}: ${anchor.durationMinutes} min`)
    const sum = anchors.reduce((total, anchor) => total + anchor.durationMinutes, 0)
    // Never drifts by more than half a step per anchor (routeEngineConfig
    // has 3 pause rules) — a generous, structural bound, not a fragile
    // exact-value assertion.
    assert.ok(Math.abs(sum - totalBreakMinutes) <= 3 * 2.5, `sum ${sum} too far from requested ${totalBreakMinutes}`)
  }
})

test('anchors are positioned within the route distance, in ascending order', () => {
  const anchors = distributeAutomaticPauses(100, 60)
  assert.ok(anchors.length > 0)
  for (const anchor of anchors) {
    assert.ok(anchor.distanceKm > 0 && anchor.distanceKm < 100)
  }
  const distances = anchors.map((anchor) => anchor.distanceKm)
  assert.deepEqual(distances, [...distances].sort((a, b) => a - b))
})

test('every anchor has a strictly positive duration — a zero-duration allocation is dropped, not kept as a no-op anchor', () => {
  const anchors = distributeAutomaticPauses(50, 60)
  assert.ok(anchors.every((anchor) => anchor.durationMinutes > 0))
})

test('a very small total normalizes every anchor down to 0 and drops them all — never a fabricated 5-minute pause out of a genuine 1-minute budget', () => {
  assert.deepEqual(distributeAutomaticPauses(50, 1), [])
})

test('a total just past the 5-minute rounding threshold still produces at least one real anchor', () => {
  const anchors = distributeAutomaticPauses(50, 8)
  assert.ok(anchors.length > 0)
  for (const anchor of anchors) assert.equal(anchor.durationMinutes % 5, 0)
})

test('is deterministic across repeated calls with the same input', () => {
  const first = distributeAutomaticPauses(73.4, 60)
  const second = distributeAutomaticPauses(73.4, 60)
  assert.deepEqual(first, second)
})

test('reuses the shared routeEngineConfig.pauseRules by default (3 anchors, morning/main/afternoon)', () => {
  const anchors = distributeAutomaticPauses(100, 60)
  assert.deepEqual(
    anchors.map((anchor) => anchor.id),
    ['morning', 'main', 'afternoon'],
  )
})
