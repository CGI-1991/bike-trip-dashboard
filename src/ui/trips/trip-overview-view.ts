/**
 * "Aperçu" screen (CDC Jalon B4.3 sections 5-8): title → trip progress
 * stats → general trip map → highlighted day card, in that order (the day
 * card is no longer first). Built from the active `TripBundle` only — never
 * RGA-hardcoded. Only produces the map containers' markup; the caller
 * (`trips-manager.ts`) wires the actual Leaflet maps into them, exactly
 * like `day-detail-view.ts`.
 */

import { computeStageWaypoints, resolveStagePauseSettings } from '../../analysis/waypoint-timeline.ts'
import { resolveEffectiveMountainMode } from '../../analysis/terrain-context.ts'
import type { LatLngTuple } from '../route-map-model.ts'
import { routeGeometry } from '../../route-enrichment/route-fingerprint.ts'
import { isSignificantWaypoint } from '../../analysis/canonical-waypoints.ts'
import type { CanonicalWaypoint } from '../../analysis/canonical-waypoints.ts'
import { resolveOffLocation, resolveTransferLocations } from '../../analysis/day-location-fill.ts'
import { formatTransferModeAndTimes } from './transfer-summary-format.ts'
import { deriveTripTemporalState, getTripDayTemporalState } from '../../trips-manager/trip-day-temporal-state.ts'
import { formatSimpleDate } from '../date-format.ts'
import type { TripBundle, TripDayId } from '../../trip-core/index.ts'

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function formatKilometers(value: number): string {
  return `${value.toFixed(1).replace('.', ',')} km`
}

/**
 * Kinds the Aperçu global map's "Détail" toggle reveals (CDC D1.2 section 6:
 * "avec Détail actif, la carte peut montrer: tracé, départ général, arrivée
 * générale, étapes, pauses, cols nommés — RIEN D'AUTRE"). Deliberately
 * narrower than D1's own `isSignificantWaypoint` (which also lets through
 * bare, possibly-unnamed climbs, "Montée" in this app's own vocabulary,
 * never "Col") — an auto-detected city/town/village is EXCLUDED here even
 * though it would otherwise count as significant elsewhere, and this
 * exclusion must hold durably against any future POI layer (section 6: "les
 * futurs POI C2 ne devront JAMAIS apparaître sur la carte Aperçu"). A pause
 * is checked first, unconditionally — the same absolute-priority rule
 * `isSignificantWaypoint` itself uses — since it can be anchored on any
 * kind of point (`day-detail-view.ts::PAUSE_ANCHOR_KINDS`) or stand alone
 * as a synthetic waypoint.
 */
function isOverviewDetailWaypoint(waypoint: CanonicalWaypoint): boolean {
  if (waypoint.pauseDurationMinutes !== null) return true
  return waypoint.kind === 'mountain-pass' || waypoint.kind === 'saddle'
}

/**
 * Which day to highlight, given `today` (CDC section 9). Returns `null`
 * only when the trip is undated, or when `today` is strictly after every
 * day's date (the "after the trip" case) — a calendar gap during the trip
 * falls forward to the next future day rather than showing nothing.
 */
export function computeHighlightedDayId(bundle: TripBundle, now: Date | string | null): TripDayId | null {
  return deriveTripTemporalState(bundle, now).priorityDayId
}

export interface TripOverviewMapStage {
  readonly waypoints: readonly CanonicalWaypoint[]
  readonly geometry: readonly LatLngTuple[]
}

export interface TripOverview {
  readonly html: string
  readonly mapStages: readonly TripOverviewMapStage[]
  /** Significant intermediate waypoints only, per stage, same indexing as `mapStages` (CDC D1.1 section 3) — the Aperçu global map's fullscreen-only "Détail" layer, never merged into the always-visible base model. */
  readonly mapDetailStages: readonly TripOverviewMapStage[]
  readonly highlightedDayId: TripDayId | null
  /** The highlighted day's own compact map (CDC Jalon B4.3 section 8) — `null` when there is no highlighted ride day, or its route has no usable geometry. */
  readonly highlightedDayMap: TripOverviewMapStage | null
}

interface TripProgress {
  readonly distanceTotalKm: number
  readonly distanceDoneKm: number
  readonly distanceRemainingKm: number
  readonly elevationGainTotalM: number
  readonly elevationGainDoneM: number
  readonly elevationGainRemainingM: number
  readonly ridesCompleted: number
  readonly daysRemaining: number
}

