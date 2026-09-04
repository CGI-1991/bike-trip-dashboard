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
    // Integrity-hardening section 10-13: a stage whose route has no usable
    // geometry at all can never be geocoded — it is excluded outright, not
    // counted as 2 more "attempted" (impossible) endpoints.
    assert.equal(report?.endpointCount, 2)
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
    // Integrity-hardening section 10-13: a stage with no usable geometry at
    // all is excluded outright — this pass never touches it, so its day
    // keeps whatever `enrichmentStatus` it already had, rather than being
    // force-downgraded to 'partial' just because endpoint geocoding could
    // never have run for it in the first place.
    assert.equal(reloaded.days[3].enrichmentStatus, original.days[3].enrichmentStatus)
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

// Integrity-hardening sections 10-13/61: the unit of validity is one
// stage's one endpoint, never the whole TripBundle — a stage that already
// has both endpoints geocoded contributes zero lookups on a later pass.
test('a second pass over an already-geocoded trip makes zero provider calls, even with a fresh cache', async () => {
  const database = await openTestDatabase()
  try {
    const original = createGenericTripBundle()
    const cache = createGeocodingCacheRepository(database)
    const firstCalls = []
    const first = await enrichTripEndpoints({ bundle: original, provider: successProvider(firstCalls), cache, idFactory: idFactory('first'), now: () => '2028-02-01T10:00:00.000Z' })
    assert.equal(firstCalls.length, 2)

    // A brand-new cache repository (a different IndexedDB instance) proves
    // the skip comes from the stage's OWN already-geocoded route points,
    // never merely a coordinate-cache hit.
    const freshDatabase = await openTestDatabase()
    try {
      const freshCache = createGeocodingCacheRepository(freshDatabase)
      const secondCalls = []
      const second = await enrichTripEndpoints({ bundle: first.bundle, provider: successProvider(secondCalls), cache: freshCache, idFactory: idFactory('second'), now: () => '2028-02-02T10:00:00.000Z' })
      assert.equal(secondCalls.length, 0, 'the already-geocoded stage is never re-queried')
      assert.equal(second.endpointCount, 0)
      assert.equal(second.cacheHitCount, 0, 'nothing was even looked up, so nothing could be a cache hit either')
    } finally {
      freshDatabase.close()
    }
  } finally {
    database.close()
  }
})

test('adding a new, ungeocoded stage to an already-geocoded trip queries only the new stage\'s endpoints', async () => {
  const database = await openTestDatabase()
  try {
    const bundle = createGenericTripBundle()
    // Give the fixture's second route real geometry too, so both stages
    // are genuinely geocodable — a realistic "A and B already ready" trip.
    bundle.routes[1] = {
      ...bundle.routes[1],
      geometry: { full: null, simplified: [{ latitude: 46.0, longitude: 6.9, altitudeM: 900 }, { latitude: 46.1, longitude: 7.0, altitudeM: 1200 }] },
      segments: [{ index: 0, name: null, distanceKm: 12.4, elevationGainM: 300, elevationLossM: 0 }],
    }
    const cache = createGeocodingCacheRepository(database)
    const firstCalls = []
    const ready = await enrichTripEndpoints({ bundle, provider: successProvider(firstCalls), cache, idFactory: idFactory('ready'), now: () => '2028-02-01T10:00:00.000Z' })
    assert.equal(firstCalls.length, 4, 'both stages start geocodable and get queried once')
    assert.equal(tripNeedsEndpointGeocoding(ready.bundle), false)

    // A brand-new stage/route/day, appended onto the now-fully-geocoded bundle.
    const newRouteId = 'route-charlie'
    const newStageId = 'stage-charlie'
    const newDayId = 'day-charlie-new'
    const withNewStage = {
      ...ready.bundle,
      routes: [...ready.bundle.routes, {
        id: newRouteId, sourceFileId: null,
        segments: [{ index: 0, name: null, distanceKm: 30, elevationGainM: 400, elevationLossM: 100 }],
        geometry: { full: null, simplified: [{ latitude: 50.0, longitude: 4.0, altitudeM: 50 }, { latitude: 50.2, longitude: 4.3, altitudeM: 80 }] },
        profile: null, parsingStatus: 'success', parsingErrors: [],
        provenance: { sourceType: 'gpx', sourceId: null, fetchedAt: null, engineVersion: 'test@1', confidence: 'high', manuallyOverridden: false },
      }],
      stages: [...ready.bundle.stages, {
        id: newStageId, dayId: newDayId, sourceRouteId: newRouteId, name: 'New stage',
        startLocationName: null, endLocationName: null, distanceKm: 30, elevationGainM: 400, elevationLossM: 100,
        minAltitudeM: 50, maxAltitudeM: 80, movingDurationSeconds: 3_600, pauseDurationSeconds: 0, totalDurationSeconds: 3_600,
        estimatedAverageSpeedKph: 20, validationStatus: 'valid', metricsProvenance: null, climbIds: [], routePointIds: [], weatherRecordIds: [],
      }],
      days: [...ready.bundle.days, {
        id: newDayId, index: ready.bundle.days.length, displayNumber: ready.bundle.days.length + 1, date: null, type: 'ride',
        stageId: newStageId, startLocationName: null, endLocationName: null, accommodationId: null, notes: null, enrichmentStatus: 'not-started',
      }],
    }
    assert.equal(tripNeedsEndpointGeocoding(withNewStage), true, 'sanity check: the new stage genuinely needs geocoding')

    const secondCalls = []
    const afterAdd = await enrichTripEndpoints({ bundle: withNewStage, provider: successProvider(secondCalls), cache: createGeocodingCacheRepository(await openTestDatabase()), idFactory: idFactory('second'), now: () => '2028-02-03T10:00:00.000Z' })
    assert.equal(secondCalls.length, 2, 'only the new stage\'s start/end are queried')
    assert.equal(afterAdd.endpointCount, 2)

    // A and B's own already-geocoded route points are untouched — same ids, same values.
    const stageA = afterAdd.bundle.stages.find((candidate) => candidate.id === ready.bundle.stages[0].id)
    const stageB = afterAdd.bundle.stages.find((candidate) => candidate.id === ready.bundle.stages[1].id)
    assert.deepEqual(stageA.routePointIds, ready.bundle.stages[0].routePointIds)
    assert.deepEqual(stageB.routePointIds, ready.bundle.stages[1].routePointIds)
    assert.equal(tripNeedsEndpointGeocoding(afterAdd.bundle), false)
  } finally {
    database.close()
  }
})

