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

test('trip detail exposes no manual Overpass climb-naming action — climbs themselves are an Étape-only concern', () => {
  const bundle = createGenericTripBundle()
  bundle.climbs[0].name = 'Col enrichi'
  bundle.climbs[0].provenance = {
    sourceType: 'osm',
    sourceId: 'postpass-osm:mountain-pass:node:42',
    fetchedAt: '2028-04-01T10:00:00.000Z',
    engineVersion: 'route-enrichment@4',
    confidence: 'high',
    manuallyOverridden: false,
  }
  const html = renderTripDetail(bundle)
  assert.doesNotMatch(html, /Rechercher les noms des montées/)
  assert.doesNotMatch(html, /enrich-trip-climb-names/)
})

/**
 * CDC C2 section 16 (non-objectif, section 41): practical POI are visible
 * ONLY in the Étape fullscreen map's own "Calques" panel — never here. The
 * old "Lieux pratiques" technical-details disclosure this test used to
 * cover predates C2 and is gone outright (not merely hidden behind a flag);
 * re-adding any trace of it in Voyage would be the exact regression C2
 * section 16 forbids.
 */
test('trip detail (Voyage) never surfaces practical places, however many are stored — C2 confines them to the Étape fullscreen map', () => {
  const bundle = createGenericTripBundle()
  bundle.practicalPlaces.push({
    id: 'postpass-practical:stage-alpha:node:42',
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
      engineVersion: 'practical-places-postpass@1', confidence: 'high', manuallyOverridden: false,
    },
  })
  const html = renderTripDetail(bundle)
  assert.doesNotMatch(html, /Lieux pratiques/)
  assert.doesNotMatch(html, /data-trip-detail-practical/)
  assert.doesNotMatch(html, /Eau potable/)
  // Endpoint/route/climb OSM data alone still earns the attribution line —
  // practical places are simply never part of that decision any more.
  bundle.routePoints[0].provenance.sourceType = 'osm'
  assert.match(renderTripDetail(bundle), /© OpenStreetMap contributors/)
})

/**
 * CDC Jalon C1 closeout, refined by UI-POLISH-01 section 10: this test used
 * to assert a literal "Voyage enrichi"/"Provider = Postpass" banner — text
 * that no longer exists anywhere in the generic runtime (it predates the
 * B4.3/B4.4 UX pass, which deliberately made a clean, fully-successful
 * enrichment SILENT — no banner at all once every provider has succeeded,
 * per `renderTripDetail`'s own `automaticStatus` logic: empty string when
 * `routeEnrichmentState`/`osmState` are both `'success'`). UI-POLISH-01 went
 * one step further: the pending/partial banners themselves must never show
 * provider names or raw diagnostic text either (`automaticEnrichmentProgress`/
 * `automaticEnrichmentError` are still accepted as props for dev/debug
 * callers, just never rendered) — one concise, generic line only. The actual
 * contract this test must guard is:
 *   1. a pending enrichment shows a concise, non-technical banner — never the
 *      raw provider progress string;
 *   2. a fully successful one shows NO diagnostic banner (silent success);
 *   3. a partial one shows a concise, non-technical banner too;
 *   4. in every case, a structural route point (city/town/village/climb
 *      landmark) discovered by Postpass is never listed in Voyage — that
 *      stays an Étape/Parcours-only concern, never duplicated here.
 */
test('trip detail reflects Postpass enrichment status honestly (pending/silent-success/partial) without ever duplicating structural points (those are an Étape-only concern)', () => {
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
      provenance: { sourceType: 'osm', sourceId: 'postpass:city:1', fetchedAt: '2028-08-03T10:00:00.000Z', engineVersion: 'route-enrichment@4', confidence: 'high', manuallyOverridden: false },
    },
  )
  bundle.stages[0].routePointIds.push('locality-ui')

  const pending = renderTripDetail(bundle, { automaticEnrichmentPending: true, automaticEnrichmentProgress: 'Points structurants — étape 1/2 · 320 ms · 2/4 retenus' })
  assert.match(pending, /Mise à jour des données/)
  assert.doesNotMatch(pending, /Points structurants — étape 1\/2/, 'the raw provider progress string is never shown to the user (UI-POLISH-01 section 10)')
  assert.doesNotMatch(pending, /City UI/, 'a structural point discovered by Postpass never leaks into Voyage, even while enrichment is still running')

  // Every provider `'success'` (the fixture's own `osm` state is already
  // `'success'`, and the just-pushed `postpass-route-enrichment` one too) —
  // the honest, current behaviour is silence, not a banner.
  const completed = renderTripDetail(bundle)
  assert.doesNotMatch(completed, /trip-detail__enrichment/, 'a fully successful, non-pending enrichment shows no diagnostic banner at all — silent success, never a stale/removed label')
  assert.doesNotMatch(completed, /City UI/, 'still never duplicated once enrichment has finished')
  assert.match(completed, /© OpenStreetMap contributors/, 'OSM attribution still shows — that is a real, current signal, unlike the removed banner text')

  const routeStateIndex = bundle.enrichmentMetadata.providers.findIndex((state) => state.provider === 'postpass-route-enrichment')
  bundle.enrichmentMetadata.providers[routeStateIndex] = {
    ...bundle.enrichmentMetadata.providers[routeStateIndex],
    status: 'partial',
    message: 'Une zone reste à reprendre.',
  }
  const partial = renderTripDetail(bundle)
  assert.match(partial, /trip-detail__enrichment/)
  assert.match(partial, /Certaines données seront complétées ultérieurement/)
  assert.doesNotMatch(partial, /Rechercher les lieux utiles/)
  assert.doesNotMatch(partial, /City UI/, 'not duplicated in the partial state either')
})
