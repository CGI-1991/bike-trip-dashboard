import { createRouteClockTime, describeRouteClockTime, formatRouteClockTime } from '../route/time.ts'
import type { RouteClockTime, RouteTimeline, RouteWaypointType } from '../route/types.ts'
import type { RideDayTimeline, TripDayTimeline } from '../trip/types.ts'
import type { RoadbookMatchReport, RoadbookPointMatch, RoadbookStandaloneWaypoint, RoadbookWaypointLink } from '../trip/roadbook-match.ts'
import type { RoadbookPointType } from '../trip/roadbook-types.ts'

const distanceFormatter = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const integerFormatter = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 })
const waypointTypeLabels: Record<RouteWaypointType, string> = { 'route-start': 'Départ', 'route-end': 'Arrivée', 'gpx-start': 'Début GPX', 'gpx-end': 'Fin GPX', summit: 'Sommet', valley: 'Vallée', 'slope-change': 'Changement de pente', 'time-marker': 'Repère', 'pause-start': 'Début de pause', 'pause-end': 'Fin de pause' }
const roadbookPointTypeLabels: Record<RoadbookPointType, string> = { start: 'Départ', end: 'Arrivée', col: 'Col', summit: 'Sommet', village: 'Village', passage: 'Passage', resupply: 'Ravitaillement', pause: 'Pause', shelter: 'Abri', lodging: 'Hébergement', poi: 'Point d’intérêt' }

