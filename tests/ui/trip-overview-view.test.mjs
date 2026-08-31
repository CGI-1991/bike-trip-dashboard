import assert from 'node:assert/strict'
import test from 'node:test'

import { buildTripOverview, computeHighlightedDayId } from '../../src/ui/trips/trip-overview-view.ts'
import { buildGenericOverviewDetailMarkers, buildGenericOverviewRouteMapModel } from '../../src/ui/route-map-model.ts'
import { createGenericTripBundle } from '../trip-core/support/generic-trip-fixture.mjs'

// Fixture dates: day-alpha 2027-05-10 (ride), day-bravo 2027-05-11 (off),
// day-charlie 2027-05-12 (transfer), day-delta 2027-05-13 (ride).

test('before the trip starts, day 1 is highlighted', () => {
  const bundle = createGenericTripBundle()
  assert.equal(computeHighlightedDayId(bundle, '2027-05-01'), 'day-alpha')
})

test('during the trip, the exact matching day is highlighted — even an OFF day', () => {
  const bundle = createGenericTripBundle()
  assert.equal(computeHighlightedDayId(bundle, '2027-05-11'), 'day-bravo')
})

test('a calendar gap during the trip falls forward to the next future day', () => {
  const bundle = createGenericTripBundle()
  const withGap = { ...bundle, days: bundle.days.map((day) => day.id === 'day-bravo' ? { ...day, date: null } : day) }
  assert.equal(computeHighlightedDayId(withGap, '2027-05-11'), 'day-charlie')
})

test('after the trip ends, nothing is highlighted', () => {
  const bundle = createGenericTripBundle()
  assert.equal(computeHighlightedDayId(bundle, '2027-06-01'), null)
})

test('an undated trip defaults to day 1', () => {
  const bundle = createGenericTripBundle({ dated: false })
  assert.equal(computeHighlightedDayId(bundle, null), 'day-alpha')
})

test('Aperçu order: title → stats → map → highlighted day (CDC Jalon B4.3 section 5)', () => {
  const bundle = createGenericTripBundle()
  const overview = buildTripOverview(bundle, '2027-05-01')
  const titleIndex = overview.html.indexOf('<h2>Sample Loop 01</h2>')
  const statsIndex = overview.html.indexOf('data-trip-overview-progress')
  const mapIndex = overview.html.indexOf('data-trip-overview-map')
  const dayIndex = overview.html.indexOf('trip-overview__highlighted-day')
  assert.ok(titleIndex < statsIndex && statsIndex < mapIndex && mapIndex < dayIndex, 'stats then map then the day card, never the day card first')
})

test('buildTripOverview renders the trip name and dates', () => {
  const bundle = createGenericTripBundle()
  const overview = buildTripOverview(bundle, '2027-05-01')
  assert.match(overview.html, /Sample Loop 01/)
  assert.match(overview.html, /2027-05-10 → 2027-05-13/)
})

// --- visual hierarchy: Voyage vs Aujourd'hui/Prochaine étape (CDC Jalon B4.4 sections 14/34) ---

test('Aperçu distinguishes a "Voyage" zone (stats + map) from a "Prochaine étape" zone (the highlighted day)', () => {
  const bundle = createGenericTripBundle()
  const overview = buildTripOverview(bundle, '2027-05-01')
  const voyageZoneIndex = overview.html.indexOf('data-trip-overview-zone="trip"')
  const voyageEyebrowIndex = overview.html.indexOf('>Voyage<')
  const statsIndex = overview.html.indexOf('data-trip-overview-progress')
  const mapIndex = overview.html.indexOf('data-trip-overview-map')
  const nextZoneIndex = overview.html.indexOf('data-trip-overview-zone="next"')
  const nextEyebrowIndex = overview.html.indexOf('>Prochaine étape<')
  const dayIndex = overview.html.indexOf('trip-overview__highlighted-day')
  assert.ok(voyageZoneIndex >= 0 && nextZoneIndex >= 0, 'both zones are present')
  assert.ok(voyageZoneIndex < voyageEyebrowIndex && voyageEyebrowIndex < statsIndex && statsIndex < mapIndex, 'the Voyage zone wraps stats + map, eyebrow first')
  assert.ok(mapIndex < nextZoneIndex && nextZoneIndex < nextEyebrowIndex && nextEyebrowIndex < dayIndex, 'the next-step zone starts only after the Voyage zone, eyebrow before the day card')
})

