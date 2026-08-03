import '../storage/indexeddb/support/setup-fake-indexeddb.mjs'

import assert from 'node:assert/strict'
import test from 'node:test'

import { enrichStoredTripEndpoints, enrichTripEndpoints, tripNeedsEndpointGeocoding } from '../../src/geocoding/endpoint-enrichment.ts'
import { createGeocodingCacheRepository } from '../../src/storage/indexeddb/provider-cache-repository.ts'
import { createTripRepository } from '../../src/storage/indexeddb/trip-repository.ts'
import { createGenericTripBundle } from '../trip-core/support/generic-trip-fixture.mjs'
import { openTestDatabase } from '../storage/indexeddb/support/open-test-database.mjs'

function idFactory(prefix = 'geocoded') {
  let counter = 0
  return () => `${prefix}-${counter++}`
}

function successProvider(calls) {
  return {
    id: 'mock-osm',
    sourceType: 'osm',
    attribution: 'Mock OSM',
    async reverse(coordinates) {
      calls.push(coordinates)
      return coordinates.longitude < 6.4
        ? { name: 'Départ lisible', sourceId: 'mock:start' }
        : { name: 'Arrivée lisible', sourceId: 'mock:end' }
    },
  }
}

test('endpoint enrichment persists start/end names, original coordinates and provenance without changing GPX routes', async () => {
  const database = await openTestDatabase()
  try {
    const original = createGenericTripBundle()
    const originalRoutes = structuredClone(original.routes)
    const repository = createTripRepository(database)
    await repository.saveTripBundle(original)
    const calls = []

    const report = await enrichStoredTripEndpoints({
      database,
      tripId: original.metadata.id,
      provider: successProvider(calls),
      idFactory: idFactory(),
      now: () => '2028-02-01T10:00:00.000Z',
    })

    assert.equal(report?.saved, true)
    assert.equal(report?.endpointCount, 4)
    assert.equal(report?.successCount, 2)
    assert.equal(calls.length, 2, 'the route without geometry must not call the provider')
    const reloaded = await repository.loadTripBundle(original.metadata.id)
    assert.ok(reloaded)
    assert.deepEqual(reloaded.routes, originalRoutes, 'route geometry and GPX-derived data stay unchanged')
    assert.equal(reloaded.stages[0].startLocationName, 'Départ lisible')
    assert.equal(reloaded.stages[0].endLocationName, 'Arrivée lisible')
    assert.equal(reloaded.days[0].startLocationName, 'Départ lisible')
    assert.equal(reloaded.days[0].endLocationName, 'Arrivée lisible')
    assert.equal(reloaded.days[0].enrichmentStatus, 'complete')
    assert.equal(reloaded.days[3].enrichmentStatus, 'partial')
    const endpoints = reloaded.routePoints.filter((point) => point.provenance.engineVersion === 'endpoint-geocoding@1')
    assert.deepEqual(endpoints.map(({ type, latitude, longitude }) => ({ type, latitude, longitude })), [
      { type: 'start', latitude: 45.1, longitude: 6.2 },
      { type: 'end', latitude: 45.3, longitude: 6.5 },
    ])
    assert.ok(endpoints.every((point) => point.provenance.sourceType === 'osm' && point.provenance.sourceId?.startsWith('mock:')))
    assert.equal(tripNeedsEndpointGeocoding(reloaded), false, 'a stage without coordinates does not offer an impossible retry')
  } finally {
    database.close()
  }
})

test('a second enrichment of identical endpoints is served from cache with no provider call', async () => {
  const database = await openTestDatabase()
  try {
    const original = createGenericTripBundle()
    const cache = createGeocodingCacheRepository(database)
    const firstCalls = []
    await enrichTripEndpoints({ bundle: original, provider: successProvider(firstCalls), cache, idFactory: idFactory('first'), now: () => '2028-02-01T10:00:00.000Z' })
    const secondCalls = []
    const second = await enrichTripEndpoints({ bundle: original, provider: successProvider(secondCalls), cache, idFactory: idFactory('second'), now: () => '2028-02-02T10:00:00.000Z' })
    assert.equal(firstCalls.length, 2)
    assert.equal(secondCalls.length, 0)
    assert.equal(second.cacheHitCount, 2)
    assert.equal(second.successCount, 2)
  } finally {
    database.close()
  }
})

test('network errors are non-blocking and persist an error state while the existing trip remains usable', async () => {
  const database = await openTestDatabase()
  try {
    const original = createGenericTripBundle()
    const repository = createTripRepository(database)
    await repository.saveTripBundle(original)
    const provider = {
      id: 'offline-osm', sourceType: 'osm', attribution: 'Mock OSM',
      async reverse() { throw new Error('offline') },
    }

    const report = await enrichStoredTripEndpoints({
      database,
      tripId: original.metadata.id,
      provider,
      idFactory: idFactory(),
      now: () => '2028-03-01T10:00:00.000Z',
    })

    assert.equal(report?.saved, true)
    assert.equal(report?.networkErrorCount, 2)
    const reloaded = await repository.loadTripBundle(original.metadata.id)
    assert.ok(reloaded)
    assert.equal(reloaded.stages[0].startLocationName, original.stages[0].startLocationName)
    assert.equal(reloaded.stages[0].endLocationName, original.stages[0].endLocationName)
    assert.equal(reloaded.enrichmentMetadata.providers.find((state) => state.provider === 'osm')?.status, 'error')
    assert.equal(reloaded.days.length, original.days.length)
  } finally {
    database.close()
  }
})