/**
 * Trip-wide progress (CDC Jalon B4.3 section 6, the 12-metric grid) — a ride
 * day counts as "done" once its calendar date is strictly before `todayIso`;
 * an undated trip (or a `todayIso` of `null`) has nothing done yet, same as
 * "before the trip starts". Every value comes from `TripBundle`/`bundle.stages`
 * directly — never a second, UI-only total.
 */
function computeTripProgress(bundle: TripBundle, now: Date | string | null): TripProgress {
  const temporal = deriveTripTemporalState(bundle, now)
  const stagesByDayId = new Map(bundle.stages.map((stage) => [stage.dayId, stage]))
  const rideDays = bundle.days.filter((day) => day.type === 'ride')
  let distanceTotalKm = 0
  let distanceDoneKm = 0
  let elevationGainTotalM = 0
  let elevationGainDoneM = 0
  let ridesCompleted = 0

  for (const day of rideDays) {
    const stage = stagesByDayId.get(day.id)
    if (stage === undefined) continue
    distanceTotalKm += stage.distanceKm ?? 0
    elevationGainTotalM += stage.elevationGainM ?? 0
    const done = getTripDayTemporalState(temporal, day.id)?.completed ?? false
    if (done) {
      ridesCompleted++
      distanceDoneKm += stage.distanceKm ?? 0
      elevationGainDoneM += stage.elevationGainM ?? 0
    }
  }

  return {
    distanceTotalKm, distanceDoneKm, distanceRemainingKm: distanceTotalKm - distanceDoneKm,
    elevationGainTotalM, elevationGainDoneM, elevationGainRemainingM: elevationGainTotalM - elevationGainDoneM,
    ridesCompleted,
    daysRemaining: temporal.days.filter((day) => !day.completed).length,
  }
}

/** The six field-facing D1 metrics, in the requested order. */
function renderProgressStats(progress: TripProgress): string {
  const rows: ReadonlyArray<readonly [string, string]> = [
    ['Distance totale', formatKilometers(progress.distanceTotalKm)],
    ['Distance restante', formatKilometers(progress.distanceRemainingKm)],
    ['D+ total', `${Math.round(progress.elevationGainTotalM)} m`],
    ['D+ restant', `${Math.round(progress.elevationGainRemainingM)} m`],
    ['Étapes terminées', String(progress.ridesCompleted)],
    ['Journées restantes', String(progress.daysRemaining)],
  ]
  const cells = rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')
  return `<section class="card trip-overview__progress" data-trip-overview-progress>
    <p class="eyebrow">Progression du voyage</p>
    <dl class="trip-overview__progress-grid">${cells}</dl>
  </section>`
}

