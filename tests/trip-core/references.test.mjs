import assert from 'node:assert/strict'
import test from 'node:test'

import { validateTripBundle } from '../../src/trip-core/validation/trip-bundle.ts'
import { createGenericTripBundle } from './support/generic-trip-fixture.mjs'

function issueCodes(result) {
  assert.equal(result.ok, false)
  return result.issues.map((issue) => issue.code)
}

test('a duplicated identifier within a collection is rejected', () => {
  const bundle = createGenericTripBundle()
  bundle.routes[1] = { ...bundle.routes[1], id: bundle.routes[0].id }
  assert.ok(issueCodes(validateTripBundle(bundle)).includes('duplicate-id'))
})

test('an unknown stageId on a ride day is rejected', () => {
  const bundle = createGenericTripBundle()
  bundle.days[0].stageId = 'stage-does-not-exist'
  assert.ok(issueCodes(validateTripBundle(bundle)).includes('unknown-reference'))
})

test('an unknown sourceRouteId on a stage is rejected', () => {
  const bundle = createGenericTripBundle()
  bundle.stages[0].sourceRouteId = 'route-does-not-exist'
  assert.ok(issueCodes(validateTripBundle(bundle)).includes('unknown-reference'))
})

test('an unknown sourceFileId on a route is rejected', () => {
  const bundle = createGenericTripBundle()
  bundle.routes[0].sourceFileId = 'source-file-does-not-exist'
  assert.ok(issueCodes(validateTripBundle(bundle)).includes('unknown-reference'))
})

test('an unknown accommodationId on a day is rejected', () => {
  const bundle = createGenericTripBundle()
  bundle.days[1].accommodationId = 'lodging-does-not-exist'
  assert.ok(issueCodes(validateTripBundle(bundle)).includes('unknown-reference'))
})

test('an unknown climbId referenced by a stage is rejected', () => {
  const bundle = createGenericTripBundle()
  bundle.stages[1].climbIds = ['climb-does-not-exist']
  assert.ok(issueCodes(validateTripBundle(bundle)).includes('unknown-reference'))
})

test('an unknown routePointId referenced by a stage is rejected', () => {
  const bundle = createGenericTripBundle()
  bundle.stages[0].routePointIds = ['point-does-not-exist']
  assert.ok(issueCodes(validateTripBundle(bundle)).includes('unknown-reference'))
})

test('an orphan stage (dayId pointing nowhere) is rejected', () => {
  const bundle = createGenericTripBundle()
  bundle.stages[1].dayId = 'day-does-not-exist'
  assert.ok(issueCodes(validateTripBundle(bundle)).includes('unknown-reference'))
})
