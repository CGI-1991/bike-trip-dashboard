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

import { computeStagePauseRecommendations, computeStageTimingCurve, computeStageWaypoints, resolveStagePauseSettings } from '../../analysis/waypoint-timeline.ts'
import type { AutomaticPauseEnrichmentInput, StageTimingCurve } from '../../analysis/waypoint-timeline.ts'
import type { PauseCandidatePlace } from '../../analysis/pause-recommendation.ts'
import { isSignificantWaypoint } from '../../analysis/canonical-waypoints.ts'
import type { CanonicalWaypoint, CanonicalWaypointKind } from '../../analysis/canonical-waypoints.ts'
import { buildClimbProfile } from '../../analysis/climb-profile.ts'
import type { ClimbGradeClass, ClimbProfileSegment } from '../../analysis/climb-profile.ts'
import { routeGeometry } from '../../route-enrichment/route-fingerprint.ts'
import { resolveOffCoordinates, resolveOffLocation, resolveSharedInfoDayId, resolveTransferCoordinates, resolveTransferLocations } from '../../analysis/day-location-fill.ts'
import type { RouteMapMarkerModel, RouteMapModel } from '../route-map-model.ts'
import { isPracticalPlaceUxCategory } from '../../practical-places/taxonomy.ts'
import { resolveEffectiveMountainMode } from '../../analysis/terrain-context.ts'
import { formatShortDate } from '../date-format.ts'
import { compactPlaceName } from '../compact-place-name.ts'
import {
  buildPauseRecommendationViewModels,
  computeCandidateOpeningStatus,
  findPauseRecommendationForWaypoint,
  formatPauseRecommendationReasons,
  pauseRecommendationBadgeLabel,
} from './pause-recommendation-view.ts'
import type { CandidateOpeningStatusViewModel, PauseRecommendationViewModel } from './pause-recommendation-view.ts'
import { buildPauseCandidates } from '../../analysis/pause-recommendation.ts'
import { parseClockToMinutes } from '../../analysis/timing.ts'
import { normalizePauseDurationMinutes } from '../../analysis/pause-duration.ts'
import { formatTransferDuration, formatTransferModeAndTimes } from './transfer-summary-format.ts'
import { resolveMapsDirectionsUrl, resolveMapsSearchUrl } from '../maps-link.ts'
import { TRANSFER_MODE_LABELS } from './transfer-mode-labels.ts'
import { TRANSFER_MODES } from '../../trip-core/index.ts'
import type { StagePreparationStatus } from '../../trips-manager/stage-preparation.ts'
import type { Accommodation, Climb, RideStageSettings, RouteGeometryPoint, RoutePointId, SourceFileId, TransferTiming, TripBundle, TripDay, TripDayId } from '../../trip-core/index.ts'

export interface DayDetailOptions {
  /** C2.5 sections 16-17: `partial`/`error` shows a compact "Réessayer" banner in the stats card — every other status (or none supplied) renders no banner at all, exactly as before this feature existed. */
  readonly preparationStatus?: StagePreparationStatus | null
}

/** Kinds that can anchor a pause (CDC Jalon B4 section 15): the same set `pause-placement.ts` already restricts automatic anchors to. Also the manual pause editor's full candidate list (CDC Jalon B4.3 section 31) — a separate, wider need from `isSignificantWaypoint`'s normal-view policy (CDC section 40: never conflate the two). Exported so `trips-manager.ts` can build/validate pause mutations against the same set. */
export const PAUSE_ANCHOR_KINDS: ReadonlySet<CanonicalWaypointKind> = new Set(['city', 'town', 'village', 'mountain-pass', 'saddle'])

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
 * CDC D1.2 section 9: a real identity bandeau — a strong `Jx`/date block on
 * the left (same visual language as the Voyage day card's own left column,
 * D1.1 section 5), the day's main content (départ → arrivée for a ride;
 * whatever's most identifying for OFF/transfer) large/bold on the right.
 * No distance/D+/météo/heures here — those stay in their own dedicated
 * blocks (CDC: "pas besoin d'ajouter... dans ce bandeau").
 */
