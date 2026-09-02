import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { buildDayDetail } from '../../src/ui/trips/day-detail-view.ts'
import { isSignificantWaypoint } from '../../src/analysis/canonical-waypoints.ts'
import { renderInlineWaypointWeather } from '../../src/ui/weather-view.ts'
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

// --- R2.1 sections 3-4 (tests A/B/C/D/E): Pauses/Météo bottom block —
// static markup, both panels closed by default, non-sticky, in the normal
// page flow. ------------------------------------------------------------

test('A: Pauses and Météo both start closed — no extended content visible, both toggles aria-expanded=false', () => {
  const bundle = createGenericTripBundle()
  const detail = buildDayDetail(bundle, 'day-alpha')
  assert.match(detail.html, /<div class="day-bottom-block" data-day-bottom-block>/)
  assert.match(detail.html, /data-action="toggle-bottom-panel" aria-expanded="false" aria-controls="day-bottom-panel-pauses">Pauses</)
  assert.match(detail.html, /data-action="toggle-bottom-panel" aria-expanded="false" aria-controls="day-bottom-panel-weather">Météo</)
  assert.match(detail.html, /<div id="day-bottom-panel-pauses" class="day-bottom-block__panel" data-bottom-panel hidden>/)
  assert.match(detail.html, /<div id="day-bottom-panel-weather" class="day-bottom-block__panel" data-bottom-panel hidden>/)
})

