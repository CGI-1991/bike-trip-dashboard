/**
 * "Aperçu" screen (CDC Jalon B4.3 sections 5-8): title → trip progress
 * stats → general trip map → highlighted day card, in that order (the day
 * card is no longer first). Built from the active `TripBundle` only — never
 * RGA-hardcoded. Only produces the map containers' markup; the caller
 * (`trips-manager.ts`) wires the actual Leaflet maps into them, exactly
 * like `day-detail-view.ts`.
 */

import { computeStageWaypoints, resolveStagePauseSettings } from '../../analysis/waypoint-timeline.ts'
import type { LatLngTuple } from '../route-map-model.ts'
import { routeGeometry } from '../../route-enrichment/route-fingerprint.ts'
import { isSignificantWaypoint } from '../../analysis/canonical-waypoints.ts'
import type { CanonicalWaypoint } from '../../analysis/canonical-waypoints.ts'
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
 * Which day to highlight, given `today` (CDC section 9). Returns `null`
 * only when the trip is undated, or when `today` is strictly after every
 * day's date (the "after the trip" case) — a calendar gap during the trip
 * falls forward to the next future day rather than showing nothing.
 */
export function computeHighlightedDayId(bundle: TripBundle, todayIso: string | null): TripDayId | null {
  const datedDays = bundle.days.filter((day): day is TripBundle['days'][number] & { readonly date: string } => day.date !== null)
  if (todayIso === null || datedDays.length === 0) return bundle.days[0]?.id ?? null
  const firstDay = datedDays[0]
  const lastDay = datedDays[datedDays.length - 1]
  if (firstDay === undefined || lastDay === undefined) return null
  if (todayIso < firstDay.date) return bundle.days[0]?.id ?? null
  if (todayIso > lastDay.date) return null
  const exact = datedDays.find((day) => day.date === todayIso)
  if (exact !== undefined) return exact.id
  const nextFuture = datedDays.find((day) => day.date > todayIso)
  return nextFuture?.id ?? null
}

export interface TripOverviewMapStage {
  readonly waypoints: readonly CanonicalWaypoint[]
  readonly geometry: readonly LatLngTuple[]
}

export interface TripOverview {
  readonly html: string
  readonly mapStages: readonly TripOverviewMapStage[]
  /** Villages only, per stage, same indexing as `mapStages` (CDC Jalon B4 section 9): the Aperçu global map's opt-in Villages layer. */
  readonly mapVillageStages: readonly TripOverviewMapStage[]
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
  readonly elevationLossTotalM: number
  readonly elevationLossDoneM: number
  readonly elevationLossRemainingM: number
  readonly ridesCompleted: number
  readonly ridesRemaining: number
  readonly offDays: number
}

/**
 * Trip-wide progress (CDC Jalon B4.3 section 6, the 12-metric grid) — a ride
 * day counts as "done" once its calendar date is strictly before `todayIso`;
 * an undated trip (or a `todayIso` of `null`) has nothing done yet, same as
 * "before the trip starts". Every value comes from `TripBundle`/`bundle.stages`
 * directly — never a second, UI-only total.
 */
