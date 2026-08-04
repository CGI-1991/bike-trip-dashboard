import assert from 'node:assert/strict'
import test from 'node:test'

import { locatePointOnRoute } from '../../src/route/route-proximity.ts'
import { enrichTripRoute, removeGeometricDuplicateClimbs } from '../../src/route-enrichment/enrichment.ts'
import {
  STRUCTURAL_LANDMARK_COLLECTION_RADIUS_METERS,
  STRUCTURAL_LOCALITY_COLLECTION_RADIUS_METERS,
} from '../../src/route-enrichment/types.ts'
import { createGenericTripBundle } from '../trip-core/support/generic-trip-fixture.mjs'

function idFactory(prefix = 'route-enriched') {
  let index = 0
  return () => `${prefix}-${index++}`
}

function memoryCache() {
  const values = new Map()
  return {
    async get(identity) { return values.get(JSON.stringify(identity)) ?? null },
    async put(identity, results, storedAt) { values.set(JSON.stringify(identity), { results, storedAt }) },
  }
}

function candidate(featureType, overrides = {}) {
  const tags = featureType === 'mountain-pass' ? { mountain_pass: 'yes' }
    : featureType === 'city' || featureType === 'town' || featureType === 'village' || featureType === 'hamlet' ? { place: featureType }
      : { natural: featureType }
  return {
    osmType: 'node', osmId: `${featureType}-1`, featureType, name: featureType,
    latitude: 45, longitude: 6.127, elevationM: 500, usefulTags: tags, ...overrides,
  }
}

function provider(candidates, overrides = {}) {
  return {
    id: 'mock-postpass', sourceType: 'osm', attribution: 'OSM · Postpass',
    async findStructuralCandidates() {
      return {
        candidates, durationMs: 12, rawCandidateCount: candidates.length, httpStatus: 200,
        payloadBytes: 400, startedAt: '2028-08-03T10:00:00.000Z', finishedAt: '2028-08-03T10:00:00.012Z',
      }
    },
    ...overrides,
  }
}

function climbBundle() {
  const bundle = createGenericTripBundle()
  bundle.routes[0].geometry = { full: [
    { latitude: 45, longitude: 6, altitudeM: 100 },
    { latitude: 45, longitude: 6.0635, altitudeM: 300 },
    { latitude: 45, longitude: 6.127, altitudeM: 500 },
    { latitude: 45, longitude: 6.1905, altitudeM: 470 },
    { latitude: 45, longitude: 6.254, altitudeM: 400 },
  ], simplified: null }
  bundle.climbs = [{
    id: 'climb-test', routeId: bundle.routes[0].id, name: 'Montée 1', startDistanceKm: 0, endDistanceKm: 9.5,
    elevationGainM: 380, averageGradientPercent: 4, maxGradientPercent: 8, startAltitudeM: 100, endAltitudeM: 480,
    confidence: 'probable', provenance: { sourceType: 'generated', sourceId: null, fetchedAt: null, engineVersion: 'test', confidence: 'medium', manuallyOverridden: false },
  }]
  bundle.stages[0].climbIds = ['climb-test']
  return bundle
}

