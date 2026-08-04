import assert from 'node:assert/strict'
import test from 'node:test'

import { renderTripDetail } from '../../src/ui/trips/trip-detail-view.ts'
import { createGenericTripBundle } from '../trip-core/support/generic-trip-fixture.mjs'

test('a ride day header is compact — date before locations, no GPX/roadbook stage name', () => {
  const bundle = createGenericTripBundle()
  const html = renderTripDetail(bundle)
  assert.match(html, /J1 — 10\.05\.27 — Riverside → Hilltown/)
  assert.doesNotMatch(html, /Riverside to Hilltown/)
})

test('a transfer day header reads "Jn — Transfert — date", with the known locations as a secondary line', () => {
  const bundle = createGenericTripBundle()
  const html = renderTripDetail(bundle)
  assert.match(html, /J3 — Transfert — 12\.05\.27/)
  assert.match(html, /<span class="trip-detail__day-subtitle">Hilltown → Lakeside<\/span>/)
})

test('an OFF day header reads "Jn — OFF — date", with a single known location when start and end match', () => {
  const bundle = createGenericTripBundle()
  const html = renderTripDetail(bundle)
  assert.match(html, /J2 — OFF — 11\.05\.27/)
  assert.match(html, /<span class="trip-detail__day-subtitle">Hilltown<\/span>/)
})

test('an undated day header omits the date segment entirely rather than showing a placeholder', () => {
  const bundle = createGenericTripBundle({ dated: false })
  const html = renderTripDetail(bundle)
  assert.match(html, /J1 — Riverside → Hilltown<\/strong>/)
  assert.doesNotMatch(html, /J1 — \d/)
})

test('the Voyage screen never lists structural points (Localités/Villages/Relief) or hamlet/peak — those live only in the Étape view', () => {
  const bundle = createGenericTripBundle()
  bundle.routePoints.push(
    {
      id: 'village-ui', routeId: bundle.routes[0].id, type: 'village', name: 'Petit Village',
      latitude: 45.2, longitude: 6.25, elevationM: null, trackDistanceKm: 15,
      osmFeatureType: 'village', lateralDistanceKm: 0.5,
      provenance: { sourceType: 'osm', sourceId: 'postpass:village:1', fetchedAt: null, engineVersion: 'route-enrichment@4', confidence: 'high', manuallyOverridden: false },
    },
  )
  bundle.stages[0].routePointIds.push('village-ui')
  const html = renderTripDetail(bundle)
  assert.doesNotMatch(html, /Petit Village/)
  assert.doesNotMatch(html, /trip-detail__structural-points/)
  assert.doesNotMatch(html, /<h4>Localités<\/h4>/)
})

test('the Voyage screen never lists climbs — no global montées section', () => {
  const bundle = createGenericTripBundle()
  const html = renderTripDetail(bundle)
  assert.doesNotMatch(html, /Delta Pass/)
  assert.doesNotMatch(html, /<h3>Montées<\/h3>/)
})

test('the Voyage screen carries no per-screen "Retour à Mes voyages" button — the global nav covers it', () => {
  const bundle = createGenericTripBundle()
  const html = renderTripDetail(bundle)
  assert.doesNotMatch(html, /back-to-list/)
  assert.doesNotMatch(html, /Retour à Mes voyages/)
})

test('a ride day card shows distance, D+, departure time and estimated arrival', () => {
  const bundle = createGenericTripBundle()
  const html = renderTripDetail(bundle)
  assert.match(html, /<dt>Distance<\/dt><dd>62,4 km<\/dd>/)
  assert.match(html, /<dt>D\+<\/dt><dd>\+780 m<\/dd>/)
  assert.match(html, /<dt>Départ<\/dt><dd>08:00<\/dd>/)
  assert.match(html, /<dt>Arrivée estimée<\/dt><dd>\d{2}:\d{2}<\/dd>/)
})

test('a ride day with no route geometry shows an em dash for departure/arrival rather than a fabricated time', () => {
  const bundle = createGenericTripBundle()
  const html = renderTripDetail(bundle)
  const deltaCard = html.split('data-day-id="day-delta"')[0]?.split('trip-detail__day--ride').at(-1) ?? ''
  assert.match(deltaCard, /<dt>Arrivée estimée<\/dt><dd>—<\/dd>/)
})

test('every day row offers a "Voir le détail" action carrying its own day id, for ride days only', () => {
  const bundle = createGenericTripBundle()
  const html = renderTripDetail(bundle)
  assert.equal((html.match(/data-action="open-day-detail"/g) ?? []).length, 2)
  assert.match(html, /data-day-id="day-alpha"/)
  assert.match(html, /data-day-id="day-delta"/)
})
