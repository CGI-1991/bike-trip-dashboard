import assert from 'node:assert/strict'
import test from 'node:test'

import { CURRENT_TRIP_BUNDLE_SCHEMA_VERSION } from '../../src/trip-core/schema/version.ts'
import { validateTripBundle } from '../../src/trip-core/validation/trip-bundle.ts'
import { migrateTripBundle } from '../../src/trip-core/migrations/migrate-trip-bundle.ts'
import { createGenericTripBundle } from './support/generic-trip-fixture.mjs'

test('CURRENT_TRIP_BUNDLE_SCHEMA_VERSION is 1', () => {
  assert.equal(CURRENT_TRIP_BUNDLE_SCHEMA_VERSION, 1)
})

test('schemaVersion 1 is accepted', () => {
  const result = validateTripBundle(createGenericTripBundle())
  assert.equal(result.ok, true)
})

test('a future schema version is refused by the validator', () => {
  const bundle = createGenericTripBundle()
  bundle.schemaVersion = 2
  bundle.metadata.schemaVersion = 2
  const result = validateTripBundle(bundle)
  assert.equal(result.ok, false)
  assert.ok(result.issues.some((issue) => issue.code === 'unsupported-schema-version'))
})

test('a future schema version is refused by the migrator, explicitly', () => {
  const bundle = createGenericTripBundle()
  bundle.schemaVersion = 2
  const result = migrateTripBundle(bundle)
  assert.equal(result.ok, false)
  assert.ok(result.issues.some((issue) => issue.code === 'unsupported-future-schema-version'))
})

test('an older schema version with no registered migration is refused, not silently accepted', () => {
  const bundle = createGenericTripBundle()
  bundle.schemaVersion = 0
  const result = migrateTripBundle(bundle)
  assert.equal(result.ok, false)
  assert.ok(result.issues.some((issue) => issue.code === 'no-migration-registered'))
})

test('a required field absent from the root is reported', () => {
  const bundle = createGenericTripBundle()
  delete bundle.metadata
  const result = validateTripBundle(bundle)
  assert.equal(result.ok, false)
  assert.ok(result.issues.some((issue) => issue.path === 'metadata'))
})

test('a wrong type on a required field is reported', () => {
  const bundle = createGenericTripBundle()
  bundle.days = 'not-an-array'
  const result = validateTripBundle(bundle)
  assert.equal(result.ok, false)
  assert.ok(result.issues.some((issue) => issue.path === 'days'))
})

test('a non-finite value (NaN/Infinity) is reported, never silently accepted', () => {
  const bundle = createGenericTripBundle()
  bundle.stages[0].distanceKm = Number.NaN
  const result = validateTripBundle(bundle)
  assert.equal(result.ok, false)
  assert.ok(result.issues.some((issue) => issue.path === 'stages[0].distanceKm'))
})
