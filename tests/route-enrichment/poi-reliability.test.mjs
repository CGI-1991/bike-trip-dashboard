import '../storage/indexeddb/support/setup-fake-indexeddb.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createGenericTripBundle } from '../trip-core/support/generic-trip-fixture.mjs'
import { openTestDatabase } from '../storage/indexeddb/support/open-test-database.mjs'
import { createTripRepository } from '../../src/storage/indexeddb/trip-repository.ts'
import { createSourceFileRepository } from '../../src/storage/indexeddb/source-file-repository.ts'
import { enrichTripRoute } from '../../src/route-enrichment/enrichment.ts'
import { enrichStoredTripPracticalPlaces, enrichTripPracticalPlaces } from '../../src/practical-places/enrichment.ts'
import { parsePostpassPracticalPlacesFeatureCollection } from '../../src/practical-places/postpass-provider.ts'
import { locateAndDeduplicatePostpassPracticalPlaces } from '../../src/practical-places/route-proximity.ts'
import { createRouteLocator, locatePointOnRoute } from '../../src/route/route-proximity.ts'
import { indexRouteGeometry, sliceRouteGeometry } from '../../src/route-enrichment/segment-geometry.ts'
import { isStagePhaseComplete, planStageJobs, SEARCH_PLAN_VERSION } from '../../src/route-enrichment/enrichment-jobs.ts'
import { migrateEnrichmentJobs, resetPracticalPlacesForRefresh } from '../../src/route-enrichment/settled-stages.ts'
import { EnrichmentHttpError } from '../../src/route-enrichment/enrichment-failure.ts'
import { validateTripBundle } from '../../src/trip-core/index.ts'

const kmPerDegree = Math.PI / 180 * 6371
const point = km => ({ latitude: 45 + km / kmPerDegree, longitude: 6, altitudeM: 100 })
const now = () => '2028-10-22T12:00:00.000Z'
const result = candidates => ({ candidates, durationMs: 1, rawCandidateCount: candidates.length, httpStatus: 200, payloadBytes: 0, startedAt: now(), finishedAt: now() })
const provider = findCandidates => ({ id: 'poi-reliability', sourceType: 'osm', attribution: 'Test', findCandidates })
const water = (km = 5) => ({ osmType: 'node', osmId: 'water', category: 'water', name: null, ...point(km), usefulTags: { amenity: 'drinking_water' } })
function bundle(length = 120, spacing = 1) {
  const value = createGenericTripBundle()
  value.routes[0].geometry = { full: Array.from({ length: length / spacing + 1 }, (_, i) => point(i * spacing)), simplified: null }
  return value
}
function cache() {
  const entries = new Map()
  return { async get(key) { return entries.get(JSON.stringify(key)) ?? null }, async put(key, results, storedAt) { entries.set(JSON.stringify(key), { results, storedAt }) } }
}
const automaticPlaces = value => value.practicalPlaces.filter(place => place.provenance.engineVersion.startsWith('practical-places-'))

test('clipping sparse geometry covers boundaries and the final kilometre without replaying the start', () => {
  const indexed = indexRouteGeometry(Array.from({ length: 11 }, (_, i) => point(i * 10)))
  for (const job of planStageJobs(100, 'practical')) {
    const clipped = sliceRouteGeometry(indexed, job.startKm, job.endKm)
    assert.ok(clipped.length >= 2)
    assert.ok(Math.abs((clipped[0].latitude - 45) * kmPerDegree - job.startKm) < 0.002)
    assert.ok(Math.abs((clipped.at(-1).latitude - 45) * kmPerDegree - job.endKm) < 0.002)
  }
})

test('a village at km 35 is actually requested and retained on a sparse simplified 100 km trace', async () => {
  const value = bundle(100)
  value.routes[0].geometry.simplified = value.routes[0].geometry.full.filter((_, i) => i % 10 === 0)
  const village = { osmType: 'node', osmId: '35', featureType: 'village', name: 'Village', ...point(35), elevationM: 100, usefulTags: {} }
  let serial = 0
  const report = await enrichTripRoute({ bundle: value, cache: cache(), now, idFactory: () => `point-${serial++}`,
    provider: { id: 'geometry-test', async findStructuralCandidates(search) {
      const requested = indexRouteGeometry(search.geometry).lengthKm
      assert.ok(Math.abs(requested - search.routeLengthKm) < 0.01, 'the real query has the declared bounds')
      return result(locatePointOnRoute(village, search.geometry).lateralDistanceMeters <= search.localityCollectionRadiusMeters ? [village] : [])
    } } })
  assert.ok(report.bundle.routePoints.some(candidate => candidate.name === 'Village'))
  assert.equal(isStagePhaseComplete(report.bundle, value.stages[0].id, 'structural'), true)
})

