import assert from 'node:assert/strict'
import test from 'node:test'

import { locateAndDeduplicatePracticalPlaces } from '../../src/practical-places/route-proximity.ts'

const geometry = [
  { latitude: 0, longitude: 0, altitudeM: null },
  { latitude: 0, longitude: 0.01, altitudeM: null },
]

function candidate(osmId, overrides = {}) {
  return {
    osmType: 'node', osmId, category: 'bakery', name: `Lieu ${osmId}`,
    latitude: 0.0003, longitude: 0.005, usefulTags: {}, ...overrides,
  }
}

test('route projection sorts by route kilometer and rejects a POI requiring a large detour', () => {
  const places = locateAndDeduplicatePracticalPlaces([
    candidate('late', { longitude: 0.008 }),
    candidate('far', { latitude: 0.01, longitude: 0.004 }),
    candidate('early', { longitude: 0.002 }),
  ], geometry, 250)
  assert.deepEqual(places.map((place) => place.osmId), ['early', 'late'])
  assert.ok(places[0].trackDistanceKm < places[1].trackDistanceKm)
  assert.ok(places.every((place) => place.lateralDistanceMeters < 40))
})

test('deduplication merges repeated OSM objects and same named establishment but keeps useful unnamed water and toilets', () => {
  const places = locateAndDeduplicatePracticalPlaces([
    candidate('bakery-node', { name: 'Chez Léa' }),
    candidate('bakery-node', { name: 'Chez Léa', latitude: 0.0002 }),
    candidate('bakery-way', { osmType: 'way', name: 'CHEZ LEA', latitude: 0.00031, longitude: 0.00501 }),
    candidate('water', { category: 'water', name: null, longitude: 0.006 }),
    candidate('toilets', { category: 'toilet', name: null, longitude: 0.007 }),
    candidate('unnamed-cafe', { category: 'cafe-or-ice-cream', name: null, longitude: 0.008 }),
  ], geometry)
  assert.equal(places.filter((place) => place.name?.includes('Léa')).length, 1)
  assert.ok(places.some((place) => place.category === 'water' && place.name === null))
  assert.ok(places.some((place) => place.category === 'toilet' && place.name === null))
  assert.ok(!places.some((place) => place.osmId === 'unnamed-cafe'))
})

test('anonymous shelter and repair station are kept, while anonymous shops, food and sport are rejected', () => {
  const candidates = [
    candidate('shelter', { category: 'shelter', name: null, usefulTags: { amenity: 'shelter' } }),
    candidate('repair', { category: 'bike-service', name: null, usefulTags: { amenity: 'bicycle_repair_station' } }),
    candidate('bike-shop', { category: 'bike-service', name: null, usefulTags: { shop: 'bicycle' } }),
    candidate('food', { category: 'supermarket', name: null, usefulTags: { shop: 'convenience' } }),
    candidate('sport', { category: 'sports', name: null, usefulTags: { shop: 'sports' } }),
  ]
  assert.deepEqual(locateAndDeduplicatePracticalPlaces(candidates, geometry).map((item) => item.osmId), ['shelter', 'repair'])
})
