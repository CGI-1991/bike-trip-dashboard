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
  assert.match(html, /<button class="trip-day-card trip-day-card--ride[^"]*" type="button" data-action="open-day-detail" data-day-id="day-alpha"/)
  assert.match(html, /<strong>J1<\/strong><time datetime="2027-05-10">10 mai<\/time>/)
  assert.match(html, /Riverside → Hilltown/)
  assert.doesNotMatch(html, /Riverside to Hilltown/)
  assert.doesNotMatch(html, /Voir le détail/)
})

test('a ride day card carries the compact "Étape" badge (CDC D1 section 3: replaces the old "Roulé" wording)', () => {
  const bundle = createGenericTripBundle()
  const html = renderTripDetail(bundle)
  assert.match(html, /<span class="tag tag--ride">Étape<\/span>/)
  assert.doesNotMatch(html, />Roulé</)
})

test('an OFF day card shows the OFF badge and its auto-filled/known location, no "Voir le détail"', () => {
  const bundle = createGenericTripBundle()
  const html = renderTripDetail(bundle)
  assert.match(html, /trip-day-card--off/)
  assert.match(html, /<span class="tag tag--off">OFF<\/span>/)
  assert.match(html, /<strong>J2<\/strong><time datetime="2027-05-11">11 mai<\/time>/)
  assert.match(html, /Hilltown/)
  assert.doesNotMatch(html, /Voir le détail/)
})

test('a transfer day card shows the Transfert badge and origin → destination', () => {
  const bundle = createGenericTripBundle()
  const html = renderTripDetail(bundle)
  assert.match(html, /trip-day-card--transfer/)
  assert.match(html, /<span class="tag tag--transfer">Transfert<\/span>/)
  assert.match(html, /<strong>J3<\/strong><time datetime="2027-05-12">12 mai<\/time>/)
  assert.match(html, /Hilltown → Lakeside/)
})

test('an undated day header omits the date segment entirely rather than showing a placeholder', () => {
  const bundle = createGenericTripBundle({ dated: false })
  const html = renderTripDetail(bundle)
  assert.match(html, /<strong>J1<\/strong>/)
  assert.doesNotMatch(html, /<time /)
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
  assert.match(html, /<span class="trip-day-card__metrics"><span>62,4 km<\/span><span>\+780 m<\/span><\/span>/)
  assert.match(html, /<span class="visually-hidden">Départ <\/span>08:00/)
  assert.match(html, /<span class="visually-hidden">ETA <\/span>\d{2}:\d{2}<\/strong>/)
})

test('a ride day with no route geometry shows an em dash for departure/arrival rather than a fabricated time', () => {
  const bundle = createGenericTripBundle()
  const html = renderTripDetail(bundle)
  // `data-day-id="day-delta"` appears several times in the card (the button
  // itself, the weather mount, and the retry slot) — grab the card
  // `<button>…</button>` block itself, not just the text between the first
  // two occurrences.
  const deltaCard = html.match(/<button[^>]*data-day-id="day-delta"[\s\S]*?<\/button>/)?.[0] ?? ''
  assert.match(deltaCard, /<span class="visually-hidden">ETA <\/span>—<\/strong>/)
})

