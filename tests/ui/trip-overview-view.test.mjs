import assert from 'node:assert/strict'
import test from 'node:test'

import { buildTripOverview, computeHighlightedDayId } from '../../src/ui/trips/trip-overview-view.ts'
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

test('buildTripOverview renders name, dates, day counts, distance, D+ and an OFF/transfer summary', () => {
  const bundle = createGenericTripBundle()
  const overview = buildTripOverview(bundle, '2027-05-01')
  assert.match(overview.html, /Sample Loop 01/)
  assert.match(overview.html, /2027-05-10 → 2027-05-13/)
  assert.match(overview.html, /4 \(2 roulées · 1 jour OFF · 1 transfert\)/)
  assert.match(overview.html, /62,4 km/)
  assert.match(overview.html, /\+780 m/)
})

test('buildTripOverview shows the highlighted ride day with a "Voir cette étape" action', () => {
  const bundle = createGenericTripBundle()
  const overview = buildTripOverview(bundle, '2027-05-01')
  assert.equal(overview.highlightedDayId, 'day-alpha')
  assert.match(overview.html, /J1 — 10\.05\.27 — Riverside → Hilltown/)
  assert.match(overview.html, /data-action="open-day-detail" data-day-id="day-alpha"/)
})

test('buildTripOverview shows the highlighted OFF day with no "Voir cette étape" action (no Étape view for OFF days)', () => {
  const bundle = createGenericTripBundle()
  const overview = buildTripOverview(bundle, '2027-05-11')
  assert.equal(overview.highlightedDayId, 'day-bravo')
  assert.match(overview.html, /J2 — OFF — 11\.05\.27/)
  assert.doesNotMatch(overview.html, /data-action="open-day-detail" data-day-id="day-bravo"/)
})

test('after the trip, no highlighted-day section renders at all', () => {
  const bundle = createGenericTripBundle()
  const overview = buildTripOverview(bundle, '2027-06-01')
  assert.equal(overview.highlightedDayId, null)
  assert.doesNotMatch(overview.html, /trip-overview__highlighted-day/)
})

test('mapStages carries one entry per stage, geometry-less stages resolve to an empty segment', () => {
  const bundle = createGenericTripBundle()
  const overview = buildTripOverview(bundle, '2027-05-01')
  assert.equal(overview.mapStages.length, 2)
  assert.ok(overview.mapStages[0].geometry.length > 1)
  assert.deepEqual(overview.mapStages[1].geometry, [])
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
