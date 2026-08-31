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

/**
 * CDC C2 section 2/15: Postpass practical-place enrichment IS now a third
 * automatic phase, run once per trip open exactly like endpoints/route data
 * — superseding the pre-C2 guarantee that used to live at this exact test
 * name ("never invokes practical-place enrichment"). What C2 still forbids
 * is Overpass ever running automatically (covered by
 * `tests/ui/no-overpass-runtime.test.mjs` and the source-text guard above);
 * a Postpass-shaped provider given here now runs exactly once, then never
 * again once the trip's provider state is `success` (tests AR/AS).
 */
test('when supplied, the practical-places provider runs automatically exactly once per trip needing it', async () => {
  const database = await openTestDatabase()
  try {
    const repository = createTripRepository(database)
    const bundle = createGenericTripBundle()
    await repository.saveTripBundle(bundle)
    let practicalCalls = 0
    const provider = {
      id: 'postpass-practical-places', sourceType: 'osm', attribution: 'OSM',
      async findCandidates() {
        practicalCalls++
        return { candidates: [], durationMs: 1, rawCandidateCount: 0, httpStatus: 200, payloadBytes: 10, startedAt: '2028-08-03T10:00:00.000Z', finishedAt: '2028-08-03T10:00:00.001Z' }
      },
    }

    const report = await runStoredTripAutomaticEnrichment({
      database, tripId: bundle.metadata.id, practicalPlacesProvider: provider,
      idFactory: idFactory(), now: () => '2028-08-03T10:00:00.000Z',
    })
    assert.equal(report.practicalPlacesAttempted, true)
    assert.ok(practicalCalls >= 1)
    const afterFirst = practicalCalls

    // A second automatic pass (e.g. re-opening the trip) must not repeat the
    // search — the trip's own provider state is already `success`.
    const second = await runStoredTripAutomaticEnrichment({
      database, tripId: bundle.metadata.id, practicalPlacesProvider: provider,
      idFactory: idFactory(), now: () => '2028-08-04T10:00:00.000Z',
    })
    assert.equal(second.practicalPlacesAttempted, false)
    assert.equal(practicalCalls, afterFirst)
  } finally {
    database.close()
  }
})

test('with no practical-places provider supplied, automatic enrichment never attempts one', async () => {
  const database = await openTestDatabase()
  try {
    const repository = createTripRepository(database)
    const bundle = createGenericTripBundle()
    await repository.saveTripBundle(bundle)

    const report = await runStoredTripAutomaticEnrichment({
      database, tripId: bundle.metadata.id, idFactory: idFactory(), now: () => '2028-08-03T10:00:00.000Z',
    })

    assert.equal(report.endpointAttempted, false)
    assert.equal(report.routeAttempted, false)
    assert.equal(report.practicalPlacesAttempted, false)
    assert.ok(await repository.loadTripBundle(bundle.metadata.id))
  } finally {
    database.close()
  }
})
