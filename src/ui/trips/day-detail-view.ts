/**
 * Generic single-day detail screen (CDC Jalon B section 15, reworked across
 * Jalons B4.2/B4.3/B4.4): a compact sticky identity + nav + tablist
 * composition (CDC B4.3 sections 24-25), built from the active `TripBundle`
 * only — never from RGA-hardcoded data.
 *
 * Three shells, one shared shell chrome (sticky header, tablist, Infos,
 * Météo — CDC Jalon B4.4 sections 23-27):
 * - `ride`: the full shell — Résumé/stats, map+profile, Parcours, Météo,
 *   Infos. Only produces the map/profile containers' markup; the caller
 *   (`trips-manager.ts`) wires the actual Leaflet map and SVG profile into
 *   them, since that requires real DOM elements, not strings.
 * - `off`/`transfer`: a lighter shell — a Résumé card (day type + known
 *   location(s), no cycling stats), Météo, Infos — never a fake map/profile
 *   for a day with no GPX/route at all. `buildDayDetail` used to return
 *   `null` for these (a real regression: OFF/transfer days had no Étape
 *   screen to land on at all, no Infos/Météo of their own) — every day is
 *   now openable, so "Précédent/Suivant" can traverse the whole trip
 *   chronology, not just ride days (CDC section 25).
 *
 * `buildDayDetail` still returns `null` only when `dayId` itself can't be
 * resolved, or (ride only) its stage/route can't be resolved either.
 */

import { computeStageWaypoints, resolveStagePauseSettings } from '../../analysis/waypoint-timeline.ts'
import { isSignificantWaypoint } from '../../analysis/canonical-waypoints.ts'
import type { CanonicalWaypoint, CanonicalWaypointKind, WaypointVisibilityFilters } from '../../analysis/canonical-waypoints.ts'
import { buildClimbProfile } from '../../analysis/climb-profile.ts'
import type { ClimbGradeClass, ClimbProfileSegment } from '../../analysis/climb-profile.ts'
import { routeGeometry } from '../../route-enrichment/route-fingerprint.ts'
import { resolveOffLocation, resolveTransferLocations } from '../../analysis/day-location-fill.ts'
import { formatCompactDate } from '../date-format.ts'
import type { Accommodation, Climb, RideStageSettings, RouteGeometryPoint, RoutePointId, SourceFileId, TransferTiming, TripBundle, TripDay, TripDayId } from '../../trip-core/index.ts'

/** Kinds that can anchor a pause (CDC Jalon B4 section 15): the same set `pause-placement.ts` already restricts automatic anchors to. Also the manual pause editor's full candidate list (CDC Jalon B4.3 section 31) — a separate, wider need from `isSignificantWaypoint`'s normal-view policy (CDC section 40: never conflate the two). Exported so `trips-manager.ts` can build/validate pause mutations against the same set. */
export const PAUSE_ANCHOR_KINDS: ReadonlySet<CanonicalWaypointKind> = new Set(['city', 'town', 'village', 'mountain-pass', 'saddle'])

const DEFAULT_FILTERS: WaypointVisibilityFilters = { showSecondaryClimbs: false }

export interface DayDetailOptions {
  /** Montées secondaires toggle (CDC Jalon B4.3 section 29) — local UI state owned by the caller, never persisted. Defaults to off. There is no Villages toggle any more: an ordinary city/town/village never shows in normal view regardless (CDC section 26/28) — the full list stays reachable only through the manual pause editor. */
  readonly filters?: WaypointVisibilityFilters
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—'
  const hours = Math.floor(seconds / 3_600)
  const minutes = Math.round((seconds % 3_600) / 60)
  return `${hours} h ${String(minutes).padStart(2, '0')}`
}

function formatKilometers(value: number): string {
  return `${value.toFixed(1).replace('.', ',')} km`
}

