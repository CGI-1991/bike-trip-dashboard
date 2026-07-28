import { createRouteClockTime, describeRouteClockTime, formatRouteClockTime } from '../route/time.ts'
import type { RouteClockTime, RouteTimeline, RouteWaypoint, RouteWaypointType } from '../route/types.ts'
import { getRoadbookPointRole } from '../trip/point-role.ts'
import type { RideDayTimeline, TripDayTimeline } from '../trip/types.ts'
import type { RoadbookMatchReport, RoadbookPointMatch } from '../trip/roadbook-match.ts'
import type { RoadbookPointType } from '../trip/roadbook-types.ts'

const distanceFormatter = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const integerFormatter = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 })
const pointTypeLabels: Record<RoadbookPointType, string> = { start: 'Départ', end: 'Arrivée', col: 'Col', summit: 'Sommet', village: 'Village', passage: 'Passage', resupply: 'Ravitaillement', pause: 'Pause possible', shelter: 'Abri', lodging: 'Hébergement', poi: 'Point d’intérêt' }
const generatedTypeLabels: Record<RouteWaypointType, string> = { 'route-start': 'Départ', 'route-end': 'Arrivée', 'gpx-start': 'Début du tracé', 'gpx-end': 'Fin du tracé', summit: 'Point haut intermédiaire', valley: 'Fond de vallée', 'slope-change': 'Rupture de pente importante', 'time-marker': 'Repère temporel', 'pause-start': 'Début de pause', 'pause-end': 'Fin de pause' }