test('Aperçu labels the highlighted day "Aujourd’hui" when it is today, "Prochaine étape" otherwise', () => {
  const bundle = createGenericTripBundle()
  assert.match(buildTripOverview(bundle, '2027-05-10').html, />Aujourd’hui</)
  assert.match(buildTripOverview(bundle, '2027-05-01').html, />Prochaine étape</)
})

test('Aperçu renders no "next step" zone at all once the trip is entirely in the past (nothing to highlight)', () => {
  const bundle = createGenericTripBundle()
  const overview = buildTripOverview(bundle, '2028-01-01')
  assert.doesNotMatch(overview.html, /data-trip-overview-zone="next"/)
})

test('buildTripOverview shows exactly the six D1 progress metrics', () => {
  const bundle = createGenericTripBundle()
  const overview = buildTripOverview(bundle, '2027-05-01')
  for (const label of [
    'Distance totale', 'Distance restante', 'D+ total', 'D+ restant',
    'Étapes terminées', 'Journées restantes',
  ]) {
    assert.match(overview.html, new RegExp(`<dt>${label.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')}</dt>`), `missing metric: ${label}`)
  }
  // Scoped to the progress grid itself — the highlighted-day mini-card
  // below it carries its own unrelated <dt>s (Distance/D+/Départ/ETA),
  // never a duplicate of these six.
  const progressBlock = overview.html.match(/<section class="card trip-overview__progress"[\s\S]*?<\/section>/)?.[0] ?? ''
  assert.equal((progressBlock.match(/<dt>/g) ?? []).length, 6)
  assert.match(overview.html, /<dt>Étapes terminées<\/dt><dd>0<\/dd>/)
  assert.match(overview.html, /<dt>Journées restantes<\/dt><dd>4<\/dd>/)
})

test('a ride day already in the past is removed from remaining distance and D+', () => {
  const bundle = createGenericTripBundle()
  const overview = buildTripOverview(bundle, '2027-05-12')
  assert.match(overview.html, /<dt>Étapes terminées<\/dt><dd>1<\/dd>/)
  assert.match(overview.html, /<dt>Distance restante<\/dt><dd>0,0 km<\/dd>/)
  assert.match(overview.html, /<dt>D\+ restant<\/dt><dd>0 m<\/dd>/)
})

test('buildTripOverview shows the highlighted ride day with a clickable card and a weather mount point, no fabricated weather baked into the static markup', () => {
  const bundle = createGenericTripBundle()
  const overview = buildTripOverview(bundle, '2027-05-01')
  assert.equal(overview.highlightedDayId, 'day-alpha')
  assert.match(overview.html, /J1 — Riverside → Hilltown/)
  assert.match(overview.html, /data-action="open-day-detail" data-day-id="day-alpha"/)
  assert.match(overview.html, /role="button" tabindex="0"/)
  // CDC Jalon C1 section 20: real weather is mounted asynchronously by
  // `trips-manager.ts` (via `GenericWeatherCoordinator`) into this mount
  // point — never baked into `buildTripOverview`'s own synchronous markup.
  assert.match(overview.html, /data-trip-overview-weather-mount data-day-id="day-alpha"/)
  assert.match(overview.html, /Météo non disponible pour le moment\./, 'the placeholder shown before real data ever arrives')
  assert.doesNotMatch(overview.html, /°C/)
})

test('buildTripOverview shows the highlighted OFF day as a clickable card too — OFF days now have their own Journée shell (CDC Jalon B4.4 sections 23/35)', () => {
  const bundle = createGenericTripBundle()
  const overview = buildTripOverview(bundle, '2027-05-11')
  assert.equal(overview.highlightedDayId, 'day-bravo')
  assert.match(overview.html, /J2 — OFF — 11 Mai/)
  assert.match(overview.html, /data-action="open-day-detail" data-day-id="day-bravo"/)
})

test('after the trip, no highlighted-day section renders at all', () => {
  const bundle = createGenericTripBundle()
  const overview = buildTripOverview(bundle, '2027-06-01')
  assert.equal(overview.highlightedDayId, null)
  assert.doesNotMatch(overview.html, /trip-overview__highlighted-day/)
})

// --- A/B/C: the Aperçu map keeps the FULL ridden trace (CDC D1.1 section 1) ---

