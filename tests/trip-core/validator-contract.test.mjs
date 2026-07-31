import assert from 'node:assert/strict'
import test from 'node:test'

import { validateTripBundle } from '../../src/trip-core/validation/trip-bundle.ts'
import { createGenericTripBundle } from './support/generic-trip-fixture.mjs'

test('the validator never throws on a very incomplete value', () => {
  for (const input of [undefined, null, 42, 'not a bundle', [], {}, { schemaVersion: 1 }]) {
    assert.doesNotThrow(() => validateTripBundle(input))
    const result = validateTripBundle(input)
    assert.equal(result.ok, false)
    assert.ok(result.issues.length > 0)
  }
})

test('the validator accumulates every problem instead of stopping at the first one', () => {
  const bundle = createGenericTripBundle()
  bundle.stages[0].distanceKm = -1
  bundle.routePoints[0].latitude = 999
  bundle.metadata.timezone = 'Not/A_Real_Zone'
  const result = validateTripBundle(bundle)
  assert.equal(result.ok, false)
  const paths = result.issues.map((issue) => issue.path)
  assert.ok(paths.includes('stages[0].distanceKm'))
  assert.ok(paths.includes('routePoints[0].latitude'))
  assert.ok(paths.includes('metadata.timezone'))
  assert.ok(result.issues.length >= 3)
})

test('the validator is deterministic: the same broken input yields the same issues, in the same order', () => {
  const bundle = createGenericTripBundle()
  bundle.stages[0].distanceKm = -1
  bundle.routePoints[0].latitude = 999
  bundle.days[2].index = 99

  const first = validateTripBundle(bundle)
  const second = validateTripBundle(bundle)
  assert.equal(first.ok, false)
  assert.deepEqual(first.issues, second.issues)
})

test('the validator never mutates its input', () => {
  const bundle = createGenericTripBundle()
  bundle.stages[0].distanceKm = -1 // deliberately invalid, to also exercise the failing path
  const snapshot = structuredClone(bundle)
  validateTripBundle(bundle)
  assert.deepEqual(bundle, snapshot)
})

test('a value that is not a plain object at the root is rejected without throwing', () => {
  for (const input of [[], 'string', 3.14, true]) {
    const result = validateTripBundle(input)
    assert.equal(result.ok, false)
  }
})

test('a runtime type violation invisible to the TypeScript compiler is still caught', () => {
  // Nothing here stops plain JS from putting a string where the model declares a number —
  // the runtime validator, not the type checker, is what must catch this.
  const bundle = createGenericTripBundle()
  bundle.days[0].index = '0'
  const result = validateTripBundle(bundle)
  assert.equal(result.ok, false)
  assert.ok(result.issues.some((issue) => issue.path === 'days[0].index'))
})

test('issues report a precise path, a stable code, and a human message', () => {
  const bundle = createGenericTripBundle()
  bundle.stages[0].distanceKm = -1
  const result = validateTripBundle(bundle)
  assert.equal(result.ok, false)
  const found = result.issues.find((issue) => issue.path === 'stages[0].distanceKm')
  assert.ok(found)
  assert.equal(found.code, 'invalid-value')
  assert.equal(typeof found.message, 'string')
  assert.ok(found.message.length > 0)
})
