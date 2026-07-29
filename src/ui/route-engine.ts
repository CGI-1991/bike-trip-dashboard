import { describeRouteClockTime, formatRouteClockTime } from '../route/time.ts'
import type { RouteClockTime, RouteTimeline } from '../route/types.ts'
import type { Accommodation } from '../trip/accommodations.ts'
import { resolveArrivalDisplay, resolveDepartureDisplay } from '../trip/endpoint-display.ts'
import { getRoadbookPointRole } from '../trip/point-role.ts'
import type { RoadbookMatchReport, RoadbookPointMatch } from '../trip/roadbook-match.ts'
import type { RoadbookPointType, RoadbookRideDay } from '../trip/roadbook-types.ts'
import type { RideDayTimeline, TripDayTimeline } from '../trip/types.ts'
import {
  emptyDocumentedPointWeatherListViewModel,
  formatDocumentedPointWeatherSummary,
} from '../weather/documented-point-view-model.ts'
import type {
  DocumentedPointWeatherListViewModel,
  DocumentedPointWeatherViewModel,
} from '../weather/documented-point-view-model.ts'
import { getRouteMarkerCategory, getRouteMarkerLegendSymbol } from './route-marker-style.ts'

const distanceFormatter = new Intl.NumberFormat('fr-FR', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})
const integerFormatter = new Intl.NumberFormat('fr-FR', {
  maximumFractionDigits: 0,
})
const attributeQuote = String.fromCharCode(34)
const pointTypeLabels: Record<RoadbookPointType, string> = {
  start: 'Départ',
  end: 'Arrivée',
  col: 'Col',
  summit: 'Sommet',
  village: 'Village',
  passage: 'Passage',
  resupply: 'Ravitaillement',
  pause: 'Pause possible',
  shelter: 'Abri',
  lodging: 'Hébergement',
  poi: 'Point d’intérêt',
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll(String.fromCharCode(34), '&quot;')
    .replaceAll(String.fromCharCode(39), '&#039;')
}

function renderClock(value: RouteClockTime): string {
  return `<time aria-label='${escapeHtml(describeRouteClockTime(value))}'>${escapeHtml(formatRouteClockTime(value))}</time>`
}

function altitude(value: number | null | undefined): string {
  return value == null ? 'Altitude indisponible' : `${integerFormatter.format(value)} m`
}

function normalizedPointName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('fr-FR')
    .trim()
}

interface DisplayPoint {
  readonly id: string
  readonly distanceKm: number
  readonly elapsedMinutes: number
  readonly html: string
}

function renderPointWeather(
  weather: DocumentedPointWeatherViewModel | undefined,
): string {
  if (weather === undefined) return ''

  const formatted = formatDocumentedPointWeatherSummary(weather)
  const summary = formatted === '' ? 'Météo indisponible' : formatted
  const significantRisk = weather.riskLevel === 'orange' || weather.riskLevel === 'red'
  const risk = significantRisk
    ? `<span class='route-point-weather__risk' data-point-risk-level='${weather.riskLevel}'>${escapeHtml(weather.riskLabel)} — ${escapeHtml(weather.riskReasons.join(' et '))}</span>`
    : ''
  const modifier = weather.isCurrentNonPredictive
    ? ' route-point-weather--current'
    : weather.forecastStatus === 'available'
      ? ''
      : ' route-point-weather--unavailable'

  return `<span class='route-point-weather${modifier}' data-point-weather data-point-weather-status='${weather.forecastStatus}'><span class='route-point-weather__summary'>${escapeHtml(summary)}</span>${risk}</span>`
}

/**
 * Roadbook-only: automatic GPX points never reach this renderer. They remain
 * internal to profile, ETA and weather calculations.
 */
