import '../storage/indexeddb/support/setup-fake-indexeddb.mjs'

import assert from 'node:assert/strict'
import test from 'node:test'

import { enrichStoredTripClimbNames, enrichTripClimbNames, tripNeedsClimbNameEnrichment } from '../../src/climb-names/enrichment.ts'
import { selectRelevantClimbName } from '../../src/climb-names/relevance.ts'
import { createClimbNameCacheRepository } from '../../src/storage/indexeddb/climb-name-cache-repository.ts'
import { createTripRepository } from '../../src/storage/indexeddb/trip-repository.ts'
import { createGenericTripBundle } from '../trip-core/support/generic-trip-fixture.mjs'
import { openTestDatabase } from '../storage/indexeddb/support/open-test-database.mjs'

function createClimbBundle(name = 'Montée 1') {
  const bundle = createGenericTripBundle()
  bundle.climbs[0].name = name
  bundle.climbs[0].confidence = name === 'Montée 1' ? 'probable' : 'confirmed'
  bundle.climbs[0].provenance = {
    sourceType: 'generated', sourceId: null, fetchedAt: null,
    engineVersion: 'fixture-climb-detection@1', confidence: 'medium', manuallyOverridden: false,
  }
  bundle.routes[1].geometry = {
    full: [
      { latitude: 45.5, longitude: 6.79, altitudeM: 900 },
      { latitude: 45.55, longitude: 6.8, altitudeM: 1_420 },
    ],
    simplified: null,
  }
  return bundle
}

function candidate(search, overrides = {}) {
  return {
    name: 'Col du Test',
    featureType: 'mountain-pass',
    sourceId: 'overpass-osm:mountain-pass:node:42',
    coordinates: search.coordinates,
    elevationM: search.elevationM,
    ...overrides,
  }
}

function provider(findCandidates) {
  return { id: 'mock-climb-provider', sourceType: 'osm', attribution: 'Mock OSM', findCandidates }
}

test('a relevant OSM pass names the climb and persists provider, type, provenance and timestamp across reload', async () => {
  const database = await openTestDatabase()
  try {
    const original = createClimbBundle()
    const originalRoutes = structuredClone(original.routes)
    const repository = createTripRepository(database)
    await repository.saveTripBundle(original)
    const report = await enrichStoredTripClimbNames({
      database,
      tripId: original.metadata.id,
      provider: provider(async (search) => [
        candidate(search, { name: 'Sommet plus proche', featureType: 'peak', sourceId: 'overpass-osm:peak:node:9' }),
        candidate(search),
      ]),
      now: () => '2028-04-01T10:00:00.000Z',
    })

    assert.equal(report?.saved, true)
    assert.equal(report?.namedCount, 1)
    const reloaded = await repository.loadTripBundle(original.metadata.id)
    assert.ok(reloaded)
    assert.equal(reloaded.climbs[0].name, 'Col du Test', 'a relevant pass outranks a peak')
    assert.equal(reloaded.climbs[0].provenance.sourceType, 'osm')
    assert.equal(reloaded.climbs[0].provenance.sourceId, 'overpass-osm:mountain-pass:node:42')
    assert.equal(reloaded.climbs[0].provenance.fetchedAt, '2028-04-01T10:00:00.000Z')
    assert.equal(reloaded.climbs[0].provenance.engineVersion, 'climb-name-enrichment@1')
    assert.deepEqual(reloaded.routes, originalRoutes, 'the GPX route stays unchanged')
    assert.equal(tripNeedsClimbNameEnrichment(reloaded), false)
  } finally {
    database.close()
  }
})

test('an explicit GPX waypoint name and a manual name both outrank OSM without any provider call', async () => {
  const database = await openTestDatabase()
  try {
    const calls = []
    const mock = provider(async (search) => { calls.push(search); return [candidate(search)] })
    const waypoint = createClimbBundle('Col du Waypoint GPX')
    const waypointResult = await enrichTripClimbNames({ bundle: waypoint, provider: mock, cache: createClimbNameCacheRepository(database), now: () => '2028-04-01T10:00:00.000Z' })
    assert.equal(waypointResult.bundle.climbs[0].name, 'Col du Waypoint GPX')

    const manual = createClimbBundle('Nom manuel')
    manual.climbs[0].provenance = { ...manual.climbs[0].provenance, sourceType: 'user', manuallyOverridden: true }
    const manualResult = await enrichTripClimbNames({ bundle: manual, provider: mock, cache: createClimbNameCacheRepository(database), now: () => '2028-04-01T10:00:00.000Z' })
    assert.equal(manualResult.bundle.climbs[0].name, 'Nom manuel')
    assert.equal(calls.length, 0)
  } finally {
    database.close()
  }
})

test('no result is valid and a distant rolling-terrain peak is rejected instead of forcing a name', async () => {
  const database = await openTestDatabase()
  try {
    const original = createClimbBundle()
    const noResult = await enrichTripClimbNames({
      bundle: original,
      provider: provider(async () => []),
      cache: createClimbNameCacheRepository(database),
      now: () => '2028-04-01T10:00:00.000Z',
    })
    assert.equal(noResult.namedCount, 0)
    assert.equal(noResult.noResultCount, 1)
    assert.equal(noResult.bundle.climbs[0].name, 'Montée 1')

    const summit = { latitude: 50.5, longitude: 4.5 }
    const falsePeak = candidate({ coordinates: summit, elevationM: 180 }, {
      name: 'Sommet voisin sans rapport', featureType: 'peak', sourceId: 'overpass-osm:peak:node:99',
      coordinates: { latitude: 50.502, longitude: 4.5 }, elevationM: 185,
    })
    assert.equal(selectRelevantClimbName([falsePeak], summit, 180), null)
  } finally {
    database.close()
  }
})

test('cached positive and empty results prevent duplicate provider requests', async () => {
  const database = await openTestDatabase()
  try {
    const original = createClimbBundle()
    const cache = createClimbNameCacheRepository(database)
    let calls = 0
    await enrichTripClimbNames({ bundle: original, provider: provider(async () => { calls++; return [] }), cache, now: () => '2028-04-01T10:00:00.000Z' })
    const second = await enrichTripClimbNames({ bundle: original, provider: provider(async () => { calls++; return [] }), cache, now: () => '2028-04-02T10:00:00.000Z' })
    assert.equal(calls, 1)
    assert.equal(second.cacheHitCount, 1)
    assert.equal(second.noResultCount, 1)
  } finally {
    database.close()
  }
})

test('network failure is non-blocking and the unchanged trip reloads with an error state', async () => {
  const database = await openTestDatabase()
  try {
    const original = createClimbBundle()
    const repository = createTripRepository(database)
    await repository.saveTripBundle(original)
    const report = await enrichStoredTripClimbNames({
      database,
      tripId: original.metadata.id,
      provider: provider(async () => { throw new Error('offline') }),
      now: () => '2028-04-03T10:00:00.000Z',
    })
    assert.equal(report?.saved, true)
    assert.equal(report?.networkErrorCount, 1)
    const reloaded = await repository.loadTripBundle(original.metadata.id)
    assert.equal(reloaded.climbs[0].name, 'Montée 1')
    assert.equal(reloaded.enrichmentMetadata.providers.find((state) => state.provider === 'osm')?.status, 'error')
  } finally {
    database.close()
  }
})
