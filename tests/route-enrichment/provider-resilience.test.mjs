import '../storage/indexeddb/support/setup-fake-indexeddb.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createGenericTripBundle } from '../trip-core/support/generic-trip-fixture.mjs'
import { openTestDatabase } from '../storage/indexeddb/support/open-test-database.mjs'
import { createTripRepository } from '../../src/storage/indexeddb/trip-repository.ts'
import { createRouteEnrichmentCacheRepository } from '../../src/storage/indexeddb/route-enrichment-cache-repository.ts'
import { createPostpassRouteEnrichmentProvider } from '../../src/route-enrichment/postpass-provider.ts'
import { createPostpassPracticalPlacesProvider } from '../../src/practical-places/postpass-provider.ts'
import { enrichStoredTripRoute, enrichTripRoute } from '../../src/route-enrichment/enrichment.ts'
import { enrichStoredTripPracticalPlaces, enrichTripPracticalPlaces } from '../../src/practical-places/enrichment.ts'
import { EnrichmentResponseError } from '../../src/route-enrichment/enrichment-failure.ts'
import { isStagePhaseComplete, planStageJobs } from '../../src/route-enrichment/enrichment-jobs.ts'

const now = () => '2028-10-22T12:00:00.000Z'
const geometry = Array.from({ length: 121 }, (_, i) => ({ latitude: 45 + i / 111.195, longitude: 6, altitudeM: 100 }))
function bundle() {
  const value = createGenericTripBundle()
  value.routes[0].geometry = { full: geometry, simplified: null }
  value.routes[1].geometry = { full: null, simplified: null }
  return value
}
const search = () => ({ stageId: 'stage', routeFingerprint: 'fp', geometry, routeLengthKm: 120,
  localityCollectionRadiusMeters: 1800, landmarkCollectionRadiusMeters: 500, corridorRadiusMeters: 530, anchorRadiusMeters: 800, anchors: [] })
const providerKinds = [
  { name: 'geography', create: createPostpassRouteEnrichmentProvider, call: (provider, signal) => provider.findStructuralCandidates(search(), signal), enrich: input => enrichTripRoute({ ...input, idFactory: () => 'generated' }), phase: 'structural' },
  { name: 'services', create: createPostpassPracticalPlacesProvider, call: (provider, signal) => provider.findCandidates(search(), signal), enrich: enrichTripPracticalPlaces, phase: 'practical' },
]
const failures = [
  { name: 'HTML instead of JSON', response: () => new Response('<html>Proxy error</html>'), message: /GeoJSON.*invalide/ },
  { name: 'invalid GeoJSON', response: () => Response.json({ error: 'backend unavailable' }), message: /GeoJSON.*invalide/ },
  { name: 'HTTP 400', response: () => new Response('', { status: 400 }), message: /HTTP 400/ },
  { name: 'HTTP 403', response: () => new Response('', { status: 403 }), message: /HTTP 403/ },
  { name: 'HTTP 501', response: () => new Response('', { status: 501 }), message: /indisponible/ },
]