function formatPercent(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1).replace('.', ',')} %`
}

/**
 * User-facing category per waypoint kind (CDC Jalon B4.3 section 26/41:
 * "Ville", never "Localité"; never a raw OSM `place=*`/`mountain_pass=yes`
 * value).
 */
const KIND_LABELS: Readonly<Record<CanonicalWaypointKind, string>> = {
  start: 'Départ', end: 'Arrivée', city: 'Ville', town: 'Ville', village: 'Village',
  'mountain-pass': 'Col', saddle: 'Col', climb: 'Montée', pause: 'Pause',
}

const KIND_MARKERS: Readonly<Record<CanonicalWaypointKind, string>> = {
  start: 'D', end: 'A', city: '●', town: '●', village: '●', 'mountain-pass': '◆', saddle: '◆', climb: '▲', pause: '❚❚',
}

function renderPauseBadge(waypoint: CanonicalWaypoint): string {
  return waypoint.pauseDurationMinutes === null ? '' : `<span class="tag tag--pause">Pause ${waypoint.pauseDurationMinutes} min</span>`
}

/**
 * One plain chronological row — every kind except `climb`, which gets the
 * richer mini-card below (CDC Jalon B4.2 section 17). Sections 32-40/47
 * closeout: the secondary line is exactly "Type · Distance" — never a
 * competing "Kilomètre X km" phrasing (section 39: the formatter's own
 * "X,X km" already says it, a second "Kilomètre" prefix is redundant), never
 * the point's own altitude either (section 37: not a primary value here —
 * it stays available in the profile/tooltip/météo/data instead). `Distance`
 * is always `trackDistanceKm` — the point's own position on the stage from
 * the departure (CDC section 33), the one canonical source
 * (`CanonicalWaypoint.trackDistanceKm`, section 38), never recomputed here.
 */
function renderTimelineRow(waypoint: CanonicalWaypoint): string {
  const meta = `${KIND_LABELS[waypoint.kind]} · ${formatKilometers(waypoint.trackDistanceKm)}`
  const time = waypoint.clockTime === null ? '' : `<span class="day-detail__timeline-time">${escapeHtml(waypoint.clockTime)}</span>`
  return `<li class="day-detail__timeline-row day-detail__timeline-row--${waypoint.importance}" data-waypoint-id="${escapeHtml(waypoint.id)}" data-waypoint-kind="${waypoint.kind}">
    <span class="day-detail__timeline-marker" aria-hidden="true">${KIND_MARKERS[waypoint.kind]}</span>
    <div class="day-detail__timeline-body">
      <strong>${escapeHtml(waypoint.name)}</strong>
      <span class="day-detail__timeline-meta">${meta}</span>
      ${renderPauseBadge(waypoint)}
    </div>
    ${time}
  </li>`
}

/**
 * Colour scale for the climb mini-profile bar (CDC Jalon B4.2 section 18) —
 * progressive green → yellow → orange → red → dark violet as the positive
 * gradient increases, matching `analysis/climb-profile.ts::ClimbGradeClass`'s
 * fixed bands. A brief downhill dip inside a climb's own bounds gets a
 * neutral cool tone, never part of the "positive gradient" scale.
 */
const GRADE_CLASS_COLORS: Readonly<Record<ClimbGradeClass, string>> = {
  'descent-7-plus': '#4f7f8f',
  'descent-0-7': '#7fa9a6',
  'climb-0-1': '#7fb35a',
  'climb-1-4': '#c9c24a',
  'climb-4-8': '#e2963a',
  'climb-8-12': '#cf4a3a',
  'climb-12-plus': '#7a2a52',
}

/** < 3 km climbs use 250 m bins to stay readable (CDC Jalon B4.2 section 18); longer climbs use the analysis module's own 500 m default. */
function climbSegmentLengthMeters(climb: Climb): number {
  return climb.endDistanceKm - climb.startDistanceKm < 3 ? 250 : 500
}

/**
 * A lightweight SVG elevation silhouette (CDC Jalon B4.3 section 34: "il
 * faut voir une forme altimétrique", not just flat colour blocks), coloured
 * per-segment by gradient (CDC section 18). Reuses only this climb's own
 * window of the already-computed segments — never a second GPX/recompute.
 * Tall enough to actually read the shape (CDC Jalon B4.4 section 31 — the
 * previous 64px-tall silhouette was closer to a coloured strip than a real
 * profile). Carries a real pointer/touch/keyboard tooltip interaction (CDC
 * B4.4 section 30) — `trips-manager.ts::mountClimbProfileInteractions`
 * reuses the exact same tooltip-clamping helper
 * (`elevation-profile.ts::clampCenteredOffsetPercent`) and cursor/tooltip
 * CSS classes as the main elevation profile, never a second, divergent
 * interaction model; this function only needs to embed the per-segment data
 * it can't otherwise reach from the DOM (a plain `title=""` attribute is not
 * enough — CDC section 30: "ne pas dépendre de title="" comme interaction
 * principale").
 */
function renderClimbProfileShape(segments: readonly ClimbProfileSegment[]): string {
  const altitudes = segments.flatMap((segment) => [segment.startAltitudeM, segment.endAltitudeM]).filter((value): value is number => value !== null)
  if (altitudes.length === 0) return ''
  const minAltitude = Math.min(...altitudes)
  const maxAltitude = Math.max(...altitudes)
  const span = Math.max(maxAltitude - minAltitude, 1)
  const totalKm = Math.max((segments[segments.length - 1]?.endDistanceKm ?? 0) - (segments[0]?.startDistanceKm ?? 0), 0.001)
  const startKm = segments[0]?.startDistanceKm ?? 0
  const width = 300
  const height = 130
  const x = (km: number): number => ((km - startKm) / totalKm) * width
  const y = (altitude: number): number => height - ((altitude - minAltitude) / span) * (height - 10) - 5

  const bands = segments.map((segment) => {
    if (segment.startAltitudeM === null || segment.endAltitudeM === null) return ''
    const x1 = x(segment.startDistanceKm)
    const x2 = x(segment.endDistanceKm)
    const y1 = y(segment.startAltitudeM)
    const y2 = y(segment.endAltitudeM)
    const color = segment.gradeClass === null ? '#c7d2cc' : GRADE_CLASS_COLORS[segment.gradeClass]
    return `<polygon points="${x1.toFixed(1)},${height} ${x1.toFixed(1)},${y1.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)} ${x2.toFixed(1)},${height}" fill="${color}"></polygon>`
  }).join('')
  const outline = segments
    .filter((segment) => segment.startAltitudeM !== null)
    .map((segment, index) => `${index === 0 ? 'M' : 'L'}${x(segment.startDistanceKm).toFixed(1)},${y(segment.startAltitudeM as number).toFixed(1)}`)
    .join(' ')
  const last = segments[segments.length - 1]
  const outlineEnd = last?.endAltitudeM === null || last?.endAltitudeM === undefined ? '' : ` L${x(last.endDistanceKm).toFixed(1)},${y(last.endAltitudeM).toFixed(1)}`

  // Embedded once, read by `mountClimbProfileInteractions` — never a second
  // recomputation of the climb profile in the DOM-wiring layer.
  const interactionData = JSON.stringify(segments.map((segment) => [segment.startDistanceKm, segment.endDistanceKm, segment.startAltitudeM, segment.endAltitudeM, segment.averageGradientPercent]))

  return `<svg class="day-detail__climb-profile-shape" data-climb-profile-interactive tabindex="0" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Profil interactif de la montée" data-segments="${escapeHtml(interactionData)}" data-start-km="${startKm}">${bands}<path d="${outline}${outlineEnd}" fill="none" stroke="var(--forest-950, #102d28)" stroke-width="1.5"></path><g class="profile-cursor" data-profile-cursor hidden><line data-profile-cursor-line y1="0" y2="${height}"></line><circle data-profile-cursor-dot r="4"></circle></g></svg>`
}

