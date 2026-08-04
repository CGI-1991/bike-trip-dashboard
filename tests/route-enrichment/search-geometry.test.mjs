import assert from 'node:assert/strict'
import test from 'node:test'

import { simplifyStructuralSearchGeometry, structuralSearchGeometry } from '../../src/route-enrichment/search-geometry.ts'
import { createGenericTripBundle } from '../trip-core/support/generic-trip-fixture.mjs'

test('long full geometry is reduced to at most 100 points while preserving endpoints and a sharp switchback', () => {
  const points = Array.from({ length: 500 }, (_unused, index) => ({
    latitude: index === 250 ? 45.5 : 45 + index * 0.00001,
    longitude: 6 + index * 0.0001,
    altitudeM: index,
  }))
  const simplified = simplifyStructuralSearchGeometry(points)
  assert.equal(simplified.length, 100)
  assert.deepEqual(simplified[0], points[0])
  assert.deepEqual(simplified.at(-1), points.at(-1))
  assert.ok(simplified.includes(points[250]))
})

test('stored simplified geometry is preferred and full geometry remains available for exact projection', () => {
  const bundle = createGenericTripBundle()
  const route = bundle.routes[0]
  route.geometry.full = [
    { latitude: 45, longitude: 6, altitudeM: 100 },
    { latitude: 45.1, longitude: 6.1, altitudeM: 200 },
    { latitude: 45.2, longitude: 6.2, altitudeM: 300 },
  ]
  route.geometry.simplified = [route.geometry.full[0], route.geometry.full.at(-1)]
  const result = structuralSearchGeometry(route)
  assert.equal(result.source, 'stored-simplified')
  assert.equal(result.geometry.length, 2)
  assert.equal(result.originalPointCount, 2)
  assert.ok(result.maximumDeviationMeters >= 0)
})
