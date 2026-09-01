import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { buildDayDetail } from '../../src/ui/trips/day-detail-view.ts'
import { isSignificantWaypoint } from '../../src/analysis/canonical-waypoints.ts'
import { createGenericTripBundle } from '../trip-core/support/generic-trip-fixture.mjs'

// CDC Jalon B4.4 sections 23-24: OFF/transfer days used to have no Étape
// screen at all (`buildDayDetail` returned `null`). They now build the
// lighter OFF/transfer shell instead — see the dedicated tests further down
// ("an OFF day now builds a real detail shell…" / "a transfer day builds a
// real detail shell…") for the shape of that shell.
test('an OFF day (no stage) still resolves — not null any more', () => {
  const bundle = createGenericTripBundle()
  assert.notEqual(buildDayDetail(bundle, 'day-bravo'), null)
})

test('a transfer day (no stage) still resolves — not null any more', () => {
  const bundle = createGenericTripBundle()
  assert.notEqual(buildDayDetail(bundle, 'day-charlie'), null)
})

test('returns null for an unknown day id', () => {
  const bundle = createGenericTripBundle()
  assert.equal(buildDayDetail(bundle, 'day-does-not-exist'), null)
})

test('returns null when the stage route has no usable geometry', () => {
  const bundle = createGenericTripBundle()
  // day-delta's stage (stage-delta / route-delta) has no geometry in the fixture.
  assert.equal(bundle.routes[1].geometry, null)
  // Its own waypoint list collapses to [] (buildCanonicalWaypoints' own no-geometry case),
  // but buildDayDetail must still resolve a header — geometry itself is surfaced as null for the caller.
  const detail = buildDayDetail(bundle, 'day-delta')
  assert.ok(detail !== null)
  assert.equal(detail.geometry, null)
  assert.deepEqual(detail.waypoints, [])
})

test('builds a real identity bandeau (Jx/short date left, départ → arrivée large/bold right, no GPX/roadbook name), stats, and a pauses section for a resolvable ride day', () => {
  const bundle = createGenericTripBundle()
  const detail = buildDayDetail(bundle, 'day-alpha')
  assert.ok(detail !== null)
  assert.match(detail.html, /<span class="day-detail__identity-number"><strong>J1<\/strong><time datetime="2027-05-10">10 mai<\/time><\/span>/)
  assert.match(detail.html, /<span class="day-detail__identity-route">Riverside → Hilltown<\/span>/)
  assert.doesNotMatch(detail.html, /Riverside to Hilltown/)
  assert.match(detail.html, /62,4 km/)
  assert.match(detail.html, /\+780 m/)
  assert.match(detail.html, /−410 m/)
  // Stage-alpha carries a 1800s (30 min) automatic pause budget with no
  // structural anchor available in this fixture, so it lands on synthetic
  // pause waypoints between the start and end — start/end themselves stay first/last.
  assert.equal(detail.waypoints[0].kind, 'start')
  assert.equal(detail.waypoints.at(-1).kind, 'end')
  assert.ok(detail.waypoints.some((waypoint) => waypoint.kind === 'pause'))
  assert.match(detail.html, /<h3>Pauses<\/h3>/)
  assert.equal(detail.stageLabel, 'J1 — Riverside → Hilltown')
})

test('the arrival time, when known, is shown as the estimated arrival stat', () => {
  const bundle = createGenericTripBundle()
  const detail = buildDayDetail(bundle, 'day-alpha')
  const arrival = detail.waypoints.at(-1)
  assert.ok(arrival.clockTime !== null)
  assert.match(detail.html, new RegExp(`Arrivée estimée</dt><dd>${arrival.clockTime}`))
})

// CDC D1.2 section 11 (tests M/N/O/P/Q): the per-day departure time
// (TripDaySettings.departureTime) is shown right in the Étape stats as its
// own clickable value — the cell itself is the editing surface, no second
// "Modifier" trigger opening a separate field/screen any more.
test('a ride day shows its own departure time in the stats as a clickable, editable value — never a second field', () => {
  const bundle = createGenericTripBundle()
  const detail = buildDayDetail(bundle, 'day-alpha')
  const departureCell = detail.statsHtml.match(/<dt>Départ<\/dt><dd>[\s\S]*?<\/dd>/)?.[0] ?? ''
  assert.match(departureCell, /<button type="button" class="day-detail__departure-value" data-action="edit-day-departure-time" data-day-departure-value aria-label="Heure de départ 08:00, modifier">08:00<\/button>/)
  // M: the same cell also carries the (initially hidden) inline
  // `<input type="time">`, pre-filled — never a second block below.
  assert.match(departureCell, /<input type="time" class="day-detail__departure-input" data-day-departure-input value="08:00" required hidden>/)
  assert.doesNotMatch(detail.statsHtml, /Modifier/)
})

test('Q: the estimated arrival stat is never itself editable — no data-action on it', () => {
  const bundle = createGenericTripBundle()
  const detail = buildDayDetail(bundle, 'day-alpha')
  const arrivalCell = detail.statsHtml.match(/<dt>Arrivée estimée<\/dt><dd>[^<]*<\/dd>/)?.[0] ?? ''
  assert.doesNotMatch(arrivalCell, /data-action/)
})

test('a day with no departure-time override falls back to 08:00, the same default computeStageWaypoints already uses', () => {
  const bundle = createGenericTripBundle()
  // day-delta (a second ride day in the fixture) has no entry in settings.days at all.
  const detail = buildDayDetail(bundle, 'day-delta')
  assert.match(detail.statsHtml, /data-day-departure-value aria-label="Heure de départ 08:00, modifier">08:00<\/button>/)
})

test('OFF/transfer days carry no departure-time stat at all — a departure time only applies to a ride day\'s own stage', () => {
  const bundle = createGenericTripBundle()
  const offDetail = buildDayDetail(bundle, 'day-bravo')
  const transferDetail = buildDayDetail(bundle, 'day-charlie')
  assert.equal(offDetail.statsHtml, '')
  assert.equal(transferDetail.statsHtml, '')
  assert.doesNotMatch(offDetail.html, /data-day-departure-value/)
  assert.doesNotMatch(transferDetail.html, /data-day-departure-value/)
})

