import '../storage/indexeddb/support/setup-fake-indexeddb.mjs'

import assert from 'node:assert/strict'
import test from 'node:test'

import { enrichStoredTripPracticalPlaces, enrichTripPracticalPlaces, PRACTICAL_PLACES_ENGINE_VERSION, tripNeedsPracticalPlacesEnrichment } from '../../src/practical-places/enrichment.ts'
import { createPracticalPlacesCacheRepository } from '../../src/storage/indexeddb/practical-places-cache-repository.ts'
import { createTripRepository } from '../../src/storage/indexeddb/trip-repository.ts'
import { createGenericTripBundle } from '../trip-core/support/generic-trip-fixture.mjs'
import { openTestDatabase } from '../storage/indexeddb/support/open-test-database.mjs'

// Only `stage-alpha`/`route1` carries real geometry in the shared fixture
// (route2 is deliberately `geometry: null`, still pending its own GPX) — one
// enrichable stage, one Postpass request, in most of these tests. The
// dedicated multi-stage test below gives route2 real geometry too, mirroring
// the pattern the retired chunked-Overpass test suite already used for the
// same purpose.
function candidate(overrides = {}) {
  return {
    osmType: 'node', osmId: '42', category: 'water', name: null,
    latitude: 45.15, longitude: 6.275,
    usefulTags: { amenity: 'drinking_water' },
    ...overrides,
  }
}

function result(candidates) {
  return { candidates, durationMs: 1, rawCandidateCount: candidates.length, httpStatus: 200, payloadBytes: 10, startedAt: '2028-08-03T10:00:00.000Z', finishedAt: '2028-08-03T10:00:00.001Z' }
}

function provider(findCandidates) {
  return { id: 'mock-postpass-practical-provider', sourceType: 'osm', attribution: 'Mock OSM', findCandidates }
}

test('C2: practical-place enrichment persists stage association, route distance, detour, OSM id, useful tags and engine version across reload — one Postpass request for the one enrichable stage', async () => {
  const database = await openTestDatabase()
  try {
    const original = createGenericTripBundle()
    const repository = createTripRepository(database)
    await repository.saveTripBundle(original)
    let calls = 0
    const report = await enrichStoredTripPracticalPlaces({
      database,
      tripId: original.metadata.id,
      provider: provider(async () => { calls++; return result([candidate()]) }),
      now: () => '2028-08-03T10:00:00.000Z',
    })
    assert.equal(report?.saved, true)
    assert.equal(report?.placeCount, 1)
    assert.equal(calls, 1, 'a single request for the one stage with usable geometry — never per-anchor, never per-chunk')

    const reloaded = await repository.loadTripBundle(original.metadata.id)
    const place = reloaded.practicalPlaces.find((item) => item.provenance.engineVersion === PRACTICAL_PLACES_ENGINE_VERSION)
    assert.ok(place)
    assert.equal(place.category, 'water')
    assert.ok(place.trackDistanceKm !== null && place.trackDistanceKm >= 0)
    assert.ok(place.detourKm !== null && place.detourKm < 0.5)
    assert.equal(place.name, null)
    assert.deepEqual(place.usefulTags, { amenity: 'drinking_water' })
    assert.equal(place.provenance.sourceId, 'mock-postpass-practical-provider:node:42')
    assert.equal(place.provenance.fetchedAt, '2028-08-03T10:00:00.000Z')
    assert.equal(place.provenance.engineVersion, PRACTICAL_PLACES_ENGINE_VERSION)
    assert.equal(reloaded.enrichmentMetadata.providers.find((state) => state.provider === 'postpass-practical-places')?.status, 'success')
    assert.equal(tripNeedsPracticalPlacesEnrichment(reloaded), false)
  } finally {
    database.close()
  }
})