/**
 * CDC Jalon C1 closeout: the colour-coded altimetric silhouette
 * (`renderClimbProfileShape`) already carries the same per-segment gradient
 * colouring — the horizontal colour-coded strip that used to render right
 * below it (`day-detail__climb-profile-bar`, one `<span>` per segment) was a
 * plain duplicate of the exact same information, just flattened. Removed
 * outright; the segmentation itself (`ClimbProfileSegment[]`, grade classes)
 * still drives the shape's colours and the interactive tooltip — only this
 * second, redundant visual is gone.
 */
function renderClimbProfileBar(segments: readonly ClimbProfileSegment[]): string {
  if (segments.length === 0) return '<p class="day-detail__climb-profile-empty">Profil indisponible pour cette montée.</p>'
  const first = segments[0]
  const last = segments[segments.length - 1]
  // `.elevation-profile__stage`/`.profile-tooltip` (CDC Jalon B4.4 section
  // 30) — the exact same positioning classes the main elevation profile
  // uses for its own interactive tooltip, reused here rather than a second,
  // parallel set of tooltip CSS.
  return `<div class="elevation-profile__stage">${renderClimbProfileShape(segments)}<div class="profile-tooltip" data-profile-tooltip hidden></div></div>
    <p class="visually-hidden" data-profile-live aria-live="polite"></p>
    <div class="day-detail__climb-profile-scale">
      <span>${formatKilometers(first?.startDistanceKm ?? 0)} · ${first?.startAltitudeM === null || first?.startAltitudeM === undefined ? '—' : `${Math.round(first.startAltitudeM)} m`}</span>
      <span>${formatKilometers(last?.endDistanceKm ?? 0)} · ${last?.endAltitudeM === null || last?.endAltitudeM === undefined ? '—' : `${Math.round(last.endAltitudeM)} m`}</span>
    </div>
    <p class="day-detail__climb-profile-caption">Survolez, touchez ou utilisez les flèches pour lire la distance, l’altitude et la pente.</p>`
}

/**
 * Climb mini-card (CDC Jalon B4.2/B4.3 section 17/34, B4.4 section 28-29,
 * sections 35-38/47 closeout). Closed state carries only the identity every
 * other Parcours row carries — Picto | Nom | ETA (au sommet), then
 * "Type · Distance" as the secondary line, `Distance` being the SUMMIT's own
 * position on the stage (`Climb.endDistanceKm`, section 35 — never the
 * climb's length) — never D+/pente/longueur, which only ever show once
 * expanded (section 47). Tapping it expands a colour-coded silhouette of
 * just this climb's own portion of the stage profile (never a second GPX/
 * recalculation — a window over the already-computed route geometry), plus
 * the Longueur/D+/Pente moyenne stats that used to sit in the closed toggle
 * (section 36). Expand/collapse is a pure client-side attribute toggle
 * (`trips-manager.ts`), never a re-render. Used for every waypoint carrying
 * a `climbId` — a bare `climb`-kind waypoint as much as a `mountain-pass`/
 * `saddle` landmark merged with a detected climb (CDC B4.4 section 28) — so
 * the marker/label stay the waypoint's own real `kind` (◆ "Col" for a named
 * pass/saddle, ▲ "Montée" for a bare climb), never hardcoded to "climb": the
 * whole point of the merge is that this is still the named col, just with
 * its profile attached.
 */
function renderClimbCard(waypoint: CanonicalWaypoint, climb: Climb, routeGeometryFull: readonly RouteGeometryPoint[] | null): string {
  const profile = routeGeometryFull === null ? null : buildClimbProfile(routeGeometryFull, climb, climbSegmentLengthMeters(climb))
  const profileId = `climb-profile-${escapeHtml(climb.id)}`
  return `<li class="day-detail__timeline-row day-detail__timeline-row--${waypoint.importance} day-detail__climb-card" data-waypoint-id="${escapeHtml(waypoint.id)}" data-waypoint-kind="${waypoint.kind}">
    <button class="day-detail__climb-toggle" type="button" data-action="toggle-climb-profile" data-climb-id="${escapeHtml(climb.id)}" aria-expanded="false" aria-controls="${profileId}">
      <span class="day-detail__climb-toggle-row">
        <span class="day-detail__timeline-marker" aria-hidden="true">${KIND_MARKERS[waypoint.kind]}</span>
        <strong>${escapeHtml(waypoint.name)}</strong>
        ${waypoint.clockTime === null ? '' : `<span class="day-detail__timeline-time">${escapeHtml(waypoint.clockTime)}</span>`}
      </span>
      <span class="day-detail__climb-toggle-row day-detail__climb-toggle-row--meta">${KIND_LABELS[waypoint.kind]} · ${formatKilometers(climb.endDistanceKm)}</span>
      ${renderPauseBadge(waypoint)}
    </button>
    <div class="day-detail__climb-profile" id="${profileId}" data-climb-profile hidden>
      <dl class="day-detail__climb-profile-stats">
        <div><dt>Longueur</dt><dd>${formatKilometers(climb.endDistanceKm - climb.startDistanceKm)}</dd></div>
        <div><dt>D+</dt><dd>+${Math.round(climb.elevationGainM)} m</dd></div>
        <div><dt>Pente moyenne</dt><dd>${formatPercent(climb.averageGradientPercent)}</dd></div>
      </dl>
      ${profile === null ? '<p class="day-detail__climb-profile-empty">Profil indisponible pour cette montée.</p>' : renderClimbProfileBar(profile.segments)}
    </div>
  </li>`
}