test('a water point in the old boundary gap survives practical-place search on a sparse full GPX', async () => {
  const value = bundle(100, 10)
  const candidate = water(35)
  const report = await enrichTripPracticalPlaces({ bundle: value, cache: cache(), now,
    provider: provider(async search => result(locatePointOnRoute(candidate, search.geometry).lateralDistanceMeters <= search.corridorRadiusMeters ? [candidate] : [])) })
  assert.equal(automaticPlaces(report.bundle).length, 1)
})

test('the real response parser and proximity filter retain an unnamed repair station', () => {
  const parsed = parsePostpassPracticalPlacesFeatureCollection({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [6, 45] }, properties: { osm_type: 'N', osm_id: 42, amenity: 'bicycle_repair_station' } }] })
  assert.equal(locateAndDeduplicatePostpassPracticalPlaces(parsed.candidates, [point(0), point(1)], [point(0)], { corridorMaximumLateralDistanceMeters: 500, anchorMaximumDistanceMeters: 800 }).length, 1)
})

test('each successful segment is persisted before the next request; interruption resumes without losing manual data', async () => {
  const database = await openTestDatabase()
  try {
    const original = bundle()
    const repository = createTripRepository(database)
    const source = original.sourceFiles[0]
    await repository.saveTripBundle(original, { sourcePayloads: [{ sourceFileId: source.id, content: new Blob(['original GPX']) }] })
    let calls = 0
    const partial = await enrichStoredTripPracticalPlaces({ database, tripId: original.metadata.id, now,
      provider: provider(async () => {
        calls++
        if (calls === 1) {
          await repository.updateTripBundle(original.metadata.id, latest => ({ ...latest, metadata: { ...latest.metadata, name: 'Edited while loading' } }))
          return result([water()])
        }
        const persisted = await repository.loadTripBundle(original.metadata.id)
        assert.equal(automaticPlaces(persisted).length, 1, 'visible data must be saved before waiting for the second request')
        throw new EnrichmentHttpError(503)
      }) })
    assert.equal(automaticPlaces(partial.bundle).length, 1)
    assert.equal(isStagePhaseComplete(partial.bundle, original.stages[0].id, 'practical'), false)
    assert.equal(partial.bundle.metadata.name, 'Edited while loading')
    assert.deepEqual(partial.bundle.settings, original.settings)
    assert.deepEqual(partial.bundle.accommodations, original.accommodations)
    let resumedCalls = 0
    const resumed = await enrichStoredTripPracticalPlaces({ database, tripId: original.metadata.id, now, provider: provider(async () => { resumedCalls++; return result([]) }) })
    assert.equal(resumedCalls, planStageJobs(120, 'practical').length - 1)
    assert.equal(resumed.requestCount, resumedCalls)
    assert.equal(isStagePhaseComplete(resumed.bundle, original.stages[0].id, 'practical'), true)
    assert.equal(automaticPlaces(resumed.bundle).length, 1)
    const payload = await createSourceFileRepository(database).getSourceFilePayload(original.metadata.id, source.id)
    assert.equal(await payload.content.text(), 'original GPX')
  } finally { database.close() }
})

test('a cache quota failure never causes subdivision or repeated HTTP requests', async () => {
  let calls = 0
  const report = await enrichTripPracticalPlaces({ bundle: bundle(40), now,
    cache: { async get() { return null }, async put() { throw new DOMException('Full', 'QuotaExceededError') } },
    provider: provider(async () => { calls++; return result([water()]) }) })
  assert.equal(calls, 1)
  assert.equal(report.networkErrorCount, 0)
  assert.equal(report.storageErrorCount, 1)
  assert.equal(automaticPlaces(report.bundle).length, 1)
})

test('old completed search plans are revalidated once without changing the saved journey', () => {
  const original = bundle(40)
  const current = migrateEnrichmentJobs(original)
  const old = { ...current, enrichmentMetadata: { ...current.enrichmentMetadata, enrichmentJobs: current.enrichmentMetadata.enrichmentJobs.map(({ planVersion, ...record }) => ({ ...record, jobs: record.jobs.map(job => ({ ...job, status: 'success' })) })) } }
  const migrated = migrateEnrichmentJobs(old)
  assert.ok(migrated.enrichmentMetadata.enrichmentJobs.every(record => record.planVersion === SEARCH_PLAN_VERSION && record.jobs.every(job => job.status === 'pending')))
  assert.equal(migrateEnrichmentJobs(migrated), migrated)
  for (const key of ['metadata', 'routes', 'sourceFiles', 'settings', 'accommodations', 'days', 'practicalPlaces']) assert.deepEqual(migrated[key], original[key])
})

test('a POI refresh retains structural completion and acquired places, changing only its cache generation', () => {
  const value = migrateEnrichmentJobs(bundle(40))
  value.enrichmentMetadata.enrichmentJobs = value.enrichmentMetadata.enrichmentJobs.map(record => ({ ...record, jobs: record.jobs.map(job => ({ ...job, status: 'success' })) }))
  const next = resetPracticalPlacesForRefresh(value)
  assert.equal(next.enrichmentMetadata.practicalPlacesGeneration, 1)
  assert.equal(isStagePhaseComplete(next, value.stages[0].id, 'structural'), true)
  assert.equal(isStagePhaseComplete(next, value.stages[0].id, 'practical'), false)
  assert.deepEqual(next.practicalPlaces, value.practicalPlaces)
  assert.deepEqual(next.settings, value.settings)
})

