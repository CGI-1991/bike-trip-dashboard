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

test('builds a compact header (date before locations, no GPX/roadbook name), stats, and a pauses section for a resolvable ride day', () => {
  const bundle = createGenericTripBundle()
  const detail = buildDayDetail(bundle, 'day-alpha')
  assert.ok(detail !== null)
  assert.match(detail.html, /J1 · 10\.05\.27 · Riverside → Hilltown/)
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

// Sections 13-17 closeout: the per-day departure time (TripDaySettings.departureTime)
// is now shown right in the Étape stats, with a compact inline editor —
// never a second "weather departure" field, never the trip-wide
// referenceSpeedKph.
test('a ride day shows its own departure time in the stats, with a "Modifier" trigger — never a second field', () => {
  const bundle = createGenericTripBundle()
  const detail = buildDayDetail(bundle, 'day-alpha')
  assert.match(detail.statsHtml, /<dt>Départ<\/dt><dd><span data-day-departure-value>08:00<\/span>.*data-action="edit-day-departure-time">Modifier<\/button><\/dd>/)
})

test('the departure editor is rendered pre-filled and collapsed by default — a pure client-side toggle, never a second screen', () => {
  const bundle = createGenericTripBundle()
  const detail = buildDayDetail(bundle, 'day-alpha')
  assert.match(detail.departureEditorHtml, /data-day-departure-editor hidden/)
  assert.match(detail.departureEditorHtml, /<input id="day-departure-time-input" type="time" data-field="day-departure-time" value="08:00"/)
  assert.match(detail.departureEditorHtml, /data-action="save-day-departure-time">Enregistrer/)
  assert.match(detail.departureEditorHtml, /data-action="cancel-edit-day-departure-time">Annuler/)
})

test('a day with no departure-time override falls back to 08:00, the same default computeStageWaypoints already uses', () => {
  const bundle = createGenericTripBundle()
  // day-delta (a second ride day in the fixture) has no entry in settings.days at all.
  const detail = buildDayDetail(bundle, 'day-delta')
  assert.match(detail.statsHtml, /<span data-day-departure-value>08:00<\/span>/)
})

test('OFF/transfer days never show a departure-time editor — a departure time only applies to a ride day\'s own stage', () => {
  const bundle = createGenericTripBundle()
  const offDetail = buildDayDetail(bundle, 'day-bravo')
  const transferDetail = buildDayDetail(bundle, 'day-charlie')
  assert.equal(offDetail.departureEditorHtml, '')
  assert.equal(transferDetail.departureEditorHtml, '')
  assert.doesNotMatch(offDetail.html, /data-day-departure-editor/)
  assert.doesNotMatch(transferDetail.html, /data-day-departure-editor/)
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
  // No filter of any kind changes that — there is no Villages toggle any more.
  const withSecondaryClimbsOn = buildDayDetail(bundle, 'day-alpha', { filters: { showSecondaryClimbs: true } })
  assert.doesNotMatch(withSecondaryClimbsOn.timelineHtml, /Micro Village/)
  assert.doesNotMatch(withSecondaryClimbsOn.timelineHtml, /Grand Bourg/)
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

test('only the Montées secondaires filter control is present — no Villages toggle any more (CDC Jalon B4.3 section 29)', () => {
  const bundle = createGenericTripBundle()
  const detail = buildDayDetail(bundle, 'day-alpha', { filters: { showSecondaryClimbs: true } })
  assert.match(detail.html, /data-filter="secondary-climbs" aria-pressed="true"/)
  assert.doesNotMatch(detail.html, /data-filter="villages"/)
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

test('the Étape screen is a real ARIA tablist with Parcours/Météo/Infos panels', () => {
  const bundle = createGenericTripBundle()
  const detail = buildDayDetail(bundle, 'day-alpha')
  assert.match(detail.html, /role="tablist"/)
  assert.match(detail.html, /role="tab" data-day-tab="route" aria-controls="day-panel-route" aria-selected="true"/)
  assert.match(detail.html, /role="tab" data-day-tab="weather" aria-controls="day-panel-weather" aria-selected="false"/)
  assert.match(detail.html, /role="tab" data-day-tab="infos" aria-controls="day-panel-infos" aria-selected="false"/)
  assert.match(detail.html, /id="day-panel-route" class="card" role="tabpanel"/)
  assert.match(detail.html, /id="day-panel-weather"[^>]*role="tabpanel"[^>]*hidden/)
  assert.match(detail.html, /id="day-panel-infos"[^>]*role="tabpanel"[^>]*hidden/)
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

test('a climb renders as a tappable mini-card — closed: picto/name/ETA-at-summit + "Type · Distance-at-summit" only; expanded: Longueur/D+/Pente moyenne + its own gradient-coloured profile panel (sections 35-38/47 closeout)', () => {
  const bundle = pushClimb(createGenericTripBundle())
  const detail = buildDayDetail(bundle, 'day-alpha')
  assert.match(detail.html, /data-action="toggle-climb-profile" data-climb-id="climb-test-1" aria-expanded="false"/)
  assert.match(detail.html, /Col du Test/)
  const waypoint = detail.waypoints.find((candidate) => candidate.climbId === 'climb-test-1')
  assert.ok(waypoint !== undefined)
  // Closed toggle: ETA at the summit (the waypoint's own clockTime, never a
  // second timing computation) and "Type · Distance", Distance being the
  // SUMMIT's own position on the stage (`Climb.endDistanceKm` = 15), never
  // the climb's length (5 km) — that only ever shows once expanded.
  const toggleMatch = /<button class="day-detail__climb-toggle"[^]*?<\/button>/.exec(detail.html)
  assert.ok(toggleMatch !== null)
  const toggleHtml = toggleMatch[0]
  if (waypoint.clockTime !== null) assert.match(toggleHtml, new RegExp(`day-detail__timeline-time">${waypoint.clockTime}<`))
  assert.match(toggleHtml, /day-detail__climb-toggle-row--meta">Montée · 15,0 km</)
  assert.doesNotMatch(toggleHtml, /Longueur|Pente moyenne|\+450 m/, 'the closed toggle must never show longueur/D+/pente — those only appear once expanded')
  // Expanded profile panel: Longueur (climb length, 15 - 10 km)/D+/Pente moyenne.
  const profileMatch = /<div class="day-detail__climb-profile" id="climb-profile-climb-test-1"[^]*?<\/div>\s*<\/li>/.exec(detail.html)
  assert.ok(profileMatch !== null)
  const profileHtml = profileMatch[0]
  assert.match(profileHtml, /<dt>Longueur<\/dt><dd>5,0 km<\/dd>/)
  assert.match(profileHtml, /<dt>D\+<\/dt><dd>\+450 m<\/dd>/)
  assert.match(profileHtml, /<dt>Pente moyenne<\/dt><dd>9,0 %<\/dd>/)
  assert.match(detail.html, /data-climb-profile hidden/, 'collapsed by default')
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
test('the climb card stays a single full-width column, and its profile SVG stays fully responsive, even inside the mobile timeline-row breakpoint', () => {
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
  // `.day-detail__climb-card` must resolve to a single flexible column…
  assert.match(css, /\.day-detail__climb-card \{ grid-template-columns: minmax\(0, 1fr\);/, 'desktop/tablet: climb card is a single full-width column')
  // …and that override must still be the LAST word inside the mobile
  // breakpoint too — not silently undone by `.day-detail__timeline-row`'s
  // own two-column reset there, which is what caused the reported squeeze.
  // Anchored on the exact row-reset rule rather than "the first `@media
  // (max-width: 430px)` block in the file" — style.css has more than one
  // such breakpoint block for unrelated components (day-tabs, pause-editor),
  // so a naive first-match regex can silently grab the wrong one.
  const rowResetRule = '.day-detail__timeline-row { grid-template-columns: auto minmax(0, 1fr); }'
  const rowResetIndex = css.indexOf(rowResetRule)
  assert.ok(rowResetIndex >= 0, 'the mobile row-reset rule must exist')
  const blockEnd = css.indexOf('\n}', rowResetIndex)
  assert.ok(blockEnd > rowResetIndex, 'the row-reset rule must sit inside a closed block')
  const enclosingBlock = css.slice(rowResetIndex, blockEnd)
  const climbCardOverrideIndex = enclosingBlock.indexOf('.day-detail__climb-card {')
  assert.ok(climbCardOverrideIndex >= 0, 'the SAME mobile breakpoint block that resets .day-detail__timeline-row must also re-assert a single-column template for .day-detail__climb-card')
  assert.match(enclosingBlock.slice(climbCardOverrideIndex), /^\.day-detail__climb-card \{ grid-template-columns: minmax\(0, 1fr\); \}/)
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
  // Sections 35/47 closeout: the closed toggle shows "Type · Distance" (the
  // summit's own position, `Climb.endDistanceKm` = 15) — no altitude any
  // more; Longueur/D+/Pente moyenne (climb length, 5 km) live in the
  // expanded profile panel instead.
  assert.match(detail.timelineHtml, /day-detail__climb-toggle-row--meta">Col · 15,0 km</)
  assert.match(detail.timelineHtml, /<dt>Longueur<\/dt><dd>5,0 km<\/dd>/)
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
  assert.match(detail.html, /Journée OFF/)
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