test('city/town and pass/saddle use exact client thresholds, preserve route order and reject excluded types', async () => {
  const bundle = climbBundle()
  const candidates = [
    candidate('town', { osmId: 'town-middle', name: 'Milieu', longitude: 6.12 }),
    candidate('city', { osmId: 'city-near', name: 'Ville 1,4 km', longitude: 6.06, latitude: 45.0125 }),
    candidate('city', { osmId: 'city-far', name: 'Ville 1,6 km', longitude: 6.10, latitude: 45.0145 }),
    candidate('mountain-pass', { osmId: 'pass-near', name: 'Col 200 m', longitude: 6.127, latitude: 45.0018 }),
    candidate('saddle', { osmId: 'saddle-far', name: 'Selle 300 m', longitude: 6.15, latitude: 45.0027 }),
    candidate('village', { osmId: 'village-forbidden', name: 'Village exclu', longitude: 6.13 }),
    candidate('hamlet', { osmId: 'hamlet-forbidden', name: 'Hameau exclu', longitude: 6.13 }),
    candidate('peak', { osmId: 'peak-forbidden', name: 'Pic exclu', longitude: 6.13 }),
  ]
  const progress = []
  const report = await enrichTripRoute({
    bundle, provider: provider(candidates), cache: memoryCache(), idFactory: idFactory(),
    now: () => '2028-08-03T10:00:00.000Z', onProgress: (event) => progress.push(event),
  })
  const structural = report.bundle.routePoints.filter((point) => point.provenance.engineVersion === 'route-enrichment@3')
  assert.deepEqual(structural.map((point) => point.name), ['Ville 1,4 km', 'Milieu', 'Col 200 m'])
  assert.deepEqual(structural.map((point) => point.osmFeatureType), ['city', 'town', 'mountain-pass'])
  assert.ok(structural[0].lateralDistanceKm > 1.3 && structural[0].lateralDistanceKm < 1.5)
  assert.ok(structural[2].lateralDistanceKm > 0.15 && structural[2].lateralDistanceKm < 0.25)
  assert.ok(structural[0].trackDistanceKm < structural[1].trackDistanceKm)
  assert.deepEqual(structural.map((point) => point.provenance.sourceId), [
    'postpass-osm:city:node:city-near',
    'postpass-osm:town:node:town-middle',
    'postpass-osm:mountain-pass:node:pass-near',
  ])
  assert.equal(report.requestCount, 1)
  assert.equal(progress.length, 1)
  assert.equal(progress[0].rawCandidateCount, 8)
  assert.equal(progress[0].retainedCandidateCount, 3)
  assert.equal(progress[0].rejectedCandidateCount, 5)
})

test('wider server recall recovers candidates displaced by simplification while full GPX thresholds stay strict', async () => {
  const bundle = climbBundle()
  const metersPerLatitudeDegree = 111_195
  const simplifiedOffsetMeters = 180
  bundle.routes[0].geometry = {
    full: [
      { latitude: 45, longitude: 6, altitudeM: 100 },
      { latitude: 45, longitude: 6.1, altitudeM: 200 },
    ],
    simplified: [
      { latitude: 45 + simplifiedOffsetMeters / metersPerLatitudeDegree, longitude: 6, altitudeM: 100 },
      { latitude: 45 + simplifiedOffsetMeters / metersPerLatitudeDegree, longitude: 6.1, altitudeM: 200 },
    ],
  }
  bundle.climbs = []
  bundle.stages[0].climbIds = []
  const candidates = [
    candidate('mountain-pass', { osmId: 'pass-recalled', name: 'Pass accepted', longitude: 6.05, latitude: 45 - 100 / metersPerLatitudeDegree }),
    candidate('saddle', { osmId: 'saddle-rejected', name: 'Saddle rejected', longitude: 6.05, latitude: 45 - 300 / metersPerLatitudeDegree }),
    candidate('town', { osmId: 'town-recalled', name: 'Town accepted', longitude: 6.05, latitude: 45 - 1_400 / metersPerLatitudeDegree }),
    candidate('city', { osmId: 'city-rejected', name: 'City rejected', longitude: 6.05, latitude: 45 - 1_600 / metersPerLatitudeDegree }),
  ]
  const collectedDistances = new Map()
  const recallProvider = provider([], {
    async findStructuralCandidates(search) {
      assert.equal(search.localityCollectionRadiusMeters, STRUCTURAL_LOCALITY_COLLECTION_RADIUS_METERS)
      assert.equal(search.landmarkCollectionRadiusMeters, STRUCTURAL_LANDMARK_COLLECTION_RADIUS_METERS)
      const collected = candidates.filter((item) => {
        const distance = locatePointOnRoute(item, search.geometry).lateralDistanceMeters
        collectedDistances.set(item.osmId, distance)
        const radius = item.featureType === 'city' || item.featureType === 'town'
          ? search.localityCollectionRadiusMeters
          : search.landmarkCollectionRadiusMeters
        return distance <= radius
      })
      return provider(collected).findStructuralCandidates(search)
    },
  })
  const progress = []
  const report = await enrichTripRoute({
    bundle, provider: recallProvider, cache: memoryCache(), idFactory: idFactory('recall'),
    now: () => '2028-08-03T10:00:00.000Z', onProgress: (event) => progress.push(event),
  })
  const structuralNames = report.bundle.routePoints
    .filter((point) => point.provenance.engineVersion === 'route-enrichment@3')
    .map((point) => point.name)
  assert.deepEqual(structuralNames, ['Town accepted', 'Pass accepted'])
  assert.ok(collectedDistances.get('pass-recalled') > 250)
  assert.ok(collectedDistances.get('town-recalled') > 1_500)
  assert.equal(progress[0].rawCandidateCount, 4)
  assert.equal(progress[0].retainedCandidateCount, 2)
  assert.equal(progress[0].rejectedCandidateCount, 2)
})