test('villageWaypoints exposes villages separately for the fullscreen map layer, even though the compact map/profile never see them', () => {
  const bundle = createGenericTripBundle()
  bundle.routePoints.push({
    id: 'village-ui', routeId: bundle.routes[0].id, type: 'passage', name: 'Micro Village',
    latitude: 45.2, longitude: 6.35, elevationM: 300, trackDistanceKm: 30,
    osmFeatureType: 'village', lateralDistanceKm: 0.5,
    provenance: { sourceType: 'osm', sourceId: 'postpass:village:1', fetchedAt: null, engineVersion: 'route-enrichment@4', confidence: 'high', manuallyOverridden: false },
  })
  bundle.stages[0].routePointIds.push('village-ui')
  const detail = buildDayDetail(bundle, 'day-alpha')
  assert.equal(detail.villageWaypoints.length, 1)
  assert.equal(detail.villageWaypoints[0].name, 'Micro Village')
})

test('Arrêts shows a compact status line only in normal view — never the pause list itself (CDC Jalon B4.3 section 30)', () => {
  const bundle = createGenericTripBundle()
  const detail = buildDayDetail(bundle, 'day-alpha')
  assert.match(detail.html, /Gestion automatique/)
  assert.match(detail.html, /<summary class="button button--quiet">Manuel<\/summary>/)
  assert.doesNotMatch(detail.html, /Rétablir Auto/, 'already automatic — no need for a button back to it')
})

function pushAnchorPoint(bundle) {
  bundle.routePoints.push({
    id: 'town-ui', routeId: bundle.routes[0].id, type: 'passage', name: 'Waypoint Town',
    latitude: 45.2, longitude: 6.35, elevationM: 300, trackDistanceKm: 30,
    osmFeatureType: 'town', lateralDistanceKm: 0.3,
    provenance: { sourceType: 'osm', sourceId: 'postpass:town:1', fetchedAt: null, engineVersion: 'route-enrichment@4', confidence: 'high', manuallyOverridden: false },
  })
  bundle.stages[0].routePointIds.push('town-ui')
  return bundle
}

test('the manual pause editor lists one compact row per candidate, checked/pre-filled for an already-active pause (CDC Jalon B4.3 section 31)', () => {
  const bundle = pushAnchorPoint(createGenericTripBundle())
  bundle.settings.stages[0] = {
    stageId: bundle.stages[0].id, pausePlanMode: 'custom',
    pauses: [{ id: 'pause-manual-1', active: true, routePointId: 'town-ui', durationSeconds: 900, order: 0, origin: 'custom' }],
  }
  const detail = buildDayDetail(bundle, 'day-alpha')
  assert.match(detail.html, /Mode manuel · 1 pause/)
  assert.match(detail.html, /data-action="save-manual-pauses"/)
  assert.match(detail.html, /data-action="pause-mode-automatic">Rétablir Auto/)
  // CDC Jalon C1 closeout section 4: "Rétablir Auto" sits next to "Manuel"
  // — a sibling of the `<details>`, always visible, never nested inside
  // its native toggle content (which would hide it while collapsed).
  const actionsIndex = detail.html.indexOf('day-detail__pauses-actions')
  const detailsIndex = detail.html.indexOf('<details class="day-pause-editor"')
  const restoreButtonIndex = detail.html.indexOf('data-action="pause-mode-automatic"')
  const detailsCloseIndex = detail.html.indexOf('</details>')
  assert.ok(actionsIndex >= 0 && actionsIndex < detailsIndex, '"Manuel" and "Rétablir Auto" share the same wrapper')
  assert.ok(restoreButtonIndex > detailsCloseIndex, '"Rétablir Auto" is a sibling AFTER </details>, never inside it (never hidden while collapsed)')
  assert.match(detail.html, /data-candidate-id="town-ui"/)
  assert.match(detail.html, /Waypoint Town/)
  assert.match(detail.html, /input type="checkbox" data-field="pause-active" checked/)
  assert.match(detail.html, /value="15"/) // 900 seconds = 15 minutes
  // Never a card/select/input-per-row beyond the one checkbox + duration (CDC section 31).
  assert.doesNotMatch(detail.html, /<select/)
})