function documentedPoint(
  route: RouteTimeline,
  point: RoadbookPointMatch,
  roadbookDay: RoadbookRideDay | undefined,
  accommodation: Accommodation | null,
  weather: DocumentedPointWeatherViewModel | undefined,
): DisplayPoint | null {
  if (point.matchedTrackDistanceKm === undefined) return null

  const role = getRoadbookPointRole(point)

  const distanceKm = point.matchedTrackDistanceKm
  const eta = point.eta
  const renderedEta = eta === undefined
    ? '<span>Heure indisponible</span>'
    : renderClock(eta)
  const elapsedMinutes = eta?.totalMinutesFromDeparture ?? Number.MAX_SAFE_INTEGER
  const offRoute = point.resolution !== 'matched'
  const category = getRouteMarkerCategory(point)
  const endpointDisplay =
    point.type === 'start' && roadbookDay !== undefined
      ? resolveDepartureDisplay(roadbookDay)
      : point.type === 'end' && roadbookDay !== undefined
        ? resolveArrivalDisplay(roadbookDay, accommodation)
        : undefined
  const displayName = endpointDisplay?.primaryName ?? point.name
  const pause = route.pauses.find(({ pointId }) => pointId === point.id)
  const functions = [
    endpointDisplay?.subLabel ?? pointTypeLabels[point.type],
    point.isResupplyCandidate === true && point.type !== 'resupply'
      ? 'ravitaillement'
      : null,
  ].filter((value): value is string => value !== null)
  const anomalyStatus =
    role === 'not-ridden-option'
      ? 'Option non parcourue · hors trace'
      : offRoute
        ? 'Hors parcours · heure de référence'
        : null
  const reference = offRoute ? 'Kilomètre de référence' : 'Kilomètre'
  const symbol = getRouteMarkerLegendSymbol(category)
  const pauseTag = pause === undefined
    ? ''
    : `<span class='route-point__pause-tag'>Pause ${pause.durationMinutes} min</span>`
  const statusTag = anomalyStatus === null
    ? ''
    : `<small class='route-point__status'>${escapeHtml(anomalyStatus)}</small>`
  const weatherTag = renderPointWeather(weather)

  return {
    id: point.id,
    distanceKm,
    elapsedMinutes,
    html: `<li class='route-point${offRoute ? ' route-point--off-route' : ''}${pause === undefined ? '' : ' route-point--pause'}' data-route-point-id='${escapeHtml(point.id)}' data-route-point-category=${attributeQuote}${category}${attributeQuote} data-route-distance='${distanceKm}' data-route-off-track='${offRoute}' data-route-pause-active='${pause !== undefined}' data-point-weather-status='${weather?.forecastStatus ?? 'none'}'><span class='route-point__time'>${renderedEta}</span><span class='route-point__main'><strong><span class='route-point__symbol' aria-hidden='true'>${symbol}</span> ${escapeHtml(displayName)}</strong><small>${altitude(point.matchedElevationM ?? point.elevationM)} · ${escapeHtml(functions.join(' · '))}</small><span class='route-point__distance'>${reference} ${distanceFormatter.format(distanceKm)} km</span></span>${pauseTag}${statusTag}${weatherTag}</li>`,
  }
}

export function buildRouteDisplayPoints(
  route: RouteTimeline,
  dayId: string,
  report: RoadbookMatchReport | null,
  accommodation: Accommodation | null = null,
  weather: DocumentedPointWeatherListViewModel = emptyDocumentedPointWeatherListViewModel,
): readonly DisplayPoint[] {
  const dayReport = report?.days?.find((day) => day.dayId === dayId)
  const roadbookDay = dayReport?.type === 'ride' ? dayReport.roadbook : undefined
  const dayPointMatches = report?.allPointMatches.filter(
    (point) => point.dayId === dayId,
  ) ?? []
  const geographicNames = new Set(
    dayPointMatches
      .filter((point) => getRoadbookPointRole(point) !== 'information')
      .map(({ name }) => normalizedPointName(name)),
  )
  const visiblePointMatches = dayPointMatches.filter(
    (point) =>
      getRoadbookPointRole(point) !== 'information' ||
      !geographicNames.has(normalizedPointName(point.name)),
  )
  const documented = visiblePointMatches
    .map((point) => documentedPoint(
      route,
      point,
      roadbookDay,
      accommodation,
      weather.pointWeatherById.get(point.id),
    ))
    .filter((point): point is DisplayPoint => point !== null)

  return [...documented].sort(
    (left, right) =>
      left.distanceKm - right.distanceKm ||
      left.elapsedMinutes - right.elapsedMinutes ||
      left.id.localeCompare(right.id),
  )
}