for (const kind of providerKinds) {
  for (const failure of failures) {
    test(`${kind.name}: ${failure.name} leaves the 120 km plan intact, makes one request and never caches failure as an empty result`, async () => {
      const original = bundle()
      let calls = 0, puts = 0
      const provider = kind.create({ fetchFn: async () => { calls++; return failure.response() } })
      const report = await kind.enrich({ bundle: original, provider, now,
        cache: { async get() { return null }, async put() { puts++ } } })
      assert.equal(calls, 1)
      assert.equal(puts, 0)
      const jobs = report.bundle.enrichmentMetadata.enrichmentJobs.find(entry => entry.stageId === original.stages[0].id).jobs.filter(job => job.kind === kind.phase)
      assert.equal(jobs.length, planStageJobs(120, kind.phase).length)
      assert.equal(jobs.filter(job => job.attempts > 0).length, 1)
      assert.equal(isStagePhaseComplete(report.bundle, original.stages[0].id, kind.phase), false)
      assert.match(report.bundle.enrichmentMetadata.providers.find(state => state.status === 'error').message, failure.message)
      assert.deepEqual(report.bundle.practicalPlaces, original.practicalPlaces)
    })
  }
  test(`${kind.name}: a signal aborted before invocation never starts a fetch`, async () => {
    let calls = 0
    const provider = kind.create({ fetchFn: async () => { calls++; return Response.json({ type: 'FeatureCollection', features: [] }) } })
    await assert.rejects(kind.call(provider, AbortSignal.abort()), { name: 'AbortError' })
    assert.equal(calls, 0)
  })
  test(`${kind.name}: timeout covers a response body that stalls after HTTP headers`, async () => {
    const provider = kind.create({ requestTimeoutMs: 5, fetchFn: async (_url, init) => ({ ok: true, status: 200,
      json: () => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })) }) })
    await assert.rejects(kind.call(provider), { name: 'EnrichmentTimeoutError' })
  })
  test(`${kind.name}: a malformed response has a typed failure, not an empty successful collection`, async () => {
    const provider = kind.create({ fetchFn: async () => new Response('not JSON') })
    await assert.rejects(kind.call(provider), EnrichmentResponseError)
  })
  test(`${kind.name}: a later successful stage preserves the saved explanation of an earlier refusal`, async () => {
    const database = await openTestDatabase()
    try {
      const original = bundle()
      original.routes[1].geometry = { full: geometry.map(point => ({ ...point, latitude: point.latitude + 2 })), simplified: null }
      await createTripRepository(database).saveTripBundle(original)
      const provider = kind.create({ fetchFn: async (_url, init) => {
        const sql = init.body.get('data')
        return sql.includes('LINESTRING(6 45,') ? new Response('', { status: 403 }) : Response.json({ type: 'FeatureCollection', features: [] })
      } })
      const input = { database, tripId: original.metadata.id, provider, now, idFactory: () => 'generated' }
      const report = kind.phase === 'structural' ? await enrichStoredTripRoute(input) : await enrichStoredTripPracticalPlaces(input)
      const state = report.bundle.enrichmentMetadata.providers.find(state => state.provider === (kind.phase === 'structural' ? 'postpass-route-enrichment' : 'postpass-practical-places'))
      assert.equal(state.status, 'partial')
      assert.match(state.message, /HTTP 403/)
      assert.equal(isStagePhaseComplete(report.bundle, original.stages[1].id, kind.phase), true)
    } finally { database.close() }
  })
}

test('cache eviction never removes durable places or restarts a completed trip', async () => {
  const database = await openTestDatabase()
  try {
    const original = bundle()
    const repository = createTripRepository(database)
    await repository.saveTripBundle(original)
    let calls = 0
    const provider = createPostpassPracticalPlacesProvider({ fetchFn: async () => {
      calls++
      return Response.json({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [6, 45.05] }, properties: { osm_type: 'N', osm_id: 123, amenity: 'drinking_water' } }] })
    } })
    const first = await enrichStoredTripPracticalPlaces({ database, tripId: original.metadata.id, provider, now })
    const before = calls
    assert.ok(before > 1)
    const cache = createRouteEnrichmentCacheRepository(database, { now, maxEntries: 1 })
    await cache.put({ providerId: 'eviction', routeFingerprint: 'other', enrichmentType: 'structural-points', engineVersion: 'test' }, [], now())
    const reopened = await enrichStoredTripPracticalPlaces({ database, tripId: original.metadata.id, provider, now: () => '2028-12-22T12:00:00.000Z' })
    assert.equal(calls, before)
    assert.deepEqual(reopened.bundle.practicalPlaces, first.bundle.practicalPlaces)
    assert.ok(reopened.bundle.practicalPlaces.some(place => place.provenance.sourceId?.endsWith(':node:123')))
  } finally { database.close() }
})
