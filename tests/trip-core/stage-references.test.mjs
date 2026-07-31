import assert from 'node:assert/strict'
import test from 'node:test'

import { validateTripBundle } from '../../src/trip-core/validation/trip-bundle.ts'
import { createGenericTripBundle } from './support/generic-trip-fixture.mjs'

function issueCodes(result) {
  assert.equal(result.ok, false)
  return result.issues.map((issue) => issue.code)
}

function issuePaths(result) {
  assert.equal(result.ok, false)
  return result.issues.map((issue) => issue.path)
}

test('a climb on the correct route is accepted', () => {
  const bundle = createGenericTripBundle()
  bundle.stages[1].climbIds = [bundle.climbs[0].id] // climb belongs to route2, same as stage2
  assert.equal(validateTripBundle(bundle).ok, true)
})

test('a climb that exists but belongs to a different route is rejected, with a precise path', () => {
  const bundle = createGenericTripBundle()
  // climbs[0].routeId is route2; attach it to stage 0, whose sourceRouteId is route1.
  bundle.stages[0].climbIds = [bundle.climbs[0].id]
  const result = validateTripBundle(bundle)
  assert.ok(issueCodes(result).includes('route-mismatch'))
  assert.ok(issuePaths(result).includes('stages[0].climbIds[0]'))
})

test('a routePoint that exists but belongs to a different route is rejected, with a precise path', () => {
  const bundle = createGenericTripBundle()
  // routePoints[2] (point3) belongs to route2; attach it to stage 0, whose sourceRouteId is route1.
  bundle.stages[0].routePointIds = [bundle.routePoints[0].id, bundle.routePoints[2].id]
  const result = validateTripBundle(bundle)
  assert.ok(issueCodes(result).includes('route-mismatch'))
  assert.ok(issuePaths(result).includes('stages[0].routePointIds[1]'))
})

test('a duplicated climbId within one stage is rejected', () => {
  const bundle = createGenericTripBundle()
  bundle.stages[1].climbIds = [bundle.climbs[0].id, bundle.climbs[0].id]
  const result = validateTripBundle(bundle)
  assert.ok(issueCodes(result).includes('duplicate-reference'))
  assert.ok(issuePaths(result).includes('stages[1].climbIds[1]'))
})

test('a duplicated routePointId within one stage is rejected', () => {
  const bundle = createGenericTripBundle()
  bundle.stages[0].routePointIds = [bundle.routePoints[0].id, bundle.routePoints[0].id]
  const result = validateTripBundle(bundle)
  assert.ok(issueCodes(result).includes('duplicate-reference'))
  assert.ok(issuePaths(result).includes('stages[0].routePointIds[1]'))
})
