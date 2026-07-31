import assert from 'node:assert/strict'
import test from 'node:test'

import { validateTripBundle } from '../../src/trip-core/validation/trip-bundle.ts'
import { createGenericTripBundle } from './support/generic-trip-fixture.mjs'

function issueCodes(result) {
  assert.equal(result.ok, false)
  return result.issues.map((issue) => issue.code)
}

test('a valid override (route-point → routePoints) validates with no issue', () => {
  const result = validateTripBundle(createGenericTripBundle())
  assert.equal(result.ok, true)
})

test('an override with a targetId unknown in any collection is rejected', () => {
  const bundle = createGenericTripBundle()
  bundle.overrides[0].targetId = 'nothing-resolves-to-this'
  assert.ok(issueCodes(validateTripBundle(bundle)).includes('unknown-reference'))
})

test('an override whose targetId exists but in a different collection than targetType is rejected', () => {
  const bundle = createGenericTripBundle()
  // targetType stays 'route-point', but targetId now points at a climb id instead.
  bundle.overrides[0].targetId = bundle.climbs[0].id
  assert.ok(issueCodes(validateTripBundle(bundle)).includes('unknown-reference'))
})

test('each of the six targetType → collection resolutions accepts a valid id', () => {
  const bundle = createGenericTripBundle()
  const cases = [
    ['trip-day', bundle.days[0].id],
    ['ride-stage', bundle.stages[0].id],
    ['route-point', bundle.routePoints[0].id],
    ['climb', bundle.climbs[0].id],
    ['practical-place', bundle.practicalPlaces[0].id],
    ['accommodation', bundle.accommodations[0].id],
  ]
  bundle.overrides = cases.map(([targetType, targetId], index) => ({
    id: `override-${index}`,
    targetType,
    targetId,
    field: 'name',
    value: 'x',
    reason: null,
    createdAt: '2027-01-03T00:00:00.000Z',
  }))
  assert.equal(validateTripBundle(bundle).ok, true)
})

test('an exact duplicate override (same targetType, targetId, field) is rejected', () => {
  const bundle = createGenericTripBundle()
  const [original] = bundle.overrides
  bundle.overrides = [original, { ...original, id: 'override-point-alpha-end-name-2' }]
  assert.ok(issueCodes(validateTripBundle(bundle)).includes('duplicate-override'))
})

test('two overrides on the same target with a different field are not duplicates', () => {
  const bundle = createGenericTripBundle()
  const [original] = bundle.overrides
  bundle.overrides = [original, { ...original, id: 'override-point-alpha-end-elevation', field: 'elevationM', value: 650 }]
  assert.equal(validateTripBundle(bundle).ok, true)
})