/**
 * Single ordered Parcours list (CDC Jalon B4.3 sections 11/26-29): one
 * chronological `<ol>`, sorted by `trackDistanceKm` (already the order
 * `waypoints` comes in), no grouping/duplication. In normal view, only
 * départ/arrivée/pauses/significant relief show (`isSignificantWaypoint`) —
 * the exact same policy the map/profile use.
 */
function renderTimelineList(waypoints: readonly CanonicalWaypoint[], climbs: readonly Climb[], filters: WaypointVisibilityFilters, routeGeometryFull: readonly RouteGeometryPoint[] | null): string {
  const visible = waypoints.filter((waypoint) => isSignificantWaypoint(waypoint, filters))
  if (visible.length === 0) return '<p>Aucun point de passage disponible.</p>'
  const rows = visible.map((waypoint) => {
    // CDC Jalon B4.4 section 28: a col merged with a detected climb
    // (`kind` stays `mountain-pass`/`saddle` — the landmark's own kind, per
    // `canonical-waypoints.ts::buildCanonicalWaypoints`'s merge — while
    // `climbId` still points at the real `Climb`) must get the same
    // mini-profile card as a bare `climb`-kind waypoint. Checking `climbId`
    // first, regardless of `kind`, is what makes that case — the single most
    // common one for a named col — actually resolve to `renderClimbCard`
    // instead of a plain row with no profile at all.
    if (waypoint.climbId === null) return renderTimelineRow(waypoint)
    const climb = climbs.find((candidate) => candidate.id === waypoint.climbId)
    return climb === undefined ? renderTimelineRow(waypoint) : renderClimbCard(waypoint, climb, routeGeometryFull)
  }).join('')
  return `<ol class="day-detail__timeline">${rows}</ol>`
}

/** Only "Montées secondaires" remains (CDC Jalon B4.3 section 29) — no Villages toggle: an ordinary city/town/village never appears in the normal view any more, with or without a filter (the full list lives only in the manual pause editor, section 31). */
function renderFilters(filters: WaypointVisibilityFilters): string {
  const secondaryClimbs = filters.showSecondaryClimbs ?? false
  return `<div class="point-filters" role="group" aria-label="Filtres du parcours" data-day-detail-filters>
    <button class="button" type="button" data-action="toggle-parcours-filter" data-filter="secondary-climbs" aria-pressed="${secondaryClimbs}">Montées secondaires</button>
  </div>`
}

function pauseStatusText(mode: 'automatic' | 'custom', activeCount: number): string {
  if (mode === 'automatic') return 'Gestion automatique'
  if (activeCount === 0) return 'Mode manuel · aucune pause'
  return `Mode manuel · ${activeCount} pause${activeCount > 1 ? 's' : ''}`
}

/**
 * One compact candidate row for the manual pause editor (CDC Jalon B4.3
 * section 31) — name/type/distance/ETA, a single checkbox, and a duration
 * field that only shows once checked. No card, no dropdown, no per-change
 * save: every row's state is read together by the caller's single
 * "Enregistrer" action (`trips-manager.ts`).
 */
function renderPauseCandidateRow(candidate: CanonicalWaypoint, activePause: RideStageSettings['pauses'][number] | undefined): string {
  const isActive = activePause !== undefined
  const durationMinutes = activePause === undefined ? 15 : Math.round(activePause.durationSeconds / 60)
  return `<div class="day-pause-editor__row" data-candidate-id="${escapeHtml(candidate.id)}">
    <label class="day-pause-editor__row-check">
      <input type="checkbox" data-field="pause-active" ${isActive ? 'checked' : ''}>
      <strong>${escapeHtml(candidate.name)}</strong>
    </label>
    <span class="day-pause-editor__row-meta">${KIND_LABELS[candidate.kind]} · ${formatKilometers(candidate.trackDistanceKm)}${candidate.clockTime === null ? '' : ` · ${escapeHtml(candidate.clockTime)}`}</span>
    <label class="day-pause-editor__row-duration" ${isActive ? '' : 'hidden'}>
      <input type="number" min="0" max="120" step="5" value="${durationMinutes}" data-field="pause-duration"> min
    </label>
  </div>`
}

/**
 * Pauses (CDC Jalon B4.3 sections 30-32, CDC Jalon C1 closeout section 4):
 * the normal view is a compact status line only — never the pause list,
 * never a card/select/input in consultation. "Manuel" deploys a single
 * `<details>` panel (native disclosure, no extra JS needed to open/close
 * it) with one compact row per candidate point (city/town/village/col);
 * everything is batched behind one "Enregistrer" action (`trips-manager.ts`'s
 * `save-manual-pauses` handler) — never a save per checkbox/duration
 * change, never a full `renderDay()`.
 *
 * "Rétablir Auto" sits next to "Manuel" — a sibling of the `<details>`
 * inside `.day-detail__pauses-actions`, deliberately NOT a child of
 * `<details>` itself: any element inside `<details>` other than its own
 * first `<summary>` is native toggle content (hidden while collapsed), so
 * it used to only ever show once the user had already opened the Manuel
 * panel and scrolled to the bottom. As a sibling it is always visible
 * whenever the stage genuinely carries a manual override (`resolution.mode
 * === 'custom'`), reverting instantly via the same `pause-mode-automatic`
 * action — no need to open the panel first, and (unchanged) that handler
 * only ever patches the pauses/stats/timeline subtree, never a full
 * reload.
 *
 * Always wrapped in a stable `data-day-detail-pauses` container so the
 * caller can patch just this subtree after a mutation.
 */
