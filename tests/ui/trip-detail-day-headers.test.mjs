import assert from 'node:assert/strict'
import test from 'node:test'

import { renderTripDetail } from '../../src/ui/trips/trip-detail-view.ts'
import { createGenericTripBundle } from '../trip-core/support/generic-trip-fixture.mjs'

test('the Voyage screen has no global stats — title then straight into the day list (CDC Jalon B4.3 section 9)', () => {
  const bundle = createGenericTripBundle()
  const html = renderTripDetail(bundle)
  assert.match(html, /<h2>Sample Loop 01<\/h2>/)
  assert.doesNotMatch(html, /trip-detail__summary/)
  assert.doesNotMatch(html, /Distance totale/)
  assert.doesNotMatch(html, /Progression du voyage/)
})

test('a ride day card is a single clickable button — compact date, no GPX/roadbook stage name, no separate "Voir le détail" (CDC Jalon B4.3 sections 4/10)', () => {
  const bundle = createGenericTripBundle()
  const html = renderTripDetail(bundle)
  assert.match(html, /<button class="trip-day-card trip-day-card--ride" type="button" data-action="open-day-detail" data-day-id="day-alpha">/)
  assert.match(html, /J1 · 10 Mai/)
  assert.match(html, /Riverside → Hilltown/)
  assert.doesNotMatch(html, /Riverside to Hilltown/)
  assert.doesNotMatch(html, /Voir le détail/)
})

test('an OFF day card shows the OFF badge and its auto-filled/known location, no "Voir le détail"', () => {
  const bundle = createGenericTripBundle()
  const html = renderTripDetail(bundle)
  assert.match(html, /trip-day-card--off/)
  assert.match(html, /<span class="tag tag--off">OFF<\/span>/)
  assert.match(html, /J2 · 11 Mai/)
  assert.match(html, /Hilltown/)
})

test('a transfer day card shows the Transfert badge and origin → destination', () => {
  const bundle = createGenericTripBundle()
  const html = renderTripDetail(bundle)
  assert.match(html, /trip-day-card--transfer/)
  assert.match(html, /<span class="tag tag--transfer">Transfert<\/span>/)
  assert.match(html, /J3 · 12 Mai/)
  assert.match(html, /Hilltown → Lakeside/)
})

test('an undated day header omits the date segment entirely rather than showing a placeholder', () => {
  const bundle = createGenericTripBundle({ dated: false })
  const html = renderTripDetail(bundle)
  assert.match(html, /J1<\/span>/)
  assert.doesNotMatch(html, /J1 · \d/)
})

test('the Voyage screen never lists structural points (Ville/Villages/Relief) or hamlet/peak — those live only in the Étape view', () => {
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
  const deltaCard = html.split('data-day-id="day-delta"')[1] ?? ''
  assert.match(deltaCard, /<dt>Arrivée estimée<\/dt><dd>—<\/dd>/)
})

test('a stage switched to manual pause mode changes the Voyage screen\'s estimated arrival time (CDC Jalon B4 section 15/16)', () => {
  const automaticBundle = createGenericTripBundle()
  const manualBundle = createGenericTripBundle()
  manualBundle.settings.stages[0] = {
    stageId: manualBundle.stages[0].id, pausePlanMode: 'custom',
    pauses: [{ id: 'pause-manual-1', active: true, routePointId: manualBundle.routePoints[0].id, durationSeconds: 3_600, order: 0, origin: 'custom' }],
  }
  const automaticArrival = renderTripDetail(automaticBundle).match(/<dt>Arrivée estimée<\/dt><dd>(\d{2}:\d{2})<\/dd>/)[1]
  const manualArrival = renderTripDetail(manualBundle).match(/<dt>Arrivée estimée<\/dt><dd>(\d{2}:\d{2})<\/dd>/)[1]
  assert.notEqual(automaticArrival, manualArrival)
})

test('every day — ride, OFF, and transfer alike — is its own clickable card carrying its own day id (CDC Jalon B4.4 sections 23/35: every day type now has a Journée/Étape shell to land on)', () => {
  const bundle = createGenericTripBundle()
  const html = renderTripDetail(bundle)
  assert.equal((html.match(/data-action="open-day-detail"/g) ?? []).length, 4)
  assert.match(html, /data-day-id="day-alpha"/)
  assert.match(html, /data-day-id="day-bravo"/)
  assert.match(html, /data-day-id="day-charlie"/)
  assert.match(html, /data-day-id="day-delta"/)
})

test('a single "Télécharger les GPX" action is offered once the trip has at least one ride stage (CDC Jalon B4.3 section 15)', () => {
  const bundle = createGenericTripBundle()
  const html = renderTripDetail(bundle)
  assert.match(html, /data-action="download-trip-gpx"/)
  assert.match(html, /Télécharger les GPX/)
})