function escapeHtml(value: string): string { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;') }
function renderClock(value: RouteClockTime): string { return `<time aria-label="${escapeHtml(describeRouteClockTime(value))}">${escapeHtml(formatRouteClockTime(value))}</time>` }
function altitude(value: number | null): string { return value === null ? '—' : `${integerFormatter.format(value)} m` }
function gpxNumber(value: number): string { return String(value).padStart(2, '0') }

interface Row { readonly elapsed: number; readonly distance: number; readonly priority: number; readonly html: string }

function automaticRow(timeline: RouteTimeline, waypoint: RouteTimeline['waypoints'][number], link: RoadbookWaypointLink | undefined, primary: RoadbookPointMatch | undefined): Row {
  const pause = timeline.pauses.find(({ startWaypointId }) => startWaypointId === waypoint.id)
  const namedType = primary === undefined ? waypointTypeLabels[waypoint.type] : roadbookPointTypeLabels[primary.type]
  const type = pause === undefined ? namedType : `Pause ${pause.durationMinutes} min${primary?.isResupplyCandidate === true || primary?.type === 'resupply' ? ' · ravitaillement' : ''}`
  const visible = waypoint.type === 'route-start' || waypoint.type === 'route-end' || waypoint.type === 'summit' || waypoint.type === 'pause-start' || primary?.type === 'col' || primary?.type === 'summit' || primary?.subtype === 'strategic-passage'
  const name = link?.displayName ?? waypoint.name
  return { elapsed: waypoint.progress.elapsedMinutes, distance: waypoint.progress.distanceKm, priority: link === undefined ? 2 : 0, html: `<details class="route-point" role="listitem" data-route-waypoint data-route-waypoint-origin="automatic" data-route-waypoint-type="${waypoint.type}" data-route-compact-visible="${visible}" data-route-elapsed="${waypoint.progress.elapsedMinutes}" data-route-distance="${waypoint.progress.distanceKm}"><summary><span class="route-point__time">${renderClock(createRouteClockTime(timeline.summary.departureTimeMinutes, waypoint.progress.elapsedMinutes))}</span><span class="route-point__main"><strong>${escapeHtml(name)}</strong><small>${escapeHtml(type)} · ${altitude(waypoint.progress.altitudeM)}</small></span><span class="route-point__distance">${distanceFormatter.format(waypoint.progress.distanceKm)} km</span></summary><div class="route-point__details"><p>${escapeHtml(waypoint.name)}</p><p>Rôle : ${escapeHtml(type)}${pause === undefined ? '' : ' · pause active'}</p><p>Source : GPX ${gpxNumber(waypoint.sourceFileNumber)}</p></div></details>` }
}

function standaloneRow(waypoint: RoadbookStandaloneWaypoint): Row {
  const visible = waypoint.type === 'col' || waypoint.type === 'summit' || waypoint.type === 'start' || waypoint.type === 'end'
  return { elapsed: waypoint.eta.totalMinutesFromDeparture, distance: waypoint.trackDistanceKm, priority: 1, html: `<details class="route-point" role="listitem" data-route-waypoint data-route-waypoint-origin="roadbook" data-route-waypoint-type="${waypoint.type}" data-route-compact-visible="${visible}" data-route-elapsed="${waypoint.eta.totalMinutesFromDeparture}" data-route-distance="${waypoint.trackDistanceKm}"><summary><span class="route-point__time">${renderClock(waypoint.eta)}</span><span class="route-point__main"><strong>${escapeHtml(waypoint.name)}</strong><small>${roadbookPointTypeLabels[waypoint.type]} · ${altitude(waypoint.altitudeM)}</small></span><span class="route-point__distance">${distanceFormatter.format(waypoint.trackDistanceKm)} km</span></summary><div class="route-point__details"><p>Point documenté projeté sur la trace.</p><p>Rôle : ${roadbookPointTypeLabels[waypoint.type]}</p></div></details>` }
}

function rows(timeline: RouteTimeline, dayId: string, report: RoadbookMatchReport | null): string {
  const links = report?.waypointLinks.filter((link) => link.dayId === dayId) ?? []
  const linkMap = new Map(links.map((link) => [link.waypointId, link]))
  const pointMap = new Map((report?.allPointMatches ?? []).map((point) => [point.id, point]))
  const values: Row[] = timeline.waypoints.map((waypoint) => { const link = linkMap.get(waypoint.id); return automaticRow(timeline, waypoint, link, link === undefined ? undefined : pointMap.get(link.primaryRoadbookPointId)) })
  for (const waypoint of report?.standaloneWaypoints.filter((point) => point.dayId === dayId) ?? []) values.push(standaloneRow(waypoint))
  const deduplicated: Row[] = []
  for (const value of values.sort((a, b) => a.elapsed - b.elapsed || a.distance - b.distance || a.priority - b.priority)) {
    const previous = deduplicated.at(-1)
    if (previous !== undefined && Math.abs(previous.elapsed - value.elapsed) < 2 && Math.abs(previous.distance - value.distance) < 0.2) { if (value.priority < previous.priority) deduplicated[deduplicated.length - 1] = value; continue }
    deduplicated.push(value)
  }
  return deduplicated.map(({ html }) => html).join('')
}

function clear(container: HTMLElement): void { for (const key of ['routeDayId','routeDayType','routeWaypointCount','routeArrivalElapsed','routeArrivalTime','routeArrivalDayOffset','routeGpx','routeSpeed','routePauseMinutes','routeFirstElapsed']) delete container.dataset[key] }
export function renderRouteEngineLoading(container: HTMLElement): void { clear(container); container.dataset.routeState = 'loading'; container.setAttribute('aria-busy', 'true'); container.innerHTML = '<p class="route-engine__message" role="status">Construction du parcours…</p>' }
export function renderRouteEngineError(container: HTMLElement, error: unknown): void { clear(container); container.dataset.routeState = 'error'; container.setAttribute('aria-busy', 'false'); container.innerHTML = `<div class="route-engine__message route-engine__message--error" role="alert"><strong>Moteur d’itinéraire indisponible</strong><p>${escapeHtml(error instanceof Error ? error.message : 'Erreur inconnue.')}</p></div>` }

function renderOff(container: HTMLElement, day: Extract<TripDayTimeline, { type: 'off' }>): void { clear(container); container.dataset.routeState = 'off'; container.dataset.routeDayId = day.day.id; container.dataset.routeDayType = 'off'; container.setAttribute('aria-busy', 'false'); container.innerHTML = `<div class="route-engine__off"><span class="tag tag--off">${day.day.id} · OFF</span><h3>${escapeHtml(day.day.title)}</h3><p>${escapeHtml(day.day.locationName)}</p><strong>Aucun GPX cycliste.</strong></div>` }
function renderUnavailable(container: HTMLElement, day: Extract<TripDayTimeline, { type: 'ride'; status: 'unavailable' }>): void { clear(container); container.dataset.routeState = 'unavailable'; container.dataset.routeDayId = day.day.id; container.dataset.routeDayType = 'ride'; container.setAttribute('aria-busy', 'false'); container.innerHTML = `<div class="route-engine__message route-engine__message--error" role="alert"><strong>${day.day.id} · GPX indisponible</strong><p>${escapeHtml(day.message)}</p></div>` }

function renderReady(container: HTMLElement, timeline: RideDayTimeline, report: RoadbookMatchReport | null): void {
  const { day, route } = timeline
  container.dataset.routeState = 'success'; container.dataset.routeDayId = day.id; container.dataset.routeDayType = 'ride'; container.dataset.routeGpx = String(day.gpxNumber); container.dataset.routeWaypointCount = String(route.summary.waypointCount); container.dataset.routeArrivalElapsed = String(route.summary.totalDurationMinutes); container.dataset.routeArrivalTime = formatRouteClockTime(timeline.arrivalTime); container.dataset.routeArrivalDayOffset = String(timeline.arrivalTime.dayOffset); container.dataset.routeSpeed = String(route.settings.averageSpeedKph); container.dataset.routePauseMinutes = String(route.summary.pauseDurationMinutes); container.dataset.routeFirstElapsed = String(route.waypoints[0]?.progress.elapsedMinutes ?? Number.NaN); container.setAttribute('aria-busy', 'false')
  container.innerHTML = `<p class="route-engine__compact-note">Départ, pauses actives, cols, passages stratégiques et arrivée.</p><div class="route-point-list" role="list" aria-label="Parcours de ${day.id}">${rows(route, day.id, report)}</div><label class="route-detail-toggle"><input type="checkbox" data-route-detail-toggle> Afficher tous les points</label>`
}

export function renderTripDayRouteTimeline(container: HTMLElement, day: TripDayTimeline, report: RoadbookMatchReport | null = null): void { if (day.type === 'off') renderOff(container, day); else if (day.status === 'unavailable') renderUnavailable(container, day); else renderReady(container, day, report) }