function renderPauseEditor(
  stageId: string,
  resolution: { readonly mode: 'automatic' | 'custom' },
  stageSettings: RideStageSettings | undefined,
  anchorCandidates: readonly CanonicalWaypoint[],
): string {
  const activePauses = (stageSettings?.pauses ?? []).filter((pause) => pause.active)
  const activeByRoutePointId = new Map(activePauses.map((pause) => [pause.routePointId, pause]))
  const status = pauseStatusText(resolution.mode, activePauses.length)

  const candidateRows = anchorCandidates.length === 0
    ? '<p>Aucun point canonique disponible pour ancrer une pause sur cette étape.</p>'
    : anchorCandidates.map((candidate) => renderPauseCandidateRow(candidate, activeByRoutePointId.get(candidate.id as RoutePointId))).join('')

  return `<section class="card day-detail__pauses" data-day-detail-pauses data-stage-id="${escapeHtml(stageId)}">
    <p class="eyebrow">Arrêts</p><h3>Pauses</h3>
    <p class="day-detail__pauses-status">${status}</p>
    <div class="day-detail__pauses-actions">
      <details class="day-pause-editor" data-day-pause-editor>
        <summary class="button button--quiet">Manuel</summary>
        <div class="day-pause-editor__list">${candidateRows}</div>
        <div class="day-pause-editor__actions">
          <button class="button button--primary" type="button" data-action="save-manual-pauses">Enregistrer</button>
        </div>
      </details>
      ${resolution.mode === 'custom' ? '<button class="button button--quiet" type="button" data-action="pause-mode-automatic">Rétablir Auto</button>' : ''}
    </div>
  </section>`
}

/**
 * Météo tab (CDC Jalon B4.2/B4.3 section 22/37-38, B4.4 section 27): an
 * honest placeholder only — the weather engine itself is out of scope for
 * this pass, never fake data. Identical placeholder for ride/OFF/transfer
 * days (CDC B4.4 section 27: "afficher le même placeholder propre") — a
 * future phase can key it off the OFF location or the transfer's origin/
 * destination, but never before the engine itself exists. `defaultVisible`
 * is `false` for a ride day (Parcours is the first tab there) and `true` for
 * an OFF/transfer day (which has no Parcours tab at all, so Météo opens
 * first).
 */
function renderWeatherPanel(defaultVisible = false): string {
  return `<section id="day-panel-weather" class="card" role="tabpanel" aria-labelledby="day-tab-weather" data-day-panel="weather" ${defaultVisible ? '' : 'hidden'}>
    <p class="eyebrow">Conditions</p><h3>Météo</h3>
    <div data-day-detail-weather><p role="status">Chargement des prévisions…</p></div>
  </section>`
}

/** Read-only lodging display (CDC Jalon B4.3 section 35) — name + Maps/site buttons only, never a form. Nothing rendered at all when no lodging is set, per section 35: no large empty block. */
function renderLodgingReadView(accommodation: Accommodation | undefined): string {
  if (accommodation === undefined) return ''
  const mapsLink = accommodation.mapsUrl === null ? '' : `<a class="button button--primary" href="${escapeHtml(accommodation.mapsUrl)}" target="_blank" rel="noopener">Ouvrir dans Maps</a>`
  const websiteLink = accommodation.website === null ? '' : `<a class="button button--quiet" href="${escapeHtml(accommodation.website)}" target="_blank" rel="noopener">Voir le site</a>`
  const links = [mapsLink, websiteLink].join('')
  return `<div class="day-infos__lodging-display">
    <p class="eyebrow">Hébergement</p>
    ${accommodation.name === '' ? '' : `<h4>${escapeHtml(accommodation.name)}</h4>`}
    ${links === '' ? '' : `<div class="day-infos__lodging-links">${links}</div>`}
  </div>`
}

/**
 * Infos tab (CDC Jalon B4.3 sections 35-36): read-only in normal
 * consultation — free text and lodging shown as plain content, a single
 * "Modifier" button reveals one grouped edit form (textarea + lodging
 * fields together) with one "Enregistrer" — never a form directly in view,
 * never a separate action per field. Deliberately never lists climbs here
 * — they belong to Parcours only (CDC hardening: never duplicated between
 * tabs).
 */
function renderInfosPanel(day: TripBundle['days'][number], accommodation: Accommodation | undefined): string {
  const hasNotes = day.notes !== null && day.notes.trim() !== ''
  const readView = `<div class="day-infos__read" data-day-infos-read>
    ${hasNotes ? `<p class="day-infos__notes-text">${escapeHtml(day.notes as string).replaceAll('\n', '<br>')}</p>` : '<p class="day-infos__empty">Aucune note pour cette étape.</p>'}
    ${renderLodgingReadView(accommodation)}
    <button class="button button--quiet" type="button" data-action="edit-day-infos">Modifier</button>
  </div>`

  const editView = `<div class="day-infos__edit" data-day-infos-edit hidden>
    <div class="field"><label for="day-notes">Notes</label><div class="field__control"><textarea id="day-notes" data-field="day-notes" rows="5" placeholder="Conseils, description, logistique, choses à faire…">${escapeHtml(day.notes ?? '')}</textarea></div></div>
    <div class="field"><label for="lodging-name">Nom du logement</label><div class="field__control"><input id="lodging-name" type="text" data-field="lodging-name" value="${escapeHtml(accommodation?.name ?? '')}" placeholder="Hôtel, gîte, camping…"></div></div>
    <div class="field"><label for="lodging-maps-url">URL Maps</label><div class="field__control"><input id="lodging-maps-url" type="url" data-field="lodging-maps-url" value="${escapeHtml(accommodation?.mapsUrl ?? '')}" placeholder="https://maps.google.com/…"></div></div>
    <div class="field"><label for="lodging-website">URL du site</label><div class="field__control"><input id="lodging-website" type="url" data-field="lodging-website" value="${escapeHtml(accommodation?.website ?? '')}" placeholder="https://…"></div></div>
    <div class="day-infos__notes-actions">
      <button class="button button--primary" type="button" data-action="save-day-infos">Enregistrer</button>
      <button class="button button--quiet" type="button" data-action="cancel-edit-day-infos">Annuler</button>
      <span role="status" aria-live="polite" data-day-notes-status></span>
    </div>
  </div>`

  return `<section id="day-panel-infos" class="card" role="tabpanel" aria-labelledby="day-tab-infos" data-day-panel="infos" hidden>
    <p class="eyebrow">Éditorial et logistique</p><h3>Infos</h3>
    ${readView}
    ${editView}
  </section>`
}