function renderHighlightedDay(bundle: TripBundle, highlightedDayId: TripDayId | null, now: Date | string | null, zoneLabel: string): string {
  if (highlightedDayId === null) return ''
  const day = bundle.days.find((candidate) => candidate.id === highlightedDayId)
  if (day === undefined) return ''
  const dateLabel = day.date === null ? null : formatSimpleDate(day.date)

  if (day.type !== 'ride') {
    const typeLabel = day.type === 'off' ? 'OFF' : 'Transfert'
    // Bug 5-9 closeout: this used to read `day.startLocationName`/
    // `endLocationName` directly, bypassing `resolveOffLocation`/
    // `resolveTransferLocations` entirely — the same OFF/transfer day could
    // then show a different (stale) location here than on the Voyage card
    // or the Journée detail shell, both of which already went through the
    // resolver. Single canonical source now, like every other consumer.
    const known = day.type === 'off'
      ? (() => {
          const location = resolveOffLocation(bundle, day)
          return escapeHtml(location.name ?? '—')
        })()
      : (() => {
          const { origin, destination } = resolveTransferLocations(bundle, day)
          return origin !== null && origin === destination ? escapeHtml(origin) : `${escapeHtml(origin ?? '—')} → ${escapeHtml(destination ?? '—')}`
        })()
    const headerParts = [`J${day.displayNumber}`, typeLabel, dateLabel].filter((part): part is string => part !== null)
    // R2 section 12: same compact mode/heures line as the Voyage card —
    // only when actually filled in, never fabricated.
    const modeAndTimes = day.type === 'transfer' ? formatTransferModeAndTimes(day) : null
    // CDC Jalon B4.4 sections 23/35: OFF/transfer days now have their own
    // Journée shell to open (`day-detail-view.ts`) — the highlighted card
    // here is a real navigation target too, exactly like a ride day's,
    // never left as a dead end just because it isn't a ride.
    return `<article class="trip-overview__highlighted-day card" data-action="open-day-detail" data-day-id="${escapeHtml(day.id)}" role="button" tabindex="0"><p class="eyebrow trip-overview__zone-eyebrow">${escapeHtml(zoneLabel)}</p><h3>${headerParts.join(' — ')}</h3><p>${known}</p>${modeAndTimes === null ? '' : `<p class="trip-overview__highlighted-day-transfer">${escapeHtml(modeAndTimes)}</p>`}</article>`
  }

  const stage = bundle.stages.find((candidate) => candidate.id === day.stageId)
  const locations = `${escapeHtml(stage?.startLocationName ?? '—')} → ${escapeHtml(stage?.endLocationName ?? '—')}`
  const headerParts = [`J${day.displayNumber}`, locations].filter((part): part is string => part !== null)
  const daySettings = bundle.settings.days.find((candidate) => candidate.dayId === day.id)
  const departureTime = daySettings?.departureTime ?? null
  const eta = getTripDayTemporalState(deriveTripTemporalState(bundle, now), day.id)?.arrivalEta?.label ?? null

  // CDC section 4: the whole card navigates to the Étape — no separate
  // "Voir l'étape" button when the card itself already carries the action.
  // The embedded map is non-interactive (no pan/zoom to steal the click),
  // so wrapping it is safe (CDC section 4: "les boutons internes ne
  // doivent pas déclencher aussi la navigation" — there are none here).
  return `<article class="trip-overview__highlighted-day card" data-action="open-day-detail" data-day-id="${escapeHtml(day.id)}" role="button" tabindex="0">
    <p class="eyebrow trip-overview__zone-eyebrow">${escapeHtml(zoneLabel)}</p><h3>${headerParts.join(' — ')}</h3>
    <div class="route-map route-map--compact" data-trip-overview-day-map></div>
    <dl class="trip-overview__highlighted-day-stats">
      <div><dt>Distance</dt><dd>${stage?.distanceKm === null || stage?.distanceKm === undefined ? '—' : formatKilometers(stage.distanceKm)}</dd></div>
      <div><dt>D+</dt><dd>${stage?.elevationGainM === null || stage?.elevationGainM === undefined ? '—' : `+${Math.round(stage.elevationGainM)} m`}</dd></div>
      <div><dt>Départ</dt><dd>${departureTime ?? '—'}</dd></div>
      <div><dt>ETA</dt><dd>${eta ?? '—'}</dd></div>
    </dl>
    <div class="trip-overview__weather-mount" data-trip-overview-weather-mount data-day-id="${escapeHtml(day.id)}"><p class="trip-overview__weather-placeholder">Météo non disponible pour le moment.</p></div>
  </article>`
}