function computeTripProgress(bundle: TripBundle, todayIso: string | null): TripProgress {
  const stagesByDayId = new Map(bundle.stages.map((stage) => [stage.dayId, stage]))
  const rideDays = bundle.days.filter((day) => day.type === 'ride')
  let distanceTotalKm = 0
  let distanceDoneKm = 0
  let elevationGainTotalM = 0
  let elevationGainDoneM = 0
  let elevationLossTotalM = 0
  let elevationLossDoneM = 0
  let ridesCompleted = 0

  for (const day of rideDays) {
    const stage = stagesByDayId.get(day.id)
    if (stage === undefined) continue
    distanceTotalKm += stage.distanceKm ?? 0
    elevationGainTotalM += stage.elevationGainM ?? 0
    elevationLossTotalM += stage.elevationLossM ?? 0
    const done = todayIso !== null && day.date !== null && day.date < todayIso
    if (done) {
      ridesCompleted++
      distanceDoneKm += stage.distanceKm ?? 0
      elevationGainDoneM += stage.elevationGainM ?? 0
      elevationLossDoneM += stage.elevationLossM ?? 0
    }
  }

  return {
    distanceTotalKm, distanceDoneKm, distanceRemainingKm: distanceTotalKm - distanceDoneKm,
    elevationGainTotalM, elevationGainDoneM, elevationGainRemainingM: elevationGainTotalM - elevationGainDoneM,
    elevationLossTotalM, elevationLossDoneM, elevationLossRemainingM: elevationLossTotalM - elevationLossDoneM,
    ridesCompleted, ridesRemaining: rideDays.length - ridesCompleted,
    offDays: bundle.days.filter((day) => day.type === 'off').length,
  }
}

/** The 12 metrics (CDC Jalon B4.3 section 6), in the exact order requested, 2-column mobile grid. */
function renderProgressStats(progress: TripProgress): string {
  const rows: ReadonlyArray<readonly [string, string]> = [
    ['Distance totale', formatKilometers(progress.distanceTotalKm)],
    ['Distance parcourue', formatKilometers(progress.distanceDoneKm)],
    ['Distance restante', formatKilometers(progress.distanceRemainingKm)],
    ['D+ total', `${Math.round(progress.elevationGainTotalM)} m`],
    ['D+ parcouru', `${Math.round(progress.elevationGainDoneM)} m`],
    ['D+ restant', `${Math.round(progress.elevationGainRemainingM)} m`],
    ['D− total', `${Math.round(progress.elevationLossTotalM)} m`],
    ['D− parcouru', `${Math.round(progress.elevationLossDoneM)} m`],
    ['D− restant', `${Math.round(progress.elevationLossRemainingM)} m`],
    ['Étapes roulées terminées', String(progress.ridesCompleted)],
    ['Étapes roulées restantes', String(progress.ridesRemaining)],
    ['Journées OFF', String(progress.offDays)],
  ]
  const cells = rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')
  return `<section class="card trip-overview__progress" data-trip-overview-progress>
    <p class="eyebrow">Progression du voyage</p>
    <dl class="trip-overview__progress-grid">${cells}</dl>
  </section>`
}

