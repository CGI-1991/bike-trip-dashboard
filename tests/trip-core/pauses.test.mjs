import assert from 'node:assert/strict'
import test from 'node:test'

import { validateTripBundle } from '../../src/trip-core/validation/trip-bundle.ts'
import { createGenericTripBundle } from './support/generic-trip-fixture.mjs'

function issueCodes(result) {
  assert.equal(result.ok, false)
  return result.issues.map((issue) => issue.code)
}

test('a valid stage pause plan (one pause, order 0) validates with no issue', () => {
  const result = validateTripBundle(createGenericTripBundle())
  assert.equal(result.ok, true)
})

test('a duplicated pause id within one stage is rejected', () => {
  const bundle = createGenericTripBundle()
  const [pause] = bundle.settings.stages[0].pauses
  bundle.settings.stages[0].pauses = [
    pause,
    { ...pause, order: 1, routePointId: null },
  ]
  assert.ok(issueCodes(validateTripBundle(bundle)).includes('duplicate-id'))
})

test('a duplicated order value within one stage is rejected', () => {
  const bundle = createGenericTripBundle()
  const [pause] = bundle.settings.stages[0].pauses
  bundle.settings.stages[0].pauses = [
    pause,
    { ...pause, id: 'pause-alpha-2', routePointId: null },
  ]
  assert.ok(issueCodes(validateTripBundle(bundle)).includes('duplicate-order'))
})

test('a non-contiguous order sequence (0, 2) is rejected', () => {
  const bundle = createGenericTripBundle()
  const [pause] = bundle.settings.stages[0].pauses
  bundle.settings.stages[0].pauses = [
    pause,
    { ...pause, id: 'pause-alpha-2', order: 2, routePointId: null },
  ]
  assert.ok(issueCodes(validateTripBundle(bundle)).includes('non-contiguous-order'))
})

test('an unknown routePointId on a pause is rejected', () => {
  const bundle = createGenericTripBundle()
  bundle.settings.stages[0].pauses[0].routePointId = 'point-does-not-exist'
  assert.ok(issueCodes(validateTripBundle(bundle)).includes('unknown-reference'))
})

test('a pause routePointId that belongs to a different route than the stage is rejected', () => {
  const bundle = createGenericTripBundle()
  // settings.stages[0] targets stage 0 (sourceRouteId = route1); point3 belongs to route2.
  bundle.settings.stages[0].pauses[0].routePointId = bundle.routePoints[2].id
  assert.ok(issueCodes(validateTripBundle(bundle)).includes('route-mismatch'))
})