test('route-fingerprint cache prevents a second provider call, including after the enriched bundle is reused', async () => {
  const database = await openTestDatabase()
  try {
    const cache = createPracticalPlacesCacheRepository(database)
    let calls = 0
    const mock = provider(async () => { calls++; return result([candidate({ osmId: 'cache' })]) })
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
    provider: provider(async () => result([candidate({ osmId: 'preserved' })])),
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
  assert.equal(failed.bundle.enrichmentMetadata.providers.find((state) => state.provider === 'postpass-practical-places')?.status, 'error')
  assert.equal(tripNeedsPracticalPlacesEnrichment(failed.bundle), true)
})

test('a stage-scoped failure preserves the other stage\'s successful result (partial status), and only the failed stage is retried', async () => {
  const bundle = createGenericTripBundle()
  // Give the second stage's route real geometry too, so both stages become enrichable.
  bundle.routes[1].geometry = { full: null, simplified: [
    { latitude: 46, longitude: 7, altitudeM: 800 },
    { latitude: 46.1, longitude: 7.2, altitudeM: 1200 },
  ] }
  const values = new Map()
  const memoryCache = {
    async get(identity) { return values.get(JSON.stringify(identity)) ?? null },
    async put(identity, results, storedAt) { values.set(JSON.stringify(identity), { results, storedAt }) },
  }
  let calls = 0
  const first = await enrichTripPracticalPlaces({
    bundle,
    cache: memoryCache,
    provider: provider(async (search) => {
      calls++
      if (calls === 1) throw new Error('offline')
      const point = search.geometry[0]
      return result([candidate({ osmId: 'second-stage-only', latitude: point.latitude, longitude: point.longitude })])
    }),
    now: () => '2028-08-03T10:00:00.000Z',
  })
  assert.equal(first.networkErrorCount, 1)
  assert.equal(first.placeCount, 1)
  assert.equal(first.bundle.enrichmentMetadata.providers.find((state) => state.provider === 'postpass-practical-places')?.status, 'partial')
  assert.equal(tripNeedsPracticalPlacesEnrichment(first.bundle), true, 'a partial result still needs a follow-up pass')

  const callsBeforeRetry = calls
  const second = await enrichTripPracticalPlaces({
    bundle: first.bundle,
    cache: memoryCache,
    provider: provider(async () => { calls++; return result([candidate({ osmId: 'first-stage-recovered' })]) }),
    now: () => '2028-08-04T10:00:00.000Z',
  })
  assert.equal(calls - callsBeforeRetry, 1, 'the already-cached (successful) stage is never re-requested — only the previously failed one')
  assert.equal(second.placeCount, 2)
  assert.equal(second.bundle.enrichmentMetadata.providers.find((state) => state.provider === 'postpass-practical-places')?.status, 'success')
})

test('an anchor-category candidate keeps its distance-to-anchor as its own detour, not the route-line lateral distance', async () => {
  const bundle = createGenericTripBundle()
  const memoryCache = { async get() { return null }, async put() {} }
  const enriched = await enrichTripPracticalPlaces({
    bundle,
    cache: memoryCache,
    provider: provider(async (search) => {
      if (search.anchors.length === 0) return result([])
      const anchor = search.anchors[0]
      // Placed exactly on the départ anchor itself — its distance to that
      // anchor is ~0 regardless of how far départ sits laterally from the
      // route's own polyline simplification.
      return result([candidate({ osmId: 'supermarket-on-anchor', category: 'supermarket', name: 'Supermarché Test', latitude: anchor.latitude, longitude: anchor.longitude })])
    }),
    now: () => '2028-08-03T10:00:00.000Z',
  })
  const place = enriched.bundle.practicalPlaces.find((item) => item.category === 'supermarket')
  assert.ok(place)
  assert.ok(place.detourKm < 0.01)
})

test('C2 non-objectif (section 41): a trip with no usable route geometry at all never needs/attempts practical-place enrichment', async () => {
  const bundle = createGenericTripBundle()
  for (const route of bundle.routes) route.geometry = null
  assert.equal(tripNeedsPracticalPlacesEnrichment(bundle), false)
})

// --- C2.5 sections 27-28 / AI-AL: pause duration vs position invalidation ---

function withManualPause(bundle, durationSeconds) {
  const stage = bundle.stages.find((candidate) => candidate.id === 'stage-alpha')
  const route = bundle.routes.find((candidate) => candidate.id === stage.sourceRouteId)
  const alreadyPushed = bundle.routePoints.some((point) => point.id === 'village-anchor-test')
  if (!alreadyPushed) {
    bundle.routePoints.push({
      id: 'village-anchor-test', routeId: route.id, type: 'passage', name: 'Anchor Village',
      latitude: 45.2, longitude: 6.35, elevationM: 400, trackDistanceKm: 30,
      osmFeatureType: 'village', lateralDistanceKm: 0.2,
      provenance: { sourceType: 'osm', sourceId: 'postpass:village:anchor', fetchedAt: null, engineVersion: 'route-enrichment@4', confidence: 'high', manuallyOverridden: false },
    })
    stage.routePointIds.push('village-anchor-test')
  }
  return {
    ...bundle,
    settings: {
      ...bundle.settings,
      stages: [
        ...bundle.settings.stages.filter((entry) => entry.stageId !== 'stage-alpha'),
        { stageId: 'stage-alpha', pausePlanMode: 'custom', pauses: [{ id: 'pause-anchor-test', active: true, routePointId: 'village-anchor-test', durationSeconds, order: 0, origin: 'custom' }] },
      ],
    },
  }
}

// --- RC2 final-closeout sections 11-14/18/73: progressive per-stage persistence ---

function withSecondEnrichableStage(bundle) {
  bundle.routes[1].geometry = { full: null, simplified: [
    { latitude: 46, longitude: 7, altitudeM: 800 },
    { latitude: 46.1, longitude: 7.2, altitudeM: 1200 },
  ] }
  return bundle
}

test('C/D: each stage\'s result is persisted immediately — E1 is already committed to IndexedDB before E2\'s own request even starts', async () => {
  const database = await openTestDatabase()
  try {
    const bundle = withSecondEnrichableStage(createGenericTripBundle())
    const repository = createTripRepository(database)
    await repository.saveTripBundle(bundle)
    let calls = 0
    const midPassSnapshots = []
    const report = await enrichStoredTripPracticalPlaces({
      database,
      tripId: bundle.metadata.id,
      provider: provider(async () => {
        calls++
        if (calls === 2) {
          const midPass = await repository.loadTripBundle(bundle.metadata.id)
          midPassSnapshots.push(midPass.practicalPlaces.some((place) => place.provenance.engineVersion === PRACTICAL_PLACES_ENGINE_VERSION))
        }
        return result([candidate({ osmId: `call-${calls}` })])
      }),
      now: () => '2028-08-03T10:00:00.000Z',
    })
    assert.equal(calls, 2)
    assert.deepEqual(midPassSnapshots, [true], 'E1\'s result was already saved before E2\'s request fired')
    assert.equal(report.saved, true)
    assert.equal(report.bundle.enrichmentMetadata.providers.find((state) => state.provider === 'postpass-practical-places')?.status, 'success')
  } finally {
    database.close()
  }
})

test('E: E2 timeout/error does not stop E3 — each stage is still attempted, chronological order preserved (F)', async () => {
  const database = await openTestDatabase()
  try {
    const bundle = createGenericTripBundle()
    withSecondEnrichableStage(bundle)
    // A genuine third ride day + stage + route, appended after the others —
    // asserts the whole chronological run, not just a two-stage case.
    const thirdDayId = 'day-echo'
    const thirdDayDate = '2027-05-14'
    bundle.days.push({
      ...bundle.days[0], id: thirdDayId, index: bundle.days.length, displayNumber: bundle.days.length + 1,
      date: thirdDayDate, stageId: 'stage-charlie', accommodationId: null, notes: null,
    })
    bundle.metadata = { ...bundle.metadata, endDate: thirdDayDate }
    bundle.calendar = { ...bundle.calendar, endDate: thirdDayDate }
    bundle.stages.push({ ...bundle.stages[0], id: 'stage-charlie', dayId: thirdDayId, sourceRouteId: 'route-extra', routePointIds: [], weatherRecordIds: [] })
    bundle.routes.push({ ...bundle.routes[0], id: 'route-extra', geometry: { full: null, simplified: [
      { latitude: 47, longitude: 8, altitudeM: 500 },
      { latitude: 47.1, longitude: 8.2, altitudeM: 700 },
    ] } })
    const repository = createTripRepository(database)
    await repository.saveTripBundle(bundle)
    const seenStageIds = []
    let calls = 0
    const report = await enrichStoredTripPracticalPlaces({
      database,
      tripId: bundle.metadata.id,
      provider: provider(async (search) => {
        calls++
        seenStageIds.push(search.stageId)
        if (calls === 2) throw new Error('offline')
        return result([candidate({ osmId: `call-${calls}` })])
      }),
      now: () => '2028-08-03T10:00:00.000Z',
    })
    assert.equal(calls, 3, 'all three stages were attempted — E2\'s failure never stopped E3')
    assert.deepEqual(seenStageIds, ['stage-alpha', bundle.stages[1].id, 'stage-charlie'], 'strict chronological E1→E2→E3 order')
    assert.equal(report.networkErrorCount, 1)
    assert.equal(report.bundle.enrichmentMetadata.providers.find((state) => state.provider === 'postpass-practical-places')?.status, 'partial')
  } finally {
    database.close()
  }
})

test('section 18: a stage-scoped POI failure is recorded per-stage in practicalPlacesStageErrors — never the whole trip', async () => {
  const database = await openTestDatabase()
  try {
    const bundle = withSecondEnrichableStage(createGenericTripBundle())
    const repository = createTripRepository(database)
    await repository.saveTripBundle(bundle)
    let calls = 0
    const report = await enrichStoredTripPracticalPlaces({
      database,
      tripId: bundle.metadata.id,
      provider: provider(async () => {
        calls++
        if (calls === 2) throw new Error('offline')
        return result([candidate({ osmId: `call-${calls}` })])
      }),
      now: () => '2028-08-03T10:00:00.000Z',
    })
    assert.deepEqual(report.bundle.enrichmentMetadata.practicalPlacesStageErrors, [bundle.stages[1].dayId])

    // A subsequent successful full pass clears it again.
    const second = await enrichStoredTripPracticalPlaces({
      database, tripId: bundle.metadata.id,
      provider: provider(async () => { calls++; return result([candidate({ osmId: `call-${calls}` })]) }),
      now: () => '2028-08-04T10:00:00.000Z',
    })
    assert.equal(second.bundle.enrichmentMetadata.practicalPlacesStageErrors, undefined, 'cleared once every pending stage settles successfully — never left dangling')
  } finally {
    database.close()
  }
})

test('section 14: onlyDayId retries exactly the previously-failed stage, without re-requesting the already-succeeded one', async () => {
  const database = await openTestDatabase()
  try {
    const bundle = withSecondEnrichableStage(createGenericTripBundle())
    const repository = createTripRepository(database)
    await repository.saveTripBundle(bundle)
    const calls = []
    await enrichStoredTripPracticalPlaces({
      database, tripId: bundle.metadata.id,
      provider: provider(async (search) => {
        calls.push(search.stageId)
        if (search.stageId === bundle.stages[1].id) throw new Error('offline')
        return result([candidate({ osmId: `initial-${calls.length}` })])
      }),
      now: () => '2028-08-03T10:00:00.000Z',
    })
    assert.equal(calls.length, 2, 'both stages were attempted by the ordinary full pass; the second one failed (never cached)')

    const secondStageDayId = bundle.stages[1].dayId
    const retryReport = await enrichStoredTripPracticalPlaces({
      database, tripId: bundle.metadata.id, onlyDayId: secondStageDayId,
      provider: provider(async (search) => { calls.push(search.stageId); return result([candidate({ osmId: `retry-${calls.length}` })]) }),
      now: () => '2028-08-04T10:00:00.000Z',
    })
    assert.equal(calls.length, 3, 'only the previously-failed stage made a new request — the already-succeeded first stage stays cached and untouched')
    assert.equal(calls[2], bundle.stages[1].id)
    assert.equal(retryReport.stageCount, 1)
    assert.equal(retryReport.bundle.enrichmentMetadata.practicalPlacesStageErrors, undefined, 'the retry cleared the per-stage issue')
    assert.equal(retryReport.bundle.enrichmentMetadata.providers.find((state) => state.provider === 'postpass-practical-places')?.status, 'success')
  } finally {
    database.close()
  }
})

test('AK/AL: moving a pause to a different anchor is a real cache-miss for that stage — the stale POI set is never silently reused forever', async () => {
  const database = await openTestDatabase()
  try {
    const cache = createPracticalPlacesCacheRepository(database)
    let calls = 0
    const mock = provider(async () => { calls++; return result([candidate({ osmId: `call-${calls}` })]) })
    // First pass: no manual pause at all — anchors are start+end only.
    const first = await enrichTripPracticalPlaces({ bundle: createGenericTripBundle(), cache, provider: mock, now: () => '2028-08-03T10:00:00.000Z' })
    assert.equal(calls, 1)
    // Second pass: the SAME stage, but a pause now anchors on an extra waypoint — a genuine anchor-set change.
    const second = await enrichTripPracticalPlaces({ bundle: withManualPause(first.bundle, 600), cache, provider: mock, now: () => '2028-08-04T10:00:00.000Z' })
    assert.equal(calls, 2, 'the anchor change must be a real cache-miss, not silently reuse the old anchor set\'s result')
    assert.equal(second.cacheHitCount, 0)
  } finally {
    database.close()
  }
})

test('AI/AJ: changing only a pause\'s duration (same anchor position) never re-triggers a search — a pure cache hit', async () => {
  const database = await openTestDatabase()
  try {
    const cache = createPracticalPlacesCacheRepository(database)
    let calls = 0
    const mock = provider(async () => { calls++; return result([candidate({ osmId: `call-${calls}` })]) })
    const first = await enrichTripPracticalPlaces({ bundle: withManualPause(createGenericTripBundle(), 600), cache, provider: mock, now: () => '2028-08-03T10:00:00.000Z' })
    assert.equal(calls, 1)
    // Same anchor (routePointId unchanged), only the duration differs.
    const second = await enrichTripPracticalPlaces({ bundle: withManualPause(first.bundle, 1_200), cache, provider: mock, now: () => '2028-08-04T10:00:00.000Z' })
    assert.equal(calls, 1, 'a duration-only change must never re-trigger Postpass — the anchor set (positions) is unchanged')
    assert.equal(second.cacheHitCount, 1)
  } finally {
    database.close()
  }
})
