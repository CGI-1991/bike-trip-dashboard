import '../storage/indexeddb/support/setup-fake-indexeddb.mjs'

import assert from 'node:assert/strict'
import test from 'node:test'

import { enrichStoredTripPracticalPlaces, enrichTripPracticalPlaces, PRACTICAL_PLACES_ENGINE_VERSION } from '../../src/practical-places/enrichment.ts'
import { createOverpassPracticalPlacesProvider } from '../../src/practical-places/overpass-provider.ts'
import { createPracticalPlacesCacheRepository } from '../../src/storage/indexeddb/practical-places-cache-repository.ts'
import { createTripRepository } from '../../src/storage/indexeddb/trip-repository.ts'
import { createGenericTripBundle } from '../trip-core/support/generic-trip-fixture.mjs'
import { openTestDatabase } from '../storage/indexeddb/support/open-test-database.mjs'
import { renderTripDetail } from '../../src/ui/trips/trip-detail-view.ts'

function candidate(overrides = {}) {
  return {
    osmType: 'node', osmId: '42', category: 'water', name: null,
    latitude: 45.15, longitude: 6.275,
    usefulTags: { amenity: 'drinking_water', access: 'yes' },
    ...overrides,
  }
}

function provider(findCandidates) {
  return { id: 'mock-practical-provider', sourceType: 'osm', attribution: 'Mock OSM', findCandidates }
}

test('practical-place enrichment persists stage association, route distance, detour, OSM id, useful tags and enrichment date/version across reload', async () => {
  const database = await openTestDatabase()
  try {
    const original = createGenericTripBundle()
    const repository = createTripRepository(database)
    await repository.saveTripBundle(original)
    const report = await enrichStoredTripPracticalPlaces({
      database,
      tripId: original.metadata.id,
      provider: provider(async () => [candidate()]),
      now: () => '2028-08-03T10:00:00.000Z',
    })
    assert.equal(report?.saved, true)
    assert.equal(report?.placeCount, 1)

    const reloaded = await repository.loadTripBundle(original.metadata.id)
    const place = reloaded.practicalPlaces.find((item) => item.provenance.engineVersion === PRACTICAL_PLACES_ENGINE_VERSION)
    assert.ok(place)
    assert.equal(place.stageId, original.stages[0].id)
    assert.deepEqual(place.dayIds, [original.days[0].id])
    assert.ok(place.trackDistanceKm > 0)
    assert.ok(place.detourKm < 0.001)
    assert.equal(place.name, null)
    assert.deepEqual(place.usefulTags, { amenity: 'drinking_water', access: 'yes' })
    assert.equal(place.provenance.sourceId, 'mock-practical-provider:node:42')
    assert.equal(place.provenance.fetchedAt, '2028-08-03T10:00:00.000Z')
    assert.equal(place.provenance.engineVersion, PRACTICAL_PLACES_ENGINE_VERSION)
  } finally {
    database.close()
  }
})

test('route-fingerprint cache prevents a second provider call, including after the enriched bundle is reused', async () => {
  const database = await openTestDatabase()
  try {
    const cache = createPracticalPlacesCacheRepository(database)
    let calls = 0
    const mock = provider(async () => { calls++; return [candidate({ osmId: 'cache' })] })
    const first = await enrichTripPracticalPlaces({
      bundle: createGenericTripBundle(), cache, provider: mock, now: () => '2028-08-03T10:00:00.000Z',
    })
    const second = await enrichTripPracticalPlaces({
      bundle: first.bundle, cache, provider: mock, now: () => '2028-08-04T10:00:00.000Z',
    })
    assert.equal(calls, 1)
    assert.equal(second.cacheHitCount, 1)
    assert.equal(second.placeCount, 1)
  } finally {
    database.close()
  }
})

test('network failure is non-blocking and leaves previously enriched practical places intact', async () => {
  const memoryCache = { async get() { return null }, async put() {} }
  const original = createGenericTripBundle()
  const enriched = await enrichTripPracticalPlaces({
    bundle: original,
    cache: memoryCache,
    provider: provider(async () => [candidate({ osmId: 'preserved' })]),
    now: () => '2028-08-03T10:00:00.000Z',
  })
  const beforeFailure = structuredClone(enriched.bundle.practicalPlaces)
  const failed = await enrichTripPracticalPlaces({
    bundle: enriched.bundle,
    cache: memoryCache,
    provider: provider(async () => { throw new Error('offline') }),
    now: () => '2028-08-04T10:00:00.000Z',
  })
  assert.equal(failed.networkErrorCount, 1)
  assert.deepEqual(failed.bundle.practicalPlaces, beforeFailure)
  assert.equal(failed.bundle.enrichmentMetadata.providers.find((state) => state.provider === 'osm-practical-places')?.status, 'error')
})

test('a realistic Overpass body response reaches persistence and the technical UI end to end', async () => {
  const database = await openTestDatabase()
  try {
    const original = createGenericTripBundle()
    original.practicalPlaces = []
    const repository = createTripRepository(database)
    await repository.saveTripBundle(original)
    const provider = createOverpassPracticalPlacesProvider({
      minimumIntervalMs: 0,
      fetchFn: async () => ({
        ok: true,
        status: 200,
        async json() {
          return { elements: [
            { type: 'node', id: 101, lat: 45.15, lon: 6.275, tags: { amenity: 'drinking_water' } },
            { type: 'way', id: 102, center: { lat: 45.16, lon: 6.29 }, tags: { shop: 'bakery', name: 'Boulangerie du Test' } },
            { type: 'node', id: 103, lat: 45.17, lon: 6.305, tags: { amenity: 'toilets', fee: 'no' } },
          ] }
        },
      }),
    })
    const report = await enrichStoredTripPracticalPlaces({
      database, tripId: original.metadata.id, provider, now: () => '2028-08-03T10:00:00.000Z',
    })
    assert.equal(report?.placeCount, 3)
    const reloaded = await repository.loadTripBundle(original.metadata.id)
    assert.equal(reloaded.practicalPlaces.length, 3)
    assert.equal(reloaded.enrichmentMetadata.providers.find((state) => state.provider === 'osm-practical-places')?.status, 'success')
    const html = renderTripDetail(reloaded)
    assert.match(html, /Eau potable/)
    assert.match(html, /Boulangerie du Test/)
    assert.match(html, /Toilettes/)
    assert.match(html, /© OpenStreetMap contributors/)
  } finally {
    database.close()
  }
})
