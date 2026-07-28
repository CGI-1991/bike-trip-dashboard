import { getDistanceToRouteKm, getRoadbookPointRole } from '../trip/point-role.ts'
import type { RoadbookDayMatchReport, RoadbookPointMatch } from '../trip/roadbook-match.ts'
import type { TripDayTimeline } from '../trip/types.ts'

const esc = (value: string): string => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
const clock = (minutes: number): string => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

function category(point: RoadbookPointMatch): string {
  if (getRoadbookPointRole(point) === 'weather-reference') return 'off-route'
  if (point.type === 'col' || point.type === 'summit') return 'summit'
  if (point.type === 'pause' || point.type === 'resupply') return 'pause'
  if (point.type === 'start' || point.type === 'end') return 'endpoint'
  return 'passage'
}

function pointItem(point: RoadbookPointMatch): string {
  const role = getRoadbookPointRole(point)
  const distance = getDistanceToRouteKm(point)
  const km = point.matchedTrackDistanceKm === undefined ? '—' : `${point.matchedTrackDistanceKm.toFixed(1)} km`
  const eta = point.eta === undefined ? '—' : clock(point.eta.clockMinutes)
  return `<details class="point-row" data-point-category="${category(point)}"><summary><span class="point-row__type">${esc(point.type)}</span><strong>${esc(point.name)}</strong><span>${role === 'weather-reference' ? 'Hors parcours — heure de référence' : 'Sur parcours'}</span><span>${km} · ${eta}</span></summary><dl><div><dt>Rôle</dt><dd>${role}</dd></div><div><dt>Altitude</dt><dd>${Math.round(point.elevationM ?? point.matchedElevationM ?? 0)} m</dd></div><div><dt>Distance à la trace</dt><dd>${distance === null ? '—' : `environ ${distance.toFixed(1)} km`}</dd></div><div><dt>Origine</dt><dd>${esc(point.sourceKind)}</dd></div></dl>${point.notes === undefined ? '' : `<p>${esc(point.notes)}</p>`}</details>`
}

export function renderDayPoints(container: HTMLElement, report: RoadbookDayMatchReport | null, timeline: TripDayTimeline | null): void {
  if (report === null) { container.innerHTML = '<p role="status">Points en cours de préparation…</p>'; return }
  if (report.type === 'off') { container.innerHTML = '<p>Une journée OFF ne contient aucun point cycliste.</p>'; return }
  const points = report.points.filter((point) => getRoadbookPointRole(point) !== 'excluded')
  const summary = timeline?.type === 'ride' && timeline.status === 'ready' ? timeline.route.summary : null
  container.innerHTML = `<dl class="points-metrics"><div><dt>Distance</dt><dd>${summary === null ? '—' : `${summary.distanceKm.toFixed(1)} km`}</dd></div><div><dt>D+</dt><dd>${summary === null ? '—' : `${Math.round(summary.elevationGainM)} m`}</dd></div><div><dt>D−</dt><dd>${summary === null ? '—' : `${Math.round(summary.elevationLossM)} m`}</dd></div><div><dt>Altitude max.</dt><dd>${summary?.maxAltitudeM == null ? '—' : `${Math.round(summary.maxAltitudeM)} m`}</dd></div></dl><div class="point-filters" aria-label="Filtrer les points"><button type="button" data-point-filter="all" aria-pressed="true">Tous</button><button type="button" data-point-filter="summit">Cols et sommets</button><button type="button" data-point-filter="pause">Pauses et ravitos</button><button type="button" data-point-filter="passage">Villages et passages</button><button type="button" data-point-filter="endpoint">Départ et arrivée</button><button type="button" data-point-filter="off-route">Hors parcours</button></div><div class="point-list">${points.map(pointItem).join('')}</div>`
}