function renderDayIdentityHeader(day: TripDay, mainLabel: string, fullMainLabel: string): string {
  const dateLabel = day.date === null ? null : formatShortDate(day.date)
  return `<header class="day-detail__sticky-identity" data-day-detail-identity title="${escapeHtml(fullMainLabel)}" aria-label="${escapeHtml(fullMainLabel)}">
    <span class="day-detail__identity-number"><strong>J${day.displayNumber}</strong>${dateLabel === null ? '' : `<time datetime="${day.date}">${escapeHtml(dateLabel)}</time>`}</span>
    <span class="day-detail__identity-route">${mainLabel}</span>
  </header>`
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

/**
 * R3 sections 5-8/14, RC2 section 28: a compact, fixed-size clock dial
 * replaces the old full-width "Pause N min" badge/banner — a filled
 * circular sector (CSS `conic-gradient`, clockwise from 12 o'clock, exactly
 * like a stopwatch) with the duration in minutes at its centre, as a bare
 * number `N` (no minute suffix — RC2 drops the trailing `'` for better
 * optical centring; the "minutes" meaning is carried by `aria-label` only,
 * never by the visible glyph). `--pause-fraction` is `min(1, minutes / 60)`:
 * a pause ≥ 60 min shows a fully filled dial (CDC section 7: "le cercle peut
 * être considéré comme entièrement rempli") — the exact value is never
 * guessed from the dial itself, only from the centred text, so 65/75/90/95
 * all render a full circle with their own real number inside. Fixed pixel
 * size (`--pause-clock-size`, `style.css`) regardless of 1 vs 2 digits —
 * R2's own `renderPauseBadge` (a variable-width text badge that could
 * reshape the row) is gone; this occupies a stable slot in the time column
 * no matter the duration (CDC section 8). `role="img"`/`aria-label` carry
 * the real meaning for assistive tech — the dial's own fill is never the
 * only way to know the duration (CDC section 78).
 */
function renderPauseBadge(waypoint: CanonicalWaypoint): string {
  if (waypoint.pauseDurationMinutes === null) return ''
  const minutes = waypoint.pauseDurationMinutes
  const fraction = Math.min(1, minutes / 60)
  return `<span class="pause-clock" style="--pause-fraction: ${fraction}" role="img" aria-label="Pause ${minutes} minutes"><span class="pause-clock__face" aria-hidden="true"></span><span class="pause-clock__label" aria-hidden="true">${minutes}</span></span>`
}

/**
 * R2.1 section 11: the time column now stacks the clock time above the
 * pause badge (when there is one) — a card with a pause keeps the exact
 * same skeleton as one without, no full-width badge reshaping the row's own
 * geometry (the old behaviour put the badge in the body, next to the meta
 * line, which could push/reflow that line under a long place name). Shared
 * by `renderTimelineRow` and `renderClimbCard` so both keep an identical
 * left column. Omitted entirely (no wrapper at all) when there is neither a
 * clock time nor a pause — preserves the exact 1-or-0-children grid
 * behaviour the row's `auto minmax(0, 1fr)` template already relies on.
 */
function renderTimelineTimeColumn(waypoint: CanonicalWaypoint): string {
  const time = waypoint.clockTime === null ? '' : `<span class="day-detail__timeline-time">${escapeHtml(waypoint.clockTime)}</span>`
  const pauseBadge = renderPauseBadge(waypoint)
  if (time === '' && pauseBadge === '') return ''
  return `<span class="day-detail__timeline-time-col">${time}${pauseBadge}</span>`
}

/**
 * One plain chronological row — every kind except `climb`, which gets the
 * richer mini-card below (CDC Jalon B4.2 section 17), same skeleton now
 * (CDC D1.2 section 17). Sections 32-40/47 closeout: the secondary line is
 * exactly "Type · Distance" — never a competing "Kilomètre X km" phrasing
 * (section 39: the formatter's own "X,X km" already says it, a second
 * "Kilomètre" prefix is redundant), never the point's own altitude either
 * (section 37: not a primary value here — it stays available in the
 * profile/tooltip/data instead). `Distance` is always `trackDistanceKm` —
 * the point's own position on the stage from the departure (CDC section
 * 33), the one canonical source (`CanonicalWaypoint.trackDistanceKm`,
 * section 38), never recomputed here.
 *
 * CDC D1.2 sections 14-18: time now leads on the left (ZONE GAUCHE), name/
 * meta/inline météo in the body (ZONE CENTRALE) — `[data-waypoint-weather]`
 * is an empty mount point here; `trips-manager.ts` fills it in once weather
 * arrives (`weather-view.ts::renderInlineWaypointWeather`), matched to this
 * exact waypoint by `data-waypoint-id` — the single fused Parcours+Météo
 * list this jalon closes out, never a second, separate points list for the
 * same waypoints (section 24 — the "Points significatifs" block dropped
 * from the mounted weather panel itself, see `trips-manager.ts`).
 */
function renderTimelineRow(waypoint: CanonicalWaypoint): string {
  const meta = `${KIND_LABELS[waypoint.kind]} · ${formatKilometers(waypoint.trackDistanceKm)}`
  return `<li class="day-detail__timeline-row day-detail__timeline-row--${waypoint.importance}" data-waypoint-id="${escapeHtml(waypoint.id)}" data-waypoint-kind="${waypoint.kind}">
    ${renderTimelineTimeColumn(waypoint)}
    <div class="day-detail__timeline-body">
      <strong><span class="day-detail__timeline-marker" aria-hidden="true">${KIND_MARKERS[waypoint.kind]}</span>${escapeHtml(waypoint.name)}</strong>
      <span class="day-detail__timeline-meta">${meta}</span>
      <span class="day-detail__timeline-weather" data-waypoint-weather data-waypoint-id="${escapeHtml(waypoint.id)}"></span>
    </div>
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
    <p class="day-detail__climb-profile-caption">Touchez le profil pour explorer.</p>`
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
  // CDC D1.2 sections 17/22: the SAME skeleton as a plain timeline row —
  // time on the left, marker-prefixed name/meta/météo in the body — never a
  // visually foreign component. The compact meta line is now
  // "Longueur · D+ · Pente" (climb-specific, in the same position a plain
  // row's "Type · Distance" occupies) rather than deferred to the expanded
  // state only.
  const meta = `${formatKilometers(climb.endDistanceKm - climb.startDistanceKm)} · +${Math.round(climb.elevationGainM)} m · ${formatPercent(climb.averageGradientPercent)}`
  return `<li class="day-detail__timeline-row day-detail__timeline-row--${waypoint.importance} day-detail__climb-card" data-waypoint-id="${escapeHtml(waypoint.id)}" data-waypoint-kind="${waypoint.kind}">
    <button class="day-detail__climb-toggle" type="button" data-action="toggle-climb-profile" data-climb-id="${escapeHtml(climb.id)}" aria-expanded="false" aria-controls="${profileId}">
      ${renderTimelineTimeColumn(waypoint)}
      <span class="day-detail__timeline-body">
        <strong><span class="day-detail__timeline-marker" aria-hidden="true">${KIND_MARKERS[waypoint.kind]}</span>${escapeHtml(waypoint.name)}</strong>
        <span class="day-detail__timeline-meta">${meta}</span>
        <span class="day-detail__timeline-weather" data-waypoint-weather data-waypoint-id="${escapeHtml(waypoint.id)}"></span>
      </span>
    </button>
    <div class="day-detail__climb-profile" id="${profileId}" data-climb-profile hidden>
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
// Jalon C2.5 section 61: the "Montées secondaires" user toggle is gone — the
// Parcours list now always uses `isSignificantWaypoint`'s own default
// policy (no filters), exactly like the Aperçu screen and the generic
// weather sampler already do. Secondary climbs stay fully detected/
// classified internally (`classifyClimbImportance`, `climb-detection.ts`)
// — only this display-level filter disappears; nothing here mutates the
// underlying topographic analysis.
function renderTimelineList(waypoints: readonly CanonicalWaypoint[], climbs: readonly Climb[], routeGeometryFull: readonly RouteGeometryPoint[] | null): string {
  const visible = waypoints.filter((waypoint) => isSignificantWaypoint(waypoint))
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
/**
 * CDC C3 section 31: a compact "★ Recommandé"/"Bon choix" + one reason line
 * inside the manual editor's own candidate row — a hint only, never a value
 * the row itself carries into `save-manual-pauses` (the checkbox/duration
 * inputs are unaffected). `undefined` (no recommendation for this
 * candidate, or C3 never ran) renders nothing extra, identical to before
 * this feature existed.
 *
 * R2.1 sections 9-10: `openingStatus`, when present, adds one more compact
 * line — "Ouvert à l'ETA"/"Fermé à l'ETA"/"Horaires inconnus", plus (only
 * when genuinely useful — closed now, open with a different departure) a
 * short "ouvert avec départ ±N h" hint. Never a fresh fetch, never a second
 * opening-hours parser — `computeCandidateOpeningStatus`
 * (`pause-recommendation-view.ts`) reuses C3's own `evaluateOpeningAtPassage`
 * and the weather panel's own 5 scenario offsets.
 */
function renderPauseCandidateRow(
  candidate: CanonicalWaypoint,
  activePause: RideStageSettings['pauses'][number] | undefined,
  recommendation: PauseRecommendationViewModel | undefined,
  openingStatus: CandidateOpeningStatusViewModel | undefined,
): string {
  const isActive = activePause !== undefined
  // R3 section 13: an old bundle's own `durationSeconds` may not be a
  // multiple of 5 — normalized here at display time, never migrated
  // destructively.
  const durationMinutes = activePause === undefined ? 15 : normalizePauseDurationMinutes(Math.round(activePause.durationSeconds / 60))
  const badgeLabel = recommendation === undefined ? null : pauseRecommendationBadgeLabel(recommendation.level)
  const hint = badgeLabel === null
    ? ''
    : `<span class="day-pause-editor__row-hint"><span class="tag tag--pause-recommended">${escapeHtml(badgeLabel)}</span>${recommendation !== undefined && recommendation.reasons.length > 0 ? ` ${escapeHtml(formatPauseRecommendationReasons(recommendation.reasons, 2))}` : ''}</span>`
  const openingLine = openingStatus === undefined
    ? ''
    : `<span class="day-pause-editor__row-opening">${escapeHtml(openingStatus.label)}${openingStatus.scenarioHint === null ? '' : ` · ${escapeHtml(openingStatus.scenarioHint)}`}</span>`
  return `<div class="day-pause-editor__row" data-candidate-id="${escapeHtml(candidate.id)}">
    <label class="day-pause-editor__row-check">
      <input type="checkbox" data-field="pause-active" ${isActive ? 'checked' : ''}>
      <strong>${escapeHtml(candidate.name)}</strong>
    </label>
    <span class="day-pause-editor__row-meta">${KIND_LABELS[candidate.kind]} · ${formatKilometers(candidate.trackDistanceKm)}${candidate.clockTime === null ? '' : ` · ${escapeHtml(candidate.clockTime)}`}</span>
    ${hint}
    ${openingLine}
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
  recommendations: readonly PauseRecommendationViewModel[] = [],
  openingStatusByCandidateId: ReadonlyMap<string, CandidateOpeningStatusViewModel> = new Map(),
): string {
  const activePauses = (stageSettings?.pauses ?? []).filter((pause) => pause.active)
  const activeByRoutePointId = new Map(activePauses.map((pause) => [pause.routePointId, pause]))
  const status = pauseStatusText(resolution.mode, activePauses.length)

  const candidateRows = anchorCandidates.length === 0
    ? '<p>Aucun point canonique disponible pour ancrer une pause sur cette étape.</p>'
    : anchorCandidates.map((candidate) => renderPauseCandidateRow(
        candidate,
        activeByRoutePointId.get(candidate.id as RoutePointId),
        findPauseRecommendationForWaypoint(recommendations, candidate.id),
        openingStatusByCandidateId.get(candidate.id),
      )).join('')

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
 * R2.1 sections 3-4: Pauses and Météo, regrouped into one compact,
 * non-sticky bottom block — in the normal page flow (never `position:
 * sticky`, it simply scrolls with everything else), placed after the
 * timeline, before the "GPX" action. Both panels start closed; at most one
 * is open at a time (`trips-manager.ts`'s own `toggle-bottom-panel`
 * handler enforces that — this function only renders the static markup).
 * `pausesHtml` is `renderPauseEditor`'s own output, completely unchanged —
 * every existing function (candidates, C3 hint, Enregistrer, Rétablir Auto)
 * stays exactly as it already is, just relocated into this panel. The
 * weather mount (`[data-day-detail-weather]`) keeps the exact same
 * attribute `mountWeatherViews` (`trips-manager.ts`) already queries by —
 * only its container/visibility changed, not the wiring.
 */
function renderPauseWeatherBottomBlock(pausesHtml: string): string {
  return `<div class="day-bottom-block" data-day-bottom-block>
    <div class="day-bottom-block__toggles">
      <button type="button" class="day-bottom-block__toggle" data-action="toggle-bottom-panel" aria-expanded="false" aria-controls="day-bottom-panel-pauses">Pauses</button>
      <button type="button" class="day-bottom-block__toggle" data-action="toggle-bottom-panel" aria-expanded="false" aria-controls="day-bottom-panel-weather">Météo</button>
    </div>
    <div id="day-bottom-panel-pauses" class="day-bottom-block__panel" data-bottom-panel hidden>
      ${pausesHtml}
    </div>
    <div id="day-bottom-panel-weather" class="day-bottom-block__panel" data-bottom-panel hidden>
      <div data-day-detail-weather><p role="status">Chargement des prévisions…</p></div>
    </div>
  </div>`
}

/**
 * Météo tab (CDC Jalon B4.2/B4.3 section 22/37-38, B4.4 section 27): an
 * honest placeholder only — the weather engine itself is out of scope for
 * this pass, never fake data. Identical placeholder for ride/OFF/transfer
 * days (CDC B4.4 section 27: "afficher le même placeholder propre") — a
 * future phase can key it off the OFF location or the transfer's origin/
 * destination, but never before the engine itself exists. R2.1 sections
 * 28-29: only ever used by the OFF/transfer shell now (a ride day's own
 * weather stays inline inside Parcours, `renderTimelineList`'s sibling
 * weather section) — always visible, direct in the page flow, no tab of
 * its own any more.
 */
function renderWeatherPanel(): string {
  return `<section id="day-panel-weather" class="card" data-day-panel="weather">
    <p class="eyebrow">Conditions</p><h3>Météo</h3>
    <div data-day-detail-weather><p role="status">Chargement des prévisions…</p></div>
  </section>`
}

/**
 * Read-only lodging display (CDC Jalon B4.3 section 35, RC2 final-closeout
 * sections 37/40/45-49) — name + address/réservation (plain text) + Maps/
 * site buttons, never a form. Nothing rendered at all when no lodging is
 * set, per section 35: no large empty block. The Maps action follows the
 * shared priority hierarchy (explicit URL > address > coordinates,
 * `maps-link.ts`) rather than only ever appearing when `mapsUrl` itself is
 * set — a lodging with just a text address still gets a working action
 * (section 49: never force the visitor to hand-craft a URL themselves).
 */
function renderLodgingReadView(accommodation: Accommodation | undefined): string {
  if (accommodation === undefined) return ''
  const mapsUrl = resolveMapsSearchUrl({
    explicitUrl: accommodation.mapsUrl,
    address: accommodation.address,
    coordinates: accommodation.latitude === null || accommodation.longitude === null ? null : { latitude: accommodation.latitude, longitude: accommodation.longitude },
  })
  const mapsLink = mapsUrl === null ? '' : `<a class="button button--primary" href="${escapeHtml(mapsUrl)}" target="_blank" rel="noopener">Ouvrir dans Maps</a>`
  // RC2 final-closeout section 46: two distinct URLs stay two distinct
  // actions, but the rare case where the same URL was pasted into both
  // fields collapses to the one Maps action, never a duplicate button.
  const websiteLink = accommodation.website === null || accommodation.website === mapsUrl
    ? ''
    : `<a class="button button--quiet" href="${escapeHtml(accommodation.website)}" target="_blank" rel="noopener">Voir le site</a>`
  const links = [mapsLink, websiteLink].join('')
  return `<div class="day-infos__lodging-display">
    <p class="eyebrow">Hébergement</p>
    ${accommodation.name === '' ? '' : `<h4>${escapeHtml(accommodation.name)}</h4>`}
    ${accommodation.address === null ? '' : `<p class="day-infos__lodging-detail">${escapeHtml(accommodation.address)}</p>`}
    ${accommodation.bookingReference === null ? '' : `<p class="day-infos__lodging-detail">Réservation : ${escapeHtml(accommodation.bookingReference)}</p>`}
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
/**
 * R2.1 section 36's `<select>`: the 7 fixed values, plus — only when the
 * currently-stored value isn't one of them (a legacy R2 free-text value,
 * e.g. "TGV") — one extra literal option so it stays selected and visible
 * rather than silently snapping away the moment this form re-renders.
 */
function renderTransferModeOptions(currentMode: string | undefined): string {
  const known = TRANSFER_MODES.map((code) => `<option value="${code}"${currentMode === code ? ' selected' : ''}>${TRANSFER_MODE_LABELS[code]}</option>`).join('')
  const isLegacyValue = currentMode !== undefined && currentMode.trim() !== '' && !(TRANSFER_MODES as readonly string[]).includes(currentMode)
  const legacyOption = isLegacyValue ? `<option value="${escapeHtml(currentMode as string)}" selected>${escapeHtml(currentMode as string)}</option>` : ''
  return `<option value=""${currentMode === undefined || currentMode === '' ? ' selected' : ''}>—</option>${known}${legacyOption}`
}

/**
 * Infos tab (CDC Jalon B4.3 sections 35-36, R2.1 sections 33-34/36-37):
 * read-only in normal consultation — free text and lodging shown as plain
 * content, a single "Modifier" button reveals one grouped edit form
 * (textarea + lodging fields together, plus a transfer's own mode/heures/
 * opérateur/lien when relevant) with one "Enregistrer" — never a form
 * directly in view, never a separate action per field. Deliberately never
 * lists climbs here — they belong to Parcours only (CDC hardening: never
 * duplicated between tabs).
 *
 * `infoDay` (R2.1 sections 33-34) is the day whose notes/lodging are shown
 * and edited here — the day itself for everything except an
 * `after_previous` transfer, which shares its previous day's own Infos
 * (`resolveSharedInfoDayId`); defaults to `day` when the caller has nothing
 * different to say. The transfer-specific fields (mode/heures/opérateur/
 * lien) always belong to `day` itself, never to `infoDay`, even when they
 * differ — a shared transfer still has its own journey.
 *
 * `resolvedLocation` (R2.1 sections 40-41) is the location(s) already
 * auto-resolved by `day-location-fill.ts` — shown only as each field's own
 * placeholder (never its `value`, so an empty field always reads as "using
 * the automatic one", exactly like every other auto-fill in this app), and
 * only ever a fallback: as soon as `startLocationName`/`endLocationName`
 * itself is non-null, `resolveOffLocation`/`resolveTransferLocations`
 * already prefer it outright — this field is simply what makes that
 * override reachable ("autoriser un libellé manuel" when nothing else can
 * resolve one).
 */
function renderInfosPanel(day: TripBundle['days'][number], accommodation: Accommodation | undefined, options: {
  readonly asTab?: boolean
  readonly infoDay?: TripBundle['days'][number]
  readonly resolvedLocation?: { readonly start: string | null; readonly end: string | null }
  /** DER-DES-DER section 75 — non-null makes that transfer side read-only, with this hint under it. */
  readonly originLinkHint?: string | null
  readonly destinationLinkHint?: string | null
} = {}): string {
  const infoDay = options.infoDay ?? day
  const isSharedInfo = infoDay.id !== day.id
  const hasNotes = infoDay.notes !== null && infoDay.notes.trim() !== ''
  // R2.1 section 32: a `before_next` transfer never carries its own
  // lodging — logically it belongs to the following ride day, not to the
  // journey between two places. Hidden outright rather than shown-but-
  // pointless, in both the read and edit views.
  const showLodging = !(day.type === 'transfer' && (day.transferTiming ?? 'dedicated') === 'before_next')
  const sharedInfoHint = isSharedInfo ? '<p class="day-infos__shared-hint">Infos partagées avec la journée précédente.</p>' : ''
  const readView = `<div class="day-infos__read" data-day-infos-read>
    ${sharedInfoHint}
    ${hasNotes ? `<p class="day-infos__notes-text">${escapeHtml(infoDay.notes as string).replaceAll('\n', '<br>')}</p>` : '<p class="day-infos__empty">Aucune note pour cette étape.</p>'}
    ${showLodging ? renderLodgingReadView(accommodation) : ''}
    <button class="button button--quiet" type="button" data-action="edit-day-infos">Modifier</button>
  </div>`

  // R2/R2.1 sections 2/36-37: a transfer's own mode/heures/opérateur/lien
  // are edited here, right next to notes — the same single edit surface as
  // lodging, never a second location (the D3.1 structural editor stays
  // structure-only, exactly like it already does for notes). The opérateur
  // field is hidden for "bike" (client-side reveal, see the `change`
  // listener in `trips-manager.ts` — a bike leg has no compagnie).
  const transferFields = day.type !== 'transfer' ? '' : `
    <div class="field"><label for="transfer-mode">Mode de transport</label><div class="field__control"><select id="transfer-mode" data-field="transfer-mode">${renderTransferModeOptions(day.transferMode)}</select></div></div>
    <div class="field field--inline">
      <label for="transfer-departure-time">Départ</label><div class="field__control field__time-control"><input id="transfer-departure-time" type="time" data-field="transfer-departure-time" value="${escapeHtml(day.transferDepartureTime ?? '')}"></div>
      <label for="transfer-arrival-time">Arrivée</label><div class="field__control field__time-control"><input id="transfer-arrival-time" type="time" data-field="transfer-arrival-time" value="${escapeHtml(day.transferArrivalTime ?? '')}"></div>
    </div>
    <div class="field" data-field-group="transfer-operator"${day.transferMode === 'bike' ? ' hidden' : ''}><label for="transfer-operator">Compagnie / opérateur</label><div class="field__control"><input id="transfer-operator" type="text" data-field="transfer-operator" value="${escapeHtml(day.transferOperator ?? '')}" placeholder="SNCF, FlixBus…"></div></div>
    <div class="field"><label for="transfer-link">Lien réservation</label><div class="field__control"><input id="transfer-link" type="url" data-field="transfer-link" value="${escapeHtml(day.transferLink ?? '')}" placeholder="https://…"></div></div>
    <div class="field"><label for="transfer-ticket-link">Lien billet</label><div class="field__control"><input id="transfer-ticket-link" type="url" data-field="transfer-ticket-link" value="${escapeHtml(day.transferTicketLink ?? '')}" placeholder="https://…"></div></div>`

  // R2.1 sections 40-41 / R3 sections 30-35: a manual location label — the
  // always-available fallback once neither a neighbouring stage nor a
  // coordinate override can resolve one — plus, per side, a "Choisir sur
  // la carte" trigger for the fuller coordinate override (never required;
  // the text field alone remains a complete, map-free path).
  // `startLocationName`/`endLocationName` are `day`'s own fields (never
  // `infoDay`'s), exactly like the transfer fields above.
  const resolvedLocation = options.resolvedLocation
  const pickerTrigger = (target: 'start' | 'end'): string =>
    `<button class="button button--quiet field__map-trigger" type="button" data-action="start-choose-location" data-target="${target}">Choisir sur la carte</button>`
  /**
   * DER-DES-DER section 75: a transfer endpoint that the trip's own
   * chronology already determines — a ride day's GPX endpoint, or the
   * previous transfer's destination — is shown as a plain read-only value
   * with a short hint, NOT as an input with a picker. It has exactly one
   * source of truth elsewhere, and offering to edit it here would let the
   * traveller fork that truth into two disagreeing values.
   */
  const linkedEndpoint = (label: string, value: string | null, hint: string): string =>
    `<label>${escapeHtml(label)}</label><div class="field__control"><p class="field__linked-value" data-linked-endpoint>${escapeHtml(value ?? '—')}</p><small class="field__linked-hint">${escapeHtml(hint)}</small></div>`
  const editableEndpoint = (id: 'location-start' | 'location-end', label: string, value: string | null, placeholder: string, target: 'start' | 'end'): string =>
    `<label for="${id}">${escapeHtml(label)}</label><div class="field__control"><input id="${id}" type="text" data-field="${id}" value="${escapeHtml(value ?? '')}" placeholder="${escapeHtml(placeholder)}"></div>${pickerTrigger(target)}`
  const locationFields = day.type === 'off'
    ? `<div class="field"><label for="location-start">Lieu</label><div class="field__control"><input id="location-start" type="text" data-field="location-start" value="${escapeHtml(day.startLocationName ?? '')}" placeholder="${escapeHtml(resolvedLocation?.start ?? 'Nom du lieu')}"></div>${pickerTrigger('start')}</div>`
    : day.type === 'transfer' ? `<div class="field field--inline">
      ${options.originLinkHint !== undefined && options.originLinkHint !== null
        ? linkedEndpoint('Origine', resolvedLocation?.start ?? null, options.originLinkHint)
        : editableEndpoint('location-start', 'Origine', day.startLocationName, resolvedLocation?.start ?? 'Origine', 'start')}
      ${options.destinationLinkHint !== undefined && options.destinationLinkHint !== null
        ? linkedEndpoint('Destination', resolvedLocation?.end ?? null, options.destinationLinkHint)
        : editableEndpoint('location-end', 'Destination', day.endLocationName, resolvedLocation?.end ?? 'Destination', 'end')}
    </div>` : ''
  // R3 sections 30-35: one shared picker block, reused for whichever side
  // was clicked (`data-location-picker`, target tracked purely client-side
  // — never baked into this static markup). Starts hidden; `trips-manager.ts`
  // reveals it and mounts a real, synchronous, always-interactive map
  // (`mountLocationPicker`) on `start-choose-location`.
  const locationPicker = day.type === 'off' || day.type === 'transfer' ? `<div class="location-picker" data-location-picker hidden>
    <p class="location-picker__hint">Touchez la carte pour choisir un point.</p>
    <div class="route-map route-map--picker" data-location-picker-map></div>
    <p class="route-map__fallback" data-location-picker-fallback hidden>Fond de carte indisponible. Vous pouvez tout de même toucher la carte pour choisir un point.</p>
    <div class="field"><label for="location-picker-label">Libellé</label><div class="field__control"><input id="location-picker-label" type="text" data-location-picker-label placeholder="Nom du lieu"></div></div>
    <div class="location-picker__actions">
      <button class="button button--primary" type="button" data-action="confirm-choose-location" disabled>Confirmer</button>
      <button class="button button--quiet" type="button" data-action="cancel-choose-location">Annuler</button>
    </div>
  </div>` : ''

  const editView = `<div class="day-infos__edit" data-day-infos-edit hidden>
    ${locationFields}
    ${locationPicker}
    ${transferFields}
    <div class="field"><label for="day-notes">Notes</label><div class="field__control"><textarea id="day-notes" data-field="day-notes" rows="5" placeholder="Conseils, description, logistique, choses à faire…">${escapeHtml(infoDay.notes ?? '')}</textarea></div></div>
    ${showLodging ? `
    <div class="field"><label for="lodging-name">Nom du logement</label><div class="field__control"><input id="lodging-name" type="text" data-field="lodging-name" value="${escapeHtml(accommodation?.name ?? '')}" placeholder="Hôtel, gîte, camping…"></div></div>
    <div class="field"><label for="lodging-address">Adresse</label><div class="field__control"><input id="lodging-address" type="text" data-field="lodging-address" value="${escapeHtml(accommodation?.address ?? '')}" placeholder="Adresse du logement"></div></div>
    <div class="field"><label for="lodging-maps-url">URL Maps</label><div class="field__control"><input id="lodging-maps-url" type="url" data-field="lodging-maps-url" value="${escapeHtml(accommodation?.mapsUrl ?? '')}" placeholder="https://maps.google.com/…"></div></div>
    <div class="field"><label for="lodging-website">URL du site</label><div class="field__control"><input id="lodging-website" type="url" data-field="lodging-website" value="${escapeHtml(accommodation?.website ?? '')}" placeholder="https://…"></div></div>
    <div class="field"><label for="lodging-booking-reference">Réservation (référence)</label><div class="field__control"><input id="lodging-booking-reference" type="text" data-field="lodging-booking-reference" value="${escapeHtml(accommodation?.bookingReference ?? '')}" placeholder="Numéro de réservation"></div></div>` : ''}
    <div class="day-infos__notes-actions">
      <button class="button button--primary" type="button" data-action="save-day-infos">Enregistrer</button>
      <button class="button button--quiet" type="button" data-action="cancel-edit-day-infos">Annuler</button>
      <span role="status" aria-live="polite" data-day-notes-status></span>
    </div>
  </div>`

  // R2.1 sections 28-29: OFF/transfer no longer wrap Infos in a tab at all
  // (`options.asTab: false`) — a plain, always-visible section, direct in
  // the page flow. Ride days are untouched (`asTab` defaults to `true`,
  // the existing Parcours/Infos tablist). `data-day-panel="infos"` stays on
  // the section either way — `patchInfosPanel`/`patchDaySummary`
  // (`trips-manager.ts`) target it by that attribute regardless of tab
  // membership.
  const asTab = options.asTab ?? true
  const sectionAttrs = asTab ? ' role="tabpanel" aria-labelledby="day-tab-infos" data-day-panel="infos" hidden' : ' data-day-panel="infos"'
  return `<section id="day-panel-infos" class="card"${sectionAttrs}>
    <h3>Infos</h3>
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
  readonly pausesHtml: string
  readonly timelineHtml: string
  readonly infosHtml: string
  /** R2 section 2: the OFF/transfer Résumé card (`[data-day-detail-summary]`) — empty for a ride day, which has no separate summary card of its own (its identity bandeau/stats already cover that ground). Lets a transfer's mode/heures edit (saved from Infos) patch just this one subtree instead of a full rebuild. */
  readonly summaryHtml: string
  /** CDC D1.1 sections 16-17 — the profile's distance→time mapping (`waypoint-timeline.ts::computeStageTimingCurve`), threaded through to `renderGenericElevationProfile`'s ETA band. `null` for OFF/transfer days (no profile at all) or an untimed ride stage. */
  readonly timingCurve: StageTimingCurve | null
  /** R2.1 sections 38/40-41 — an OFF/transfer day's own markers-only map (its resolved location, or the transfer's origin/destination pair), never a routed line (no GPX exists for a transfer). `null` for a ride day (its own `geometry`-driven model already covers that) or when nothing at all is resolvable. */
  readonly markersOnlyMapModel: RouteMapModel | null
  /** R3 sections 36-37 — the sticky identity header fragment (`[data-day-detail-identity]`), on its own so a location override (saved from Infos or the map picker) can patch just this subtree too, alongside `summaryHtml`/the map — never leaving the header stale until the screen is reopened. */
  readonly identityHtml: string
  /**
   * R3 sections 36-37 — an OFF/transfer day's own map card + dialog markup
   * (or `''` when nothing is resolvable at all yet), the exact content of
   * the always-present `[data-day-detail-map-slot]` wrapper. Lets a
   * location override that resolves a map for the FIRST time patch that
   * slot in directly — the map card's own presence in the DOM is otherwise
   * baked in only at the initial full render, so `mountMapAndProfile`
   * would silently no-op (no `[data-day-detail-map]` to find yet) without
   * this. Always `''` for a ride day (its own map is never conditional).
   */
  readonly mapCardHtml: string
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
  return buildRideDayDetail(bundle, day, options.preparationStatus ?? null)
}

/**
 * C2.5 sections 16-17 / R1 section 4: a compact, non-blocking banner —
 * partial/error data is shown, never hidden. Short, actionable, no technical
 * vocabulary (CDC R1: "pas de vocabulaire technique").
 *
 * DER-DES-DER sections 51-52: the "Réessayer" BUTTON is gone from here. It
 * used to exist in two places at once — this banner and the Voyage screen's
 * own stage card — which made the same action look like two different
 * features and put a network-triggering control on the screen the rider uses
 * in the field. There is now exactly ONE place to retry a stage: its card on
 * the Voyage screen. The Étape screen keeps the honest information ("what is
 * missing") and drops the action, pointing at where it lives instead.
 */
function renderPreparationBanner(preparationStatus: StagePreparationStatus | null): string {
  if (preparationStatus !== 'partial' && preparationStatus !== 'error') return ''
  const label = preparationStatus === 'partial' ? 'Certaines données pratiques manquent.' : 'Préparation incomplète.'
  return `<div class="day-detail__prep-banner" role="status"><span>${escapeHtml(label)} Vous pouvez relancer la préparation depuis la liste des étapes.</span></div>`
}

function transferTimingLabel(timing: TransferTiming | undefined): string {
  if (timing === 'after_previous') return 'Après l’étape précédente'
  if (timing === 'before_next') return 'Avant l’étape suivante'
  return 'Journée indépendante'
}

/**
 * R2.1 sections 38/40-41 — an OFF/transfer day's own markers-only map:
 * `resolveOffCoordinates`/`resolveTransferCoordinates` supply the exact
 * same coordinates "Choisir sur la carte" would also read/override, so this
 * is never a second, divergent resolution. Deliberately no `coordinates`
 * line at all (`createRouteMap` still fits the view to every marker's own
 * position) — a transfer's origin→destination gap is never drawn as a
 * fabricated straight line (no GPX exists for a transfer in v1).
 */
function buildOffOrTransferMapModel(bundle: TripBundle, day: TripDay): RouteMapModel | null {
  const markers: RouteMapMarkerModel[] = []
  if (day.type === 'off') {
    const location = resolveOffCoordinates(bundle, day)
    if (location !== null) markers.push({ id: `${day.id}-location`, category: 'start', name: resolveOffLocation(bundle, day).name ?? 'Lieu', coordinate: [location.latitude, location.longitude], offRoute: false, pauseActive: false })
  } else if (day.type === 'transfer') {
    const { origin, destination } = resolveTransferCoordinates(bundle, day)
    const { origin: originName, destination: destinationName } = resolveTransferLocations(bundle, day)
    if (origin !== null) markers.push({ id: `${day.id}-origin`, category: 'start', name: originName ?? 'Origine', coordinate: [origin.latitude, origin.longitude], offRoute: false, pauseActive: false })
    if (destination !== null) markers.push({ id: `${day.id}-destination`, category: 'finish', name: destinationName ?? 'Destination', coordinate: [destination.latitude, destination.longitude], offRoute: false, pauseActive: false })
  }
  return markers.length === 0 ? null : { coordinates: [], markers }
}

/**
 * The lighter OFF/transfer shell (CDC Jalon B4.4 section 24): a Résumé card
 * (day type + known location(s), no cycling stats), Météo (placeholder),
 * Infos — never a fake map/profile/Parcours for a day with no GPX/route at
 * all. Shares the same sticky header + tablist chrome as the ride shell so
 * "Précédent/Suivant" lands on a screen that looks and behaves the same way.
 */
function buildOffOrTransferDayDetail(bundle: TripBundle, day: TripDay): DayDetail {
  const typeLabel = day.type === 'off' ? 'Journée OFF' : 'Transfert'
  const stageLabel = `J${day.displayNumber} — ${typeLabel}`
  // The identity bandeau's right side reuses the same canonical resolvers
  // the Voyage day card and Aperçu's highlighted-day card already go
  // through (`day-location-fill.ts`) — never a second, divergent resolution
  // (CDC D1.2 section 29: only what's necessary for identity consistency).
  // A short type badge ("OFF"/"Transfert") stays prefixed — the ride
  // bandeau needs none (départ → arrivée alone is unambiguous), but OFF/
  // transfer's own type is exactly what a bare location can't convey.
  const badgeLabel = day.type === 'off' ? 'OFF' : 'Transfert'
  const transferLocations = day.type === 'transfer' ? resolveTransferLocations(bundle, day) : null
  const resolvedLocation = transferLocations === null
    ? { start: resolveOffLocation(bundle, day).name, end: null }
    : { start: transferLocations.origin, end: transferLocations.destination }
  const fullLocationLabel = day.type === 'off'
    ? resolvedLocation.start ?? '—'
    : resolvedLocation.start === null && resolvedLocation.end === null ? '—' : `${resolvedLocation.start ?? '—'} → ${resolvedLocation.end ?? '—'}`
  const fullMainLabel = `${badgeLabel} — ${fullLocationLabel}`
  const mainLabel = `${escapeHtml(badgeLabel)} — ${escapeHtml(compactPlaceName(fullLocationLabel))}`

  const summaryHtml = day.type === 'off' ? renderOffSummary(bundle, day) : renderTransferSummary(bundle, day)
  // R2.1 sections 33-34: an `after_previous` transfer shows/edits the
  // previous day's own notes/lodging, not a second, empty copy of its own.
  const infoDayId = resolveSharedInfoDayId(bundle, day)
  const infoDay = bundle.days.find((candidate) => candidate.id === infoDayId) ?? day
  const accommodation = infoDay.accommodationId === null ? undefined : bundle.accommodations.find((candidate) => candidate.id === infoDay.accommodationId)
  const infosHtml = renderInfosPanel(day, accommodation, {
    asTab: false, infoDay, resolvedLocation,
    // Section 75: a linked side is displayed, not edited.
    originLinkHint: transferLocations?.originLinkHint ?? null,
    destinationLinkHint: transferLocations?.destinationLinkHint ?? null,
  })
  const markersOnlyMapModel = buildOffOrTransferMapModel(bundle, day)
  // R2.1 sections 38/40-41: the map card only appears at all once at least
  // one location is resolvable — never an empty map frame with nothing to
  // show (`mountMapAndProfile`, `trips-manager.ts`, mounts into it once
  // `markersOnlyMapModel` is non-null; same container/dialog attributes as
  // the ride shell's own map, so the shared Leaflet wiring needs no branch).
  const mapHtml = markersOnlyMapModel === null ? '' : `<section class="card day-detail__map-profile-card" data-day-detail-map-profile-card>
      <div class="route-map route-map--action" data-day-detail-map data-explore-map role="button" tabindex="0" aria-label="Ouvrir la carte en plein écran"></div>
    </section>
    <dialog class="route-map-dialog" data-day-detail-map-dialog aria-labelledby="day-detail-expanded-map-title">
      <header><h2 id="day-detail-expanded-map-title">Carte</h2><div class="route-map-dialog__actions"><button class="button button--quiet" type="button" data-close-map>Fermer</button></div></header>
      <div class="route-map-dialog__map-wrap"><div class="route-map route-map--expanded" data-route-map-expanded></div><p class="route-map__fallback route-map__fallback--expanded" data-expanded-route-map-fallback hidden>Fond de carte indisponible.</p></div>
    </dialog>`

  // R2.1 sections 28-29: no tablist for OFF/transfer any more — Résumé,
  // Météo and Infos all render directly, at the top level, in that fixed
  // order (never a Parcours/profil/montées section — this day has none).
  const identityHtml = renderDayIdentityHeader(day, mainLabel, fullMainLabel)
  const html = `<div class="day-detail" data-day-detail>
    <div class="day-detail__sticky-header" data-day-detail-sticky-header>
      ${identityHtml}
    </div>
    ${summaryHtml}
    <div data-day-detail-map-slot>${mapHtml}</div>
    ${renderWeatherPanel()}
    ${infosHtml}
    <nav class="day-detail__floating-nav" aria-label="Journées voisines"><button class="button button--quiet" type="button" data-action="previous-day" aria-label="Journée précédente">‹</button><button class="button button--quiet" type="button" data-action="next-day" aria-label="Journée suivante">›</button></nav>
  </div>`

  return {
    html, waypoints: [], geometry: null, stageLabel, villageWaypoints: [], sourceFileId: null,
    statsHtml: '', pausesHtml: '', timelineHtml: '', infosHtml, summaryHtml, timingCurve: null, markersOnlyMapModel, identityHtml, mapCardHtml: mapHtml,
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

/**
 * Transfer Résumé (CDC Jalon B4.4 sections 22/24) — origin → destination,
 * plus the transfer's own moment when it isn't the default "journée dédiée"
 * (CDC section 22's `transferTiming`, edited from the trip editor). R2
 * section 2: mode/heures (edited from Infos, never fabricated) show as one
 * extra compact line, plus a derived duration line only when both times are
 * present and consistent — never a third stored field.
 */
function renderTransferSummary(bundle: TripBundle, day: TripDay): string {
  const { origin, destination } = resolveTransferLocations(bundle, day)
  const route = origin === null && destination === null ? 'Origine/destination inconnues.' : `${escapeHtml(origin ?? '—')} → ${escapeHtml(destination ?? '—')}`
  const modeAndTimes = formatTransferModeAndTimes(day)
  const duration = formatTransferDuration(day)
  // R3 sections 18-21 / RC2 final-closeout sections 39/45: opérateur stays
  // plain text (no action of its own); a configured reservation link is an
  // evident action and must be directly reachable here — this fixes the
  // real gap the CDC names outright ("un champ Lien de réservation peut
  // être configuré mais ne pas apparaître dans Détail"). RC2 adds the two
  // remaining TRAJET actions the same section lists: Billet (its own,
  // independent link — `transferTicketLink`) and Itinéraire (a generic,
  // mode-agnostic directions link built from the resolved origin/
  // destination coordinates, `maps-link.ts` — never forced into cycling
  // directions like a POI popup). Priority order matches section 45:
  // Réservation, Billet, Itinéraire. Each is entirely independent — any
  // subset may be configured/resolvable, never a fabricated placeholder.
  const operator = day.transferOperator ?? null
  const reservationLink = day.transferLink ?? null
  const ticketLink = day.transferTicketLink ?? null
  const { origin: originCoordinates, destination: destinationCoordinates } = resolveTransferCoordinates(bundle, day)
  // DER-DES-DER sections 98-101: real coordinates on both ends, plus the
  // Google Maps travel mode implied by THIS day's current `transferMode` —
  // rebuilt on every render, so switching Train → Voiture immediately gives
  // a driving itinerary rather than a stored, now-wrong link.
  const directionsUrl = resolveMapsDirectionsUrl(
    originCoordinates === null ? null : { latitude: originCoordinates.latitude, longitude: originCoordinates.longitude },
    destinationCoordinates === null ? null : { latitude: destinationCoordinates.latitude, longitude: destinationCoordinates.longitude },
    day.transferMode ?? null,
  )
  const actions = [
    reservationLink === null ? '' : `<a class="button button--quiet" href="${escapeHtml(reservationLink)}" target="_blank" rel="noopener">Réservation</a>`,
    ticketLink === null ? '' : `<a class="button button--quiet" href="${escapeHtml(ticketLink)}" target="_blank" rel="noopener">Billet</a>`,
    directionsUrl === null ? '' : `<a class="button button--quiet" href="${escapeHtml(directionsUrl)}" target="_blank" rel="noopener">Itinéraire</a>`,
  ].join('')
  return `<section class="card day-detail__summary" data-day-detail-summary>
    <p class="eyebrow">Résumé</p>
    <p>${route}</p>
    <p class="day-detail__summary-timing">${escapeHtml(transferTimingLabel(day.transferTiming))}</p>
    ${modeAndTimes === null ? '' : `<p class="day-detail__summary-transfer">${escapeHtml(modeAndTimes)}</p>`}
    ${duration === null ? '' : `<p class="day-detail__summary-transfer">${escapeHtml(duration)}</p>`}
    ${operator === null ? '' : `<p class="day-detail__summary-transfer">${escapeHtml(operator)}</p>`}
    ${actions === '' ? '' : `<p class="day-detail__summary-actions">${actions}</p>`}
  </section>`
}

/**
 * CDC C3 sections 8/20-21/26: projects this stage's own already-persisted
 * POI (C2 Postpass, `bundle.practicalPlaces`) and weather
 * (`bundle.weather`) into the small, engine-owned shapes
 * `analysis/pause-recommendation.ts` accepts — never a network call, never
 * a second `opening_hours`/weather parser. `null` fields on the source data
 * simply fall through as `null`/`undefined`, letting the engine skip that
 * one signal rather than fabricating a default.
 */
function buildAutomaticPauseEnrichment(bundle: TripBundle, stage: TripBundle['stages'][number], day: TripDay): AutomaticPauseEnrichmentInput {
  const places: PauseCandidatePlace[] = bundle.practicalPlaces.flatMap((place) => {
    if (place.stageId !== stage.id || place.trackDistanceKm === null || !isPracticalPlaceUxCategory(place.category)) return []
    return [{ id: place.id, category: place.category, name: place.name, trackDistanceKm: place.trackDistanceKm, detourKm: place.detourKm ?? 0, openingHours: place.openingHours }]
  })
  const weatherRecord = bundle.weather.find((record) => record.dayId === day.id)
  const weather = weatherRecord === undefined ? undefined : {
    precipitationMm: weatherRecord.precipitationMm, windSpeedKph: weatherRecord.windSpeedKph, temperatureMaxC: weatherRecord.temperatureMaxC,
  }
  const weekdayAtDeparture = day.date === null ? undefined : new Date(`${day.date}T12:00:00Z`).getUTCDay()
  return { practicalPlaces: places, weather, weekdayAtDeparture }
}

function buildRideDayDetail(bundle: TripBundle, day: TripBundle['days'][number], preparationStatus: StagePreparationStatus | null): DayDetail | null {
  if (day.stageId === null) return null
  const stage = bundle.stages.find((candidate) => candidate.id === day.stageId)
  if (stage === undefined) return null
  const route = bundle.routes.find((candidate) => candidate.id === stage.sourceRouteId)
  if (route === undefined) return null
  const geometry = routeGeometry(route)

  const daySettings = bundle.settings.days.find((candidate) => candidate.dayId === day.id)
  const settings = { referenceSpeedKph: bundle.settings.global.referenceSpeedKph, departureTime: daySettings?.departureTime ?? '08:00' }
  const stageSettings = bundle.settings.stages.find((candidate) => candidate.stageId === stage.id)
  const pauseResolution = resolveStagePauseSettings(bundle.settings.global.pausePlanMode, stageSettings)
  // CDC C3 section 26: ignored internally whenever `manualPauses` is set
  // (custom mode) — building it unconditionally here is harmless and keeps
  // this call site simple; C3 never touches a saved manual pause either way.
  const automaticPauseEnrichment = buildAutomaticPauseEnrichment(bundle, stage, day)
  const waypointsInput = {
    stage, route, routePoints: bundle.routePoints, climbs: bundle.climbs, settings,
    manualPauses: pauseResolution.mode === 'custom' ? pauseResolution.manualPauses : undefined,
    mountainMode: resolveEffectiveMountainMode(bundle),
    automaticPauseEnrichment,
  }
  const waypoints = computeStageWaypoints(waypointsInput)
  const pauseRecommendations = buildPauseRecommendationViewModels(computeStagePauseRecommendations(waypointsInput), waypoints)
  const anchorCandidates = waypoints.filter((waypoint) => PAUSE_ANCHOR_KINDS.has(waypoint.kind))
  // R2.1 sections 9-10: opening status per candidate — reuses the exact
  // same merged POI-per-anchor data C3's own scoring already computes
  // (`buildPauseCandidates`), never a second, divergent association. Only
  // ever computed when the day's weekday is actually known (an undated
  // trip has nothing reliable to evaluate against — never guessed at).
  const openingStatusByCandidateId = new Map<string, CandidateOpeningStatusViewModel>()
  if (automaticPauseEnrichment.weekdayAtDeparture !== undefined) {
    const mergedCandidates = buildPauseCandidates(waypoints, automaticPauseEnrichment.practicalPlaces ?? [])
    for (const candidate of anchorCandidates) {
      if (candidate.clockTime === null) continue
      const merged = mergedCandidates.find((entry) => entry.waypointId === candidate.id)
      const place = merged?.places.find((entry) => entry.openingHours !== null)
      if (place === undefined) continue
      const status = computeCandidateOpeningStatus(place.openingHours, automaticPauseEnrichment.weekdayAtDeparture, parseClockToMinutes(candidate.clockTime))
      if (status !== null) openingStatusByCandidateId.set(candidate.id, status)
    }
  }

  const fullLocations = `${stage.startLocationName ?? '—'} → ${stage.endLocationName ?? '—'}`
  const locations = `${escapeHtml(compactPlaceName(stage.startLocationName ?? '—'))} → ${escapeHtml(compactPlaceName(stage.endLocationName ?? '—'))}`
  const stageLabel = `J${day.displayNumber} — ${stage.startLocationName ?? '—'} → ${stage.endLocationName ?? '—'}`

  const arrival = waypoints.length === 0 ? null : waypoints[waypoints.length - 1]
  const totalDurationSeconds = arrival?.elapsedMinutes === null || arrival?.elapsedMinutes === undefined
    ? stage.totalDurationSeconds
    : Math.round(arrival.elapsedMinutes * 60)
  const primaryClimbCount = new Set(
    waypoints.filter((waypoint) => waypoint.climbId !== null && isSignificantWaypoint(waypoint)).map((waypoint) => waypoint.climbId),
  ).size
  // In manual mode, the displayed total reflects the actually-placed pauses
  // (which the user controls directly) rather than the imported automatic
  // budget estimate — the two only ever match by coincidence once edited.
  // RC2 final-closeout section 29: re-normalized to the nearest 5-minute
  // step at display time too — a no-op for every value this app itself ever
  // produces (already a multiple of 5), but never shows a stray raw value
  // (e.g. 42) for a legacy/imported `pauseDurationSeconds` that predates
  // that rule.
  const totalPauseMinutes = pauseResolution.mode === 'custom'
    ? waypoints.reduce((total, waypoint) => total + (waypoint.pauseDurationMinutes ?? 0), 0)
    : stage.pauseDurationSeconds === null ? null : normalizePauseDurationMinutes(Math.round(stage.pauseDurationSeconds / 60))
  // CDC D1.2 section 11: the Départ cell is itself the editing surface — no
  // more separate "Modifier" trigger opening a second block below. Both the
  // plain display button and the (initially hidden) `<input type="time">`
  // are always rendered side by side — a pure `hidden` toggle between them
  // (`trips-manager.ts`'s `edit-day-departure-time` handler), exactly like
  // `renderInfosPanel`'s own read/edit split, never a dynamically created
  // element. The fresh `statsHtml` this function produces after a save
  // always has the input hidden again, so a completed edit naturally
  // collapses back — never a second, separately-tracked "editor open" state
  // to reset.
  const statsHtml = `<dl class="day-detail__stats" data-day-detail-stats>
    <div><dt>Départ</dt><dd>
      <button type="button" class="day-detail__departure-value" data-action="edit-day-departure-time" data-day-departure-value aria-label="Heure de départ ${escapeHtml(settings.departureTime)}, modifier">${escapeHtml(settings.departureTime)}</button>
      <input type="time" class="day-detail__departure-input" data-day-departure-input value="${escapeHtml(settings.departureTime)}" required hidden>
    </dd></div>
    <div><dt>Arrivée estimée</dt><dd>${arrival?.clockTime ?? '—'}</dd></div>
    <div><dt>Distance</dt><dd>${stage.distanceKm === null ? '—' : formatKilometers(stage.distanceKm)}</dd></div>
    <div><dt>Durée</dt><dd>${formatDuration(totalDurationSeconds)}</dd></div>
    <div><dt>D+</dt><dd>${stage.elevationGainM === null ? '—' : `+${Math.round(stage.elevationGainM)} m`}</dd></div>
    <div><dt>D−</dt><dd>${stage.elevationLossM === null ? '—' : `−${Math.round(stage.elevationLossM)} m`}</dd></div>
    <div><dt>Montées</dt><dd>${primaryClimbCount}</dd></div>
    <div><dt>Pauses</dt><dd>${totalPauseMinutes === null ? '—' : `${totalPauseMinutes} min`}</dd></div>
  </dl>`

  const pausesHtml = renderPauseEditor(stage.id, pauseResolution, stageSettings, anchorCandidates, pauseRecommendations, openingStatusByCandidateId)
  const timelineHtml = renderTimelineList(waypoints, bundle.climbs, geometry)
  const accommodation = day.accommodationId === null ? undefined : bundle.accommodations.find((candidate) => candidate.id === day.accommodationId)
  const infosHtml = renderInfosPanel(day, accommodation)
  const timingCurve = computeStageTimingCurve(waypointsInput)

  // CDC D1.1 sections 6-10: three independent blocks, always all three
  // visible regardless of the selected tab — Stats, Map+Profil, and the
  // tabbed Détails card (Parcours|Infos, météo opérationnelle folded into
  // Parcours, section 11). The sticky header now carries ONLY the identity
  // — the tabbar moved into the Détails card itself and sticks contextually
  // there (`--day-sticky-header-h`, `sticky-header-offset.ts`), not from the
  // very top of the screen (section 10).
  const identityHtml = renderDayIdentityHeader(day, locations, fullLocations)
  const html = `<div class="day-detail" data-day-detail>
    <div class="day-detail__sticky-header" data-day-detail-sticky-header>
      ${identityHtml}
    </div>
    <section class="card day-detail__stats-card" data-day-detail-stats-card>
      ${statsHtml}
      ${renderPreparationBanner(preparationStatus)}
    </section>
    <section class="card day-detail__map-profile-card" data-day-detail-map-profile-card>
      <div class="route-map route-map--action" data-day-detail-map data-explore-map role="button" tabindex="0" aria-label="Ouvrir la carte de l’étape en plein écran"></div>
      <div data-day-detail-profile></div>
      <!--
        DER-DES-DER sections 105-107: the GPX download belongs visually with
        the trace it downloads. It used to sit at the bottom of the Parcours
        tab, several sections away from the map and relief profile it
        actually corresponds to — and invisible entirely while the Infos tab
        was selected. Same button, same behaviour (the stored original file,
        still available offline), full width at the foot of this block.
      -->
      <button class="button button--quiet button--full" type="button" data-action="download-stage-gpx">GPX</button>
    </section>
    <dialog class="route-map-dialog" data-day-detail-map-dialog aria-labelledby="day-detail-expanded-map-title">
      <header><h2 id="day-detail-expanded-map-title">Carte de l’étape</h2><div class="route-map-dialog__actions"><button class="button button--quiet" type="button" data-action="locate-me" aria-label="Me localiser">📍</button><button class="button button--quiet" type="button" data-map-layers-toggle aria-expanded="false" aria-controls="day-detail-map-layers-panel" hidden>Calques</button><button class="button button--quiet" type="button" data-close-map>Fermer</button></div></header>
      <div class="route-map-dialog__map-wrap"><div class="route-map route-map--expanded" data-route-map-expanded></div><p class="route-map__fallback route-map__fallback--expanded" data-expanded-route-map-fallback hidden>Fond de carte indisponible. Le tracé reste accessible dans le profil.</p><button class="practical-layers-backdrop" type="button" data-map-layers-backdrop aria-label="Fermer les calques" tabindex="-1" hidden></button><section class="practical-layers-panel" id="day-detail-map-layers-panel" data-map-layers-panel role="dialog" aria-labelledby="day-detail-map-layers-title" hidden><header><div><h3 id="day-detail-map-layers-title">Calques</h3><p class="practical-layers-panel__note">Points principaux toujours visibles</p></div><button class="button button--quiet" type="button" data-map-layers-close>Fermer</button></header><div class="practical-layers-list" data-map-layers-list></div></section></div>
    </dialog>
    <div data-day-detail-weather-alerts></div>
    <section class="card day-detail__details-card" data-day-detail-details-card>
      <nav class="day-tabs" role="tablist" aria-label="Sections de l’étape" data-day-detail-tabs>
        <button id="day-tab-route" type="button" role="tab" data-day-tab="route" aria-controls="day-panel-route" aria-selected="true" tabindex="0">Parcours</button>
        <button id="day-tab-infos" type="button" role="tab" data-day-tab="infos" aria-controls="day-panel-infos" aria-selected="false" tabindex="-1">Infos</button>
      </nav>
      <section id="day-panel-route" class="card" role="tabpanel" aria-labelledby="day-tab-route" data-day-panel="route">
        <div data-day-detail-timeline>${timelineHtml}</div>
        ${renderPauseWeatherBottomBlock(pausesHtml)}
      </section>
      ${infosHtml}
    </section>
    <nav class="day-detail__floating-nav" aria-label="Journées voisines"><button class="button button--quiet" type="button" data-action="previous-day" aria-label="Journée précédente">‹</button><button class="button button--quiet" type="button" data-action="next-day" aria-label="Journée suivante">›</button></nav>
  </div>`

  return {
    html, waypoints, geometry, stageLabel,
    villageWaypoints: waypoints.filter((waypoint) => waypoint.kind === 'village'),
    sourceFileId: route.sourceFileId,
    statsHtml, pausesHtml, timelineHtml, infosHtml, summaryHtml: '', timingCurve, markersOnlyMapModel: null, identityHtml, mapCardHtml: '',
  }
}
