import { calculateHaversineDistanceKm } from '../gpx/parser.ts'
import type { GpxAnalysisSuccess, GpxTrackPoint } from '../gpx/types.ts'
import type { RoadbookMatchReport } from '../trip/roadbook-match.ts'
import type { RideDayTimeline } from '../trip/types.ts'

export interface ProfileSample { readonly distanceKm: number; readonly altitudeM: number }

export function sampleElevationProfile(gpx: GpxAnalysisSuccess, maximumPoints = 280): readonly ProfileSample[] {
  const points = gpx.segments.flatMap(({ points }) => points)
  const values: ProfileSample[] = []
  let distanceKm = 0
  points.forEach((point, index) => { if (index > 0) distanceKm += calculateHaversineDistanceKm(points[index - 1] as GpxTrackPoint, point); if (point.elevationM !== null) values.push({ distanceKm, altitudeM: point.elevationM }) })
  if (values.length <= maximumPoints) return values
  const sampled: ProfileSample[] = [values[0] as ProfileSample]
  const bucketSize = (values.length - 2) / (maximumPoints - 2)
  for (let bucket = 0; bucket < maximumPoints - 2; bucket++) {
    const start = Math.floor(1 + bucket * bucketSize)
    const end = Math.max(start + 1, Math.floor(1 + (bucket + 1) * bucketSize))
    const slice = values.slice(start, end)
    const previous = sampled.at(-1) as ProfileSample
    const candidate = slice.reduce((best, value) => Math.abs(value.altitudeM - previous.altitudeM) > Math.abs(best.altitudeM - previous.altitudeM) ? value : best, slice[0] as ProfileSample)
    sampled.push(candidate)
  }
  sampled.push(values.at(-1) as ProfileSample)
  return sampled
}

function escapeHtml(value: string): string { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;') }

export function renderElevationProfile(container: HTMLElement, gpx: GpxAnalysisSuccess | null, timeline: RideDayTimeline | null, report: RoadbookMatchReport | null): void {
  if (gpx === null || timeline === null) { container.innerHTML = '<p>Profil indisponible.</p>'; return }
  const samples = sampleElevationProfile(gpx)
  if (samples.length < 2) { container.innerHTML = '<p>Profil altimétrique indisponible.</p>'; return }
  const min = Math.min(...samples.map(({ altitudeM }) => altitudeM)); const max = Math.max(...samples.map(({ altitudeM }) => altitudeM)); const total = samples.at(-1)?.distanceKm ?? 1
  const x = (distance: number) => 20 + 760 * distance / Math.max(total, 0.1); const y = (alt: number) => 210 - 180 * (alt - min) / Math.max(max - min, 1)
  const line = samples.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(point.distanceKm).toFixed(1)},${y(point.altitudeM).toFixed(1)}`).join(' ')
  const dayPoints = report?.allPointMatches.filter(({ dayId }) => dayId === timeline.day.id) ?? []
  const markers = dayPoints.filter(({ matchedTrackDistanceKm }) => matchedTrackDistanceKm !== undefined).map((point) => { const distance = point.matchedTrackDistanceKm as number; const altitude = point.matchedElevationM ?? point.elevationM ?? min; const off = point.resolution !== 'matched'; return `<g class="profile-marker ${off ? 'profile-marker--off-route' : ''}" transform="translate(${x(distance).toFixed(1)} ${y(altitude).toFixed(1)})"><circle r="${off ? 5 : 4}"/><title>${escapeHtml(point.name)} · ${distance.toFixed(1)} km</title></g>` }).join('')
  const pauses = timeline.route.pauses.map((pause) => `<line class="profile-pause" x1="${x(pause.distanceKm)}" x2="${x(pause.distanceKm)}" y1="24" y2="214"><title>Pause ${pause.durationMinutes} min</title></line>`).join('')
  container.innerHTML = `<figure class="elevation-profile"><svg viewBox="0 0 800 240" role="img" aria-labelledby="profile-title-${timeline.day.id}" preserveAspectRatio="none"><title id="profile-title-${timeline.day.id}">Profil altimétrique de ${timeline.day.id}</title><path class="profile-area" d="${line} L780,214 L20,214 Z"/><path class="profile-line" d="${line}"/>${pauses}${markers}<text x="20" y="20">${Math.round(max)} m</text><text x="20" y="230">${Math.round(min)} m</text><text x="700" y="230">${total.toFixed(1)} km</text></svg><figcaption>Profil GPX échantillonné · points hors parcours en cercle vide.</figcaption></figure>`
}
