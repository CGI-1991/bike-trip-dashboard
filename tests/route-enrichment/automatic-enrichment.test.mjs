import '../storage/indexeddb/support/setup-fake-indexeddb.mjs'

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { runStoredTripAutomaticEnrichment } from '../../src/route-enrichment/automatic-enrichment.ts'
import { createTripRepository } from '../../src/storage/indexeddb/trip-repository.ts'
import { createGenericTripBundle } from '../trip-core/support/generic-trip-fixture.mjs'
import { openTestDatabase } from '../storage/indexeddb/support/open-test-database.mjs'

function idFactory() {
  let index = 0
  return () => `automatic-${index++}`
}

test('automatic route enrichment is wired to Postpass and has no Overpass dependency', () => {
  const mainSource = readFileSync(new URL('../../src/main.ts', import.meta.url), 'utf8')
  const automaticSource = readFileSync(new URL('../../src/route-enrichment/automatic-enrichment.ts', import.meta.url), 'utf8')
  assert.match(mainSource, /routeEnrichmentProvider:\s*createPostpassRouteEnrichmentProvider\(/)
  assert.doesNotMatch(mainSource, /routeEnrichmentProvider:\s*createOverpass/)
  assert.doesNotMatch(automaticSource, /overpass-api\.de|Overpass/)
})

test('a locally saved trip remains readable while automatic network enrichment is still pending', async () => {
  const database = await openTestDatabase()
  try {
    const repository = createTripRepository(database)
    const bundle = createGenericTripBundle()
    await repository.saveTripBundle(bundle)
    let release
    const gate = new Promise((resolve) => { release = resolve })
    const routeProvider = {
      id: 'slow-route', sourceType: 'osm', attribution: 'OSM',
      async findStructuralCandidates() {
        await gate
        return { candidates: [], durationMs: 1, rawCandidateCount: 0, httpStatus: 200, payloadBytes: 10, startedAt: '2028-08-03T10:00:00.000Z', finishedAt: '2028-08-03T10:00:00.001Z' }
      },
    }
    const running = runStoredTripAutomaticEnrichment({
      database, tripId: bundle.metadata.id, routeEnrichmentProvider: routeProvider,
      idFactory: idFactory(), now: () => '2028-08-03T10:00:00.000Z',
    })
    const readableBeforeNetwork = await repository.loadTripBundle(bundle.metadata.id)
    assert.ok(readableBeforeNetwork)
    assert.equal(readableBeforeNetwork.metadata.name, bundle.metadata.name)
    release()
    const report = await running
    assert.equal(report.routeAttempted, true)
    assert.equal(report.partial, false)
  } finally {
    database.close()
  }
})

test('automatic enrichment runs endpoints before route data and a network outage never removes the trip', async () => {
  const database = await openTestDatabase()
  try {
    const repository = createTripRepository(database)
    const bundle = createGenericTripBundle()
    await repository.saveTripBundle(bundle)
    const phases = []
    const report = await runStoredTripAutomaticEnrichment({
      database,
      tripId: bundle.metadata.id,
      geocodingProvider: { id: 'offline-geocoder', sourceType: 'osm', attribution: 'OSM', async reverse() { throw new Error('offline') } },
      routeEnrichmentProvider: { id: 'offline-route', sourceType: 'osm', attribution: 'OSM', async findStructuralCandidates() { throw new Error('offline') } },
      idFactory: idFactory(),
      now: () => '2028-08-03T10:00:00.000Z',
      onProgress: (progress) => phases.push(progress.phase),
    })
    assert.equal(phases[0], 'endpoints')
    assert.equal(report.partial, true)
    assert.ok(await repository.loadTripBundle(bundle.metadata.id))
    assert.equal(report.bundle.enrichmentMetadata.providers.find((state) => state.provider === 'postpass-route-enrichment').status, 'error')
  } finally {
    database.close()
  }
})

test('the normal automatic pipeline never invokes practical-place enrichment', async () => {
  const database = await openTestDatabase()
  try {
    const repository = createTripRepository(database)
    const bundle = createGenericTripBundle()
    await repository.saveTripBundle(bundle)
    let practicalCalls = 0

    const report = await runStoredTripAutomaticEnrichment({
      database,
      tripId: bundle.metadata.id,
      practicalPlacesProvider: {
        id: 'forbidden-practical-provider',
        sourceType: 'osm',
        attribution: 'OSM',
        async findCandidates() { practicalCalls++; return [] },
      },
      idFactory: idFactory(),
      now: () => '2028-08-03T10:00:00.000Z',
    })

    assert.equal(report.endpointAttempted, false)
    assert.equal(report.routeAttempted, false)
    assert.equal(practicalCalls, 0)
    assert.ok(await repository.loadTripBundle(bundle.metadata.id))
  } finally {
    database.close()
  }
})