export interface DayDetail {
  readonly html: string
  readonly waypoints: readonly CanonicalWaypoint[]
  readonly geometry: readonly RouteGeometryPoint[] | null
  readonly stageLabel: string
  /** Villages only (CDC Jalon B4 section 9): hidden by default on both map/profile, offered as an opt-in fullscreen-map layer. */
  readonly villageWaypoints: readonly CanonicalWaypoint[]
  /** For the "GPX" download action in Parcours (CDC Jalon B4.3 section 33) — the original source file, never a reconstruction. `null` when the route has no known source (should not happen for a resolvable ride day, but never assumed). */
  readonly sourceFileId: SourceFileId | null
  /** Targeted-patch fragments (CDC Jalon B4.2/B4.3 section 3): each already carries its own stable wrapper attribute, so a caller can replace just one subtree instead of the whole screen after a pause/filter/Infos mutation — never a full `renderDay`. */
  readonly statsHtml: string
  /** `''` for OFF/transfer days — a departure time only ever applies to a ride day's own stage timeline (sections 13-17). */
  readonly departureEditorHtml: string
  readonly pausesHtml: string
  readonly timelineHtml: string
  readonly infosHtml: string
}

/**
 * Builds the Étape/Journée detail screen for one day, whatever its type
 * (CDC Jalon B4.4 sections 23-24). Returns `null` only when `dayId` itself
 * can't be resolved, or — ride days only — its stage/route can't be
 * resolved either; the caller falls back to the day list in those cases.
 */
export function buildDayDetail(bundle: TripBundle, dayId: TripDayId, options: DayDetailOptions = {}): DayDetail | null {
  const day = bundle.days.find((candidate) => candidate.id === dayId)
  if (day === undefined) return null
  if (day.type !== 'ride') return buildOffOrTransferDayDetail(bundle, day)
  return buildRideDayDetail(bundle, day, options)
}

function transferTimingLabel(timing: TransferTiming | undefined): string {
  if (timing === 'after_previous') return 'Après l’étape précédente'
  if (timing === 'before_next') return 'Avant l’étape suivante'
  return 'Journée dédiée'
}

/**
 * The lighter OFF/transfer shell (CDC Jalon B4.4 section 24): a Résumé card
 * (day type + known location(s), no cycling stats), Météo (placeholder),
 * Infos — never a fake map/profile/Parcours for a day with no GPX/route at
 * all. Shares the same sticky header + tablist chrome as the ride shell so
 * "Précédent/Suivant" lands on a screen that looks and behaves the same way.
 */
function buildOffOrTransferDayDetail(bundle: TripBundle, day: TripDay): DayDetail {
  const dateLabel = day.date === null ? null : formatCompactDate(day.date)
  const typeLabel = day.type === 'off' ? 'Journée OFF' : 'Transfert'
  const identityParts = [`J${day.displayNumber}`, dateLabel, typeLabel].filter((part): part is string => part !== null)
  const stageLabel = `J${day.displayNumber} — ${typeLabel}`

  const summaryHtml = day.type === 'off' ? renderOffSummary(bundle, day) : renderTransferSummary(bundle, day)
  const accommodation = day.accommodationId === null ? undefined : bundle.accommodations.find((candidate) => candidate.id === day.accommodationId)
  const infosHtml = renderInfosPanel(day, accommodation)

  const html = `<div class="day-detail" data-day-detail>
    <div class="day-detail__sticky-header" data-day-detail-sticky-header>
      <header class="day-detail__sticky-identity" data-day-detail-identity><span class="eyebrow">Détail de la journée</span><strong>${identityParts.join(' · ')}</strong></header>
      <nav class="day-detail__sticky-nav" data-day-detail-nav aria-label="Navigation de la journée">
        <button class="button button--quiet" type="button" data-action="back-to-trip-detail">← Retour</button>
        <button class="button button--quiet" type="button" data-action="previous-day" aria-label="Journée précédente">‹</button>
        <button class="button button--quiet" type="button" data-action="next-day" aria-label="Journée suivante">›</button>
      </nav>
    </div>
    ${summaryHtml}
    <nav class="day-tabs" role="tablist" aria-label="Sections de la journée" data-day-detail-tabs>
      <button id="day-tab-weather" type="button" role="tab" data-day-tab="weather" aria-controls="day-panel-weather" aria-selected="true" tabindex="0">Météo</button>
      <button id="day-tab-infos" type="button" role="tab" data-day-tab="infos" aria-controls="day-panel-infos" aria-selected="false" tabindex="-1">Infos</button>
    </nav>
    ${renderWeatherPanel(true)}
    ${infosHtml}
  </div>`

  return {
    html, waypoints: [], geometry: null, stageLabel, villageWaypoints: [], sourceFileId: null,
    statsHtml: '', departureEditorHtml: '', pausesHtml: '', timelineHtml: '', infosHtml,
  }
}