test('the spatial index agrees with exhaustive projection on a winding route and preserves loop ordering', () => {
  const geometry = Array.from({ length: 5000 }, (_, i) => ({ latitude: 45 + i / 10000, longitude: 6 + Math.sin(i / 50) / 50, altitudeM: 100 }))
  const locator = createRouteLocator(geometry)
  for (let i = 0; i < 100; i++) {
    const candidate = { latitude: 45 + i / 200, longitude: 6 + Math.cos(i) / 40 }
    const indexed = locator.locate(candidate)
    const exhaustive = locatePointOnRoute(candidate, geometry)
    assert.ok(Math.abs(indexed.lateralDistanceMeters - exhaustive.lateralDistanceMeters) < 0.00001)
    assert.ok(indexed.trackDistanceKm >= 0 && indexed.trackDistanceKm <= indexRouteGeometry(geometry).lengthKm)
  }
  // Chainage follows the trace's own fixed distance scale, not a scale
  // recomputed at the latitude of each off-route candidate.
  const chainage = indexRouteGeometry(geometry).distancesKm
  for (let i = 500; i < geometry.length; i += 500) assert.ok(Math.abs(locator.locate(geometry[i]).trackDistanceKm - chainage[i]) < 0.000001)
  const loop = createRouteLocator([point(0), point(1), point(0)])
  assert.equal(loop.locate(point(0)).trackDistanceKm, 0)
})

test('background atomic updates cannot recreate a journey deleted while a request was running', async () => {
  const database = await openTestDatabase()
  try {
    const repository = createTripRepository(database)
    const value = bundle(10)
    await repository.saveTripBundle(value)
    await repository.deleteTrip(value.metadata.id)
    assert.equal(await repository.updateTripBundle(value.metadata.id, () => value), null)
    assert.equal(await repository.hasTrip(value.metadata.id), false)
  } finally { database.close() }
})

test('a refresh requested during an HTTP request prevents its old generation from being applied', async () => {
  const database = await openTestDatabase()
  try {
    const value = bundle(40)
    const repository = createTripRepository(database)
    await repository.saveTripBundle(value)
    let calls = 0
    await enrichStoredTripPracticalPlaces({ database, tripId: value.metadata.id, now,
      provider: provider(async () => {
        calls++
        await repository.updateTripBundle(value.metadata.id, latest => resetPracticalPlacesForRefresh(latest))
        return result([water()])
      }) })
    assert.equal(calls, 1, 'the superseded pass stops before its next request')
    const stored = await repository.loadTripBundle(value.metadata.id)
    assert.equal(stored.enrichmentMetadata.practicalPlacesGeneration, 1)
    assert.equal(automaticPlaces(stored).length, 0, 'the old response cannot replace the requested refresh')
    assert.equal(isStagePhaseComplete(stored, value.stages[0].id, 'practical'), false)
  } finally { database.close() }
})

test('revalidating old geography preserves a manually overridden stop and its pause reference without duplicate ids', async () => {
  const value = bundle(40)
  const route = value.routes[0]
  const stop = { id: 'manual-old-stop', routeId: route.id, type: 'passage', name: 'Mon arrêt', ...point(5), elevationM: 100,
    trackDistanceKm: 5, osmFeatureType: 'village', lateralDistanceKm: 0,
    provenance: { sourceType: 'osm', sourceId: 'postpass-osm:village:node:55', fetchedAt: now(), engineVersion: 'route-enrichment@3', confidence: 'high', manuallyOverridden: true } }
  value.routePoints.push(stop)
  value.stages[0].routePointIds.push(stop.id)
  value.settings.stages = [{ stageId: value.stages[0].id, pausePlanMode: 'custom', pauses: [{ id: 'my-pause', active: true, routePointId: stop.id, durationSeconds: 900, order: 0, origin: 'custom' }] }]
  let serial = 0
  const report = await enrichTripRoute({ bundle: value, cache: cache(), now, idFactory: () => `new-${serial++}`,
    provider: { id: 'manual-stop-provider', async findStructuralCandidates() { return result([{ osmType: 'node', osmId: '55', featureType: 'village', name: 'Nouveau nom OSM', ...point(5), elevationM: 100, usefulTags: {} }]) } } })
  assert.equal(report.bundle.routePoints.filter(candidate => candidate.id === stop.id).length, 1)
  assert.equal(report.bundle.routePoints.find(candidate => candidate.id === stop.id).name, 'Mon arrêt')
  assert.deepEqual(report.bundle.settings, value.settings)
  assert.equal(validateTripBundle(report.bundle).ok, true)
})
