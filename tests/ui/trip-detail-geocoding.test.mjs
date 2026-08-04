import assert from 'node:assert/strict'
import test from 'node:test'

import { renderTripDetail } from '../../src/ui/trips/trip-detail-view.ts'
import { createGenericTripBundle } from '../trip-core/support/generic-trip-fixture.mjs'

test('trip detail displays start to end independently from the GPX stage name and exposes optional enrichment', () => {
  const bundle = createGenericTripBundle()
  const html = renderTripDetail(bundle, { canEnrichEndpoints: true })
  assert.match(html, /Riverside → Hilltown/)
  assert.match(html, /Identifier les lieux de départ et d’arrivée/)
})

test('trip detail attributes OSM endpoint names when present', () => {
  const bundle = createGenericTripBundle()
  bundle.routePoints[0].provenance.sourceType = 'osm'
  const html = renderTripDetail(bundle)
  assert.match(html, /© OpenStreetMap contributors/)
})

test('trip detail offers optional climb naming and displays an enriched climb name', () => {
  const bundle = createGenericTripBundle()
  bundle.climbs[0].name = 'Col enrichi'
  bundle.climbs[0].provenance = {
    sourceType: 'osm',
    sourceId: 'overpass-osm:mountain-pass:node:42',
    fetchedAt: '2028-04-01T10:00:00.000Z',
    engineVersion: 'climb-name-enrichment@1',
    confidence: 'high',
    manuallyOverridden: false,
  }
  const html = renderTripDetail(bundle, { canEnrichClimbNames: true })
  assert.match(html, /Col enrichi/)
  assert.match(html, /Rechercher les noms des montées/)
  assert.match(html, /© OpenStreetMap contributors/)
})

test('trip detail keeps stored practical places readable but exposes no practical-place search action', () => {
  const bundle = createGenericTripBundle()
  bundle.practicalPlaces.push({
    id: 'osm-practical:stage-alpha:node:42',
    stageId: bundle.stages[0].id,
    category: 'water',
    name: null,
    latitude: 45.15,
    longitude: 6.275,
    description: null,
    trackDistanceKm: 12.34,
    detourKm: 0.04,
    openingHours: null,
    usefulTags: { amenity: 'drinking_water' },
    hidden: false,
    pinned: false,
    dayIds: [bundle.days[0].id],
    provenance: {
      sourceType: 'osm', sourceId: 'mock:node:42', fetchedAt: '2028-08-03T10:00:00.000Z',
      engineVersion: 'practical-places-osm@1', confidence: 'high', manuallyOverridden: false,
    },
  })
  const html = renderTripDetail(bundle)
  assert.doesNotMatch(html, /Rechercher les lieux utiles/)
  assert.match(html, /Eau potable/)
  assert.match(html, /Sans nom/)
  assert.match(html, /≈ 12\.3 km/)
  assert.match(html, /© OpenStreetMap contributors/)
})

test('trip detail distinguishes an unstarted, successful-empty and failed practical-place search', () => {
  const bundle = createGenericTripBundle()
  bundle.practicalPlaces = []
  assert.match(renderTripDetail(bundle), /Recherche de lieux pratiques non encore effectuée/)

  bundle.enrichmentMetadata.providers.push({
    provider: 'osm-practical-places', lastAttemptedAt: '2028-08-03T10:00:00.000Z',
    lastSuccessAt: '2028-08-03T10:00:00.000Z', status: 'success', message: null,
  })
  assert.match(renderTripDetail(bundle), /Recherche effectuée : aucun lieu pratique trouvé/)

  bundle.enrichmentMetadata.providers[bundle.enrichmentMetadata.providers.length - 1] = {
    provider: 'osm-practical-places', lastAttemptedAt: '2028-08-04T10:00:00.000Z',
    lastSuccessAt: '2028-08-03T10:00:00.000Z', status: 'error', message: 'Overpass indisponible.',
  }
  const failedHtml = renderTripDetail(bundle)
  assert.match(failedHtml, /dernière recherche a échoué/)
  assert.doesNotMatch(failedHtml, /Rechercher les lieux utiles/)
})

test('trip detail shows Postpass diagnostics plus ordered city/town and pass/saddle measurements', () => {
  const bundle = createGenericTripBundle()
  bundle.enrichmentMetadata.providers.push({
    provider: 'postpass-route-enrichment', lastAttemptedAt: '2028-08-03T10:00:00.000Z',
    lastSuccessAt: '2028-08-03T10:00:00.000Z', status: 'success', message: 'Postpass · network · 320 ms · 4 candidat(s) / 2 retenu(s).',
  })
  bundle.routePoints.push(
    {
      id: 'locality-ui', routeId: bundle.routes[0].id, type: 'passage', name: 'City UI',
      latitude: 45.2, longitude: 6.3, elevationM: 300, trackDistanceKm: 10,
      osmFeatureType: 'city', lateralDistanceKm: 0.2,
      provenance: { sourceType: 'osm', sourceId: 'postpass:city:1', fetchedAt: '2028-08-03T10:00:00.000Z', engineVersion: 'route-enrichment@3', confidence: 'high', manuallyOverridden: false },
    },
    {
      id: 'pass-ui', routeId: bundle.routes[0].id, type: 'summit', name: 'Col UI',
      latitude: 45.25, longitude: 6.35, elevationM: 1234, trackDistanceKm: 20,
      osmFeatureType: 'mountain-pass', lateralDistanceKm: 0.08,
      provenance: { sourceType: 'osm', sourceId: 'postpass:pass:1', fetchedAt: '2028-08-03T10:00:00.000Z', engineVersion: 'route-enrichment@3', confidence: 'high', manuallyOverridden: false },
    },
  )
  bundle.stages[0].routePointIds.push('locality-ui', 'pass-ui')
  const pending = renderTripDetail(bundle, { automaticEnrichmentPending: true, automaticEnrichmentProgress: 'Points structurants — étape 1/2 · 320 ms · 2/4 retenus' })
  assert.match(pending, /Enrichissement en cours/)
  assert.match(pending, /Points structurants — étape 1\/2/)
  const completed = renderTripDetail(bundle)
  assert.match(completed, /Voyage enrichi/)
  assert.match(completed, /Provider = Postpass/)
  assert.match(completed, /Localités/)
  assert.match(completed, /km 10\.0/)
  assert.match(completed, /city/)
  assert.match(completed, /City UI/)
  assert.match(completed, /écart 200 m/)
  assert.match(completed, /Cols/)
  assert.match(completed, /pass/)
  assert.match(completed, /Col UI/)
  assert.match(completed, /écart 80 m · 1234 m/)

  const routeStateIndex = bundle.enrichmentMetadata.providers.findIndex((state) => state.provider === 'postpass-route-enrichment')
  bundle.enrichmentMetadata.providers[routeStateIndex] = {
    ...bundle.enrichmentMetadata.providers[routeStateIndex],
    status: 'partial',
    message: 'Une zone reste à reprendre.',
  }
  const partial = renderTripDetail(bundle)
  assert.match(partial, /Enrichissement partiel/)
  assert.doesNotMatch(partial, /Rechercher les lieux utiles/)
})
