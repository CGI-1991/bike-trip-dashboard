import {
  createRouteClockTime,
  describeRouteClockTime,
  formatRouteClockTime,
} from '../route/time.ts'
import type {
  RouteClockTime,
  RouteTimeline,
  RouteWaypointType,
} from '../route/types.ts'
import type {
  RideDayTimeline,
  TripDayTimeline,
} from '../trip/types.ts'
import type {
  RoadbookMatchReport,
  RoadbookPointMatch,
  RoadbookStandaloneWaypoint,
  RoadbookWaypointLink,
} from '../trip/roadbook-match.ts'
import type { RoadbookPointType } from '../trip/roadbook-types.ts'

const distanceFormatter = new Intl.NumberFormat('fr-FR', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})
const integerFormatter = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 })

const waypointTypeLabels: Record<RouteWaypointType, string> = {
  'route-start': 'Départ',
  'route-end': 'Arrivée',
  'gpx-start': 'Début GPX',
  'gpx-end': 'Fin GPX',
  summit: 'Sommet',
  valley: 'Vallée',
  'slope-change': 'Pente',
  'time-marker': 'Repère',
  'pause-start': 'Début pause',
  'pause-end': 'Fin pause',
}

const roadbookPointTypeLabels: Record<RoadbookPointType, string> = {
  start: 'Départ roadbook',
  end: 'Arrivée roadbook',
  col: 'Col',
  summit: 'Sommet',
  village: 'Village',
  passage: 'Passage',
  resupply: 'Ravitaillement',
  pause: 'Pause',
  shelter: 'Abri',
  lodging: 'Hébergement',
  poi: 'Point d’intérêt',
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function renderRouteClockTime(value: RouteClockTime): string {
  return `<time aria-label='${escapeHtml(describeRouteClockTime(value))}'>${escapeHtml(formatRouteClockTime(value))}</time>`
}

function formatDuration(totalMinutes: number): string {
  const roundedMinutes = Math.round(totalMinutes)
  const hours = Math.floor(roundedMinutes / 60)
  const minutes = roundedMinutes % 60
  return hours === 0 ? `${minutes} min` : `${hours} h ${String(minutes).padStart(2, '0')}`
}

function formatAltitude(altitudeM: number | null): string {
  return altitudeM === null ? '—' : `${integerFormatter.format(altitudeM)} m`
}

function formatGpxNumber(gpxNumber: number): string {
  return String(gpxNumber).padStart(2, '0')
}

interface RenderedWaypointRow {
  readonly elapsedMinutes: number
  readonly distanceKm: number
  readonly order: number
  readonly html: string
}

function renderAutomaticWaypointRow(
  timeline: RouteTimeline,
  waypoint: RouteTimeline['waypoints'][number],
  link: RoadbookWaypointLink | undefined,
  primaryPoint: RoadbookPointMatch | undefined,
): RenderedWaypointRow {
  const pointIds = link?.roadbookPointIds.join(' ') ?? ''
  const typeLabel = primaryPoint === undefined
    ? waypointTypeLabels[waypoint.type]
    : roadbookPointTypeLabels[primaryPoint.type]
  const displayName = link?.displayName ?? waypoint.name
  const technicalName = link === undefined ? '' : `<small>${escapeHtml(waypoint.name)}</small>`

  return {
    elapsedMinutes: waypoint.progress.elapsedMinutes,
    distanceKm: waypoint.progress.distanceKm,
    order: 0,
    html: `
        <tr
          data-route-waypoint
          data-route-waypoint-origin="automatic"
          data-route-waypoint-type="${waypoint.type}"
          data-route-elapsed="${waypoint.progress.elapsedMinutes}"
          data-route-distance="${waypoint.progress.distanceKm}"
          data-route-gpx="${waypoint.sourceFileNumber}"
          ${pointIds.length === 0 ? '' : `data-roadbook-point-ids="${escapeHtml(pointIds)}"`}
        >
          <td>${renderRouteClockTime(
            createRouteClockTime(
              timeline.summary.departureTimeMinutes,
              waypoint.progress.elapsedMinutes,
            ),
          )}</td>
          <td>
            <strong>${typeLabel}</strong>
            <span>${escapeHtml(displayName)}</span>
            ${technicalName}
          </td>
          <td>${distanceFormatter.format(waypoint.progress.distanceKm)} km</td>
          <td>${formatAltitude(waypoint.progress.altitudeM)}</td>
          <td>${formatGpxNumber(waypoint.sourceFileNumber)}</td>
        </tr>`,
  }
}

function renderStandaloneWaypointRow(
  timeline: RouteTimeline,
  waypoint: RoadbookStandaloneWaypoint,
): RenderedWaypointRow {
  const gpxNumber = timeline.summary.firstSourceFileNumber

  return {
    elapsedMinutes: waypoint.eta.totalMinutesFromDeparture,
    distanceKm: waypoint.trackDistanceKm,
    order: 1,
    html: `
      <tr
        data-route-waypoint
        data-route-waypoint-origin="roadbook"
        data-route-waypoint-type="${waypoint.type}"
        data-route-elapsed="${waypoint.eta.totalMinutesFromDeparture}"
        data-route-distance="${waypoint.trackDistanceKm}"
        data-route-gpx="${gpxNumber}"
        data-roadbook-point-ids="${escapeHtml(waypoint.roadbookPointIds.join(' '))}"
      >
        <td>${renderRouteClockTime(waypoint.eta)}</td>
        <td>
          <strong>${roadbookPointTypeLabels[waypoint.type]}</strong>
          <span>${escapeHtml(waypoint.name)}</span>
          <small>Point roadbook apparié</small>
        </td>
        <td>${distanceFormatter.format(waypoint.trackDistanceKm)} km</td>
        <td>${formatAltitude(waypoint.altitudeM)}</td>
        <td>${formatGpxNumber(gpxNumber)}</td>
      </tr>`,
  }
}

function renderWaypointRows(
  timeline: RouteTimeline,
  dayId: string,
  roadbookReport: RoadbookMatchReport | null,
): string {
  const links = roadbookReport?.waypointLinks.filter((link) => link.dayId === dayId) ?? []
  const standaloneWaypoints = roadbookReport?.standaloneWaypoints.filter(
    (waypoint) => waypoint.dayId === dayId,
  ) ?? []
  const linksByWaypointId = new Map(links.map((link) => [link.waypointId, link]))
  const pointsById = new Map(
    (roadbookReport?.allPointMatches ?? []).map((point) => [point.id, point]),
  )
  const rows = [
    ...timeline.waypoints.map((waypoint) => {
      const link = linksByWaypointId.get(waypoint.id)
      return renderAutomaticWaypointRow(
        timeline,
        waypoint,
        link,
        link === undefined ? undefined : pointsById.get(link.primaryRoadbookPointId),
      )
    }),
    ...standaloneWaypoints.map((waypoint) =>
      renderStandaloneWaypointRow(timeline, waypoint),
    ),
  ]

  return rows
    .sort(
      (left, right) =>
        left.elapsedMinutes - right.elapsedMinutes ||
        left.distanceKm - right.distanceKm ||
        left.order - right.order,
    )
    .map(({ html }) => html)
    .join('')
}

function clearCalculatedData(container: HTMLElement): void {
  delete container.dataset.routeDayId
  delete container.dataset.routeDayType
  delete container.dataset.routeWaypointCount
  delete container.dataset.routeArrivalElapsed
  delete container.dataset.routeArrivalTime
  delete container.dataset.routeArrivalDayOffset
  delete container.dataset.routeGpx
  delete container.dataset.routeSpeed
  delete container.dataset.routePauseMinutes
  delete container.dataset.routeFirstElapsed
}

export function renderRouteEngineLoading(container: HTMLElement): void {
  clearCalculatedData(container)
  container.dataset.routeState = 'loading'
  container.setAttribute('aria-busy', 'true')
  container.innerHTML = `
    <p class="route-engine__message" role="status" aria-live="polite">
      Construction des chronologies journalières…
    </p>`
}

export function renderRouteEngineError(container: HTMLElement, error: unknown): void {
  const message = error instanceof Error ? error.message : 'Erreur inconnue.'
  clearCalculatedData(container)
  container.dataset.routeState = 'error'
  container.setAttribute('aria-busy', 'false')
  container.innerHTML = `
    <div class="route-engine__message route-engine__message--error" role="alert">
      <strong>Moteur d’itinéraire indisponible</strong>
      <p>${escapeHtml(message)}</p>
    </div>`
}

function renderOffDayTimeline(
  container: HTMLElement,
  dayTimeline: Extract<TripDayTimeline, { type: 'off' }>,
): void {
  clearCalculatedData(container)
  container.dataset.routeState = 'off'
  container.dataset.routeDayId = dayTimeline.day.id
  container.dataset.routeDayType = 'off'
  container.setAttribute('aria-busy', 'false')
  container.innerHTML = `
    <div class="route-engine__off" role="status" aria-live="polite">
      <span class="tag tag--off">${dayTimeline.day.id} · OFF</span>
      <h3>${escapeHtml(dayTimeline.day.title)}</h3>
      <p>${escapeHtml(dayTimeline.day.locationName)}</p>
      <strong>Aucune distance, aucun D+ et aucune ETA cycliste.</strong>
      <small>Prochaine journée roulée : ${dayTimeline.day.nextRideDayId}</small>
    </div>`
}

function renderUnavailableRideTimeline(
  container: HTMLElement,
  dayTimeline: Extract<TripDayTimeline, { type: 'ride'; status: 'unavailable' }>,
): void {
  clearCalculatedData(container)
  container.dataset.routeState = 'unavailable'
  container.dataset.routeDayId = dayTimeline.day.id
  container.dataset.routeDayType = 'ride'
  container.dataset.routeGpx = String(dayTimeline.day.gpxNumber)
  container.setAttribute('aria-busy', 'false')
  container.innerHTML = `
    <div class="route-engine__message route-engine__message--error" role="alert">
      <strong>${dayTimeline.day.id} · GPX ${formatGpxNumber(dayTimeline.day.gpxNumber)} indisponible</strong>
      <p>${escapeHtml(dayTimeline.message)}</p>
    </div>`
}

function renderReadyRideTimeline(
  container: HTMLElement,
  dayTimeline: RideDayTimeline,
  roadbookReport: RoadbookMatchReport | null,
): void {
  const { day, route } = dayTimeline
  const { summary, settings } = route
  const firstElapsedMinutes = route.waypoints[0]?.progress.elapsedMinutes ?? Number.NaN

  container.dataset.routeState = 'success'
  container.dataset.routeDayId = day.id
  container.dataset.routeDayType = 'ride'
  container.dataset.routeGpx = String(day.gpxNumber)
  container.dataset.routeWaypointCount = String(summary.waypointCount)
  container.dataset.routeArrivalElapsed = String(summary.totalDurationMinutes)
  container.dataset.routeArrivalTime = formatRouteClockTime(dayTimeline.arrivalTime)
  container.dataset.routeArrivalDayOffset = String(dayTimeline.arrivalTime.dayOffset)
  container.dataset.routeSpeed = String(settings.averageSpeedKph)
  container.dataset.routePauseMinutes = String(summary.pauseDurationMinutes)
  container.dataset.routeFirstElapsed = String(firstElapsedMinutes)
  container.setAttribute('aria-busy', 'false')
  container.innerHTML = `
    <div class="route-engine__status" role="status" aria-live="polite">
      <strong>${day.id} · ${escapeHtml(day.name)}</strong>
      <span>GPX ${formatGpxNumber(day.gpxNumber)} · ${summary.waypointCount} waypoints</span>
    </div>

    <dl class="route-engine__summary">
      <div>
        <dt>Départ</dt>
        <dd>${escapeHtml(dayTimeline.startTime)}</dd>
      </div>
      <div>
        <dt>Durée roulée</dt>
        <dd>${formatDuration(summary.movingDurationMinutes)}</dd>
      </div>
      <div>
        <dt>Pauses</dt>
        <dd>${formatDuration(summary.pauseDurationMinutes)}</dd>
      </div>
      <div>
        <dt>ETA d’arrivée</dt>
        <dd>${renderRouteClockTime(dayTimeline.arrivalTime)}</dd>
      </div>
    </dl>

    <div
      class="route-table-wrapper"
      role="region"
      tabindex="0"
      aria-label="Chronologie des waypoints de ${day.id}"
    >
      <table class="route-table">
        <caption class="visually-hidden">Waypoints calculés pour ${day.id}</caption>
        <thead>
          <tr>
            <th scope="col">Heure</th>
            <th scope="col">Type</th>
            <th scope="col">Distance</th>
            <th scope="col">Altitude</th>
            <th scope="col">GPX</th>
          </tr>
        </thead>
        <tbody>${renderWaypointRows(route, day.id, roadbookReport)}</tbody>
      </table>
    </div>

    <p class="route-engine__note">
      Chronologie propre à ${day.id} : temps écoulé remis à zéro et aucune propagation vers le jour suivant.
    </p>`
}

export function renderTripDayRouteTimeline(
  container: HTMLElement,
  dayTimeline: TripDayTimeline,
  roadbookReport: RoadbookMatchReport | null = null,
): void {
  if (dayTimeline.type === 'off') {
    renderOffDayTimeline(container, dayTimeline)
    return
  }

  if (dayTimeline.status === 'unavailable') {
    renderUnavailableRideTimeline(container, dayTimeline)
    return
  }

  renderReadyRideTimeline(container, dayTimeline, roadbookReport)
}
