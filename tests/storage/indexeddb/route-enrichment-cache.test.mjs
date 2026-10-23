import './support/setup-fake-indexeddb.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { openTestDatabase } from './support/open-test-database.mjs'
import { createRouteEnrichmentCacheRepository } from '../../../src/storage/indexeddb/route-enrichment-cache-repository.ts'
import { createTripRepository } from '../../../src/storage/indexeddb/trip-repository.ts'
import { OBJECT_STORE_NAMES } from '../../../src/storage/indexeddb/constants.ts'
import { runInTransaction } from '../../../src/storage/indexeddb/transaction.ts'
import { promisifyRequest } from '../../../src/storage/indexeddb/request.ts'
import { createGenericTripBundle } from '../../trip-core/support/generic-trip-fixture.mjs'

const start = '2028-08-03T10:00:00.000Z'
const afterDays = days => new Date(Date.parse(start) + days * 86_400_000).toISOString()
const identity = (chunkKey = 'one', enrichmentType = 'practical-places') => ({ providerId: 'postpass', routeFingerprint: 'route', enrichmentType, chunkKey, engineVersion: 'test@1' })
const readAll = database => runInTransaction(database, [OBJECT_STORE_NAMES.providerCache], 'readonly', tx => promisifyRequest(tx.objectStore(OBJECT_STORE_NAMES.providerCache).getAll()))
const writeRaw = (database, record) => runInTransaction(database, [OBJECT_STORE_NAMES.providerCache], 'readwrite', tx => promisifyRequest(tx.objectStore(OBJECT_STORE_NAMES.providerCache).put(record)))
const records = values => values.filter(value => value.kind === 'route-enrichment-chunk-v1')

test('positive POI answers expire after seven days, empty answers after one, geography after thirty', async () => {
  const database = await openTestDatabase()
  try {
    let time = start
    const cache = createRouteEnrichmentCacheRepository(database, { now: () => time })
    await cache.put(identity('poi'), [{ id: 'water' }], start)
    await cache.put(identity('empty'), [], start)
    await cache.put(identity('geo', 'structural-points'), [{ id: 'village' }], start)
    time = afterDays(1)
    assert.equal(await cache.get(identity('empty')), null)
    assert.ok(await cache.get(identity('poi')))
    time = afterDays(7)
    assert.equal(await cache.get(identity('poi')), null)
    assert.ok(await cache.get(identity('geo', 'structural-points')))
    time = afterDays(30)
    assert.equal(await cache.get(identity('geo', 'structural-points')), null)
  } finally { database.close() }
})

test('legacy unbounded records use their original timestamp, never a new freshness date', async () => {
  const database = await openTestDatabase()
  try {
    let time = start
    const cache = createRouteEnrichmentCacheRepository(database, { now: () => time })
    await cache.put(identity(), [{ id: 'old' }], start)
    const [saved] = records(await readAll(database))
    const { payloadBytes: _, ...legacy } = saved
    await writeRaw(database, { ...legacy, expiresAt: null })
    assert.ok(await cache.get(identity()))
    time = afterDays(7)
    assert.equal(await cache.get(identity()), null)
  } finally { database.close() }
})

test('compaction evicts oldest route answers with headroom and preserves trips and other provider caches', async () => {
  const database = await openTestDatabase()
  try {
    let time = start
    const cache = createRouteEnrichmentCacheRepository(database, { now: () => time, maxEntries: 4 })
    const bundle = createGenericTripBundle()
    const repository = createTripRepository(database)
    await repository.saveTripBundle(bundle)
    await writeRaw(database, { cacheKey: 'geocoding:saved', kind: 'reverse-geocoding-v1', useful: 'preserved' })
    for (let i = 0; i < 5; i++) {
      time = new Date(Date.parse(start) + i * 1000).toISOString()
      await cache.put(identity(String(i)), [{ id: i }], time)
    }
    assert.equal(await cache.get(identity('0')), null)
    assert.equal(await cache.get(identity('1')), null)
    assert.ok(await cache.get(identity('2')))
    assert.ok(await cache.get(identity('4')))
    const all = await readAll(database)
    assert.equal(records(all).length, 3)
    assert.equal(all.find(value => value.cacheKey === 'geocoding:saved').useful, 'preserved')
    assert.deepEqual(await repository.loadTripBundle(bundle.metadata.id), bundle)
  } finally { database.close() }
})

