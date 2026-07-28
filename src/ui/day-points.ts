import { getDistanceToRouteKm, getRoadbookPointRole } from '../trip/point-role.ts'
import type { RoadbookDayMatchReport, RoadbookPointMatch } from '../trip/roadbook-match.ts'
import type { TripDayTimeline } from '../trip/types.ts'

const esc = (value: string): string => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
const clock = (minutes: number): string => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
const roleLabels = { 'route-point': 'Sur le parcours', 'weather-reference': 'Météo à proximité', information: 'Information', excluded: 'Non parcouru' } as const

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
  const status = role === 'weather-reference' ? 'Hors parcours — heure de référence' : roleLabels[role]
  const functionLabel = point.isPauseCandidate ? 'Pause possible' : point.isResupplyCandidate ? 'Ravitaillement possible' : point.type
  return `<details class="point-row" data-point-category="${category(point)}" data-point-name="${esc(point.name)}"><summary><span class="point-row__type">${esc(point.type)}</span><strong>${esc(point.name)}</strong><span>${status}</span><span>${km} · ${eta}</span></summary><dl><div><dt>Rôle</dt><dd>${roleLabels[role]}</dd></div><div><dt>Altitude</dt><dd>${Math.round(point.elevationM ?? point.matchedElevationM ?? 0)} m</dd></div>${role === 'weather-reference' ? `<div><dt>Distance à la trace</dt><dd>${distance === null ? '—' : `environ ${distance.toFixed(1)} km`}</dd></div>` : ''}<div><dt>Fonction</dt><dd>${esc(functionLabel)}</dd></div></dl>${point.notes === undefined ? '' : `<p>${esc(point.notes)}</p>`}</details>`
}

export function getUniqueDisplayPoints(report: Extract<RoadbookDayMatchReport, { type: 'ride' }>): readonly RoadbookPointMatch[] {
  const unique = new Map<string, RoadbookPointMatch>()
  for (const point of report.points.filter(
    (candidate) => !(candidate.resolution === 'informational' && candidate.name.includes(' / ')),
  )) {
    const key = point.name.trim().toLocaleLowerCase('fr-FR')
    const existing = unique.get(key)
    if (existing === undefined || (getRoadbookPointRole(existing) !== 'route-point' && getRoadbookPointRole(point) === 'route-point')) unique.set(key, point)
  }
  return [...unique.values()]
}

export function renderDayPoints(container: HTMLElement, report: RoadbookDayMatchReport | null, _timeline: TripDayTimeline | null): void {
  if (report === null) { container.innerHTML = '<p role="status">Points en cours de préparation…</p>'; return }
  if (report.type === 'off') { container.innerHTML = '<p>Une journée OFF ne contient aucun point cycliste.</p>'; return }
  const points = getUniqueDisplayPoints(report)
  container.innerHTML = `<div class="point-filters" aria-label="Filtrer les points"><button type="button" data-point-filter="all" aria-pressed="true">Tous</button><button type="button" data-point-filter="summit">Cols et sommets</button><button type="button" data-point-filter="pause">Pauses et ravitos</button><button type="button" data-point-filter="passage">Villages et passages</button><button type="button" data-point-filter="endpoint">Départ et arrivée</button><button type="button" data-point-filter="off-route">Hors parcours</button></div><div class="point-list">${points.map(pointItem).join('')}</div>`
}