/** OFF Résumé (CDC Jalon B4.4 section 24) — day type + known location, reusing the same auto-fill as the Voyage day card (`day-location-fill.ts`), never a second, divergent resolution. */
function renderOffSummary(bundle: TripBundle, day: TripDay): string {
  const location = resolveOffLocation(bundle, day)
  return `<section class="card day-detail__summary" data-day-detail-summary>
    <p class="eyebrow">Résumé</p>
    <p>${location.name === null ? 'Lieu inconnu.' : escapeHtml(location.name)}</p>
  </section>`
}

/** Transfer Résumé (CDC Jalon B4.4 sections 22/24) — origin → destination, plus the transfer's own moment when it isn't the default "journée dédiée" (CDC section 22's `transferTiming`, edited from the trip editor). */
function renderTransferSummary(bundle: TripBundle, day: TripDay): string {
  const { origin, destination } = resolveTransferLocations(bundle, day)
  const route = origin === null && destination === null ? 'Origine/destination inconnues.' : `${escapeHtml(origin ?? '—')} → ${escapeHtml(destination ?? '—')}`
  return `<section class="card day-detail__summary" data-day-detail-summary>
    <p class="eyebrow">Résumé</p>
    <p>${route}</p>
    <p class="day-detail__summary-timing">${escapeHtml(transferTimingLabel(day.transferTiming))}</p>
  </section>`
}