function renderHighlightedDay(bundle: TripBundle, highlightedDayId: TripDayId | null): string {
  if (highlightedDayId === null) return ''
  const day = bundle.days.find((candidate) => candidate.id === highlightedDayId)
  if (day === undefined) return ''
  const dateLabel = day.date === null ? null : formatSimpleDate(day.date)

  if (day.type !== 'ride') {
    const typeLabel = day.type === 'off' ? 'OFF' : 'Transfert'
    const known = day.startLocationName !== null && day.startLocationName === day.endLocationName
      ? escapeHtml(day.startLocationName)
      : `${escapeHtml(day.startLocationName ?? '—')} → ${escapeHtml(day.endLocationName ?? '—')}`
    const headerParts = [`J${day.displayNumber}`, typeLabel, dateLabel].filter((part): part is string => part !== null)
    // CDC Jalon B4.4 sections 23/35: OFF/transfer days now have their own
    // Journée shell to open (`day-detail-view.ts`) — the highlighted card
    // here is a real navigation target too, exactly like a ride day's,
    // never left as a dead end just because it isn't a ride.
    return `<article class="trip-overview__highlighted-day card" data-action="open-day-detail" data-day-id="${escapeHtml(day.id)}" role="button" tabindex="0"><p class="eyebrow">À suivre</p><h3>${headerParts.join(' — ')}</h3><p>${known}</p></article>`
  }

  const stage = bundle.stages.find((candidate) => candidate.id === day.stageId)
  const locations = `${escapeHtml(stage?.startLocationName ?? '—')} → ${escapeHtml(stage?.endLocationName ?? '—')}`
  const headerParts = [`J${day.displayNumber}`, locations].filter((part): part is string => part !== null)
  const daySettings = bundle.settings.days.find((candidate) => candidate.dayId === day.id)
  const departureTime = daySettings?.departureTime ?? null
  let eta: string | null = null
  if (stage !== undefined) {
    const route = bundle.routes.find((candidate) => candidate.id === stage.sourceRouteId)
    if (route !== undefined && routeGeometry(route) !== null) {
      const settings = { referenceSpeedKph: bundle.settings.global.referenceSpeedKph, departureTime: departureTime ?? '08:00' }
      const stageSettings = bundle.settings.stages.find((candidate) => candidate.stageId === stage.id)
      const pauseResolution = resolveStagePauseSettings(bundle.settings.global.pausePlanMode, stageSettings)
      const waypoints = computeStageWaypoints({
        stage, route, routePoints: bundle.routePoints, climbs: bundle.climbs, settings,
        manualPauses: pauseResolution.mode === 'custom' ? pauseResolution.manualPauses : undefined,
        mountainMode: bundle.settings.global.mountainMode ?? false,
      })
      eta = waypoints.length === 0 ? null : waypoints[waypoints.length - 1]?.clockTime ?? null
    }
  }

  // CDC section 4: the whole card navigates to the Étape — no separate
  // "Voir l'étape" button when the card itself already carries the action.
  // The embedded map is non-interactive (no pan/zoom to steal the click),
  // so wrapping it is safe (CDC section 4: "les boutons internes ne
  // doivent pas déclencher aussi la navigation" — there are none here).
  return `<article class="trip-overview__highlighted-day card" data-action="open-day-detail" data-day-id="${escapeHtml(day.id)}" role="button" tabindex="0">
    <p class="eyebrow">À suivre</p><h3>${headerParts.join(' — ')}</h3>
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

export function buildTripOverview(bundle: TripBundle, todayIso: string | null): TripOverview {
  const progress = computeTripProgress(bundle, todayIso)

  const mapVillageStages: TripOverviewMapStage[] = []
  const mapStages: TripOverviewMapStage[] = bundle.stages.map((stage) => {
    const route = bundle.routes.find((candidate) => candidate.id === stage.sourceRouteId)
    const geometry = route === undefined ? null : routeGeometry(route)
    if (geometry === null) { mapVillageStages.push({ waypoints: [], geometry: [] }); return { waypoints: [], geometry: [] } }
    const daySettings = bundle.settings.days.find((candidate) => candidate.dayId === stage.dayId)
    const settings = { referenceSpeedKph: bundle.settings.global.referenceSpeedKph, departureTime: daySettings?.departureTime ?? '08:00' }
    const stageSettings = bundle.settings.stages.find((candidate) => candidate.stageId === stage.id)
    const pauseResolution = resolveStagePauseSettings(bundle.settings.global.pausePlanMode, stageSettings)
    const waypoints = computeStageWaypoints({
      stage, route: route as NonNullable<typeof route>, routePoints: bundle.routePoints, climbs: bundle.climbs, settings,
      manualPauses: pauseResolution.mode === 'custom' ? pauseResolution.manualPauses : undefined,
      mountainMode: bundle.settings.global.mountainMode ?? false,
    })
    const geometryTuples = geometry.map((point) => [point.latitude, point.longitude] as const)
    mapVillageStages.push({ waypoints: waypoints.filter((waypoint) => waypoint.kind === 'village'), geometry: geometryTuples })
    // A city/town/village or secondary climb carrying a pause still shows
    // on the compact map (CDC Jalon B4.3 section 27) — never just
    // `visibleByDefault`.
    return { waypoints: waypoints.filter((waypoint) => isSignificantWaypoint(waypoint)), geometry: geometryTuples }
  })

  const highlightedDayId = computeHighlightedDayId(bundle, todayIso)
  const highlightedDay = highlightedDayId === null ? undefined : bundle.days.find((candidate) => candidate.id === highlightedDayId)
  const highlightedStage = highlightedDay?.stageId === null || highlightedDay?.stageId === undefined
    ? undefined
    : bundle.stages.find((candidate) => candidate.id === highlightedDay.stageId)
  const highlightedStageIndex = highlightedStage === undefined ? -1 : bundle.stages.indexOf(highlightedStage)
  const highlightedDayMap = highlightedStageIndex === -1 ? null : mapStages[highlightedStageIndex] ?? null

  // CDC Jalon B4.4 sections 14/34: two visually hierarchised zones — VOYAGE
  // (progress + global map) then AUJOURD'HUI/PROCHAINE ÉTAPE (the
  // highlighted day) — rather than one undifferentiated stack. An eyebrow +
  // spacing + accent border, never a heavy extra title (kept RGA-reference
  // sober). The highlighted day's own zone is only rendered at all when
  // there is something to highlight — an empty "Prochaine étape" eyebrow
  // over nothing would be worse than omitting the zone entirely.
  const nextZoneLabel = highlightedDay?.date !== null && highlightedDay?.date === todayIso ? 'Aujourd’hui' : 'Prochaine étape'
  const highlightedDayHtml = renderHighlightedDay(bundle, highlightedDayId)

  const html = `<div class="trip-overview" data-trip-overview>
    <header class="view-heading"><p class="eyebrow">Aperçu</p><h2>${escapeHtml(bundle.metadata.name)}</h2></header>
    <p class="trip-overview__dates">${bundle.metadata.startDate ?? 'Non daté'}${bundle.metadata.endDate ? ` → ${bundle.metadata.endDate}` : ''}</p>
    <section class="trip-overview__zone trip-overview__zone--trip" data-trip-overview-zone="trip">
      <p class="eyebrow trip-overview__zone-eyebrow">Voyage</p>
      ${renderProgressStats(progress)}
      <section class="card route-map-card" data-route-visuals>
        <div class="section-heading"><div><p class="eyebrow">Vue d’ensemble</p><h3>Carte du voyage</h3></div><button class="button button--quiet" type="button" data-explore-map>Explorer la carte</button></div>
        <div class="route-map" data-trip-overview-map></div>
      </section>
      <dialog class="route-map-dialog" data-trip-overview-map-dialog aria-labelledby="trip-overview-expanded-map-title">
        <header><h2 id="trip-overview-expanded-map-title">Carte du voyage</h2><div class="route-map-dialog__actions"><button class="button button--quiet" type="button" data-map-layers-toggle aria-expanded="false" aria-controls="trip-overview-map-layers-panel" hidden>Calques</button><button class="button button--quiet" type="button" data-close-map>Fermer</button></div></header>
        <div class="route-map-dialog__map-wrap"><div class="route-map route-map--expanded" data-route-map-expanded></div><p class="route-map__fallback route-map__fallback--expanded" data-expanded-route-map-fallback hidden>Fond de carte indisponible.</p><button class="practical-layers-backdrop" type="button" data-map-layers-backdrop aria-label="Fermer les calques" tabindex="-1" hidden></button><section class="practical-layers-panel" id="trip-overview-map-layers-panel" data-map-layers-panel role="dialog" aria-labelledby="trip-overview-map-layers-title" hidden><header><div><p class="eyebrow">Points principaux toujours visibles</p><h3 id="trip-overview-map-layers-title">Calques</h3></div><button class="button button--quiet" type="button" data-map-layers-close>Fermer</button></header><div class="practical-layers-list" data-map-layers-list></div></section></div>
      </dialog>
    </section>
    ${highlightedDayHtml === '' ? '' : `<section class="trip-overview__zone trip-overview__zone--next" data-trip-overview-zone="next">
      <p class="eyebrow trip-overview__zone-eyebrow">${nextZoneLabel}</p>
      ${highlightedDayHtml}
    </section>`}
  </div>`

  return { html, mapStages, mapVillageStages, highlightedDayId, highlightedDayMap }
}
