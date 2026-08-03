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

test('trip detail exposes practical-place search and renders a compact stage list with OSM attribution', () => {
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
  const html = renderTripDetail(bundle, { canSearchPracticalPlaces: true })
  assert.match(html, /Rechercher les lieux utiles/)
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
  assert.match(failedHtml, /Overpass indisponible/)
  assert.match(failedHtml, /dernière recherche a échoué/)
})

test('trip detail shows non-blocking automatic progress and ordered route localities', () => {
  const bundle = createGenericTripBundle()
  bundle.enrichmentMetadata.providers.push({
    provider: 'osm-route-enrichment', lastAttemptedAt: '2028-08-03T10:00:00.000Z',
    lastSuccessAt: '2028-08-03T10:00:00.000Z', status: 'success', message: null,
  })
  bundle.routePoints.push({
    id: 'locality-ui', routeId: bundle.routes[0].id, type: 'village', name: 'Village UI',
    latitude: 45.2, longitude: 6.3, elevationM: 300, trackDistanceKm: 10,
    osmFeatureType: 'village', lateralDistanceKm: 0.2,
    provenance: { sourceType: 'osm', sourceId: 'osm:village:1', fetchedAt: '2028-08-03T10:00:00.000Z', engineVersion: 'route-enrichment@2', confidence: 'high', manuallyOverridden: false },
  })
  bundle.stages[0].routePointIds.push('locality-ui')
  const pending = renderTripDetail(bundle, { automaticEnrichmentPending: true, automaticEnrichmentProgress: 'Localités — étape 1/2, zone 2/4' })
  assert.match(pending, /Enrichissement en cours/)
  assert.match(pending, /Localités — étape 1\/2, zone 2\/4/)
  const completed = renderTripDetail(bundle)
  assert.match(completed, /Voyage enrichi/)
  assert.match(completed, /Passage :<\/strong> Village UI/)
})