export function buildTripOverview(bundle: TripBundle, now: Date | string | null): TripOverview {
  const temporal = deriveTripTemporalState(bundle, now)
  const progress = computeTripProgress(bundle, now)

  const mapDetailStages: TripOverviewMapStage[] = []
  const fullMapStages: TripOverviewMapStage[] = []
  const mapStages: TripOverviewMapStage[] = bundle.stages.map((stage) => {
    const route = bundle.routes.find((candidate) => candidate.id === stage.sourceRouteId)
    const geometry = route === undefined ? null : routeGeometry(route)
    if (geometry === null) {
      mapDetailStages.push({ waypoints: [], geometry: [] })
      fullMapStages.push({ waypoints: [], geometry: [] })
      return { waypoints: [], geometry: [] }
    }
    const daySettings = bundle.settings.days.find((candidate) => candidate.dayId === stage.dayId)
    const settings = { referenceSpeedKph: bundle.settings.global.referenceSpeedKph, departureTime: daySettings?.departureTime ?? '08:00' }
    const stageSettings = bundle.settings.stages.find((candidate) => candidate.stageId === stage.id)
    const pauseResolution = resolveStagePauseSettings(bundle.settings.global.pausePlanMode, stageSettings)
    const waypoints = computeStageWaypoints({
      stage, route: route as NonNullable<typeof route>, routePoints: bundle.routePoints, climbs: bundle.climbs, settings,
      manualPauses: pauseResolution.mode === 'custom' ? pauseResolution.manualPauses : undefined,
      mountainMode: resolveEffectiveMountainMode(bundle),
    })
    const geometryTuples = geometry.map((point) => [point.latitude, point.longitude] as const)
    fullMapStages.push({ waypoints: waypoints.filter((waypoint) => isSignificantWaypoint(waypoint)), geometry: geometryTuples })
    mapDetailStages.push({
      waypoints: waypoints.filter((waypoint) => waypoint.kind !== 'start' && waypoint.kind !== 'end' && isOverviewDetailWaypoint(waypoint)),
      geometry: [],
    })
    // CDC D1.1 section 1: the Aperçu map keeps the FULL ridden trace — only
    // the marker set is trimmed to the two principal (start/end) points;
    // `geometryTuples` (never `[]`) is what makes `buildGenericOverviewRouteMapModel`
    // draw this stage's real GPX line instead of a marker-only stub.
    return { waypoints: waypoints.filter((waypoint) => waypoint.kind === 'start' || waypoint.kind === 'end'), geometry: geometryTuples }
  })

  const highlightedDayId = temporal.priorityDayId
  const highlightedDay = highlightedDayId === null ? undefined : bundle.days.find((candidate) => candidate.id === highlightedDayId)
  const highlightedStage = highlightedDay?.stageId === null || highlightedDay?.stageId === undefined
    ? undefined
    : bundle.stages.find((candidate) => candidate.id === highlightedDay.stageId)
  const highlightedStageIndex = highlightedStage === undefined ? -1 : bundle.stages.indexOf(highlightedStage)
  const highlightedDayMap = highlightedStageIndex === -1 ? null : fullMapStages[highlightedStageIndex] ?? null

  // CDC Jalon B4.4 sections 14/34: two visually hierarchised zones — VOYAGE
  // (progress + global map) then AUJOURD'HUI/PROCHAINE ÉTAPE (the
  // highlighted day) — rather than one undifferentiated stack. An eyebrow +
  // spacing + accent border, never a heavy extra title (kept RGA-reference
  // sober). The highlighted day's own zone is only rendered at all when
  // there is something to highlight — an empty "Prochaine étape" eyebrow
  // over nothing would be worse than omitting the zone entirely.
  const highlightedState = highlightedDayId === null ? null : getTripDayTemporalState(temporal, highlightedDayId)
  const nextZoneLabel = highlightedState?.current === true ? 'Aujourd’hui' : highlightedDay?.type === 'ride' ? 'Prochaine étape' : 'À suivre'
  const highlightedDayHtml = renderHighlightedDay(bundle, highlightedDayId, now, nextZoneLabel)

  // CDC D1.2 section 2: the app-shell header (fond vert) is now the sole
  // general trip identity — its own subtitle already carries the date
  // span/day count (`app-header.ts::overviewSubtitle`), so this screen no
  // longer repeats the trip name or its dates. A minimal eyebrow keeps just
  // enough "you are here" context without duplicating anything.
  const html = `<div class="trip-overview" data-trip-overview>
    <header class="view-heading"><p class="eyebrow">Aperçu</p></header>
    <section class="trip-overview__zone trip-overview__zone--trip" data-trip-overview-zone="trip">
      ${renderProgressStats(progress)}
      <section class="card route-map-card" data-route-visuals>
        <div class="section-heading"><div><p class="eyebrow">Vue d’ensemble</p><h3>Carte du voyage</h3></div><div class="route-map-card__actions"><button class="button button--quiet" type="button" data-action="download-trip-gpx">GPX</button></div></div>
        <div class="route-map route-map--action" data-trip-overview-map data-explore-map role="button" tabindex="0" aria-label="Ouvrir la carte du voyage en plein écran"></div>
      </section>
      <dialog class="route-map-dialog" data-trip-overview-map-dialog aria-labelledby="trip-overview-expanded-map-title">
        <header><h2 id="trip-overview-expanded-map-title">Carte du voyage</h2><div class="route-map-dialog__actions"><button class="button button--quiet" type="button" data-map-layers-toggle aria-pressed="false" aria-label="Afficher les pauses et cols nommés sur la carte" hidden>Détail</button><button class="button button--quiet" type="button" data-close-map>Fermer</button></div></header>
        <div class="route-map-dialog__map-wrap"><div class="route-map route-map--expanded" data-route-map-expanded></div><p class="route-map__fallback route-map__fallback--expanded" data-expanded-route-map-fallback hidden>Fond de carte indisponible.</p></div>
      </dialog>
    </section>
    ${highlightedDayHtml === '' ? '' : `<section class="trip-overview__zone trip-overview__zone--next" data-trip-overview-zone="next">
      ${highlightedDayHtml}
    </section>`}
  </div>`

  return { html, mapStages, mapDetailStages, highlightedDayId, highlightedDayMap }
}