test('the bottom block is never sticky (in the normal page flow, no dedicated sticky class/CSS rule)', () => {
  const bundle = createGenericTripBundle()
  const detail = buildDayDetail(bundle, 'day-alpha')
  assert.doesNotMatch(detail.html, /day-bottom-block[^"]*sticky/)
  const css = readFileSync(new URL('../../src/style.css', import.meta.url), 'utf8')
  const blockRule = /\.day-bottom-block \{[^}]*\}/.exec(css)?.[0] ?? ''
  assert.doesNotMatch(blockRule, /position: sticky/)
})

test('the Pauses panel still carries renderPauseEditor\'s own untouched content — status line, C3, Enregistrer', () => {
  const bundle = pushMainSlotAnchor(createGenericTripBundle())
  const detail = buildDayDetail(bundle, 'day-alpha')
  const panelMatch = /<div id="day-bottom-panel-pauses"[^]*?<\/div>\s*<div id="day-bottom-panel-weather"/.exec(detail.html)
  assert.ok(panelMatch !== null)
  assert.match(panelMatch[0], /data-day-detail-pauses/)
  assert.match(panelMatch[0], /data-action="save-manual-pauses"/)
})

test('the Météo panel still carries the exact same [data-day-detail-weather] mount `mountWeatherViews` (trips-manager.ts) queries by', () => {
  const bundle = createGenericTripBundle()
  const detail = buildDayDetail(bundle, 'day-alpha')
  const panelMatch = /<div id="day-bottom-panel-weather"[^]*?<\/div>\s*<\/div>/.exec(detail.html)
  assert.ok(panelMatch !== null)
  assert.match(panelMatch[0], /data-day-detail-weather/)
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
  assert.match(detail.html, /Pause 10 minutes/, 'the pause clock dial\'s own accessible label')
  assert.match(detail.html, /pause-clock__label" aria-hidden="true">10'/)
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

test('R3 sections 24-28: the "Alertes météo" mount sits between the map/profile card and the tabbed Détails card — always present, never behind the Pauses/Météo bottom-block toggle', () => {
  const bundle = createGenericTripBundle()
  const detail = buildDayDetail(bundle, 'day-alpha')
  const mapProfileCardIndex = detail.html.indexOf('data-day-detail-map-profile-card')
  const alertsMountIndex = detail.html.indexOf('data-day-detail-weather-alerts')
  const detailsCardIndex = detail.html.indexOf('data-day-detail-details-card')
  assert.ok(alertsMountIndex > mapProfileCardIndex && alertsMountIndex < detailsCardIndex)
  assert.doesNotMatch(detail.html, /data-day-detail-weather-alerts"[^>]*hidden/, 'never hidden by default — trips-manager.ts fills it in once weather resolves, same as every other empty-slot mount')
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

// R2.1 sections 24-25 (tests AL-AO): a firm product rule — a col with no
// associated montée must not be exposed anywhere at all, not even as a
// plain point (this used to stay a simple point, never a climb mini-card —
// R2.1 removes it from the surfaced waypoint set entirely).
test('AM: a mountain-pass landmark with no matching detected climb (climbId null) does not become a waypoint at all — absent from the timeline entirely', () => {
  const bundle = createGenericTripBundle()
  bundle.routePoints.push({
    id: 'bare-pass', routeId: bundle.routes[0].id, type: 'passage', name: 'Col Isolé',
    latitude: 45.22, longitude: 6.3, elevationM: 900, trackDistanceKm: 20,
    osmFeatureType: 'mountain-pass', lateralDistanceKm: 0.05,
    provenance: { sourceType: 'osm', sourceId: 'postpass:pass:1', fetchedAt: null, engineVersion: 'route-enrichment@4', confidence: 'high', manuallyOverridden: false },
  })
  bundle.stages[0].routePointIds.push('bare-pass')
  const detail = buildDayDetail(bundle, 'day-alpha')
  assert.equal(detail.waypoints.find((candidate) => candidate.id === 'bare-pass'), undefined)
  assert.doesNotMatch(detail.timelineHtml, /day-detail__climb-card/)
  assert.doesNotMatch(detail.timelineHtml, /Col Isolé/)
})

test('AN: an orphan col (no montée associated) never becomes a pause candidate either', () => {
  const bundle = createGenericTripBundle()
  bundle.routePoints.push({
    id: 'bare-pass', routeId: bundle.routes[0].id, type: 'passage', name: 'Col Isolé',
    latitude: 45.22, longitude: 6.3, elevationM: 900, trackDistanceKm: 20,
    osmFeatureType: 'mountain-pass', lateralDistanceKm: 0.05,
    provenance: { sourceType: 'osm', sourceId: 'postpass:pass:1', fetchedAt: null, engineVersion: 'route-enrichment@4', confidence: 'high', manuallyOverridden: false },
  })
  bundle.stages[0].routePointIds.push('bare-pass')
  const detail = buildDayDetail(bundle, 'day-alpha')
  assert.doesNotMatch(detail.pausesHtml, /data-candidate-id="bare-pass"/)
})

// --- R2 section 1 (correction R1): C3 disappears from the Parcours timeline,
// stays fully actionable in the manual pause editor only. ------------------

/**
 * A real town anchor right next to stage-alpha's "main" ideal pause slot —
 * 50 % of its ACTUAL geometry distance (~32.36 km here, independent of the
 * fixture's own `RideStage.distanceKm` metadata field, which
 * `computeStageWaypoints` never reads for this) — is enough for the
 * automatic engine to pick it over a synthetic fallback pause, no
 * practical-place/POI fixture needed for a recommendation to exist at all
 * (`levelFor` in `analysis/pause-recommendation.ts` only ever returns 'good'
 * or 'recommended' for an actually-selected candidate, never a silent/
 * neutral level). A distinct id/distance from the shared `pushAnchorPoint`
 * helper (used elsewhere at 30 km, well outside this window) on purpose.
 */
function pushMainSlotAnchor(bundle) {
  bundle.routePoints.push({
    id: 'town-main-slot', routeId: bundle.routes[0].id, type: 'passage', name: 'Waypoint Main',
    latitude: 45.2, longitude: 6.35, elevationM: 300, trackDistanceKm: 16,
    osmFeatureType: 'town', lateralDistanceKm: 0.3,
    provenance: { sourceType: 'osm', sourceId: 'postpass:town:2', fetchedAt: null, engineVersion: 'route-enrichment@4', confidence: 'high', manuallyOverridden: false },
  })
  bundle.stages[0].routePointIds.push('town-main-slot')
  return bundle
}

test('A/B (R3 sections 5-8/14): an automatic pause in the Parcours timeline is a bare, compact clock dial — no "Bon choix"/"★ Recommandé", no C3 reason, no score, no full-width badge', () => {
  const bundle = pushMainSlotAnchor(createGenericTripBundle())
  const detail = buildDayDetail(bundle, 'day-alpha')
  const pausedWaypoint = detail.waypoints.find((candidate) => candidate.id === 'town-main-slot')
  assert.ok(pausedWaypoint !== undefined && pausedWaypoint.pauseDurationMinutes !== null, 'the anchor must actually receive the automatic pause for this test to be meaningful')
  assert.match(detail.timelineHtml, /class="pause-clock"/)
  assert.match(detail.timelineHtml, new RegExp(`Pause ${pausedWaypoint.pauseDurationMinutes} minutes`), 'the dial\'s own accessible label')
  assert.match(detail.timelineHtml, new RegExp(`pause-clock__label" aria-hidden="true">${pausedWaypoint.pauseDurationMinutes}'`), 'the dial\'s own centred text — always minutes, never "1h.."')
  assert.doesNotMatch(detail.timelineHtml, /tag--pause-recommended/)
  assert.doesNotMatch(detail.timelineHtml, /day-detail__pause-reason/)
  assert.doesNotMatch(detail.timelineHtml, /Bon choix/)
  assert.doesNotMatch(detail.timelineHtml, /★ Recommandé/)
  assert.doesNotMatch(detail.timelineHtml, /Score/)
  assert.doesNotMatch(detail.timelineHtml, /tag--pause"/, 'H: no full-width Pause banner/badge at all any more')
})

// --- R3 sections 6-8/14 (tests A-H, letters reused per the CDC's own
// section 14 numbering): the clock dial's own fraction/text at various
// durations — a manual pause gives full control over the exact minute
// value, unlike the automatic budget allocator. ------------------------

function manualPauseBundle(durationSeconds) {
  const bundle = pushVillageAndTown(createGenericTripBundle())
  bundle.settings.stages[0] = {
    stageId: bundle.stages[0].id, pausePlanMode: 'custom',
    pauses: [{ id: 'pause-on-village', active: true, routePointId: 'village-ui', durationSeconds, order: 0, origin: 'custom' }],
  }
  return bundle
}

function pauseClockOf(detail) {
  const match = /<span class="pause-clock" style="--pause-fraction: ([^"]+)"[^]*?pause-clock__label" aria-hidden="true">([^<]+)<\/span>/.exec(detail.timelineHtml)
  assert.ok(match !== null, 'a pause-clock dial must be present')
  return { fraction: Number(match[1]), label: match[2] }
}

test('A (10 min ≈ one-sixth of the dial)', () => {
  const detail = buildDayDetail(manualPauseBundle(600), 'day-alpha')
  const dial = pauseClockOf(detail)
  assert.ok(Math.abs(dial.fraction - 10 / 60) < 1e-9)
  assert.equal(dial.label, "10'")
})

test('B (30 min = half circle)', () => {
  const detail = buildDayDetail(manualPauseBundle(1_800), 'day-alpha')
  const dial = pauseClockOf(detail)
  assert.equal(dial.fraction, 0.5)
  assert.equal(dial.label, "30'")
})

test('C (55 min ≈ almost-complete sector)', () => {
  const detail = buildDayDetail(manualPauseBundle(3_300), 'day-alpha')
  const dial = pauseClockOf(detail)
  assert.ok(Math.abs(dial.fraction - 55 / 60) < 1e-9)
  assert.equal(dial.label, "55'")
})

test('D (60 min = full circle)', () => {
  const detail = buildDayDetail(manualPauseBundle(3_600), 'day-alpha')
  const dial = pauseClockOf(detail)
  assert.equal(dial.fraction, 1)
  assert.equal(dial.label, "60'")
})

test('E (75 min = full circle + text "75\'")', () => {
  const detail = buildDayDetail(manualPauseBundle(4_500), 'day-alpha')
  const dial = pauseClockOf(detail)
  assert.equal(dial.fraction, 1, 'never a second ring/lap — a ≥60 min pause always reads as a full dial')
  assert.equal(dial.label, "75'")
})

test('F (95 min = full circle + text "95\'")', () => {
  const detail = buildDayDetail(manualPauseBundle(5_700), 'day-alpha')
  const dial = pauseClockOf(detail)
  assert.equal(dial.fraction, 1)
  assert.equal(dial.label, "95'")
})

test('always minutes, never "1h.." — even at 75/95 min', () => {
  const detail75 = buildDayDetail(manualPauseBundle(4_500), 'day-alpha')
  const detail95 = buildDayDetail(manualPauseBundle(5_700), 'day-alpha')
  assert.doesNotMatch(detail75.timelineHtml, /1\s*h/)
  assert.doesNotMatch(detail95.timelineHtml, /1\s*h/)
})

test('I (39 min normalizes to 40 before it ever reaches the dial — legacy compatibility)', () => {
  const detail = buildDayDetail(manualPauseBundle(39 * 60), 'day-alpha')
  const dial = pauseClockOf(detail)
  assert.equal(dial.label, "40'")
})

test('J (77 min normalizes to 75 before it ever reaches the dial)', () => {
  const detail = buildDayDetail(manualPauseBundle(77 * 60), 'day-alpha')
  const dial = pauseClockOf(detail)
  assert.equal(dial.label, "75'")
})

test('G: a paused vignette keeps the same general timeline-row geometry as an unpaused one — only the fixed-size dial differs', () => {
  const paused = buildDayDetail(manualPauseBundle(600), 'day-alpha')
  const unpaused = buildDayDetail(createGenericTripBundle(), 'day-alpha')
  const pausedRow = /<li class="day-detail__timeline-row[^>]*data-waypoint-id="village-ui"[^>]*>[^]*?<\/li>/.exec(paused.timelineHtml)?.[0]
  const anyUnpausedRow = /<li class="day-detail__timeline-row[^]*?<\/li>/.exec(unpaused.timelineHtml)?.[0]
  assert.ok(pausedRow !== undefined && anyUnpausedRow !== undefined)
  // Same grid template class, same body structure — the dial only ever
  // adds a second child inside the existing time column.
  assert.match(pausedRow, /day-detail__timeline-time-col/)
  assert.equal((pausedRow.match(/day-detail__timeline-body/g) ?? []).length, 1)
  assert.equal((anyUnpausedRow.match(/day-detail__timeline-body/g) ?? []).length, 1)
})

test('H: the accessible label always carries the real value, independent of the dial\'s own visual fill', () => {
  const detail = buildDayDetail(manualPauseBundle(4_500), 'day-alpha')
  assert.match(detail.timelineHtml, /aria-label="Pause 75 minutes"/)
})

// --- R2.1 sections 9-10 (tests K/L): opening status per candidate, wired
// end to end through buildDayDetail. ----------------------------------------

test('K/L: a candidate near a POI with known opening hours shows its status in the manual pause editor, recomputed from the day\'s own current ETA — no fresh fetch, reuses already-persisted data', () => {
  const bundle = pushMainSlotAnchor(createGenericTripBundle())
  bundle.practicalPlaces.push({
    id: 'poi-bakery-1', stageId: bundle.stages[0].id, category: 'bakery', name: 'Boulangerie du Village',
    latitude: 45.2, longitude: 6.35, description: null, trackDistanceKm: 16, detourKm: 0.05,
    openingHours: '24/7', usefulTags: {}, hidden: false, pinned: false, dayIds: [bundle.days[0].id],
    provenance: { sourceType: 'osm', sourceId: 'postpass-practical-places:node:1', fetchedAt: '2028-01-01T00:00:00.000Z', engineVersion: 'practical-places-postpass@1', confidence: 'high', manuallyOverridden: false },
  })
  const detail = buildDayDetail(bundle, 'day-alpha')
  const rowMatch = /<div class="day-pause-editor__row" data-candidate-id="town-main-slot">[^]*?<\/div>/.exec(detail.pausesHtml)
  assert.ok(rowMatch !== null)
  assert.match(rowMatch[0], /day-pause-editor__row-opening">Ouvert à l.ETA/)
})

test('a candidate with no nearby POI at all shows no opening-status line — never a fake "Horaires inconnus" for a plain locality', () => {
  const bundle = pushMainSlotAnchor(createGenericTripBundle())
  const detail = buildDayDetail(bundle, 'day-alpha')
  const rowMatch = /<div class="day-pause-editor__row" data-candidate-id="town-main-slot">[^]*?<\/div>/.exec(detail.pausesHtml)
  assert.ok(rowMatch !== null)
  assert.doesNotMatch(rowMatch[0], /day-pause-editor__row-opening/)
})

test('C/D: the manual pause editor still shows the C3 recommendation badge and its short reason for the same candidate — the only place this information is actionable', () => {
  const bundle = pushMainSlotAnchor(createGenericTripBundle())
  const detail = buildDayDetail(bundle, 'day-alpha')
  const editorMatch = /<div class="day-pause-editor__list">[^]*<\/div>\s*<div class="day-pause-editor__actions">/.exec(detail.pausesHtml)
  assert.ok(editorMatch !== null)
  const rowHtml = editorMatch[0]
  assert.match(rowHtml, /data-candidate-id="town-main-slot"/)
  assert.match(rowHtml, /day-pause-editor__row-hint/)
  assert.match(rowHtml, /tag--pause-recommended/)
  assert.match(rowHtml, /Bon choix|★ Recommandé/)
})

// --- R2.1 section 11 / R3 sections 5-8 (tests V/W): the pause clock dial
// lives under the clock time, in the left column — a paused stop keeps the
// exact same card skeleton as one without, never a full-width badge. -------

test('V: the pause clock dial sits inside the same left time column as the clock time — never in the body next to the meta line', () => {
  const bundle = pushMainSlotAnchor(createGenericTripBundle())
  const detail = buildDayDetail(bundle, 'day-alpha')
  const rowMatch = /<li class="day-detail__timeline-row[^"]*" data-waypoint-id="town-main-slot"[^]*?<\/li>/.exec(detail.timelineHtml)
  assert.ok(rowMatch !== null)
  const rowHtml = rowMatch[0]
  const timeColStart = rowHtml.indexOf('day-detail__timeline-time-col')
  const bodyStart = rowHtml.indexOf('day-detail__timeline-body')
  const dialIndex = rowHtml.indexOf('pause-clock')
  assert.ok(timeColStart >= 0 && bodyStart > timeColStart, 'the time column wraps the clock time, ahead of the body')
  assert.ok(dialIndex > timeColStart && dialIndex < bodyStart, 'the dial sits inside the time column, before the body starts')
  const bodyHtml = rowHtml.slice(bodyStart)
  assert.doesNotMatch(bodyHtml, /pause-clock/, 'the dial never lands in the body/meta area any more')
})

test('W: a paused row and an unpaused row share the exact same skeleton — no full-width badge reshaping the card', () => {
  const bundle = pushMainSlotAnchor(createGenericTripBundle())
  const detail = buildDayDetail(bundle, 'day-alpha')
  // Every row (paused or not) is exactly `<li ...>[time-col?]<div class="day-detail__timeline-body">…</div></li>` — the pause dial only ever adds a second child inside the SAME time column, never a new sibling block of its own.
  const rows = detail.timelineHtml.match(/<li class="day-detail__timeline-row[^]*?<\/li>/g) ?? []
  assert.ok(rows.length > 1, 'sanity: more than one row to compare')
  const pausedRows = rows.filter((row) => row.includes('pause-clock'))
  const unpausedRows = rows.filter((row) => !row.includes('pause-clock'))
  assert.ok(pausedRows.length > 0 && unpausedRows.length > 0, 'sanity: at least one of each')
  for (const row of [...pausedRows, ...unpausedRows]) {
    // Exactly one top-level body block, always the row's last child before `</li>`.
    assert.equal((row.match(/day-detail__timeline-body/g) ?? []).length, 1)
    assert.match(row, /<\/div>\s*<\/li>$/, 'the body div is always the row\'s own last child — no extra sibling block')
  }
})

// --- R2 section 1 (correction R1): météo is never expandable, montées stay
// the timeline's one and only disclosure. -----------------------------------

test('G: a climb toggle keeps working on its own — aria-expanded/aria-controls, one interactive control per row', () => {
  const bundle = pushClimb(createGenericTripBundle())
  const detail = buildDayDetail(bundle, 'day-alpha')
  assert.match(detail.timelineHtml, /<button class="day-detail__climb-toggle"[^>]*aria-expanded="false" aria-controls="climb-profile-climb-test-1"/)
})

// --- R2.1 sections 12-14 (tests X/Y): a shared, sober "this is
// interactive" visual language — colour + a reinforced border, reused by
// montées and the départ value, never applied to a plain informational row.

test('X: a montée card carries the shared interactive affordance (reinforced border + tint) — a plain row never does', () => {
  const css = readFileSync(new URL('../../src/style.css', import.meta.url), 'utf8')
  const climbCardRule = /\.day-detail__climb-card \{[^}]*\}/.exec(css)?.[0] ?? ''
  assert.match(climbCardRule, /border-color: var\(--forest-700\)/)
  assert.match(climbCardRule, /background: var\(--forest-50\)/)
  const plainRowRule = /\.day-detail__timeline-row \{[^}]*\}/.exec(css)?.[0] ?? ''
  assert.doesNotMatch(plainRowRule, /var\(--forest-700\)/, 'Y: a plain informational row stays neutral — no borrowed interactive colour')
})

test('the départ value (Stats) uses the same interactive colour family as a montée card — a consistent language across comparable controls', () => {
  const css = readFileSync(new URL('../../src/style.css', import.meta.url), 'utf8')
  const departureRule = /\.day-detail__departure-value \{[^}]*\}/.exec(css)?.[0] ?? ''
  assert.match(departureRule, /background: var\(--forest-50\)/)
})

test('H: a climb that also carries an alert-level météo line exposes exactly one expandable control — the climb toggle, never the météo line', () => {
  const bundle = pushClimb(createGenericTripBundle())
  const detail = buildDayDetail(bundle, 'day-alpha')
  const waypoint = detail.waypoints.find((candidate) => candidate.climbId === 'climb-test-1')
  const cardMatch = new RegExp(`<li class="day-detail__timeline-row[^"]*day-detail__climb-card"[^]*?<\\/li>`).exec(detail.timelineHtml)
  assert.ok(cardMatch !== null)
  // Simulates `trips-manager.ts::mountTimelineWaypointWeather` filling this
  // exact row's mount with an alert-level point — `renderInlineWaypointWeather`
  // can no longer ever produce a `<button>` (R2 section 1), so this stays a
  // single-button row regardless of the weather risk level.
  const mountedHtml = cardMatch[0].replace(
    `<span class="day-detail__timeline-weather" data-waypoint-weather data-waypoint-id="${waypoint.id}"></span>`,
    renderInlineWaypointWeather({
      id: waypoint.id, name: waypoint.name, role: 'passage', available: true, riskLevel: 'red',
      temperatureC: 6, apparentTemperatureC: 3, precipitationProbabilityPct: 80, precipitationMm: 12,
      windSpeedKph: 30, windGustsKph: 70, weatherCodeLabel: null, etaLabel: waypoint.clockTime, riskReasons: ['Rafales fortes en altitude'],
    }),
  )
  assert.equal((mountedHtml.match(/<button/g) ?? []).length, 1, 'only the climb toggle is a <button> — the météo line must never add a second one')
  assert.equal((mountedHtml.match(/aria-expanded/g) ?? []).length, 1, 'only the climb toggle carries aria-expanded')
  assert.match(mountedHtml, /day-detail__waypoint-weather day-detail__waypoint-weather--red/, 'the météo line is still highlighted — just never interactive')
})

// --- OFF/transfer detail shell (CDC Jalon B4.4 sections 23-24/38): every
// day type is now openable — no more `null` for OFF/transfer. ---------------

test('AV/AW: an OFF day now builds a real detail shell — Résumé, Météo and Infos rendered directly one after another, no tabs at all, no fake map/profile', () => {
  const bundle = createGenericTripBundle()
  const detail = buildDayDetail(bundle, 'day-bravo')
  assert.ok(detail !== null, 'OFF days must be openable now (CDC Jalon B4.4 section 13)')
  assert.equal(detail.waypoints.length, 0)
  assert.equal(detail.geometry, null)
  // R2.1 sections 38/40-41: an OFF day now gets a real markers-only map
  // once its location resolves (Hilltown, from the neighbouring ride day)
  // — never an elevation profile, never a fake cycling stat alongside it.
  assert.match(detail.html, /data-day-detail-map/, 'the resolved location gets a real markers-only map')
  assert.doesNotMatch(detail.html, /data-day-detail-profile/, 'never a fake elevation profile')
  assert.doesNotMatch(detail.html, /data-day-tab="route"/, 'no Parcours tab at all')
  // R2.1 sections 28-29: no tablist at all for OFF/transfer any more.
  assert.doesNotMatch(detail.html, /data-day-detail-tabs/)
  assert.doesNotMatch(detail.html, /role="tab"/)
  assert.doesNotMatch(detail.html, /role="tabpanel"/)
  const summaryIndex = detail.html.indexOf('day-detail__summary')
  const weatherIndex = detail.html.indexOf('day-panel-weather')
  const infosIndex = detail.html.indexOf('day-panel-infos')
  assert.ok(summaryIndex >= 0 && summaryIndex < weatherIndex && weatherIndex < infosIndex, 'AW: Résumé, then Météo, then Infos, in that fixed order')
  assert.doesNotMatch(detail.html.slice(weatherIndex, weatherIndex + 40), /hidden/, 'Météo is directly visible, never hidden behind a tab')
  assert.doesNotMatch(detail.html.slice(infosIndex, infosIndex + 40), /hidden/, 'Infos is directly visible, never hidden behind a tab')
  assert.match(detail.html, /<span class="day-detail__identity-route">OFF — Hilltown<\/span>/, 'the identity bandeau carries a short type badge + the known location')
  assert.match(detail.html, /Hilltown/, 'the OFF day\'s known/auto-filled location shows in the Résumé')
  assert.match(detail.html, /data-day-detail-weather/, 'the same Météo mount point as a ride day — real weather is mounted by trips-manager.ts')
  assert.match(detail.html, /data-action="edit-day-infos">Modifier/, 'Infos is the same read/edit component as a ride day')
})

test('AX/AY: a transfer day builds a real detail shell — origin → destination, its transferTiming, no tabs at all', () => {
  const bundle = createGenericTripBundle()
  bundle.days[2].transferTiming = 'after_previous'
  const detail = buildDayDetail(bundle, 'day-charlie')
  assert.ok(detail !== null)
  assert.equal(detail.geometry, null)
  assert.doesNotMatch(detail.html, /data-day-tab="route"/)
  assert.doesNotMatch(detail.html, /data-day-detail-tabs/, 'AX: no tablist at all')
  assert.doesNotMatch(detail.html, /role="tab"/)
  assert.match(detail.html, /Transfert/)
  assert.match(detail.html, /Hilltown → Lakeside/)
  assert.match(detail.html, /Après l’étape précédente/)
  // AY: résumé + météo + infos all present, directly visible.
  const weatherIndex = detail.html.indexOf('day-panel-weather')
  const infosIndex = detail.html.indexOf('day-panel-infos')
  assert.ok(weatherIndex >= 0 && infosIndex > weatherIndex)
  assert.doesNotMatch(detail.html.slice(weatherIndex, weatherIndex + 40), /hidden/)
  assert.doesNotMatch(detail.html.slice(infosIndex, infosIndex + 40), /hidden/)
})

test('a transfer day with no explicit transferTiming shows the "journée indépendante" default', () => {
  const bundle = createGenericTripBundle()
  const detail = buildDayDetail(bundle, 'day-charlie')
  assert.match(detail.html, /Journée indépendante/)
})

// --- R2 section 2: pragmatic transfer mode/heures — never fabricated -------

test('N/P: a transfer with no mode/heures at all (an old bundle, or simply never filled in) shows neither a mode/times line nor a duration — never fabricated', () => {
  const bundle = createGenericTripBundle()
  const detail = buildDayDetail(bundle, 'day-charlie')
  assert.doesNotMatch(detail.html, /day-detail__summary-transfer/)
})

test('P: a transfer with only a mode (no times) shows it alone', () => {
  const bundle = createGenericTripBundle()
  bundle.days[2].transferMode = 'Train'
  const detail = buildDayDetail(bundle, 'day-charlie')
  assert.match(detail.html, /<p class="day-detail__summary-transfer">Train<\/p>/)
})

test('P: a transfer with only times (no mode) shows them alone', () => {
  const bundle = createGenericTripBundle()
  bundle.days[2].transferDepartureTime = '09:20'
  bundle.days[2].transferArrivalTime = '12:05'
  const detail = buildDayDetail(bundle, 'day-charlie')
  assert.match(detail.html, /<p class="day-detail__summary-transfer">09:20 → 12:05<\/p>/)
})

test('mode + heures together render as "Mode · HH:MM → HH:MM", plus a separately derived duration line — never a stored/fabricated duration', () => {
  const bundle = createGenericTripBundle()
  bundle.days[2].transferMode = 'Train'
  bundle.days[2].transferDepartureTime = '09:20'
  bundle.days[2].transferArrivalTime = '12:05'
  const detail = buildDayDetail(bundle, 'day-charlie')
  assert.match(detail.html, /<p class="day-detail__summary-transfer">Train · 09:20 → 12:05<\/p>/)
  assert.match(detail.html, /<p class="day-detail__summary-transfer">2 h 45<\/p>/)
})

test('Q: an inconsistent/overnight time pair (arrival not after departure) never fabricates a negative/guessed duration', () => {
  const bundle = createGenericTripBundle()
  bundle.days[2].transferDepartureTime = '22:00'
  bundle.days[2].transferArrivalTime = '02:00'
  const detail = buildDayDetail(bundle, 'day-charlie')
  assert.match(detail.html, /<p class="day-detail__summary-transfer">22:00 → 02:00<\/p>/)
  assert.equal((detail.html.match(/day-detail__summary-transfer/g) ?? []).length, 1, 'exactly one transfer line — no duration line at all')
})

test('an old/incomplete transfer bundle (no transferMode/transferDepartureTime/transferArrivalTime fields at all) does not crash', () => {
  const bundle = createGenericTripBundle()
  delete bundle.days[2].transferMode
  delete bundle.days[2].transferDepartureTime
  delete bundle.days[2].transferArrivalTime
  assert.doesNotThrow(() => buildDayDetail(bundle, 'day-charlie'))
})

test('the Infos edit form exposes mode/départ/arrivée fields only for a transfer day — never for OFF or ride', () => {
  const bundle = createGenericTripBundle()
  bundle.days[2].transferMode = 'train'
  bundle.days[2].transferDepartureTime = '09:20'
  bundle.days[2].transferArrivalTime = '12:05'
  const transferDetail = buildDayDetail(bundle, 'day-charlie')
  assert.match(transferDetail.infosHtml, /<select id="transfer-mode" data-field="transfer-mode">/)
  assert.match(transferDetail.infosHtml, /<option value="train" selected>Train<\/option>/)
  assert.match(transferDetail.infosHtml, /<input id="transfer-departure-time" type="time" data-field="transfer-departure-time" value="09:20">/)
  assert.match(transferDetail.infosHtml, /<input id="transfer-arrival-time" type="time" data-field="transfer-arrival-time" value="12:05">/)

  const offDetail = buildDayDetail(bundle, 'day-bravo')
  assert.doesNotMatch(offDetail.infosHtml, /data-field="transfer-mode"/)
  const rideDetail = buildDayDetail(bundle, 'day-alpha')
  assert.doesNotMatch(rideDetail.infosHtml, /data-field="transfer-mode"/)
})

// --- R2.1 sections 32-34/36-38/40-41: transfer overhaul ---------------------

test('an after_previous transfer shows/edits the previous (calendar-adjacent) day\'s own notes/lodging, with a shared-info hint — never a second, empty copy of its own', () => {
  const bundle = createGenericTripBundle()
  bundle.days[2].transferTiming = 'after_previous'
  const detail = buildDayDetail(bundle, 'day-charlie')
  assert.match(detail.infosHtml, /day-infos__shared-hint/, 'a visible hint explains where these Infos actually come from')
  assert.match(detail.infosHtml, /Rest day in Hilltown\./, 'day-bravo\'s own notes show here, not day-charlie\'s')
  assert.doesNotMatch(detail.infosHtml, /Train transfer, no cyclable stage\./, 'never day-charlie\'s own (now-orphaned) notes')
})

test('a dedicated/before_next transfer, an OFF day, and a ride day show no shared-info hint — each shows its own Infos', () => {
  const bundle = createGenericTripBundle()
  for (const dayId of ['day-alpha', 'day-bravo', 'day-charlie']) {
    const detail = buildDayDetail(bundle, dayId)
    assert.doesNotMatch(detail.infosHtml, /day-infos__shared-hint/, `${dayId} has no shared-info hint`)
  }
})

test('R2.1 section 32: a before_next transfer never shows lodging fields at all — logically belongs to the following ride day, not the journey', () => {
  const bundle = createGenericTripBundle()
  bundle.days[2].transferTiming = 'before_next'
  const detail = buildDayDetail(bundle, 'day-charlie')
  assert.doesNotMatch(detail.infosHtml, /lodging-name/)
  assert.doesNotMatch(detail.infosHtml, /lodging-maps-url/)
  assert.doesNotMatch(detail.infosHtml, /lodging-website/)
  // The transfer's own fields (mode/heures/notes) stay fully present.
  assert.match(detail.infosHtml, /data-field="transfer-mode"/)
})

test('a dedicated transfer keeps its lodging fields exactly as before — only before_next hides them', () => {
  const bundle = createGenericTripBundle()
  const detail = buildDayDetail(bundle, 'day-charlie')
  assert.match(detail.infosHtml, /lodging-name/)
})

test('R2.1 section 37: opérateur/lien fields render with their stored values; opérateur starts hidden when the mode is "bike"', () => {
  const bundle = createGenericTripBundle()
  bundle.days[2].transferMode = 'bike'
  bundle.days[2].transferOperator = 'Vélib\''
  bundle.days[2].transferLink = 'https://example.com/booking'
  const detail = buildDayDetail(bundle, 'day-charlie')
  assert.match(detail.infosHtml, /data-field-group="transfer-operator" hidden/, 'a bike leg starts with the opérateur field already hidden')
  assert.match(detail.infosHtml, /<input id="transfer-operator" type="text" data-field="transfer-operator" value="Vélib&#039;"/)
  assert.match(detail.infosHtml, /<input id="transfer-link" type="url" data-field="transfer-link" value="https:\/\/example\.com\/booking"/)
})

test('a non-bike mode leaves the opérateur field visible', () => {
  const bundle = createGenericTripBundle()
  bundle.days[2].transferMode = 'train'
  const detail = buildDayDetail(bundle, 'day-charlie')
  assert.doesNotMatch(detail.infosHtml, /data-field-group="transfer-operator" hidden/)
})

// --- R3 sections 18-21: a configured reservation link/opérateur must
// actually appear in Détail — the real bug this section names outright. ---

test('a configured reservation link appears as a clickable action in the transfer\'s own Résumé — the exact gap R3 names ("configuré mais absent de Détail")', () => {
  const bundle = createGenericTripBundle()
  bundle.days[2].transferLink = 'https://sncf-connect.com/booking/abc123'
  const detail = buildDayDetail(bundle, 'day-charlie')
  assert.match(detail.summaryHtml, /<a class="button button--quiet" href="https:\/\/sncf-connect\.com\/booking\/abc123" target="_blank" rel="noopener">Réservation<\/a>/)
})

test('a configured opérateur shows as plain text in the Résumé — never turned into a link/action of its own', () => {
  const bundle = createGenericTripBundle()
  bundle.days[2].transferOperator = 'SNCF'
  const detail = buildDayDetail(bundle, 'day-charlie')
  assert.match(detail.summaryHtml, /<p class="day-detail__summary-transfer">SNCF<\/p>/)
  assert.doesNotMatch(detail.summaryHtml, /<a[^>]*>SNCF/)
})

test('no reservation link/opérateur configured shows neither line at all — never an empty action', () => {
  const bundle = createGenericTripBundle()
  const detail = buildDayDetail(bundle, 'day-charlie')
  assert.doesNotMatch(detail.summaryHtml, /Réservation/)
  assert.doesNotMatch(detail.summaryHtml, /day-detail__summary-actions/)
})

test('R2.1 sections 22/31: the "dedicated" transferTiming label reads "Journée indépendante", matching the CDC\'s own wording', () => {
  const bundle = createGenericTripBundle()
  const detail = buildDayDetail(bundle, 'day-charlie')
  assert.match(detail.html, /Journée indépendante/)
  assert.doesNotMatch(detail.html, /Journée dédiée/)
})

// --- R2.1 sections 40-41: manual location-name override ---------------------

test('an OFF day\'s manual location field starts empty, with the auto-resolved name as its placeholder — never the value, so it always reads as "using the automatic one"', () => {
  const bundle = createGenericTripBundle()
  // This fixture's OFF day already carries an explicit override matching
  // what would also auto-resolve — clear it to exercise the genuinely
  // unset case.
  bundle.days[1].startLocationName = null
  const detail = buildDayDetail(bundle, 'day-bravo')
  assert.match(detail.infosHtml, /<input id="location-start" type="text" data-field="location-start" value="" placeholder="Hilltown">/)
  assert.doesNotMatch(detail.infosHtml, /data-field="location-end"/, 'OFF has only one location, never an end field')
})

test('an OFF day\'s own manual override shows as the field\'s actual value, not just a placeholder', () => {
  const bundle = createGenericTripBundle()
  bundle.days[1].startLocationName = 'Custom Hamlet'
  const detail = buildDayDetail(bundle, 'day-bravo')
  assert.match(detail.infosHtml, /<input id="location-start" type="text" data-field="location-start" value="Custom Hamlet"/)
})

test('a transfer day exposes both an origin and a destination manual field, each with its own auto-resolved placeholder', () => {
  const bundle = createGenericTripBundle()
  // This fixture's transfer day already carries explicit overrides on both
  // sides — clear them to exercise the genuinely unset, placeholder-only case.
  bundle.days[2].startLocationName = null
  bundle.days[2].endLocationName = null
  const detail = buildDayDetail(bundle, 'day-charlie')
  assert.match(detail.infosHtml, /<input id="location-start" type="text" data-field="location-start" value="" placeholder="Hilltown">/, 'the previous ride stage\'s own endLocationName ("Hilltown") is the origin placeholder')
  assert.match(detail.infosHtml, /<input id="location-end" type="text" data-field="location-end" value="" placeholder="Lakeside">/, 'the next ride stage\'s own startLocationName ("Lakeside") is the destination placeholder')
})

test('a ride day never exposes a manual location field at all — its endpoints already come from its own GPX', () => {
  const bundle = createGenericTripBundle()
  const detail = buildDayDetail(bundle, 'day-alpha')
  assert.doesNotMatch(detail.infosHtml, /data-field="location-start"/)
})

// --- R3 sections 30-35: "Choisir sur la carte" picker markup --------------

test('an OFF day exposes exactly one "Choisir sur la carte" trigger (its single location), and the shared picker block starts hidden', () => {
  const bundle = createGenericTripBundle()
  const detail = buildDayDetail(bundle, 'day-bravo')
  const triggers = detail.infosHtml.match(/data-action="start-choose-location" data-target="(start|end)"/g) ?? []
  assert.deepEqual(triggers, ['data-action="start-choose-location" data-target="start"'])
  assert.match(detail.infosHtml, /<div class="location-picker" data-location-picker hidden>/)
  assert.match(detail.infosHtml, /data-location-picker-map/)
  assert.match(detail.infosHtml, /data-action="confirm-choose-location" disabled/)
  assert.match(detail.infosHtml, /data-action="cancel-choose-location"/)
})

test('a transfer day exposes two triggers, one per side (origine/destination)', () => {
  const bundle = createGenericTripBundle()
  const detail = buildDayDetail(bundle, 'day-charlie')
  const triggers = detail.infosHtml.match(/data-action="start-choose-location" data-target="(start|end)"/g) ?? []
  assert.deepEqual(triggers, ['data-action="start-choose-location" data-target="start"', 'data-action="start-choose-location" data-target="end"'])
})

test('a ride day has neither a picker trigger nor a picker block at all', () => {
  const bundle = createGenericTripBundle()
  const detail = buildDayDetail(bundle, 'day-alpha')
  assert.doesNotMatch(detail.infosHtml, /start-choose-location/)
  assert.doesNotMatch(detail.infosHtml, /data-location-picker/)
})

test('R2.1 sections 38/40-41: an OFF day with a resolvable location gets a real markers-only map model — one "start" marker, never a routed line', () => {
  const bundle = createGenericTripBundle()
  const detail = buildDayDetail(bundle, 'day-bravo')
  assert.ok(detail.markersOnlyMapModel !== null)
  assert.equal(detail.markersOnlyMapModel.coordinates.length, 0, 'never a fabricated line')
  assert.equal(detail.markersOnlyMapModel.markers.length, 1)
  assert.equal(detail.markersOnlyMapModel.markers[0].category, 'start')
})

test('a transfer day with both origin and destination resolvable gets two markers — start and finish, never a line between them', () => {
  const bundle = createGenericTripBundle()
  // The next ride stage's own route has no geometry in this fixture by
  // default (`bundle.routes[1].geometry === null`) — give it a minimal one
  // so both sides of the transfer actually resolve.
  bundle.routes[1].geometry = { full: [{ latitude: 45.1, longitude: 5.1, altitudeM: null }, { latitude: 45.9, longitude: 5.9, altitudeM: null }], simplified: null }
  const detail = buildDayDetail(bundle, 'day-charlie')
  assert.ok(detail.markersOnlyMapModel !== null)
  assert.equal(detail.markersOnlyMapModel.coordinates.length, 0)
  const categories = detail.markersOnlyMapModel.markers.map((marker) => marker.category).sort()
  assert.deepEqual(categories, ['finish', 'start'])
})

test('a ride day never carries a markersOnlyMapModel — its own geometry-driven model already covers that ground', () => {
  const bundle = createGenericTripBundle()
  const detail = buildDayDetail(bundle, 'day-alpha')
  assert.equal(detail.markersOnlyMapModel, null)
})

test('nothing resolvable at all (no neighbour, no route geometry) yields a null markersOnlyMapModel and no map card in the HTML — never an empty map frame', () => {
  const bundle = createGenericTripBundle()
  // Isolate day-bravo with no ride neighbours at all.
  bundle.days = [{ ...bundle.days[1], index: 0 }]
  const detail = buildDayDetail(bundle, 'day-bravo')
  assert.equal(detail.markersOnlyMapModel, null)
  assert.doesNotMatch(detail.html, /data-day-detail-map/)
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