test('mountain_pass and saddle can conservatively adjust a summit and recalculate statistics', async () => {
  for (const featureType of ['mountain-pass', 'saddle']) {
    const bundle = climbBundle()
    const report = await enrichTripRoute({
      bundle, provider: provider([candidate(featureType, { name: `Anchor ${featureType}` })]),
      cache: memoryCache(), idFactory: idFactory(featureType), now: () => '2028-08-03T10:00:00.000Z',
    })
    const climb = report.bundle.climbs[0]
    assert.equal(climb.name, `Anchor ${featureType}`)
    assert.ok(climb.endDistanceKm > 9.9 && climb.endDistanceKm < 10.1)
    assert.equal(Math.round(climb.endAltitudeM), 500)
    assert.ok(climb.elevationGainM >= 400)
    assert.equal(climb.provenance.engineVersion, 'route-enrichment@3')
  }
})

test('a pass without an existing GPX climb is exposed but never creates a climb', async () => {
  const bundle = climbBundle()
  bundle.climbs = []
  bundle.stages[0].climbIds = []
  const report = await enrichTripRoute({
    bundle, provider: provider([candidate('mountain-pass', { name: 'Col sans montée' })]),
    cache: memoryCache(), idFactory: idFactory(), now: () => '2028-08-03T10:00:00.000Z',
  })
  assert.equal(report.bundle.climbs.length, 0)
  assert.ok(report.bundle.routePoints.some((point) => point.name === 'Col sans montée'))
})

test('manual and pertinent GPX waypoint names always outrank Postpass landmarks', async () => {
  for (const existing of [
    { name: 'Nom manuel', provenance: { sourceType: 'user', sourceId: 'manual', fetchedAt: null, engineVersion: 'manual', confidence: 'high', manuallyOverridden: true } },
    { name: 'Waypoint GPX', provenance: { sourceType: 'generated', sourceId: 'gpx-waypoint', fetchedAt: null, engineVersion: 'test', confidence: 'high', manuallyOverridden: false } },
  ]) {
    const bundle = climbBundle()
    bundle.climbs[0] = { ...bundle.climbs[0], ...existing }
    const report = await enrichTripRoute({
      bundle, provider: provider([candidate('mountain-pass', { name: 'Nom Postpass' })]),
      cache: memoryCache(), idFactory: idFactory(), now: () => '2028-08-03T10:00:00.000Z',
    })
    assert.equal(report.bundle.climbs[0].name, existing.name)
    assert.equal(report.bundle.climbs[0].endDistanceKm, 9.5)
  }
})

test('an incoherent pass is named but refused for summit adjustment', async () => {
  const bundle = climbBundle()
  const report = await enrichTripRoute({
    bundle, provider: provider([candidate('mountain-pass', { name: 'Wrong altitude', elevationM: 900 })]),
    cache: memoryCache(), idFactory: idFactory(), now: () => '2028-08-03T10:00:00.000Z',
  })
  assert.equal(report.bundle.climbs[0].name, 'Wrong altitude')
  assert.equal(report.bundle.climbs[0].endDistanceKm, 9.5)
})

test('real geometric duplicates are collapsed while similar disjoint climbs remain', () => {
  const base = climbBundle().climbs[0]
  const duplicate = { ...base, id: 'duplicate', startDistanceKm: 0.2, endDistanceKm: 9.55, elevationGainM: 390 }
  const distinct = { ...base, id: 'distinct', startDistanceKm: 12, endDistanceKm: 31, elevationGainM: 979 }
  const result = removeGeometricDuplicateClimbs([base, duplicate, distinct])
  assert.deepEqual(result.map((climb) => climb.id), ['duplicate', 'distinct'])
})