test('A: the overview model carries the full ridden GPX trace for every ride stage — never marker-only', () => {
  const bundle = createGenericTripBundle()
  const overview = buildTripOverview(bundle, '2027-05-01')
  assert.equal(overview.mapStages.length, 2)
  assert.ok(overview.mapStages[0].geometry.length > 1, 'day-alpha has real geometry — must be kept, not stripped to []')
  assert.deepEqual(overview.mapStages[0].waypoints.map((waypoint) => waypoint.kind), ['start', 'end'], 'markers stay trimmed to principal points, only the geometry changed')
})

test('B: two distinct GPX stages stay two disjoint segments — never a fabricated straight line between them', () => {
  const bundle = createGenericTripBundle()
  const overview = buildTripOverview(bundle, '2027-05-01')
  const model = buildGenericOverviewRouteMapModel(overview.mapStages)
  // day-alpha has real geometry; day-delta (stage-delta) has none in this
  // fixture, so `extraLines` stays empty here — the meaningful assertion is
  // that `coordinates` is exactly day-alpha's own trace, not a merge.
  assert.deepEqual(model.coordinates, overview.mapStages[0].geometry)
  assert.deepEqual(model.extraLines, [])
})

test('C: adjacent stages sharing an endpoint location (arrival Jx == departure Jx+1) collapse into one marker', () => {
  const bundle = createGenericTripBundle()
  bundle.routes[1].geometry = { full: null, simplified: [{ latitude: 45.3, longitude: 6.5, altitudeM: 640 }, { latitude: 45.6, longitude: 6.9, altitudeM: 900 }] }
  bundle.stages[1].startLocationName = 'Hilltown'
  const overview = buildTripOverview(bundle, '2027-05-01')
  const model = buildGenericOverviewRouteMapModel(overview.mapStages)
  const hilltownMarkers = model.markers.filter((marker) => marker.name === 'Hilltown')
  assert.equal(hilltownMarkers.length, 1, 'day-alpha\'s arrival and day-delta\'s departure are the same place — one logical point')
})

test('the overview map\'s principal markers are the simple, un-iconified "overview-primary" category — no Départ/Arrivée symbol imposed', () => {
  const bundle = createGenericTripBundle()
  const overview = buildTripOverview(bundle, '2027-05-01')
  const model = buildGenericOverviewRouteMapModel(overview.mapStages)
  assert.ok(model.markers.length > 0)
  assert.ok(model.markers.every((marker) => marker.category === 'overview-primary'))
})

test('mapStages waypoints are pre-filtered to the compact-map default (villages excluded)', () => {
  const bundle = createGenericTripBundle()
  bundle.routePoints.push({
    id: 'village-ui', routeId: bundle.routes[0].id, type: 'passage', name: 'Micro Village',
    latitude: 45.2, longitude: 6.35, elevationM: 300, trackDistanceKm: 30,
    osmFeatureType: 'village', lateralDistanceKm: 0.5,
    provenance: { sourceType: 'osm', sourceId: 'postpass:village:1', fetchedAt: null, engineVersion: 'route-enrichment@4', confidence: 'high', manuallyOverridden: false },
  })
  bundle.stages[0].routePointIds.push('village-ui')
  const overview = buildTripOverview(bundle, '2027-05-01')
  assert.ok(overview.mapStages[0].waypoints.every((waypoint) => waypoint.kind !== 'village'))
})

test('mapDetailStages carries significant intermediate points while the default map keeps only endpoints', () => {
  const bundle = createGenericTripBundle()
  bundle.routePoints.push({
    id: 'village-ui', routeId: bundle.routes[0].id, type: 'passage', name: 'Micro Village',
    latitude: 45.2, longitude: 6.35, elevationM: 300, trackDistanceKm: 30,
    osmFeatureType: 'village', lateralDistanceKm: 0.5,
    provenance: { sourceType: 'osm', sourceId: 'postpass:village:1', fetchedAt: null, engineVersion: 'route-enrichment@4', confidence: 'high', manuallyOverridden: false },
  })
  bundle.stages[0].routePointIds.push('village-ui')
  const overview = buildTripOverview(bundle, '2027-05-01')
  assert.equal(overview.mapDetailStages.length, overview.mapStages.length)
  assert.equal(overview.mapDetailStages[0].waypoints.length, 4)
  assert.ok(overview.mapDetailStages[0].waypoints.some((waypoint) => waypoint.name === 'Micro Village'))
  assert.ok(overview.mapDetailStages[0].geometry.length === 0)
})

// --- D/E/F/G/H: the compact card has no Détail control at all; it lives
// only inside the fullscreen dialog (CDC D1.1 sections 2-3) ---------------