test('a stage switched to manual pause mode changes the Voyage screen\'s estimated arrival time (CDC Jalon B4 section 15/16)', () => {
  // DER-DES-DER section 21: a pause — automatic or manual — only ever lands
  // on a real waypoint, so both sides of this comparison need one. The
  // fixture's route1 otherwise carries nothing but its start/end points.
  const withMidwayVillage = () => {
    const bundle = createGenericTripBundle()
    const village = {
      ...bundle.routePoints[0], id: 'point-midway-village', type: 'passage', name: 'Midway',
      trackDistanceKm: 30, latitude: 45.2, longitude: 6.35, osmFeatureType: 'village',
    }
    bundle.routePoints = [...bundle.routePoints, village]
    bundle.stages[0] = { ...bundle.stages[0], routePointIds: [...bundle.stages[0].routePointIds, village.id] }
    return bundle
  }
  const automaticBundle = withMidwayVillage()
  const manualBundle = withMidwayVillage()
  manualBundle.settings.stages[0] = {
    stageId: manualBundle.stages[0].id, pausePlanMode: 'custom',
    pauses: [{ id: 'pause-manual-1', active: true, routePointId: 'point-midway-village', durationSeconds: 3_600, order: 0, origin: 'custom' }],
  }
  const etaOf = (html) => html.match(/<span class="visually-hidden">ETA <\/span>(\d{2}:\d{2})<\/strong>/)[1]
  const automaticArrival = etaOf(renderTripDetail(automaticBundle))
  const manualArrival = etaOf(renderTripDetail(manualBundle))
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

// --- D1 section 3/10: the priority day (per deriveTripTemporalState) gets a
// distinct visual marker on the Voyage list, and a completed ride day shows
// the compact "Terminé" status instead of "Étape" -----------------------

test('the priority day (first non-completed day) is visually marked on its card', () => {
  const bundle = createGenericTripBundle()
  const html = renderTripDetail(bundle, { now: '2027-05-01T00:00:00.000Z' })
  assert.match(html, /<button class="trip-day-card trip-day-card--ride is-priority" type="button" data-action="open-day-detail" data-day-id="day-alpha" data-trip-priority-day>/)
})

test('a completed ride day (its date is in the past) shows "Terminé" instead of "Étape"', () => {
  const bundle = createGenericTripBundle()
  const html = renderTripDetail(bundle, { now: '2027-05-13T00:00:00.000Z' })
  const alphaCard = html.match(/<li>\s*<button[^>]*data-day-id="day-alpha"[\s\S]*?<\/button>\s*<\/li>/)?.[0] ?? ''
  assert.match(alphaCard, /<span class="tag tag--completed">Terminé<\/span>/)
  assert.doesNotMatch(alphaCard, /tag--ride">Étape</)
})

// --- CDC D1.1 section 5: a stable grid — fixed left/right columns, status
// always separate from the hours zone, long names never break it ----------

test('J: the day-card date uses the short abbreviated format ("03 sept."), never the full month name', () => {
  const bundle = createGenericTripBundle()
  const html = renderTripDetail(bundle)
  assert.match(html, /<time datetime="2027-05-10">10 mai<\/time>/)
  assert.doesNotMatch(html, /10 Mai</, 'the full-month formatSimpleDate must not leak back into the Voyage list')
})

test('K: the status badge is its own grid item, physically separate from the Départ/ETA hours — never sharing a line with them or the route name', () => {
  const bundle = createGenericTripBundle()
  const html = renderTripDetail(bundle)
  const alphaCard = html.match(/<li>\s*<button[^>]*data-day-id="day-alpha"[\s\S]*?<\/button>\s*<\/li>/)?.[0] ?? ''
  // R1: the status span also carries the always-present, empty prep-slot
  // mount (`data-trip-day-prep-slot`, see `renderStagePreparationIndicator`'s
  // own doc comment) right after the tag — never a real indicator here
  // since no status map was supplied.
  assert.match(alphaCard, /<span class="trip-day-card__schedule">\s*<span class="trip-day-card__status"><span class="tag tag--ride">Étape<\/span><span data-trip-day-prep-slot><\/span><\/span>\s*<small>/)
  // The route name's own <span> carries no badge markup any more.
  assert.doesNotMatch(alphaCard, /<span class="trip-day-card__route"[^>]*>[^<]*<span class="tag/)
})

test('L: a very long place name still renders as a single ellipsis-truncated line — the grid columns (status/hours) are untouched by its length', () => {
  const bundle = createGenericTripBundle()
  bundle.stages[0].startLocationName = 'Saint-Jean-de-la-Très-Longue-Vallée-des-Alpes-Maritimes'
  const html = renderTripDetail(bundle)
  assert.match(html, /<span class="trip-day-card__route" title="Saint-Jean-de-la-Très-Longue-Vallée-des-Alpes-Maritimes → Hilltown"[^>]*>St-Jean-de-la-Très-Longue-Vallée-des-Alpes-Maritimes → Hilltown<\/span>/)
  // The right-hand schedule column still renders its own three rows,
  // wherever the card is measured — the grid never collapses/reflows it.
  const alphaCard = html.match(/<li>\s*<button[^>]*data-day-id="day-alpha"[\s\S]*?<\/button>\s*<\/li>/)?.[0] ?? ''
  assert.match(alphaCard, /<span class="trip-day-card__schedule">\s*<span class="trip-day-card__status">/)
})

// --- DER-DES-DER sections 52-53: the retry lives ONLY on the Voyage card ----

function withStatus(dayId, status) {
  return { stagePreparationStatuses: new Map([[dayId, status]]) }
}

test('BG: a partial stage shows "À compléter" + "Réessayer" on its own Voyage card, targeting that stage', () => {
  const bundle = createGenericTripBundle()
  const html = renderTripDetail(bundle, withStatus('day-alpha', 'partial'))
  assert.match(html, /<p class="trip-day-card__retry"><span>À compléter<\/span>/)
  assert.match(html, /data-action="retry-stage-preparation"[^>]*data-day-id="day-alpha"[^>]*>Réessayer<\/button>/)
})

test('BG: an errored stage gets the same single action', () => {
  const html = renderTripDetail(createGenericTripBundle(), withStatus('day-alpha', 'error'))
  assert.match(html, /data-action="retry-stage-preparation"[^>]*data-day-id="day-alpha"/)
})

test('section 53: a ready, pending or running stage stays silent — no "À compléter", no retry', () => {
  for (const status of ['ready', 'pending', 'running', 'stale', null]) {
    const html = renderTripDetail(createGenericTripBundle(), withStatus('day-alpha', status))
    assert.doesNotMatch(html, /retry-stage-preparation/, `status ${status} should not offer a retry`)
    assert.doesNotMatch(html, /À compléter/, `status ${status} should stay silent`)
  }
})

test('section 53: only the affected stage gets the action — a healthy sibling ride day stays untouched', () => {
  const bundle = createGenericTripBundle()
  const html = renderTripDetail(bundle, { stagePreparationStatuses: new Map([['day-alpha', 'error'], ['day-delta', 'ready']]) })
  assert.equal((html.match(/data-action="retry-stage-preparation"/g) ?? []).length, 1)
  assert.doesNotMatch(html, /retry-stage-preparation"[^>]*data-day-id="day-delta"/)
})

test('the retry action is never nested inside the card button — a button inside a button is invalid and would swallow the card click', () => {
  const html = renderTripDetail(createGenericTripBundle(), withStatus('day-alpha', 'error'))
  const cardButton = html.match(/<button[^>]*data-action="open-day-detail"[^>]*data-day-id="day-alpha"[\s\S]*?<\/button>/)?.[0] ?? ''
  assert.ok(cardButton.length > 0, 'the card button was found')
  assert.doesNotMatch(cardButton, /retry-stage-preparation/)
})
