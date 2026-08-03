import assert from 'node:assert/strict'
import test from 'node:test'

import { enrichTripRoute, removeGeometricDuplicateClimbs } from '../../src/route-enrichment/enrichment.ts'
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
    : featureType === 'city' || featureType === 'town' || featureType === 'village' ? { place: featureType }
      : { natural: featureType }
  return {
    osmType: 'node', osmId: `${featureType}-1`, featureType, name: featureType,
    latitude: 45, longitude: 6.127, elevationM: 500, usefulTags: tags, ...overrides,
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

test('localities are filtered at 1.5 km, deduplicated and ordered along the full GPX route', async () => {
  const bundle = climbBundle()
  const provider = {
    id: 'mock-route', sourceType: 'osm', attribution: 'OSM',
    async findCandidates(search) {
      if (search.kind === 'landmarks') return []
      return [
        candidate('village', { osmId: 'v2', name: 'Second', longitude: 6.19, latitude: 45 }),
        candidate('city', { osmId: 'v1', name: 'Premier', longitude: 6.06, latitude: 45 }),
        candidate('town', { osmId: 'v-town', name: 'Milieu', longitude: 6.12, latitude: 45 }),
        candidate('town', { osmId: 'far', name: 'Trop loin', longitude: 6.12, latitude: 45.02 }),
        candidate('city', { osmId: 'v1', name: 'Premier', longitude: 6.06, latitude: 45 }),
      ]
    },
  }
  const report = await enrichTripRoute({ bundle, provider, cache: memoryCache(), idFactory: idFactory(), now: () => '2028-08-03T10:00:00.000Z' })
  const localities = report.bundle.routePoints.filter((point) => ['city', 'town', 'village'].includes(point.osmFeatureType))
  assert.deepEqual(localities.map((point) => point.name), ['Premier', 'Milieu', 'Second'])
  assert.ok(localities[0].trackDistanceKm < localities[1].trackDistanceKm && localities[1].trackDistanceKm < localities[2].trackDistanceKm)
  assert.ok(localities.every((point) => point.lateralDistanceKm <= 1.5))
})

test('mountain_pass and saddle can conservatively adjust a summit and recalculate statistics', async () => {
  for (const featureType of ['mountain-pass', 'saddle']) {
    const bundle = climbBundle()
    const provider = {
      id: `mock-${featureType}`, sourceType: 'osm', attribution: 'OSM',
      async findCandidates(search) { return search.kind === 'landmarks' ? [candidate(featureType, { name: `Anchor ${featureType}` })] : [] },
    }
    const report = await enrichTripRoute({ bundle, provider, cache: memoryCache(), idFactory: idFactory(featureType), now: () => '2028-08-03T10:00:00.000Z' })
    const climb = report.bundle.climbs[0]
    assert.equal(climb.name, `Anchor ${featureType}`)
    assert.ok(climb.endDistanceKm > 9.9 && climb.endDistanceKm < 10.1)
    assert.equal(Math.round(climb.endAltitudeM), 500)
    assert.ok(climb.elevationGainM >= 400)
    assert.equal(climb.provenance.engineVersion, 'route-enrichment@2')
  }
})

test('natural peak names a climb but never moves its detected summit', async () => {
  const bundle = climbBundle()
  const provider = {
    id: 'mock-peak', sourceType: 'osm', attribution: 'OSM',
    async findCandidates(search) { return search.kind === 'landmarks' ? [candidate('peak', { name: 'Peak context' })] : [] },
  }
  const report = await enrichTripRoute({ bundle, provider, cache: memoryCache(), idFactory: idFactory(), now: () => '2028-08-03T10:00:00.000Z' })
  assert.equal(report.bundle.climbs[0].name, 'Peak context')
  assert.equal(report.bundle.climbs[0].endDistanceKm, 9.5)
  assert.equal(report.bundle.climbs[0].confidence, 'probable')
})

test('manual and pertinent GPX waypoint names always outrank OSM landmarks', async () => {
  for (const existing of [
    { name: 'Nom manuel', provenance: { sourceType: 'user', sourceId: 'manual', fetchedAt: null, engineVersion: 'manual', confidence: 'high', manuallyOverridden: true } },
    { name: 'Waypoint GPX', provenance: { sourceType: 'generated', sourceId: 'gpx-waypoint', fetchedAt: null, engineVersion: 'test', confidence: 'high', manuallyOverridden: false } },
  ]) {
    const bundle = climbBundle()
    bundle.climbs[0] = { ...bundle.climbs[0], ...existing }
    const provider = {
      id: 'mock-priority', sourceType: 'osm', attribution: 'OSM',
      async findCandidates(search) { return search.kind === 'landmarks' ? [candidate('mountain-pass', { name: 'Nom OSM' })] : [] },
    }
    const report = await enrichTripRoute({ bundle, provider, cache: memoryCache(), idFactory: idFactory(), now: () => '2028-08-03T10:00:00.000Z' })
    assert.equal(report.bundle.climbs[0].name, existing.name)
    assert.equal(report.bundle.climbs[0].endDistanceKm, 9.5)
  }
})

test('an incoherent pass is refused for summit adjustment', async () => {
  const bundle = climbBundle()
  const provider = {
    id: 'mock-bad-pass', sourceType: 'osm', attribution: 'OSM',
    async findCandidates(search) { return search.kind === 'landmarks' ? [candidate('mountain-pass', { name: 'Wrong altitude', elevationM: 900 })] : [] },
  }
  const report = await enrichTripRoute({ bundle, provider, cache: memoryCache(), idFactory: idFactory(), now: () => '2028-08-03T10:00:00.000Z' })
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

test('successful chunks are reused after a later chunk failure and only the missing chunk is retried', async () => {
  const bundle = climbBundle()
  bundle.routes[0].geometry.full = Array.from({ length: 7 }, (_unused, index) => ({ latitude: 45, longitude: 6 + index * 0.1, altitudeM: 100 + index * 10 }))
  const cache = memoryCache()
  let calls = 0
  const progress = []
  const firstProvider = {
    id: 'resume-provider', sourceType: 'osm', attribution: 'OSM',
    async findCandidates() { calls++; if (calls === 2) throw new Error('offline'); return [] },
  }
  const first = await enrichTripRoute({
    bundle, provider: firstProvider, cache, idFactory: idFactory(), now: () => '2028-08-03T10:00:00.000Z',
    onProgress: (event) => progress.push(event),
  })
  assert.equal(first.bundle.enrichmentMetadata.providers.find((state) => state.provider === 'osm-route-enrichment').status, 'partial')
  const failedProgressIndex = progress.findIndex((event) => event.status === 'error')
  assert.ok(failedProgressIndex >= 0)
  assert.ok(progress.slice(failedProgressIndex + 1).some((event) => event.status === 'success'))
  assert.equal(progress[failedProgressIndex].chunkIndex, 1)
  assert.equal(progress[failedProgressIndex].errorCount, 1)
  const firstCalls = calls
  const second = await enrichTripRoute({ bundle: first.bundle, provider: { ...firstProvider, async findCandidates() { calls++; return [] } }, cache, idFactory: idFactory('resume'), now: () => '2028-08-04T10:00:00.000Z' })
  assert.equal(calls - firstCalls, 1)
  assert.ok(second.cacheHitCount > 0)
  assert.equal(second.bundle.enrichmentMetadata.providers.find((state) => state.provider === 'osm-route-enrichment').status, 'success')
})
