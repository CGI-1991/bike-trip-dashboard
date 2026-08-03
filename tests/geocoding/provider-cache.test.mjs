import '../storage/indexeddb/support/setup-fake-indexeddb.mjs'

import assert from 'node:assert/strict'
import test from 'node:test'
import { IDBFactory } from 'fake-indexeddb'

import { createGeocodingCacheRepository } from '../../src/storage/indexeddb/provider-cache-repository.ts'
import { openBikeTripDatabase } from '../../src/storage/indexeddb/open-database.ts'

test('geocoding cache reuses nearby coordinates and survives an IndexedDB reload', async () => {
  const factory = new IDBFactory()
  const first = await openBikeTripDatabase(factory)
  const cache = createGeocodingCacheRepository(first)
  await cache.put('mock-osm', { latitude: 50.1, longitude: 4.2 }, { name: 'Lieu en cache', sourceId: 'mock:1' }, '2028-01-01T00:00:00.000Z')
  first.close()

  const second = await openBikeTripDatabase(factory)
  const reloaded = await createGeocodingCacheRepository(second).findNearby('mock-osm', { latitude: 50.1001, longitude: 4.2001 })
  assert.equal(reloaded?.result.name, 'Lieu en cache')
  assert.equal(await createGeocodingCacheRepository(second).findNearby('other-provider', { latitude: 50.1, longitude: 4.2 }), null)
  second.close()
})