test('whole-route cache gives one network request, then zero, and a new fingerprint triggers a new request', async () => {
  const bundle = climbBundle()
  const cache = memoryCache()
  let calls = 0
  const countingProvider = provider([], { async findStructuralCandidates(search) { calls++; return provider([]).findStructuralCandidates(search) } })
  const first = await enrichTripRoute({ bundle, provider: countingProvider, cache, idFactory: idFactory(), now: () => '2028-08-03T10:00:00.000Z' })
  const second = await enrichTripRoute({ bundle: first.bundle, provider: countingProvider, cache, idFactory: idFactory('cached'), now: () => '2028-08-04T10:00:00.000Z' })
  assert.equal(calls, 1)
  assert.equal(first.requestCount, 1)
  assert.equal(second.requestCount, 0)
  assert.equal(second.cacheHitCount, 1)

  const replacement = structuredClone(second.bundle)
  replacement.sourceFiles[0].sha256 = 'f'.repeat(64)
  const third = await enrichTripRoute({ bundle: replacement, provider: countingProvider, cache, idFactory: idFactory('replacement'), now: () => '2028-08-05T10:00:00.000Z' })
  assert.equal(calls, 2)
  assert.equal(third.requestCount, 1)
})

test('three stages progress sequentially past one failure and resume only the missing route', async () => {
  const bundle = climbBundle()
  bundle.routes[1].geometry = { full: bundle.routes[0].geometry.full.map((point) => ({ ...point, latitude: point.latitude + 0.1 })), simplified: null }
  const thirdSource = { ...structuredClone(bundle.sourceFiles[0]), id: 'source-third', sha256: 'c'.repeat(64) }
  const thirdRoute = {
    ...structuredClone(bundle.routes[0]), id: 'route-third', sourceFileId: thirdSource.id,
    geometry: { full: bundle.routes[0].geometry.full.map((point) => ({ ...point, latitude: point.latitude + 0.2 })), simplified: null },
  }
  const thirdStage = {
    ...structuredClone(bundle.stages[0]), id: 'stage-third', sourceRouteId: thirdRoute.id,
    climbIds: [], routePointIds: [],
  }
  bundle.sourceFiles.push(thirdSource)
  bundle.routes.push(thirdRoute)
  bundle.stages.push(thirdStage)
  const cache = memoryCache()
  let calls = 0
  const firstProgress = []
  const flaky = provider([], {
    async findStructuralCandidates(search) {
      calls++
      if (calls === 2) throw new Error('offline')
      return provider([candidate('town', { name: `Town ${search.stageId}`, latitude: search.geometry[0].latitude, longitude: 6.12 })]).findStructuralCandidates(search)
    },
  })
  const first = await enrichTripRoute({
    bundle, provider: flaky, cache, idFactory: idFactory(), now: () => '2028-08-03T10:00:00.000Z',
    onProgress: (progress) => firstProgress.push(progress),
  })
  assert.equal(first.bundle.enrichmentMetadata.providers.find((state) => state.provider === 'postpass-route-enrichment').status, 'partial')
  assert.equal(first.localityCount, 2)
  assert.equal(first.requestCount, 3)
  assert.equal(first.networkErrorCount, 1)
  assert.deepEqual(firstProgress.map((progress) => progress.stageId), ['stage-alpha', 'stage-delta', 'stage-third'])
  assert.deepEqual(firstProgress.map((progress) => progress.status), ['success', 'error', 'success'])
  const firstCalls = calls
  const second = await enrichTripRoute({
    bundle: first.bundle,
    provider: provider([], { async findStructuralCandidates(search) { calls++; return provider([]).findStructuralCandidates(search) } }),
    cache, idFactory: idFactory('resume'), now: () => '2028-08-04T10:00:00.000Z',
  })
  assert.equal(calls - firstCalls, 1)
  assert.equal(second.cacheHitCount, 2)
  assert.equal(second.requestCount, 1)
  assert.equal(second.bundle.enrichmentMetadata.providers.find((state) => state.provider === 'postpass-route-enrichment').status, 'success')
})
