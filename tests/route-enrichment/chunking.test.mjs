import assert from 'node:assert/strict'
import test from 'node:test'

import { buildRouteChunks } from '../../src/route-enrichment/chunking.ts'

function linearGeometry(pointCount = 101) {
  return Array.from({ length: pointCount }, (_unused, index) => ({
    latitude: 45,
    longitude: 6 + index * 0.01,
    altitudeM: 100 + index,
  }))
}

test('a long route is split into continuous 20-30 km chunks without holes and with bounded query geometry', () => {
  const chunks = buildRouteChunks(linearGeometry(), 25, 20)
  assert.ok(chunks.length >= 3)
  assert.equal(chunks[0].startDistanceKm, 0)
  for (let index = 1; index < chunks.length; index++) {
    assert.equal(chunks[index].startDistanceKm, chunks[index - 1].endDistanceKm)
  }
  assert.ok(chunks.every((chunk) => chunk.geometry.length <= 20))
  assert.ok(chunks.slice(0, -1).every((chunk) => chunk.endDistanceKm - chunk.startDistanceKm >= 20 && chunk.endDistanceKm - chunk.startDistanceKm <= 30))
  assert.deepEqual(chunks.slice(0, -1).map((chunk, index) => chunk.geometry.at(-1)), chunks.slice(1).map((chunk) => chunk.geometry[0]))
})