test('D: the compact map card carries no "Détail" toggle/button of its own — only the fullscreen dialog does', () => {
  const bundle = createGenericTripBundle()
  const overview = buildTripOverview(bundle, '2027-05-01')
  const compactCardHtml = overview.html.slice(overview.html.indexOf('data-route-visuals'), overview.html.indexOf('data-trip-overview-map-dialog'))
  assert.doesNotMatch(compactCardHtml, /Détail/)
  assert.doesNotMatch(compactCardHtml, /data-action="toggle-overview-map-detail"/, 'the D1 toggle action is gone entirely')
})

test('the compact map itself is the click/tap target that opens the fullscreen — no separate "Grand écran"/"Explorer la carte" button', () => {
  const bundle = createGenericTripBundle()
  const overview = buildTripOverview(bundle, '2027-05-01')
  assert.match(overview.html, /<div class="route-map route-map--action" data-trip-overview-map data-explore-map role="button" tabindex="0" aria-label="[^"]+"><\/div>/)
  assert.doesNotMatch(overview.html, /Grand écran/)
  assert.doesNotMatch(overview.html, /Explorer la carte/)
})

test('E: the fullscreen dialog carries the "Détail" control', () => {
  const bundle = createGenericTripBundle()
  const overview = buildTripOverview(bundle, '2027-05-01')
  const dialogHtml = overview.html.slice(overview.html.indexOf('data-trip-overview-map-dialog'))
  assert.match(dialogHtml, /data-map-layers-toggle[^>]*>Détail<\/button>/)
})

test('F/G: Détail OFF keeps only principal points; Détail ON adds significant intermediate waypoints — never practical POIs (H)', () => {
  const bundle = createGenericTripBundle()
  bundle.routePoints.push({
    id: 'village-ui', routeId: bundle.routes[0].id, type: 'passage', name: 'Micro Village',
    latitude: 45.2, longitude: 6.35, elevationM: 300, trackDistanceKm: 30,
    osmFeatureType: 'village', lateralDistanceKm: 0.5,
    provenance: { sourceType: 'osm', sourceId: 'postpass:village:1', fetchedAt: null, engineVersion: 'route-enrichment@4', confidence: 'high', manuallyOverridden: false },
  })
  bundle.stages[0].routePointIds.push('village-ui')
  const overview = buildTripOverview(bundle, '2027-05-01')
  const detailOffModel = buildGenericOverviewRouteMapModel(overview.mapStages)
  assert.ok(detailOffModel.markers.every((marker) => marker.category === 'overview-primary'), 'F: Détail OFF — only principal points')
  const detailMarkers = buildGenericOverviewDetailMarkers(overview.mapDetailStages)
  assert.ok(detailMarkers.length > 0, 'G: Détail ON — significant intermediate waypoints exist')
  assert.ok(detailMarkers.every((marker) => marker.category === 'overview-secondary'))
  assert.ok(detailMarkers.some((marker) => marker.name === 'Micro Village'))
  // H: no practical-POI category ever leaks into the model (this build never
  // computes one for the overview map to begin with).
  assert.ok(overview.mapDetailStages.flatMap((stage) => stage.waypoints).every((waypoint) => !('category' in waypoint)))
})

// --- I: the Aperçu "GPX" action targets the whole trip, not just the highlighted stage ---

test('I: the Aperçu screen offers a "GPX" action wired to the whole-trip export, not a per-stage one', () => {
  const bundle = createGenericTripBundle()
  const overview = buildTripOverview(bundle, '2027-05-01')
  assert.match(overview.html, /<button class="button button--quiet" type="button" data-action="download-trip-gpx">GPX<\/button>/)
})

test('highlightedDayMap keeps the highlighted ride geometry although the global map is marker-only', () => {
  const bundle = createGenericTripBundle()
  const overview = buildTripOverview(bundle, '2027-05-01')
  assert.equal(overview.highlightedDayId, 'day-alpha')
  assert.ok(overview.highlightedDayMap.geometry.length > 1)
  assert.ok(overview.highlightedDayMap.waypoints.length >= overview.mapStages[0].waypoints.length)
})

test('highlightedDayMap is null when the highlighted day is OFF/transfer (no stage) or nothing is highlighted', () => {
  const bundle = createGenericTripBundle()
  assert.equal(buildTripOverview(bundle, '2027-05-11').highlightedDayMap, null)
  assert.equal(buildTripOverview(bundle, '2027-06-01').highlightedDayMap, null)
})