function escapeHtml(value: string): string { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;') }
function renderClock(value: RouteClockTime): string { return `<time aria-label="${escapeHtml(describeRouteClockTime(value))}">${escapeHtml(formatRouteClockTime(value))}</time>` }
function altitude(value: number | null | undefined): string { return value == null ? 'Altitude indisponible' : `${integerFormatter.format(value)} m` }
function timeAtDistance(route: RouteTimeline, distanceKm: number): RouteClockTime {
  const points = route.waypoints.filter(({ progress }) => Number.isFinite(progress.distanceKm)).sort((a, b) => a.progress.distanceKm - b.progress.distanceKm)
  const after = points.find(({ progress }) => progress.distanceKm >= distanceKm)
  const afterIndex = after === undefined ? -1 : points.indexOf(after)
  const before = afterIndex > 0 ? points[afterIndex - 1] : points[0]
  if (after === undefined) return createRouteClockTime(route.summary.departureTimeMinutes, route.summary.totalDurationMinutes)
  if (before === undefined || after.progress.distanceKm === before.progress.distanceKm) return createRouteClockTime(route.summary.departureTimeMinutes, after.progress.elapsedMinutes)
  const ratio = Math.max(0, Math.min(1, (distanceKm - before.progress.distanceKm) / (after.progress.distanceKm - before.progress.distanceKm)))
  return createRouteClockTime(route.summary.departureTimeMinutes, before.progress.elapsedMinutes + ratio * (after.progress.elapsedMinutes - before.progress.elapsedMinutes))
}

interface DisplayPoint { readonly id: string; readonly distanceKm: number; readonly elapsedMinutes: number; readonly priority: number; readonly generated: boolean; readonly html: string }

function documentedPoint(route: RouteTimeline, point: RoadbookPointMatch): DisplayPoint {
  const distanceKm = point.matchedTrackDistanceKm ?? 0
  const eta = point.eta ?? timeAtDistance(route, distanceKm)
  const offRoute = point.resolution !== 'matched'
  const bonette = point.name.toLocaleLowerCase('fr-FR').includes('cime de la bonette')
  const role = getRoadbookPointRole(point)
  const linkedPause = point.linkedWaypointId === undefined ? undefined : route.pauses.find(({ startWaypointId }) => startWaypointId === point.linkedWaypointId)
  const functions = [pointTypeLabels[point.type], point.isResupplyCandidate === true && point.type !== 'resupply' ? 'ravitaillement' : null, linkedPause === undefined ? null : `pause ${linkedPause.durationMinutes} min`].filter((value): value is string => value !== null)
  const status = bonette ? 'Option non parcourue · hors trace' : offRoute ? 'Hors parcours · heure de référence' : 'Sur le parcours'
  const reference = offRoute ? 'Kilomètre de référence' : 'Kilomètre'
  return { id: point.id, distanceKm, elapsedMinutes: eta.totalMinutesFromDeparture, priority: 0, generated: false, html: `<details class="route-point ${offRoute ? 'route-point--off-route' : ''}" role="listitem" data-route-point-id="${escapeHtml(point.id)}" data-route-point-origin="roadbook" data-route-distance="${distanceKm}" data-route-off-track="${offRoute}"><summary><span class="route-point__time">${renderClock(eta)}${offRoute ? '<small>Référence</small>' : ''}</span><span class="route-point__main"><strong>${escapeHtml(point.name)}</strong><small>${altitude(point.matchedElevationM ?? point.elevationM)} · ${escapeHtml(functions.join(' · '))}</small><small>${escapeHtml(status)}</small></span><span class="route-point__distance">${reference} ${distanceFormatter.format(distanceKm)} km</span></summary><div class="route-point__details"><p>${escapeHtml(point.notes ?? point.resolutionJustification ?? 'Point documenté du roadbook.')}</p><p>Fonctions : ${escapeHtml(functions.join(', '))}</p><p>Rôle : ${escapeHtml(role)}</p>${point.matchDistanceM === undefined ? '' : `<p>Distance à la trace : ${integerFormatter.format(point.matchDistanceM)} m</p>`}${linkedPause === undefined ? '<p>Pause inactive</p>' : `<p>Pause active : ${linkedPause.durationMinutes} min</p>`}</div></details>` }
}

function generatedLabel(waypoint: RouteWaypoint): string {
  if (waypoint.type === 'time-marker') return waypoint.progress.distanceKm >= 5 ? `Repère ${Math.round(waypoint.progress.distanceKm / 5) * 5} km` : 'Passage après le départ'
  return generatedTypeLabels[waypoint.type]
}

function generatedPoint(route: RouteTimeline, waypoint: RouteWaypoint): DisplayPoint {
  const eta = createRouteClockTime(route.summary.departureTimeMinutes, waypoint.progress.elapsedMinutes)
  const label = generatedLabel(waypoint)
  return { id: waypoint.id, distanceKm: waypoint.progress.distanceKm, elapsedMinutes: waypoint.progress.elapsedMinutes, priority: 2, generated: true, html: `<details class="route-point route-point--generated" role="listitem" hidden data-route-point-id="${escapeHtml(waypoint.id)}" data-route-point-origin="generated" data-route-distance="${waypoint.progress.distanceKm}"><summary><span class="route-point__time">${renderClock(eta)}</span><span class="route-point__main"><strong>${escapeHtml(label)}</strong><small>${altitude(waypoint.progress.altitudeM)} · repère GPX</small></span><span class="route-point__distance">${distanceFormatter.format(waypoint.progress.distanceKm)} km</span></summary><div class="route-point__details"><p>Point utile généré depuis le profil GPX.</p><p>Rôle : repère automatique</p></div></details>` }
}

export function buildRouteDisplayPoints(route: RouteTimeline, dayId: string, report: RoadbookMatchReport | null): readonly DisplayPoint[] {
  const documented = (report?.allPointMatches.filter((point) => point.dayId === dayId) ?? []).map((point) => documentedPoint(route, point))
  const generated = route.waypoints.filter(({ type }) => !['route-start', 'route-end', 'gpx-start', 'gpx-end', 'pause-start', 'pause-end'].includes(type)).map((point) => generatedPoint(route, point)).filter((candidate) => !documented.some((point) => Math.abs(point.distanceKm - candidate.distanceKm) <= 0.25 && Math.abs(point.elapsedMinutes - candidate.elapsedMinutes) <= 3))
  const endpoints = route.waypoints.filter(({ type }) => type === 'route-start' || type === 'route-end').map((point) => generatedPoint(route, point)).map((point) => ({ ...point, priority: -1, generated: false, html: point.html.replace(' route-point--generated', '').replace(' hidden ', ' ').replace('data-route-point-origin="generated"', 'data-route-point-origin="endpoint"') }))
  const values = [...endpoints, ...documented, ...generated].sort((a, b) => a.distanceKm - b.distanceKm || a.priority - b.priority || a.elapsedMinutes - b.elapsedMinutes)
  const unique = new Map<string, DisplayPoint>()
  for (const value of values) { const key = `${Math.round(value.distanceKm * 100)}:${value.id}`; if (!unique.has(key)) unique.set(key, value) }
  return [...unique.values()]
}

function clear(container: HTMLElement): void { for (const key of ['routeDayId','routeDayType','routeWaypointCount','routeArrivalElapsed','routeArrivalTime','routeArrivalDayOffset','routeGpx','routeSpeed','routePauseMinutes','routeFirstElapsed']) delete container.dataset[key] }
export function renderRouteEngineLoading(container: HTMLElement): void { clear(container); container.dataset.routeState = 'loading'; container.setAttribute('aria-busy', 'true'); container.innerHTML = '<p class="route-engine__message" role="status">Construction du parcours…</p>' }
export function renderRouteEngineError(container: HTMLElement, error: unknown): void { clear(container); container.dataset.routeState = 'error'; container.setAttribute('aria-busy', 'false'); container.innerHTML = `<div class="route-engine__message route-engine__message--error" role="alert"><strong>Moteur d’itinéraire indisponible</strong><p>${escapeHtml(error instanceof Error ? error.message : 'Erreur inconnue.')}</p></div>` }
function renderOff(container: HTMLElement, day: Extract<TripDayTimeline, { type: 'off' }>): void { clear(container); container.dataset.routeState = 'off'; container.setAttribute('aria-busy', 'false'); container.innerHTML = `<div class="route-engine__off"><span class="tag tag--off">${day.day.id} · OFF</span><h3>${escapeHtml(day.day.title)}</h3><p>${escapeHtml(day.day.locationName)}</p><strong>Aucun GPX cycliste.</strong></div>` }
function renderUnavailable(container: HTMLElement, day: Extract<TripDayTimeline, { type: 'ride'; status: 'unavailable' }>): void { clear(container); container.dataset.routeState = 'unavailable'; container.setAttribute('aria-busy', 'false'); container.innerHTML = `<div class="route-engine__message route-engine__message--error" role="alert"><strong>${day.day.id} · GPX indisponible</strong><p>${escapeHtml(day.message)}</p></div>` }
function renderReady(container: HTMLElement, timeline: RideDayTimeline, report: RoadbookMatchReport | null): void {
  const points = buildRouteDisplayPoints(timeline.route, timeline.day.id, report)
  container.dataset.routeState = 'success'; container.dataset.routeDayId = timeline.day.id; container.dataset.routeDayType = 'ride'; container.dataset.routeGpx = String(timeline.day.gpxNumber); container.dataset.routeWaypointCount = String(points.length); container.setAttribute('aria-busy', 'false')
  container.innerHTML = `<div class="route-detail-control"><span>Points documentés</span><label class="switch"><input type="checkbox" role="switch" aria-checked="false" data-route-detail-toggle><span class="switch__track" aria-hidden="true"><span></span></span><strong>Détail</strong></label></div><div class="route-point-list" role="list" aria-label="Parcours de ${timeline.day.id}">${points.map(({ html }) => html).join('')}</div>`
}
export function setRouteDetail(container: HTMLElement, enabled: boolean): void { for (const point of container.querySelectorAll<HTMLElement>('[data-route-point-origin="generated"]')) point.hidden = !enabled; const input = container.querySelector<HTMLInputElement>('[data-route-detail-toggle]'); if (input !== null) input.setAttribute('aria-checked', String(enabled)); container.dataset.routeDetail = String(enabled) }
export function renderTripDayRouteTimeline(container: HTMLElement, day: TripDayTimeline, report: RoadbookMatchReport | null = null): void { if (day.type === 'off') renderOff(container, day); else if (day.status === 'unavailable') renderUnavailable(container, day); else renderReady(container, day, report) }