function clear(container: HTMLElement): void {
  for (const key of [
    'routeDayId',
    'routeDayType',
    'routeWaypointCount',
    'routeArrivalElapsed',
    'routeArrivalTime',
    'routeArrivalDayOffset',
    'routeGpx',
    'routeSpeed',
    'routePauseMinutes',
    'routeFirstElapsed',
  ]) delete container.dataset[key]
}

export function renderRouteEngineLoading(container: HTMLElement): void {
  clear(container)
  container.dataset.routeState = 'loading'
  container.setAttribute('aria-busy', 'true')
  container.innerHTML = '<p class=route-engine__message role=status>Construction du parcours…</p>'
}

export function renderRouteEngineError(container: HTMLElement, error: unknown): void {
  clear(container)
  container.dataset.routeState = 'error'
  container.setAttribute('aria-busy', 'false')
  const message = error instanceof Error ? error.message : 'Erreur inconnue.'
  container.innerHTML = `<div class='route-engine__message route-engine__message--error' role='alert'><strong>Moteur d’itinéraire indisponible</strong><p>${escapeHtml(message)}</p></div>`
}

function renderOff(
  container: HTMLElement,
  day: Extract<TripDayTimeline, { type: 'off' }>,
): void {
  clear(container)
  container.dataset.routeState = 'off'
  container.setAttribute('aria-busy', 'false')
  container.innerHTML = `<div class='route-engine__off'><span class='tag tag--off'>${day.day.id} · OFF</span><h3>${escapeHtml(day.day.title)}</h3><p>${escapeHtml(day.day.locationName)}</p><strong>Aucun GPX cycliste.</strong></div>`
}

function renderUnavailable(
  container: HTMLElement,
  day: Extract<TripDayTimeline, { type: 'ride'; status: 'unavailable' }>,
): void {
  clear(container)
  container.dataset.routeState = 'unavailable'
  container.setAttribute('aria-busy', 'false')
  container.innerHTML = `<div class='route-engine__message route-engine__message--error' role='alert'><strong>${day.day.id} · GPX indisponible</strong><p>${escapeHtml(day.message)}</p></div>`
}

function renderReady(
  container: HTMLElement,
  timeline: RideDayTimeline,
  report: RoadbookMatchReport | null,
  accommodation: Accommodation | null,
  weather: DocumentedPointWeatherListViewModel,
): void {
  const points = buildRouteDisplayPoints(
    timeline.route,
    timeline.day.id,
    report,
    accommodation,
    weather,
  )
  container.dataset.routeState = 'success'
  container.dataset.routeDayId = timeline.day.id
  container.dataset.routeDayType = 'ride'
  container.dataset.routeGpx = String(timeline.day.gpxNumber)
  container.dataset.routeWaypointCount = String(points.length)
  container.setAttribute('aria-busy', 'false')
  const weatherNote = weather.note === null
    ? ''
    : `<p class='route-point-weather-note' data-route-weather-note data-route-weather-state='${weather.status}'>${escapeHtml(weather.note)}</p>`
  container.innerHTML = `${weatherNote}<ol class='route-point-list' aria-label='Parcours de ${timeline.day.id}'>${points.map(({ html }) => html).join('')}</ol>`
}

export function renderTripDayRouteTimeline(
  container: HTMLElement,
  day: TripDayTimeline,
  report: RoadbookMatchReport | null = null,
  accommodation: Accommodation | null = null,
  weather: DocumentedPointWeatherListViewModel = emptyDocumentedPointWeatherListViewModel,
): void {
  if (day.type === 'off') renderOff(container, day)
  else if (day.status === 'unavailable') renderUnavailable(container, day)
  else renderReady(container, day, report, accommodation, weather)
}
