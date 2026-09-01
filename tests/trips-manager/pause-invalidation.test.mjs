import assert from 'node:assert/strict'
import test from 'node:test'

import { deriveStageInvalidation } from '../../src/trips-manager/pause-invalidation.ts'

function pause(overrides = {}) {
  return { id: 'p1', active: true, routePointId: 'rp-1', durationSeconds: 600, order: 0, origin: 'custom', ...overrides }
}

test('AI/AJ: a duration-only change never reports an anchor change', () => {
  const previous = [pause({ durationSeconds: 600 })]
  const next = [pause({ durationSeconds: 1_200 })]
  assert.deepEqual(deriveStageInvalidation(previous, next), { anchorsChanged: false })
})

test('AK: moving a pause to a different waypoint reports an anchor change', () => {
  const previous = [pause({ routePointId: 'rp-1' })]
  const next = [pause({ routePointId: 'rp-2' })]
  assert.deepEqual(deriveStageInvalidation(previous, next), { anchorsChanged: true })
})

test('adding a new active pause changes the anchor set', () => {
  const previous = [pause({ id: 'p1', routePointId: 'rp-1' })]
  const next = [pause({ id: 'p1', routePointId: 'rp-1' }), pause({ id: 'p2', routePointId: 'rp-2' })]
  assert.deepEqual(deriveStageInvalidation(previous, next), { anchorsChanged: true })
})

test('removing a pause (unchecking it) changes the anchor set', () => {
  const previous = [pause({ id: 'p1', routePointId: 'rp-1' }), pause({ id: 'p2', routePointId: 'rp-2' })]
  const next = [pause({ id: 'p1', routePointId: 'rp-1' })]
  assert.deepEqual(deriveStageInvalidation(previous, next), { anchorsChanged: true })
})

test('an inactive pause never contributes to the anchor set either way', () => {
  const previous = [pause({ routePointId: 'rp-1', active: true }), pause({ id: 'p2', routePointId: 'rp-2', active: false })]
  const next = [pause({ routePointId: 'rp-1', active: true }), pause({ id: 'p2', routePointId: 'rp-2', active: true })]
  assert.deepEqual(deriveStageInvalidation(previous, next), { anchorsChanged: true }, 'activating a previously-inactive pause DOES change the effective anchor set')
})

test('re-ordering the same active anchors (no positional/duration change) reports no change', () => {
  const previous = [pause({ id: 'p1', routePointId: 'rp-1', order: 0 }), pause({ id: 'p2', routePointId: 'rp-2', order: 1 })]
  const next = [pause({ id: 'p2', routePointId: 'rp-2', order: 0 }), pause({ id: 'p1', routePointId: 'rp-1', order: 1 })]
  assert.deepEqual(deriveStageInvalidation(previous, next), { anchorsChanged: false })
})

test('no pauses at all on either side reports no change', () => {
  assert.deepEqual(deriveStageInvalidation([], []), { anchorsChanged: false })
})