test('byte budget and concurrent repository instances cannot grow the route cache without bound', async () => {
  const database = await openTestDatabase()
  try {
    const options = { now: () => start, maxBytes: 2000 }
    const first = createRouteEnrichmentCacheRepository(database, options)
    const second = createRouteEnrichmentCacheRepository(database, options)
    await Promise.all(Array.from({ length: 10 }, (_, i) => (i % 2 === 0 ? first : second).put(identity(String(i)), [{ text: 'é'.repeat(100) }], start)))
    const retained = records(await readAll(database))
    assert.ok(retained.length > 0 && retained.length < 10)
    assert.ok(retained.reduce((sum, value) => sum + value.payloadBytes, 0) <= options.maxBytes)
    await first.put(identity('too-big'), [{ text: 'x'.repeat(3000) }], start)
    assert.equal(await first.get(identity('too-big')), null)
    assert.ok(await second.get(identity('9')))
  } finally { database.close() }
})

test('expired entries are removed on a later write, while scoped clearing leaves other routes intact', async () => {
  const database = await openTestDatabase()
  try {
    let time = start
    const cache = createRouteEnrichmentCacheRepository(database, { now: () => time })
    await cache.put(identity('expired'), [], start)
    time = afterDays(2)
    const other = { ...identity('other'), routeFingerprint: 'other-route' }
    await cache.put(other, [{ id: 'kept' }], time)
    assert.equal(records(await readAll(database)).length, 1)
    await cache.put(identity('fresh'), [{ id: 'removed' }], time)
    await cache.clearForRouteFingerprints(['route'])
    assert.ok(await cache.get(other))
    assert.equal(await cache.get(identity('fresh')), null)
    await cache.put(identity('new'), [{ id: 'new' }], time)
    const all = await readAll(database)
    assert.equal(all.find(value => value.kind === 'route-enrichment-statistics-v1').entries, records(all).length)
  } finally { database.close() }
})

test('overwriting one answer updates the budget rather than counting a duplicate entry', async () => {
  const database = await openTestDatabase()
  try {
    const cache = createRouteEnrichmentCacheRepository(database, { now: () => start, maxEntries: 2 })
    await cache.put(identity(), [{ text: 'long'.repeat(30) }], start)
    await cache.put(identity(), [{ text: 'short' }], start)
    await cache.put(identity('second'), [], start)
    assert.equal(records(await readAll(database)).length, 2)
    assert.deepEqual((await cache.get(identity())).results, [{ text: 'short' }])
  } finally { database.close() }
})

test('ordinary segment writes use transactional statistics without scanning the whole cache each time', async () => {
  const database = await openTestDatabase()
  const prototype = Object.getPrototypeOf(database.transaction(OBJECT_STORE_NAMES.providerCache).objectStore(OBJECT_STORE_NAMES.providerCache))
  const openCursor = prototype.openCursor
  let scans = 0
  prototype.openCursor = function (...args) { scans++; return openCursor.apply(this, args) }
  try {
    for (let i = 0; i < 40; i++) {
      // Separate repositories model successive stages and a reload.
      const cache = createRouteEnrichmentCacheRepository(database, { now: () => start })
      await cache.put(identity(String(i)), [{ id: i }], start)
    }
    assert.equal(scans, 1, 'the initial recount is shared across repository instances; it is not repeated for every segment')
  } finally { prototype.openCursor = openCursor; database.close() }
})
