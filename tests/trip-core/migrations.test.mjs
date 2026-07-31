import assert from 'node:assert/strict'
import test from 'node:test'

import { migrateTripBundle } from '../../src/trip-core/migrations/migrate-trip-bundle.ts'
import { createGenericTripBundle } from './support/generic-trip-fixture.mjs'

test('a valid v1 bundle migrates to itself, unchanged, and validates', () => {
  const bundle = createGenericTripBundle()
  const result = migrateTripBundle(bundle)
  assert.equal(result.ok, true)
  assert.deepEqual(result.value, bundle)
})

test('migrating never mutates the input value', () => {
  const bundle = createGenericTripBundle()
  const snapshot = structuredClone(bundle)
  migrateTripBundle(bundle)
  assert.deepEqual(bundle, snapshot)
})

test('a future, unknown schema version is rejected outright', () => {
  const bundle = createGenericTripBundle()
  bundle.schemaVersion = 42
  const result = migrateTripBundle(bundle)
  assert.equal(result.ok, false)
  assert.ok(result.issues.some((issue) => issue.code === 'unsupported-future-schema-version'))
})

test('an old schema version with no registered migration is rejected, not silently upgraded', () => {
  const bundle = createGenericTripBundle()
  bundle.schemaVersion = 0
  const result = migrateTripBundle(bundle)
  assert.equal(result.ok, false)
  assert.ok(result.issues.some((issue) => issue.code === 'no-migration-registered'))
})

test('the migration result is itself run through full validation, not accepted on trust', () => {
  const bundle = createGenericTripBundle()
  bundle.stages[0].distanceKm = -1 // structurally version-1, but otherwise invalid
  const result = migrateTripBundle(bundle)
  assert.equal(result.ok, false)
  assert.ok(result.issues.some((issue) => issue.path === 'stages[0].distanceKm'))
})
