import assert from 'node:assert/strict'
import test from 'node:test'

import { validateTripBundle } from '../../src/trip-core/validation/trip-bundle.ts'
import { createGenericTripBundle } from './support/generic-trip-fixture.mjs'

function issueCodes(result) {
  assert.equal(result.ok, false)
  return result.issues.map((issue) => issue.code)
}

// Route geometry points must be bounds-checked exactly like RoutePoint/PracticalPlace/
// Accommodation coordinates — not merely "finite" (a plain isFiniteNumber check would
// happily accept latitude 400).

test('route geometry accepts the exact latitude/longitude boundaries', () => {
  const bundle = createGenericTripBundle()
  bundle.routes[0].geometry = {
    full: null,
    simplified: [
      { latitude: 90, longitude: 180, altitudeM: null },
      { latitude: -90, longitude: -180, altitudeM: null },
    ],
  }
  const result = validateTripBundle(bundle)
  assert.equal(result.ok, true)
})

test('route geometry rejects a latitude beyond 90', () => {
  const bundle = createGenericTripBundle()
  bundle.routes[0].geometry = { full: null, simplified: [{ latitude: 90.0001, longitude: 0, altitudeM: null }] }
  assert.ok(issueCodes(validateTripBundle(bundle)).includes('invalid-value'))
})

test('route geometry rejects a longitude beyond 180', () => {
  const bundle = createGenericTripBundle()
  bundle.routes[0].geometry = { full: null, simplified: [{ latitude: 0, longitude: 180.0001, altitudeM: null }] }
  assert.ok(issueCodes(validateTripBundle(bundle)).includes('invalid-value'))
})

test('route geometry rejects NaN coordinates', () => {
  const bundle = createGenericTripBundle()
  bundle.routes[0].geometry = { full: null, simplified: [{ latitude: Number.NaN, longitude: 0, altitudeM: null }] }
  assert.ok(issueCodes(validateTripBundle(bundle)).includes('invalid-value'))
})

test('route geometry rejects Infinity coordinates', () => {
  const bundle = createGenericTripBundle()
  bundle.routes[0].geometry = { full: null, simplified: [{ latitude: 0, longitude: Number.POSITIVE_INFINITY, altitudeM: null }] }
  assert.ok(issueCodes(validateTripBundle(bundle)).includes('invalid-value'))
})

test('a routePoint accepts the exact latitude/longitude boundaries', () => {
  const bundle = createGenericTripBundle()
  bundle.routePoints[0].latitude = -90
  bundle.routePoints[0].longitude = -180
  const result = validateTripBundle(bundle)
  assert.equal(result.ok, true)
})

test('a practicalPlace accepts the exact latitude/longitude boundaries', () => {
  const bundle = createGenericTripBundle()
  bundle.practicalPlaces[0].latitude = 90
  bundle.practicalPlaces[0].longitude = 180
  const result = validateTripBundle(bundle)
  assert.equal(result.ok, true)
})