test('a stage missing only one endpoint queries exactly that one — never the side it already has', async () => {
  const database = await openTestDatabase()
  try {
    const original = createGenericTripBundle()
    const cache = createGeocodingCacheRepository(database)
    // Manually geocode only the `start` endpoint of stage1, as if a
    // previous pass had been interrupted after the first lookup.
    const point1 = original.routePoints.find((point) => point.id === original.stages[0].routePointIds[0])
    const partiallyGeocoded = {
      ...original,
      routePoints: original.routePoints.map((point) => (point.id !== point1.id ? point : {
        ...point,
        name: 'Départ déjà connu',
        provenance: { sourceType: 'osm', sourceId: 'mock:already', fetchedAt: '2028-01-01T00:00:00.000Z', engineVersion: 'endpoint-geocoding@1', confidence: 'medium', manuallyOverridden: false },
      })),
    }
    assert.equal(tripNeedsEndpointGeocoding(partiallyGeocoded), true, 'sanity check: end is still missing')

    const calls = []
    const report = await enrichTripEndpoints({ bundle: partiallyGeocoded, provider: successProvider(calls), cache, idFactory: idFactory(), now: () => '2028-02-01T10:00:00.000Z' })
    assert.equal(calls.length, 1, 'only the missing end endpoint is queried')
    assert.equal(report.endpointCount, 1)
    const startPoint = report.bundle.routePoints.find((point) => point.id === point1.id)
    assert.equal(startPoint.name, 'Départ déjà connu', 'the already-geocoded start is never re-queried or overwritten')
  } finally {
    database.close()
  }
})

// Integrity-hardening sections 14-15/63: an endpoint-only pass must never
// clobber completion bookkeeping that belongs to a different provider phase.
test('enrichmentJobs and practicalPlacesStageErrors survive an endpoint-only enrichment pass untouched', async () => {
  const database = await openTestDatabase()
  try {
    const original = createGenericTripBundle()
    const dayId = original.stages[0].dayId
    const seeded = {
      ...original,
      enrichmentMetadata: {
        ...original.enrichmentMetadata,
        enrichmentJobs: [{ stageId: original.stages[0].id, routeFingerprint: 'sha256:test-fingerprint', jobs: [{ kind: 'structural', startKm: 0, endKm: 10, status: 'success', attempts: 1 }] }],
        practicalPlacesStageErrors: [dayId],
      },
    }
    const repository = createTripRepository(database)
    await repository.saveTripBundle(seeded)

    const report = await enrichStoredTripEndpoints({
      database, tripId: seeded.metadata.id, provider: successProvider([]), idFactory: idFactory(), now: () => '2028-02-01T10:00:00.000Z',
    })
    assert.equal(report?.saved, true)
    assert.deepEqual(report.bundle.enrichmentMetadata.enrichmentJobs, seeded.enrichmentMetadata.enrichmentJobs)
    assert.deepEqual(report.bundle.enrichmentMetadata.practicalPlacesStageErrors, seeded.enrichmentMetadata.practicalPlacesStageErrors)

    const reloaded = await repository.loadTripBundle(seeded.metadata.id)
    assert.deepEqual(reloaded.enrichmentMetadata.enrichmentJobs, seeded.enrichmentMetadata.enrichmentJobs)
    assert.deepEqual(reloaded.enrichmentMetadata.practicalPlacesStageErrors, seeded.enrichmentMetadata.practicalPlacesStageErrors)
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
