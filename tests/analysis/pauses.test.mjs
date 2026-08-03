import assert from 'node:assert/strict'
import test from 'node:test'

import { distributeAutomaticPauses } from '../../src/analysis/pauses.ts'

test('zero break minutes yields no pause anchors', () => {
  assert.deepEqual(distributeAutomaticPauses(50, 0), [])
})

test('zero distance yields no pause anchors', () => {
  assert.deepEqual(distributeAutomaticPauses(0, 60), [])
})

test('the allocated durations always sum to exactly the requested total', () => {
  for (const totalBreakMinutes of [1, 7, 47, 60, 61, 119]) {
    const anchors = distributeAutomaticPauses(80, totalBreakMinutes)
    const sum = anchors.reduce((total, anchor) => total + anchor.durationMinutes, 0)
    assert.equal(sum, totalBreakMinutes, `total for ${totalBreakMinutes} minutes`)
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

test('a very small total (fewer minutes than anchors) still sums exactly, dropping anchors that would round to zero', () => {
  const anchors = distributeAutomaticPauses(50, 1)
  const sum = anchors.reduce((total, anchor) => total + anchor.durationMinutes, 0)
  assert.equal(sum, 1)
  assert.ok(anchors.length <= 3)
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