function buildRideDayDetail(bundle: TripBundle, day: TripBundle['days'][number], options: DayDetailOptions): DayDetail | null {
  if (day.stageId === null) return null
  const stage = bundle.stages.find((candidate) => candidate.id === day.stageId)
  if (stage === undefined) return null
  const route = bundle.routes.find((candidate) => candidate.id === stage.sourceRouteId)
  if (route === undefined) return null
  const geometry = routeGeometry(route)
  const filters = options.filters ?? DEFAULT_FILTERS

  const daySettings = bundle.settings.days.find((candidate) => candidate.dayId === day.id)
  const settings = { referenceSpeedKph: bundle.settings.global.referenceSpeedKph, departureTime: daySettings?.departureTime ?? '08:00' }
  const stageSettings = bundle.settings.stages.find((candidate) => candidate.stageId === stage.id)
  const pauseResolution = resolveStagePauseSettings(bundle.settings.global.pausePlanMode, stageSettings)
  const waypoints = computeStageWaypoints({
    stage, route, routePoints: bundle.routePoints, climbs: bundle.climbs, settings,
    manualPauses: pauseResolution.mode === 'custom' ? pauseResolution.manualPauses : undefined,
    mountainMode: bundle.settings.global.mountainMode ?? false,
  })
  const anchorCandidates = waypoints.filter((waypoint) => PAUSE_ANCHOR_KINDS.has(waypoint.kind))

  const dateLabel = day.date === null ? null : formatCompactDate(day.date)
  const locations = `${escapeHtml(stage.startLocationName ?? '—')} → ${escapeHtml(stage.endLocationName ?? '—')}`
  const stageLabel = `J${day.displayNumber} — ${stage.startLocationName ?? '—'} → ${stage.endLocationName ?? '—'}`
  // Compact sticky identity (CDC Jalon B4.3 section 24): one line, date
  // before locations — "J9 · 20.08.26 · Briançon → Faucon-de-Barcelonnette".
  // The GPX/roadbook stage name (`stage.name`) is deliberately never shown
  // here — it stays available as technical data only.
  const identityParts = [`J${day.displayNumber}`, dateLabel, locations].filter((part): part is string => part !== null)

  const arrival = waypoints.length === 0 ? null : waypoints[waypoints.length - 1]
  // In manual mode, the displayed total reflects the actually-placed pauses
  // (which the user controls directly) rather than the imported automatic
  // budget estimate — the two only ever match by coincidence once edited.
  const totalPauseMinutes = pauseResolution.mode === 'custom'
    ? waypoints.reduce((total, waypoint) => total + (waypoint.pauseDurationMinutes ?? 0), 0)
    : stage.pauseDurationSeconds === null ? null : Math.round(stage.pauseDurationSeconds / 60)
  // Sections 13-17 closeout: the departure time is per-day
  // (`TripDaySettings.departureTime`, never the trip-wide
  // `referenceSpeedKph`) — shown here alongside the day's other stats, with
  // its own compact "Modifier" affordance rather than the full Réglages
  // screen. `data-day-departure-value` is the one spot `trips-manager.ts`'s
  // `edit-day-departure-time` handler needs to reach without a full rebuild
  // (pre-filling the inline editor's `<input type="time">`).
  const statsHtml = `<dl class="day-detail__stats" data-day-detail-stats>
    <div><dt>Départ</dt><dd><span data-day-departure-value>${escapeHtml(settings.departureTime)}</span> <button class="button button--quiet day-detail__departure-edit-trigger" type="button" data-action="edit-day-departure-time">Modifier</button></dd></div>
    <div><dt>Distance</dt><dd>${stage.distanceKm === null ? '—' : formatKilometers(stage.distanceKm)}</dd></div>
    <div><dt>D+</dt><dd>${stage.elevationGainM === null ? '—' : `+${Math.round(stage.elevationGainM)} m`}</dd></div>
    <div><dt>D−</dt><dd>${stage.elevationLossM === null ? '—' : `−${Math.round(stage.elevationLossM)} m`}</dd></div>
    <div><dt>Roulage</dt><dd>${formatDuration(stage.movingDurationSeconds)}</dd></div>
    <div><dt>Pauses</dt><dd>${totalPauseMinutes === null ? '—' : `${totalPauseMinutes} min`}</dd></div>
    <div><dt>Montées</dt><dd>${stage.climbIds.length}</dd></div>
    <div><dt>Arrivée estimée</dt><dd>${arrival?.clockTime ?? '—'}</dd></div>
  </dl>`

  // Always rendered, always collapsed by default (`hidden`) — a pure
  // client-side toggle (`edit-day-departure-time`/`cancel-edit-day-departure-time`
  // in `trips-manager.ts`, exactly like `renderInfosPanel`'s read/edit split
  // above), never a second screen. Re-rendered fresh (and therefore always
  // freshly collapsed, pre-filled with the just-saved value) every time
  // `patchDayDetail` patches `[data-day-departure-editor]` after a save.
  const departureEditorHtml = `<div class="day-detail__departure-editor" data-day-departure-editor hidden>
    <div class="field"><label for="day-departure-time-input">Heure de départ</label><div class="field__control"><input id="day-departure-time-input" type="time" data-field="day-departure-time" value="${escapeHtml(settings.departureTime)}" required></div></div>
    <div class="day-detail__departure-editor-actions">
      <button class="button button--primary" type="button" data-action="save-day-departure-time">Enregistrer</button>
      <button class="button button--quiet" type="button" data-action="cancel-edit-day-departure-time">Annuler</button>
      <span role="status" aria-live="polite" data-day-departure-status></span>
    </div>
  </div>`

  const pausesHtml = renderPauseEditor(stage.id, pauseResolution, stageSettings, anchorCandidates)
  const timelineHtml = renderTimelineList(waypoints, bundle.climbs, filters, geometry)
  const accommodation = day.accommodationId === null ? undefined : bundle.accommodations.find((candidate) => candidate.id === day.accommodationId)
  const infosHtml = renderInfosPanel(day, accommodation)

  const html = `<div class="day-detail" data-day-detail>
    <div class="day-detail__sticky-header" data-day-detail-sticky-header>
      <header class="day-detail__sticky-identity" data-day-detail-identity><span class="eyebrow">Détail de l’étape</span><strong>${identityParts.join(' · ')}</strong></header>
      <nav class="day-detail__sticky-nav" data-day-detail-nav aria-label="Navigation de l’étape">
        <button class="button button--quiet" type="button" data-action="back-to-trip-detail">← Retour</button>
        <button class="button button--quiet" type="button" data-action="previous-day" aria-label="Étape précédente">‹</button>
        <button class="button button--quiet" type="button" data-action="next-day" aria-label="Étape suivante">›</button>
      </nav>
    </div>
    ${statsHtml}
    ${departureEditorHtml}
    <nav class="day-tabs" role="tablist" aria-label="Sections de l’étape" data-day-detail-tabs>
      <button id="day-tab-route" type="button" role="tab" data-day-tab="route" aria-controls="day-panel-route" aria-selected="true" tabindex="0">Parcours</button>
      <button id="day-tab-weather" type="button" role="tab" data-day-tab="weather" aria-controls="day-panel-weather" aria-selected="false" tabindex="-1">Météo</button>
      <button id="day-tab-infos" type="button" role="tab" data-day-tab="infos" aria-controls="day-panel-infos" aria-selected="false" tabindex="-1">Infos</button>
    </nav>
    <section id="day-panel-route" class="card" role="tabpanel" aria-labelledby="day-tab-route" data-day-panel="route">
      <div class="section-heading"><div><p class="eyebrow">Trace GPX</p><h3>Carte de l’étape</h3></div><button class="button button--quiet" type="button" data-explore-map>Explorer la carte</button></div>
      <div class="route-map" data-day-detail-map></div>
      <p class="eyebrow day-detail__profile-eyebrow">Relief</p>
      <div data-day-detail-profile></div>
      ${renderFilters(filters)}
      <div data-day-detail-timeline>${timelineHtml}</div>
      ${pausesHtml}
      <button class="button button--quiet button--full" type="button" data-action="download-stage-gpx">GPX</button>
    </section>
    <dialog class="route-map-dialog" data-day-detail-map-dialog aria-labelledby="day-detail-expanded-map-title">
      <header><h2 id="day-detail-expanded-map-title">Carte de l’étape</h2><div class="route-map-dialog__actions"><button class="button button--quiet" type="button" data-map-layers-toggle aria-expanded="false" aria-controls="day-detail-map-layers-panel" hidden>Calques</button><button class="button button--quiet" type="button" data-close-map>Fermer</button></div></header>
      <div class="route-map-dialog__map-wrap"><div class="route-map route-map--expanded" data-route-map-expanded></div><p class="route-map__fallback route-map__fallback--expanded" data-expanded-route-map-fallback hidden>Fond de carte indisponible. Le tracé reste accessible dans le profil.</p><button class="practical-layers-backdrop" type="button" data-map-layers-backdrop aria-label="Fermer les calques" tabindex="-1" hidden></button><section class="practical-layers-panel" id="day-detail-map-layers-panel" data-map-layers-panel role="dialog" aria-labelledby="day-detail-map-layers-title" hidden><header><div><p class="eyebrow">Points principaux toujours visibles</p><h3 id="day-detail-map-layers-title">Calques</h3></div><button class="button button--quiet" type="button" data-map-layers-close>Fermer</button></header><div class="practical-layers-list" data-map-layers-list></div></section></div>
    </dialog>
    ${renderWeatherPanel()}
    ${infosHtml}
  </div>`

  return {
    html, waypoints, geometry, stageLabel,
    villageWaypoints: waypoints.filter((waypoint) => waypoint.kind === 'village'),
    sourceFileId: route.sourceFileId,
    statsHtml, departureEditorHtml, pausesHtml, timelineHtml, infosHtml,
  }
}