test('a candidate with no active pause is unchecked, and its duration field starts hidden (CDC Jalon B4.3 section 31: "Durée uniquement si Pause = oui")', () => {
  const bundle = pushAnchorPoint(createGenericTripBundle())
  const detail = buildDayDetail(bundle, 'day-alpha')
  assert.match(detail.html, /data-candidate-id="town-ui"/)
  assert.doesNotMatch(detail.html, /data-field="pause-active" checked/)
  assert.match(detail.html, /pause-editor__row-duration" hidden/)
})

test('custom mode with no eligible canonical waypoint shows an explanatory message instead of a broken editor', () => {
  const bundle = createGenericTripBundle()
  bundle.settings.stages[0] = { stageId: bundle.stages[0].id, pausePlanMode: 'custom', pauses: [] }
  const detail = buildDayDetail(bundle, 'day-alpha')
  assert.match(detail.html, /Aucun point canonique disponible pour ancrer une pause/)
})

function pushVillageAndTown(bundle) {
  bundle.routePoints.push(
    {
      id: 'village-ui', routeId: bundle.routes[0].id, type: 'passage', name: 'Micro Village',
      latitude: 45.2, longitude: 6.35, elevationM: 300, trackDistanceKm: 30,
      osmFeatureType: 'village', lateralDistanceKm: 0.5,
      provenance: { sourceType: 'osm', sourceId: 'postpass:village:1', fetchedAt: null, engineVersion: 'route-enrichment@4', confidence: 'high', manuallyOverridden: false },
    },
    {
      id: 'town-ui', routeId: bundle.routes[0].id, type: 'passage', name: 'Grand Bourg',
      latitude: 45.21, longitude: 6.36, elevationM: 310, trackDistanceKm: 40,
      osmFeatureType: 'town', lateralDistanceKm: 0.3,
      provenance: { sourceType: 'osm', sourceId: 'postpass:town:1', fetchedAt: null, engineVersion: 'route-enrichment@4', confidence: 'high', manuallyOverridden: false },
    },
  )
  bundle.stages[0].routePointIds.push('village-ui', 'town-ui')
  return bundle
}

test('Parcours is a single flat chronological list — no grouped waypoint sections, no repeated category (CDC Jalon B4.3 section 11)', () => {
  const bundle = pushVillageAndTown(createGenericTripBundle())
  const detail = buildDayDetail(bundle, 'day-alpha')
  assert.match(detail.html, /<ol class="day-detail__timeline">/)
  assert.doesNotMatch(detail.html, /day-detail__waypoint-group/, 'no grouped Localités/Villages/Relief sections left')
  assert.doesNotMatch(detail.html, /<h4>Localités<\/h4>/, 'no grouped section headers left')
  assert.match(detail.timelineHtml, /Départ|Arrivée/, 'départ/arrivée always show, regardless of what else is filtered out')
})

// Sections 32-40/47 closeout: normalized vignette format for every plain
// waypoint (départ/arrivée/ville/village) — "Type · X,X km", never a second
// "Kilomètre" prefix (section 39), never the point's own altitude
// competing as a primary value on this line (section 37).
test('start/end rows show "Type · X,X km" — no "Kilomètre" prefix, no altitude, French one-decimal comma format (sections 33/37/39)', () => {
  const bundle = createGenericTripBundle()
  const detail = buildDayDetail(bundle, 'day-alpha')
  assert.match(detail.timelineHtml, /<span class="day-detail__timeline-meta">Départ · 0,0 km<\/span>/)
  assert.doesNotMatch(detail.timelineHtml, /Kilomètre/, 'the formatter\'s own "X,X km" already says it — no second "Kilomètre" prefix')
  assert.doesNotMatch(detail.timelineHtml, /Départ · \d+ m/, 'the point\'s own altitude must not appear on the Parcours meta line')
  assert.doesNotMatch(detail.timelineHtml, /\d\.\d km/, 'never a dot-decimal "5.2 km" — the app is FR throughout')
})

test('a city/town/village without a pause is never shown in the Parcours timeline, map, or profile waypoint set — no toggle brings it back (CDC Jalon B4.3 sections 26/28/29, B4.4 sections 5-6/32)', () => {
  const bundle = pushVillageAndTown(createGenericTripBundle())
  const detail = buildDayDetail(bundle, 'day-alpha')
  // Scoped to the timeline fragment specifically — never the whole
  // `detail.html`, which also carries the manual pause editor's candidate
  // list (CDC section 31/40: a deliberately WIDER, separate need that always
  // proposes city/town/village to anchor a *new* pause on, section 11).
  assert.doesNotMatch(detail.timelineHtml, /Micro Village/)
  assert.doesNotMatch(detail.timelineHtml, /Grand Bourg/)
  // Same policy on the map/profile waypoint set (CDC B4.4 section 32: one
  // shared significance policy, never a second filter).
  assert.ok(!detail.waypoints.some((waypoint) => isSignificantWaypoint(waypoint) && waypoint.name === 'Micro Village'))
  assert.ok(!detail.waypoints.some((waypoint) => isSignificantWaypoint(waypoint) && waypoint.name === 'Grand Bourg'))
  // They DO still show, unchecked, as pause candidates — a separate list
  // this policy must never suppress (CDC section 40).
  assert.match(detail.pausesHtml, /Micro Village/)
  assert.match(detail.pausesHtml, /Grand Bourg/)
})

test('"Ville" is the label used for city/town — never "Localité" (CDC Jalon B4.3 section 26/41)', () => {
  const bundle = pushVillageAndTown(createGenericTripBundle())
  bundle.settings.stages[0] = {
    stageId: bundle.stages[0].id, pausePlanMode: 'custom',
    pauses: [{ id: 'pause-on-town', active: true, routePointId: 'town-ui', durationSeconds: 600, order: 0, origin: 'custom' }],
  }
  const detail = buildDayDetail(bundle, 'day-alpha')
  assert.match(detail.html, /Grand Bourg/)
  assert.match(detail.html, /Ville · /)
  assert.doesNotMatch(detail.html, /Localité/)
})

// Jalon C2.5 section 61: the "Montées secondaires" filter control itself is
// gone from the UI — Parcours always uses `isSignificantWaypoint`'s own
// default policy now, exactly like Aperçu and the weather sampler already
// did. The underlying engine (`classifyClimbImportance`, tested directly in
// `tests/analysis/canonical-waypoints.test.mjs`) is untouched: a secondary
// climb is still fully detected/classified, simply never toggleable from
// this screen any more.
test('no "Montées secondaires" filter control (or any other Parcours filter) renders any more (CDC Jalon C2.5 section 61)', () => {
  const bundle = createGenericTripBundle()
  const detail = buildDayDetail(bundle, 'day-alpha')
  assert.doesNotMatch(detail.html, /Montées secondaires/)
  assert.doesNotMatch(detail.html, /data-filter="secondary-climbs"/)
  assert.doesNotMatch(detail.html, /data-filter="villages"/)
  assert.doesNotMatch(detail.html, /toggle-parcours-filter/)
  assert.doesNotMatch(detail.html, /point-filters/)
})

// --- village + pause = forced visibility (CDC Jalon B4.2 section 4) --------

test('a village carrying a manual pause is shown even with the Villages filter off — never a duplicate "village" + "pause" pair', () => {
  const bundle = pushVillageAndTown(createGenericTripBundle())
  bundle.settings.stages[0] = {
    stageId: bundle.stages[0].id, pausePlanMode: 'custom',
    pauses: [{ id: 'pause-on-village', active: true, routePointId: 'village-ui', durationSeconds: 600, order: 0, origin: 'custom' }],
  }
  const detail = buildDayDetail(bundle, 'day-alpha')
  assert.match(detail.html, /Micro Village/, 'the village stays visible because it now carries a pause')
  assert.match(detail.html, /Pause 10 min/)
  // Exactly one row for this point in the timeline itself (it may
  // additionally appear once more inside the manual pause editor's
  // always-present candidate list, a distinct feature — never a second
  // "Pause" card next to the timeline row).
  const occurrences = detail.timelineHtml.match(/Micro Village/g) ?? []
  assert.equal(occurrences.length, 1)
})

test('village + pause visibility is the same policy on the map/profile waypoint set as on the Parcours list', () => {
  const bundle = pushVillageAndTown(createGenericTripBundle())
  bundle.settings.stages[0] = {
    stageId: bundle.stages[0].id, pausePlanMode: 'custom',
    pauses: [{ id: 'pause-on-village', active: true, routePointId: 'village-ui', durationSeconds: 600, order: 0, origin: 'custom' }],
  }
  const detail = buildDayDetail(bundle, 'day-alpha')
  const village = detail.waypoints.find((waypoint) => waypoint.id === 'village-ui')
  assert.equal(village.visibleByDefault, false, 'the underlying flag is still "hidden by default" — only the pause forces the *effective* visibility used everywhere')
  assert.equal(village.pauseDurationMinutes, 10)
})

// --- tabs (CDC Jalon B4.2 section 7) ----------------------------------------

test('Q/R: the Étape screen is a real ARIA tablist with EXACTLY two panels — Parcours/Infos, no Météo tab any more', () => {
  const bundle = createGenericTripBundle()
  const detail = buildDayDetail(bundle, 'day-alpha')
  assert.match(detail.html, /role="tablist"/)
  assert.match(detail.html, /role="tab" data-day-tab="route" aria-controls="day-panel-route" aria-selected="true"/)
  assert.match(detail.html, /role="tab" data-day-tab="infos" aria-controls="day-panel-infos" aria-selected="false"/)
  assert.equal((detail.html.match(/role="tab"/g) ?? []).length, 2, 'exactly two tabs')
  assert.doesNotMatch(detail.html, /data-day-tab="weather"/, 'R: no Météo tab at all any more')
  assert.match(detail.html, /id="day-panel-route" class="card" role="tabpanel"/)
  assert.match(detail.html, /id="day-panel-infos"[^>]*role="tabpanel"[^>]*hidden/)
})

// --- CDC D1.1 sections 6-10: three independent blocks — Stats, Map+Profil,
// and the tabbed Détails card — Stats/Map+Profil are never part of a tab and
// stay visible no matter which of the two tabs is active. ------------------

test('M/O: Stats and Map+Profil render as their own top-level cards, structurally BEFORE the tabbed Détails card — never inside a tabpanel', () => {
  const bundle = createGenericTripBundle()
  const detail = buildDayDetail(bundle, 'day-alpha')
  const statsCardIndex = detail.html.indexOf('data-day-detail-stats-card')
  const mapProfileCardIndex = detail.html.indexOf('data-day-detail-map-profile-card')
  const detailsCardIndex = detail.html.indexOf('data-day-detail-details-card')
  const tabsIndex = detail.html.indexOf('data-day-detail-tabs')
  const routePanelIndex = detail.html.indexOf('id="day-panel-route"')
  assert.ok(statsCardIndex >= 0 && mapProfileCardIndex >= 0 && detailsCardIndex >= 0)
  assert.ok(statsCardIndex < mapProfileCardIndex && mapProfileCardIndex < detailsCardIndex, 'Stats, then Map+Profil, then Détails')
  assert.ok(detailsCardIndex < tabsIndex && tabsIndex < routePanelIndex, 'the tabbar sits at the top of the Détails card, before its panels')
  // Neither Stats nor Map+Profil is itself inside a tabpanel.
  const statsCardBlock = detail.html.slice(statsCardIndex, mapProfileCardIndex)
  assert.doesNotMatch(statsCardBlock, /role="tabpanel"/)
  const mapProfileCardBlock = detail.html.slice(mapProfileCardIndex, detailsCardIndex)
  assert.doesNotMatch(mapProfileCardBlock, /role="tabpanel"/)
})

test('the stats stay present regardless of which tab a caller would select — they are not conditionally rendered per tab (M/N)', () => {
  const bundle = createGenericTripBundle()
  const detail = buildDayDetail(bundle, 'day-alpha')
  // The stats/map/profile markup is emitted exactly once, unconditionally —
  // switching tabs in the real DOM only ever toggles `[data-day-panel]`
  // visibility (trips-manager.ts), which this static HTML doesn't simulate,
  // but the key invariant it CAN prove is that stats/map/profile carry no
  // `hidden`/tabpanel gating of their own.
  assert.doesNotMatch(detail.html, /data-day-detail-stats-card"[^>]*hidden/)
  assert.doesNotMatch(detail.html, /data-day-detail-map-profile-card"[^>]*hidden/)
})

test('P: the compact map card is click/keyboard-openable — no separate "Explorer la carte" button any more', () => {
  const bundle = createGenericTripBundle()
  const detail = buildDayDetail(bundle, 'day-alpha')
  assert.match(detail.html, /<div class="route-map route-map--action" data-day-detail-map data-explore-map role="button" tabindex="0" aria-label="[^"]+"><\/div>/)
  assert.doesNotMatch(detail.html, /Explorer la carte/)
})

test('the sticky header carries only the identity — the tabbar lives inside the Détails card, not the top sticky wrapper (CDC D1.1 section 10)', () => {
  const bundle = createGenericTripBundle()
  const detail = buildDayDetail(bundle, 'day-alpha')
  const stickyHeaderBlock = detail.html.match(/<div class="day-detail__sticky-header"[\s\S]*?<\/div>/)?.[0] ?? ''
  assert.doesNotMatch(stickyHeaderBlock, /data-day-detail-tabs/, 'AB: the tabbar is not part of the top sticky header any more')
  assert.match(stickyHeaderBlock, /day-detail__sticky-identity/)
})

test('AC: the tabbar is a real CSS position:sticky element, pinned at the identity header\'s own live-measured height — not a JS scroll listener, not stuck from the very top', () => {
  const bundle = createGenericTripBundle()
  const detail = buildDayDetail(bundle, 'day-alpha')
  // Stats/Map+Profil are never sticky at all.
  assert.doesNotMatch(detail.html, /data-day-detail-stats-card[^>]*sticky/)
  const css = readFileSync(new URL('../../src/style.css', import.meta.url), 'utf8')
  assert.match(
    css,
    /\.day-detail__details-card > \[data-day-detail-tabs\] \{[^}]*position: sticky;[^}]*top: var\(--day-sticky-header-h, 0px\);/,
    'the tabbar sticks at exactly the identity header\'s live-measured height',
  )
  // The identity header itself keeps its own, separate sticky rule at the
  // true top (`top: 0`) — the two stack, they are not the same element.
  assert.match(css, /\.day-detail__sticky-header \{ position: sticky; top: 0;/)
})

// --- CDC D1.2 section 9 (tests K/L): the identity bandeau ------------------

test('T: no unnecessary overflow on the Détails card breaks the tabbar\'s own sticky positioning (CDC D1.2 section 13 real bug)', () => {
  const css = readFileSync(new URL('../../src/style.css', import.meta.url), 'utf8')
  // `overflow` (any non-`visible` value) on an ancestor makes THAT box the
  // sticky element's scrolling container, per spec — even a card that never
  // actually scrolls. `.day-detail__details-card` is a direct ancestor of
  // the sticky tabbar and must carry no `overflow` at all.
  const cardRule = css.match(/\.day-detail__details-card \{[^}]*\}/)?.[0] ?? ''
  assert.ok(cardRule.length > 0, 'the rule must exist')
  assert.doesNotMatch(cardRule, /overflow/, 'no overflow value on the tabbar\'s sticky-containing ancestor')
})

test('the generic Détail tabbar lays out its (2) tabs in 2 equal columns — never RGA\'s own 3-column rule leaking a dead empty column', () => {
  const css = readFileSync(new URL('../../src/style.css', import.meta.url), 'utf8')
  assert.match(css, /\.day-tabs\[data-day-detail-tabs\] \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/)
})

test('K: the identity bandeau carries Jx, a short date, and départ → arrivée — nothing else', () => {
  const bundle = createGenericTripBundle()
  const detail = buildDayDetail(bundle, 'day-alpha')
  const identityBlock = detail.html.match(/<header class="day-detail__sticky-identity"[\s\S]*?<\/header>/)?.[0] ?? ''
  assert.match(identityBlock, /<strong>J1<\/strong>/)
  assert.match(identityBlock, /<time datetime="2027-05-10">10 mai<\/time>/)
  assert.match(identityBlock, /Riverside → Hilltown/)
})

test('L: the bandeau never duplicates distance/D+/départ-heure/ETA/météo — those stay in the Stats/Météo blocks only', () => {
  const bundle = createGenericTripBundle()
  const detail = buildDayDetail(bundle, 'day-alpha')
  const identityBlock = detail.html.match(/<header class="day-detail__sticky-identity"[\s\S]*?<\/header>/)?.[0] ?? ''
  assert.doesNotMatch(identityBlock, /km|D\+|D−|°C|Départ|ETA/)
})

// --- Météo mount point (CDC Jalon B4.2 section 22, CDC Jalon C1 section 19) -
// `buildDayDetail` only ever produces the empty mount point + a loading
// placeholder — never a fake temperature/rain/alert value baked into the
// static markup. The real weather (via `GenericWeatherCoordinator`) is
// mounted asynchronously by `trips-manager.ts`, exactly like the map/profile
// already are — see `weather-view.test.mjs` for the actual rendering.

test('the Météo tab only ever ships an empty mount point + a loading placeholder — no fake temperature/rain/alert/refresh baked into the static markup', () => {
  const bundle = createGenericTripBundle()
  const detail = buildDayDetail(bundle, 'day-alpha')
  assert.match(detail.html, /data-day-detail-weather/)
  assert.match(detail.html, /Chargement des prévisions…/)
  assert.doesNotMatch(detail.html, /°C/)
  assert.doesNotMatch(detail.html, /data-weather-refresh/)
})

// --- Infos: free text + lodging (CDC Jalon B4.2 section 21) -----------------

test('Infos is read-only by default: shows the note as plain text, plus a single "Modifier" action (CDC Jalon B4.3 sections 35-36)', () => {
  const bundle = createGenericTripBundle()
  bundle.days[0].notes = 'Superbe montée, prévoir de l’eau.'
  const detail = buildDayDetail(bundle, 'day-alpha')
  assert.match(detail.html, /Superbe montée, prévoir de l’eau\./)
  assert.match(detail.html, /data-action="edit-day-infos">Modifier/)
  assert.match(detail.html, /data-day-infos-edit hidden/, 'the edit form is collapsed by default')
  // The grouped edit form exists (for when "Modifier" is clicked) but never
  // shows directly in normal consultation, and there is exactly one
  // "Enregistrer" for both note + lodging together — never a form per field.
  assert.match(detail.html, /data-field="day-notes"/)
  assert.match(detail.html, /data-action="save-day-infos"/)
})

// UI-POLISH-01 section 22: three overlapping labels ("Infos" tab + a generic
// "Éditorial et logistique" kicker + "Infos" title again) collapsed into one.
test('Infos carries a single "Infos" title — no separate "Éditorial et logistique" kicker duplicating it', () => {
  const bundle = createGenericTripBundle()
  const detail = buildDayDetail(bundle, 'day-alpha')
  assert.doesNotMatch(detail.infosHtml, /Éditorial et logistique/)
  assert.match(detail.infosHtml, /<h3>Infos<\/h3>/)
})

// UI-POLISH-01 section 23: every form control in Infos (notably the notes
// textarea, which used to fall back to the browser's own default
// font/border) shares the same `.field` recipe as the lodging `<input>`s
// right below it.
test('Infos edit form: the notes textarea uses the same `.field` styling as the other inputs — no browser-default font any more', () => {
  const bundle = createGenericTripBundle()
  const detail = buildDayDetail(bundle, 'day-alpha')
  assert.match(detail.infosHtml, /<div class="field"><label for="day-notes">Notes<\/label><div class="field__control"><textarea id="day-notes"/)
  const css = readFileSync(new URL('../../src/style.css', import.meta.url), 'utf8')
  assert.match(css, /\.field textarea \{[^}]*font-size: 1rem/, 'the textarea gets an explicit, app-consistent font-size — no monospace/browser-default fallback')
})

// UI-POLISH-01 section 8/26: one compact toolbar convention, shared by every
// fullscreen map header (Aperçu's `trip-overview-view.ts` and this Étape
// dialog both use `.route-map-dialog > header`) — a single row, the title
// truncated with an ellipsis rather than allowed to wrap onto a second line.
test('the fullscreen map toolbar (shared by Aperçu and Étape) stays a single compact row — title truncates, it never wraps to a second line', () => {
  const bundle = createGenericTripBundle()
  const detail = buildDayDetail(bundle, 'day-alpha')
  assert.match(detail.html, /<dialog class="route-map-dialog" data-day-detail-map-dialog[^>]*>\s*<header><h2/)
  const css = readFileSync(new URL('../../src/style.css', import.meta.url), 'utf8')
  assert.match(css, /\.route-map-dialog > header \{[^}]*flex-wrap: nowrap/, 'the toolbar is one row, not a wrapping stack')
  assert.match(css, /\.route-map-dialog > header h2 \{[^}]*text-overflow: ellipsis/, 'a long title truncates instead of pushing the toolbar taller')
})

test('Infos shows "Aucune note" when there is none, never an empty block, and still offers "Modifier"', () => {
  const bundle = createGenericTripBundle()
  assert.equal(bundle.days[0].accommodationId, null)
  const detail = buildDayDetail(bundle, 'day-alpha')
  assert.match(detail.html, /Aucune note pour cette étape\./)
  assert.match(detail.html, /data-action="edit-day-infos">Modifier/)
})

test('Infos shows the linked accommodation\'s name, Maps and website links when the day has one, and never fabricates a link', () => {
  const bundle = createGenericTripBundle()
  bundle.days[0].accommodationId = bundle.accommodations[0].id
  const detail = buildDayDetail(bundle, 'day-alpha')
  assert.match(detail.html, /Hilltown Inn/)
  assert.match(detail.html, /Ouvrir dans Maps/)
  // The fixture's lodging has no website — the "Voir le site" link must not be fabricated.
  assert.doesNotMatch(detail.html, /Voir le site/)
})

// --- climb mini-profile (CDC Jalon B4.2 sections 17-18) ---------------------

/** stage-delta's own fixture climb sits on route-delta, which has no geometry in this fixture — attach a synthetic, OSM-named (so unambiguously "principale") climb to stage-alpha's route instead, which does. */
function pushClimb(bundle) {
  bundle.climbs.push({
    id: 'climb-test-1', routeId: bundle.routes[0].id, name: 'Col du Test',
    startDistanceKm: 10, endDistanceKm: 15, elevationGainM: 450,
    averageGradientPercent: 9, maxGradientPercent: 13, startAltitudeM: 300, endAltitudeM: 750,
    confidence: 'confirmed',
    provenance: { sourceType: 'osm', sourceId: 'postpass:climb:1', fetchedAt: null, engineVersion: 'route-enrichment@4', confidence: 'high', manuallyOverridden: false },
  })
  bundle.stages[0].climbIds.push('climb-test-1')
  return bundle
}

test('AA/AB/AC: a climb renders as a tappable mini-card, same skeleton as a plain row — closed: time-left, marker-prefixed name, "Longueur · D+ · Pente" meta, weather mount; expanded: its own gradient-coloured profile panel (CDC D1.2 sections 17/22)', () => {
  const bundle = pushClimb(createGenericTripBundle())
  const detail = buildDayDetail(bundle, 'day-alpha')
  assert.match(detail.html, /data-action="toggle-climb-profile" data-climb-id="climb-test-1" aria-expanded="false"/)
  assert.match(detail.html, /Col du Test/)
  const waypoint = detail.waypoints.find((candidate) => candidate.climbId === 'climb-test-1')
  assert.ok(waypoint !== undefined)
  const toggleMatch = /<button class="day-detail__climb-toggle"[^]*?<\/button>/.exec(detail.html)
  assert.ok(toggleMatch !== null)
  const toggleHtml = toggleMatch[0]
  // AA: time leads (left), the marker-prefixed name is never centered —
  // it's the first line of the same `.day-detail__timeline-body` a plain
  // row uses (AB: the common skeleton).
  if (waypoint.clockTime !== null) assert.match(toggleHtml, new RegExp(`day-detail__timeline-time">${waypoint.clockTime}<`))
  assert.match(toggleHtml, /<strong><span class="day-detail__timeline-marker" aria-hidden="true">[^<]+<\/span>Col du Test<\/strong>/)
  // AC: the compact meta line is now "Longueur · D+ · Pente" (climb length
  // 15 - 10 = 5 km — never the summit's own trackDistanceKm/15 km, which
  // only a plain row would show).
  assert.match(toggleHtml, /day-detail__timeline-meta">5,0 km · \+450 m · 9,0 %</)
  // AE: an (empty, until weather arrives) weather mount sits in the same body.
  assert.match(toggleHtml, /data-waypoint-weather data-waypoint-id="climb-test-1"/)
  // UI-POLISH-01 section 20: the expanded panel used to repeat the exact
  // same three numbers (Longueur/D+/Pente moyenne) already shown in the
  // closed meta line above (AC) — that duplicated `<dl>` is gone; the panel
  // now only ever adds the profile graphic itself.
  const profileMatch = /<div class="day-detail__climb-profile" id="climb-profile-climb-test-1"[^]*?<\/div>\s*<\/li>/.exec(detail.html)
  assert.ok(profileMatch !== null)
  const profileHtml = profileMatch[0]
  assert.doesNotMatch(profileHtml, /day-detail__climb-profile-stats/, 'no duplicated stats block inside the expanded profile any more')
  assert.doesNotMatch(profileHtml, /<dt>Longueur<\/dt>/)
  assert.match(detail.html, /data-climb-profile hidden/, 'AD: collapsed by default, still developable')
  // CDC Jalon C1 closeout: the gradient colouring lives only on the
  // altimetric silhouette's `<polygon>` bands now — the redundant flat
  // horizontal colour strip (`day-detail__climb-profile-bar`) was removed
  // as a pure visual duplicate of the same segmentation.
  assert.match(detail.html, /day-detail__climb-profile-shape[^>]*data-segments/, 'the interactive, gradient-coloured silhouette is present')
  assert.match(detail.html, /<polygon[^>]*fill="#/, 'at least one colour-coded gradient band is rendered')
  assert.doesNotMatch(detail.html, /day-detail__climb-profile-bar/, 'the redundant flat segment strip must not be rendered any more')
})

// Bug 48A smoke-test regression: the expanded climb card's altimetric
// profile was reported squeezed into a narrow side column next to the
// picto/name/stats text on phones. The markup itself already stacks the
// toggle header above a full-width `.day-detail__climb-profile` panel
// (asserted below) — the actual bug lived only in CSS, where the shared
// `.day-detail__timeline-row` class silently won back a two-column
// `auto | 1fr` grid template inside the mobile breakpoint, splitting the
// climb card's two children (toggle button, profile panel) across two
// narrow columns instead of stacking them full-width.
test('the climb card stays a single full-width column, and its profile SVG stays fully responsive — one stable template at every viewport width (CDC D1.2 section 17: no more mobile-only override needed once the row itself is a uniform 2-column [time|body] template everywhere)', () => {
  const bundle = pushClimb(createGenericTripBundle())
  const detail = buildDayDetail(bundle, 'day-alpha')
  // Structural check: profile is its own block below the toggle, never a
  // side-by-side sibling of the picto/name/stats inside one shared row.
  assert.match(
    detail.html,
    /<button class="day-detail__climb-toggle"[^]*?<\/button>\s*<div class="day-detail__climb-profile"/,
    'the profile panel must come after the whole toggle header, not beside it',
  )
  const css = readFileSync(new URL('../../src/style.css', import.meta.url), 'utf8')
  // `.day-detail__climb-card` resolves to a single flexible column — a real
  // override of `.day-detail__timeline-row`'s own base 2-column template
  // (time | body), which now applies uniformly at every width, so there is
  // no separate mobile-only re-assertion left to go stale (the D1.1-era
  // "Bug 48A" fix this test used to also verify).
  assert.match(css, /\.day-detail__climb-card \{ grid-template-columns: minmax\(0, 1fr\);/, 'the climb card is a single full-width column')
  assert.match(css, /\.day-detail__timeline-row \{[^}]*grid-template-columns: auto minmax\(0, 1fr\);/, 'the base row template itself is only ever 2 columns (time | body) now — nothing left for the climb card to fight at a breakpoint')
  // The SVG silhouette itself must stay viewBox-driven and CSS-sized to
  // 100% width — never a fixed pixel width that would force a horizontal
  // squeeze/scroll regardless of the parent's column layout.
  assert.match(css, /\.day-detail__climb-profile-shape \{[^}]*width: 100%/, 'the profile SVG must size to its full available width')
  assert.match(detail.html, /<svg class="day-detail__climb-profile-shape"[^>]*viewBox="0 0 \d+ \d+"/, 'the SVG keeps a viewBox rather than fixed pixel dimensions')
})

test('a climb name is never rendered as "Montée sans nom : : 4.2 km" or any double-colon artefact', () => {
  const bundle = pushClimb(createGenericTripBundle())
  const detail = buildDayDetail(bundle, 'day-alpha')
  assert.doesNotMatch(detail.html, /::/)
  assert.doesNotMatch(detail.html, /sans nom/i)
})

// --- mountain-pass/saddle merged with a climb still get the mini-profile ---
// (CDC Jalon B4.4 section 28: the bug was `waypoint.kind !== 'climb'`
// gating the mini-card, so a named col merged with its detected climb
// — `kind` stays `mountain-pass`/`saddle`, only `climbId` points at the
// climb — fell back to a plain point with no profile at all.)

function pushMergedCol(bundle, osmFeatureType) {
  bundle.climbs.push({
    id: 'climb-col-1', routeId: bundle.routes[0].id, name: 'Col de Test',
    startDistanceKm: 10, endDistanceKm: 15, elevationGainM: 450,
    averageGradientPercent: 9, maxGradientPercent: 13, startAltitudeM: 300, endAltitudeM: 750,
    confidence: 'confirmed',
    provenance: { sourceType: 'osm', sourceId: 'postpass:climb:1', fetchedAt: null, engineVersion: 'route-enrichment@4', confidence: 'high', manuallyOverridden: false },
  })
  bundle.stages[0].climbIds.push('climb-col-1')
  bundle.routePoints.push({
    id: 'col-landmark-1', routeId: bundle.routes[0].id, type: 'passage', name: 'Col de Test',
    latitude: 45.25, longitude: 6.4, elevationM: 750, trackDistanceKm: 15,
    osmFeatureType, lateralDistanceKm: 0.05,
    provenance: { sourceType: 'osm', sourceId: 'postpass:col:1', fetchedAt: null, engineVersion: 'route-enrichment@4', confidence: 'high', manuallyOverridden: false },
  })
  bundle.stages[0].routePointIds.push('col-landmark-1')
  return bundle
}

test('a mountain-pass landmark merged with its detected climb still gets the climb mini-profile card (CDC Jalon B4.4 section 28)', () => {
  const bundle = pushMergedCol(createGenericTripBundle(), 'mountain-pass')
  const detail = buildDayDetail(bundle, 'day-alpha')
  const waypoint = detail.waypoints.find((candidate) => candidate.name === 'Col de Test')
  assert.equal(waypoint.kind, 'mountain-pass')
  assert.equal(waypoint.climbId, 'climb-col-1')
  assert.match(detail.timelineHtml, /day-detail__climb-card" data-waypoint-id="col-landmark-1" data-waypoint-kind="mountain-pass"/)
  assert.match(detail.timelineHtml, /data-action="toggle-climb-profile" data-climb-id="climb-col-1"/)
  assert.match(detail.timelineHtml, /Col de Test/)
  // CDC D1.2 sections 17/22: the closed toggle now shows "Longueur · D+ ·
  // Pente" directly (climb length 5 km) — the same compact meta an
  // expanded-only summit stat used to be.
  assert.match(detail.timelineHtml, /day-detail__timeline-meta">5,0 km · \+450 m · 9,0 %</)
  assert.match(detail.timelineHtml, /◆/, 'the col marker/icon is preserved, not swapped for the generic climb marker')
})

test('a saddle landmark merged with its detected climb also gets the climb mini-profile card (CDC Jalon B4.4 section 28)', () => {
  const bundle = pushMergedCol(createGenericTripBundle(), 'saddle')
  const detail = buildDayDetail(bundle, 'day-alpha')
  const waypoint = detail.waypoints.find((candidate) => candidate.name === 'Col de Test')
  assert.equal(waypoint.kind, 'saddle')
  assert.equal(waypoint.climbId, 'climb-col-1')
  assert.match(detail.timelineHtml, /day-detail__climb-card" data-waypoint-id="col-landmark-1" data-waypoint-kind="saddle"/)
  assert.match(detail.timelineHtml, /data-action="toggle-climb-profile" data-climb-id="climb-col-1"/)
})

test('a mountain-pass landmark with no matching detected climb (climbId null) stays a simple point, never a climb mini-card', () => {
  const bundle = createGenericTripBundle()
  bundle.routePoints.push({
    id: 'bare-pass', routeId: bundle.routes[0].id, type: 'passage', name: 'Col Isolé',
    latitude: 45.22, longitude: 6.3, elevationM: 900, trackDistanceKm: 20,
    osmFeatureType: 'mountain-pass', lateralDistanceKm: 0.05,
    provenance: { sourceType: 'osm', sourceId: 'postpass:pass:1', fetchedAt: null, engineVersion: 'route-enrichment@4', confidence: 'high', manuallyOverridden: false },
  })
  bundle.stages[0].routePointIds.push('bare-pass')
  const detail = buildDayDetail(bundle, 'day-alpha')
  const waypoint = detail.waypoints.find((candidate) => candidate.id === 'bare-pass')
  assert.equal(waypoint.climbId, null)
  assert.doesNotMatch(detail.timelineHtml, /day-detail__climb-card/)
  assert.match(detail.timelineHtml, /Col Isolé/)
})

// --- OFF/transfer detail shell (CDC Jalon B4.4 sections 23-24/38): every
// day type is now openable — no more `null` for OFF/transfer. ---------------

test('an OFF day now builds a real detail shell — Résumé + Météo/Infos, no Parcours tab, no fake map/profile', () => {
  const bundle = createGenericTripBundle()
  const detail = buildDayDetail(bundle, 'day-bravo')
  assert.ok(detail !== null, 'OFF days must be openable now (CDC Jalon B4.4 section 13)')
  assert.equal(detail.waypoints.length, 0)
  assert.equal(detail.geometry, null)
  assert.doesNotMatch(detail.html, /data-day-detail-map/, 'never a fake cycling map for a day with no route')
  assert.doesNotMatch(detail.html, /data-day-detail-profile/, 'never a fake elevation profile')
  assert.doesNotMatch(detail.html, /data-day-tab="route"/, 'no Parcours tab at all')
  assert.match(detail.html, /<span class="day-detail__identity-route">OFF — Hilltown<\/span>/, 'the identity bandeau carries a short type badge + the known location')
  assert.match(detail.html, /Hilltown/, 'the OFF day\'s known/auto-filled location shows in the Résumé')
  assert.match(detail.html, /data-day-detail-weather/, 'the same Météo mount point as a ride day — real weather is mounted by trips-manager.ts')
  assert.match(detail.html, /data-action="edit-day-infos">Modifier/, 'Infos is the same read/edit component as a ride day')
})

test('a transfer day builds a real detail shell — origin → destination and its transferTiming (CDC Jalon B4.4 sections 22/24)', () => {
  const bundle = createGenericTripBundle()
  bundle.days[2].transferTiming = 'after_previous'
  const detail = buildDayDetail(bundle, 'day-charlie')
  assert.ok(detail !== null)
  assert.equal(detail.geometry, null)
  assert.doesNotMatch(detail.html, /data-day-tab="route"/)
  assert.match(detail.html, /Transfert/)
  assert.match(detail.html, /Hilltown → Lakeside/)
  assert.match(detail.html, /Après l’étape précédente/)
})

test('a transfer day with no explicit transferTiming shows the "journée dédiée" default', () => {
  const bundle = createGenericTripBundle()
  const detail = buildDayDetail(bundle, 'day-charlie')
  assert.match(detail.html, /Journée dédiée/)
})

test('every day type resolves through buildDayDetail — the precondition for a previous/next nav that traverses the whole trip chronology (CDC Jalon B4.4 section 25; the click-driven traversal itself lives in trips-manager.ts, not covered here)', () => {
  const bundle = createGenericTripBundle()
  for (const dayId of ['day-alpha', 'day-bravo', 'day-charlie', 'day-delta']) {
    assert.ok(buildDayDetail(bundle, dayId) !== null, `${dayId} must be openable`)
  }
})

// --- R1 section 4 ("erreurs/partial"), tests C/D: short, plain-language, ---
// --- actionable banners — no technical vocabulary, a real Réessayer. -------

test('R1 test C: a partial-preparation ride day shows a short, actionable banner — no "préparation"/technical wording', () => {
  const bundle = createGenericTripBundle()
  const detail = buildDayDetail(bundle, 'day-alpha', { preparationStatus: 'partial' })
  assert.match(detail.html, /<div class="day-detail__prep-banner" role="status"><span>Certaines données pratiques manquent\.<\/span>/)
  assert.match(detail.html, /data-action="retry-stage-preparation"[^>]*>Réessayer<\/button>/)
  assert.doesNotMatch(detail.html, /postpass|provider|enrichment/i)
})

test('R1 test D: an errored ride day shows a short banner with a retry action', () => {
  const bundle = createGenericTripBundle()
  const detail = buildDayDetail(bundle, 'day-alpha', { preparationStatus: 'error' })
  assert.match(detail.html, /<div class="day-detail__prep-banner" role="status"><span>Préparation incomplète\.<\/span>/)
  assert.match(detail.html, /data-action="retry-stage-preparation"[^>]*>Réessayer<\/button>/)
})

test('a ready ride day shows no preparation banner at all', () => {
  const bundle = createGenericTripBundle()
  const detail = buildDayDetail(bundle, 'day-alpha', { preparationStatus: 'ready' })
  assert.doesNotMatch(detail.html, /day-detail__prep-banner/)
})
