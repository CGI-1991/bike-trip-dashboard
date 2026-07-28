import { describeRouteClockTime, formatRouteClockTime } from '../route/time.ts'
import type { RouteClockTime, RouteTimeline } from '../route/types.ts'
import type { Accommodation } from '../trip/accommodations.ts'
import { resolveArrivalDisplay, resolveDepartureDisplay } from '../trip/endpoint-display.ts'
import { getRoadbookPointRole } from '../trip/point-role.ts'
import type { RideDayTimeline, TripDayTimeline } from '../trip/types.ts'
import type { RoadbookMatchReport, RoadbookPointMatch } from '../trip/roadbook-match.ts'
import type { RoadbookRideDay, RoadbookPointType } from '../trip/roadbook-types.ts'
import { getRouteMarkerCategory, getRouteMarkerLegendSymbol } from './route-marker-style.ts'

const distanceFormatter = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const integerFormatter = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 })
const pointTypeLabels: Record<RoadbookPointType, string> = { start: 'Départ', end: 'Arrivée', col: 'Col', summit: 'Sommet', village: 'Village', passage: 'Passage', resupply: 'Ravitaillement', pause: 'Pause possible', shelter: 'Abri', lodging: 'Hébergement', poi: 'Point d’intérêt' }

function escapeHtml(value: string): string { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;') }
function renderClock(value: RouteClockTime): string { return `<time aria-label="${escapeHtml(describeRouteClockTime(value))}">${escapeHtml(formatRouteClockTime(value))}</time>` }
function altitude(value: number | null | undefined): string { return value == null ? 'Altitude indisponible' : `${integerFormatter.format(value)} m` }

interface DisplayPoint { readonly id: string; readonly distanceKm: number; readonly elapsedMinutes: number; readonly html: string }

/**
 * Roadbook-only: the Parcours list is built exclusively from documented
 * points (see `buildRouteDisplayPoints`). Automatic GPX waypoints (km
 * markers, slope changes, summits/valleys with no roadbook equivalent, time
 * markers) never reach this function and never render here — they stay
 * internal to the route engine (ETA, slope, weather sampling).
 */
function documentedPoint(
  route: RouteTimeline,
  point: RoadbookPointMatch,
  roadbookDay: RoadbookRideDay | undefined,
  accommodation: Accommodation | null,
): DisplayPoint | null {
  if (point.matchedTrackDistanceKm === undefined) return null
  const distanceKm = point.matchedTrackDistanceKm
  const eta = point.eta
  const renderedEta = eta === undefined ? '<span>Heure indisponible</span>' : renderClock(eta)
  const elapsedMinutes = eta?.totalMinutesFromDeparture ?? Number.MAX_SAFE_INTEGER
  const offRoute = point.resolution !== 'matched'
  const role = getRoadbookPointRole(point)
  const category = getRouteMarkerCategory(point)
  const endpointDisplay =
    point.type === 'start' && roadbookDay !== undefined
      ? resolveDepartureDisplay(roadbookDay)
      : point.type === 'end' && roadbookDay !== undefined
        ? resolveArrivalDisplay(roadbookDay, accommodation)
        : undefined
  const displayName = endpointDisplay?.primaryName ?? point.name
  // A pause is matched strictly by the point's own roadbook id, never by
  // proximity to some nearby waypoint — see `RoutePause.pointId`.
  const pause = route.pauses.find(({ pointId }) => pointId === point.id)
  const functions = [
    endpointDisplay?.subLabel ?? pointTypeLabels[point.type],
    point.isResupplyCandidate === true && point.type !== 'resupply' ? 'ravitaillement' : null,
  ].filter((value): value is string => value !== null)
  const anomalyStatus =
    role === 'not-ridden-option'
      ? 'Option non parcourue · hors trace'
      : offRoute
        ? 'Hors parcours · heure de référence'
        : null
  const reference = offRoute ? 'Kilomètre de référence' : 'Kilomètre'
  const symbol = getRouteMarkerLegendSymbol(category)
  const pauseTag = pause === undefined ? '' : `<span class="route-point__pause-tag">Pause ${pause.durationMinutes} min</span>`
  const statusTag = anomalyStatus === null ? '' : `<small class="route-point__status">${escapeHtml(anomalyStatus)}</small>`
  return {
    id: point.id,
    distanceKm,
    elapsedMinutes,
    html: `<li class="route-point${offRoute ? ' route-point--off-route' : ''}${pause === undefined ? '' : ' route-point--pause'}" data-route-point-id="${escapeHtml(point.id)}" data-route-point-category="${category}" data-route-distance="${distanceKm}" data-route-off-track="${offRoute}" data-route-pause-active="${pause !== undefined}"><span class="route-point__time">${renderedEta}</span><span class="route-point__main"><strong><span class="route-point__symbol" aria-hidden="true">${symbol}</span> ${escapeHtml(displayName)}</strong><small>${altitude(point.matchedElevationM ?? point.elevationM)} · ${escapeHtml(functions.join(' · '))}</small><span class="route-point__distance">${reference} ${distanceFormatter.format(distanceKm)} km</span></span>${pauseTag}${statusTag}</li>`,
  }
}

export function buildRouteDisplayPoints(
  route: RouteTimeline,
  dayId: string,
  report: RoadbookMatchReport | null,
  accommodation: Accommodation | null = null,
): readonly DisplayPoint[] {
  const dayReport = report?.days?.find((day) => day.dayId === dayId)
  const roadbookDay = dayReport?.type === 'ride' ? dayReport.roadbook : undefined
  const dayPointMatches = report?.allPointMatches.filter((point) => point.dayId === dayId) ?? []
  const documented = dayPointMatches
    .map((point) => documentedPoint(route, point, roadbookDay, accommodation))
    .filter((point): point is DisplayPoint => point !== null)
  return [...documented].sort(
    (a, b) => a.distanceKm - b.distanceKm || a.elapsedMinutes - b.elapsedMinutes || a.id.localeCompare(b.id),
  )
}

function clear(container: HTMLElement): void { for (const key of ['routeDayId','routeDayType','routeWaypointCount','routeArrivalElapsed','routeArrivalTime','routeArrivalDayOffset','routeGpx','routeSpeed','routePauseMinutes','routeFirstElapsed']) delete container.dataset[key] }
export function renderRouteEngineLoading(container: HTMLElement): void { clear(container); container.dataset.routeState = 'loading'; container.setAttribute('aria-busy', 'true'); container.innerHTML = '<p class="route-engine__message" role="status">Construction du parcours…</p>' }
export function renderRouteEngineError(container: HTMLElement, error: unknown): void { clear(container); container.dataset.routeState = 'error'; container.setAttribute('aria-busy', 'false'); container.innerHTML = `<div class="route-engine__message route-engine__message--error" role="alert"><strong>Moteur d’itinéraire indisponible</strong><p>${escapeHtml(error instanceof Error ? error.message : 'Erreur inconnue.')}</p></div>` }
function renderOff(container: HTMLElement, day: Extract<TripDayTimeline, { type: 'off' }>): void { clear(container); container.dataset.routeState = 'off'; container.setAttribute('aria-busy', 'false'); container.innerHTML = `<div class="route-engine__off"><span class="tag tag--off">${day.day.id} · OFF</span><h3>${escapeHtml(day.day.title)}</h3><p>${escapeHtml(day.day.locationName)}</p><strong>Aucun GPX cycliste.</strong></div>` }
function renderUnavailable(container: HTMLElement, day: Extract<TripDayTimeline, { type: 'ride'; status: 'unavailable' }>): void { clear(container); container.dataset.routeState = 'unavailable'; container.setAttribute('aria-busy', 'false'); container.innerHTML = `<div class="route-engine__message route-engine__message--error" role="alert"><strong>${day.day.id} · GPX indisponible</strong><p>${escapeHtml(day.message)}</p></div>` }
function renderReady(container: HTMLElement, timeline: RideDayTimeline, report: RoadbookMatchReport | null, accommodation: Accommodation | null): void {
  const points = buildRouteDisplayPoints(timeline.route, timeline.day.id, report, accommodation)
  container.dataset.routeState = 'success'; container.dataset.routeDayId = timeline.day.id; container.dataset.routeDayType = 'ride'; container.dataset.routeGpx = String(timeline.day.gpxNumber); container.dataset.routeWaypointCount = String(points.length); container.setAttribute('aria-busy', 'false')
  container.innerHTML = `<ol class="route-point-list" aria-label="Parcours de ${timeline.day.id}">${points.map(({ html }) => html).join('')}</ol>`
}
export function renderTripDayRouteTimeline(container: HTMLElement, day: TripDayTimeline, report: RoadbookMatchReport | null = null, accommodation: Accommodation | null = null): void { if (day.type === 'off') renderOff(container, day); else if (day.status === 'unavailable') renderUnavailable(container, day); else renderReady(container, day, report, accommodation) }
