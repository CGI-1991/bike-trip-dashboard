import { calculateHaversineDistanceKm } from '../gpx/parser.ts'
import type { GpxAnalysisSuccess, GpxTrackPoint } from '../gpx/types.ts'
import type { Accommodation } from '../trip/accommodations.ts'
import { resolveArrivalDisplay, resolveDepartureDisplay } from '../trip/endpoint-display.ts'
import type { RoadbookMatchReport, RoadbookPointMatch } from '../trip/roadbook-match.ts'
import type { RideDayTimeline } from '../trip/types.ts'
import { PAUSE_ACCENT_COLOR_HEX, getRouteMarkerCategory, getRouteMarkerStyle } from './route-marker-style.ts'

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

/**
 * Renders one documented point as the same category/shape/color used on the
 * map (`route-marker-style.ts`) — a col is always the same diamond and orange
 * on both surfaces, never a plain colored dot on one and something else on
 * the other. A pause is a secondary ring around that same marker — never a
 * second position, never a separate line elsewhere on the profile.
 */
function renderProfileMarker(
  point: RoadbookPointMatch,
  label: string,
  x: (distance: number) => number,
  y: (altitude: number) => number,
  min: number,
  pauseDurationMinutes: number | undefined,
): string {
  const category = getRouteMarkerCategory(point)
  const style = getRouteMarkerStyle(category)
  const distance = point.matchedTrackDistanceKm as number
  const altitude = point.matchedElevationM ?? point.elevationM ?? min
  const off = point.resolution !== 'matched'
  const radius = style.sizePx / 2
  const cx = x(distance).toFixed(1)
  const cy = y(altitude).toFixed(1)
  const fill = off ? '#ffffff' : style.colorHex
  const stroke = off ? style.colorHex : '#ffffff'
  const strokeWidth = off ? 3 : 2
  const shape =
    style.shape === 'circle'
      ? `<circle r="${radius}" />`
      : style.shape === 'rounded-square'
        ? `<rect x="${-radius}" y="${-radius}" width="${radius * 2}" height="${radius * 2}" rx="${(radius * 0.35).toFixed(1)}" />`
        : `<rect x="${-radius}" y="${-radius}" width="${radius * 2}" height="${radius * 2}" rx="${(radius * 0.2).toFixed(1)}" transform="rotate(45)" />`
  const symbol =
    style.symbol === ''
      ? ''
      : `<text text-anchor="middle" dominant-baseline="central" font-size="${radius}" font-weight="700" fill="${off ? style.colorHex : '#ffffff'}">${style.symbol}</text>`
  const pauseRing = pauseDurationMinutes === undefined ? '' : `<circle r="${(radius + 3).toFixed(1)}" fill="none" stroke="${PAUSE_ACCENT_COLOR_HEX}" stroke-width="2" />`
  const titleSuffix = pauseDurationMinutes === undefined ? '' : ` · Pause ${pauseDurationMinutes} min`
  return `<g class="profile-marker profile-marker--${category}${off ? ' profile-marker--off-route' : ''}${pauseDurationMinutes === undefined ? '' : ' profile-marker--pause'}" transform="translate(${cx} ${cy})" style="fill:${fill};stroke:${stroke};stroke-width:${strokeWidth};"><title>${escapeHtml(label)} · ${distance.toFixed(1)} km${titleSuffix}</title>${pauseRing}${shape}${symbol}</g>`
}

export function renderElevationProfile(
  container: HTMLElement,
  gpx: GpxAnalysisSuccess | null,
  timeline: RideDayTimeline | null,
  report: RoadbookMatchReport | null,
  accommodation: Accommodation | null = null,
): void {
  if (gpx === null || timeline === null) { container.innerHTML = '<p>Profil indisponible.</p>'; return }
  const samples = sampleElevationProfile(gpx)
  if (samples.length < 2) { container.innerHTML = '<p>Profil altimétrique indisponible.</p>'; return }
  const min = Math.min(...samples.map(({ altitudeM }) => altitudeM)); const max = Math.max(...samples.map(({ altitudeM }) => altitudeM)); const total = samples.at(-1)?.distanceKm ?? 1
  const x = (distance: number) => 20 + 760 * distance / Math.max(total, 0.1); const y = (alt: number) => 210 - 180 * (alt - min) / Math.max(max - min, 1)
  const line = samples.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(point.distanceKm).toFixed(1)},${y(point.altitudeM).toFixed(1)}`).join(' ')
  const dayReport = report?.days.find((day) => day.dayId === timeline.day.id)
  const roadbookDay = dayReport?.type === 'ride' ? dayReport.roadbook : undefined
  const dayPoints = dayReport?.type === 'ride' ? dayReport.points : []
  // A pause is matched strictly by the documented point's own roadbook id —
  // see `RoutePause.pointId` — never by nearest-waypoint proximity.
  const pauseByPointId = new Map(timeline.route.pauses.flatMap((pause) => pause.pointId === undefined ? [] : [[pause.pointId, pause] as const]))
  const markers = dayPoints
    .filter(({ matchedTrackDistanceKm }) => matchedTrackDistanceKm !== undefined)
    .map((point) => {
      const label =
        point.type === 'start' && roadbookDay !== undefined
          ? resolveDepartureDisplay(roadbookDay).primaryName
          : point.type === 'end' && roadbookDay !== undefined
            ? resolveArrivalDisplay(roadbookDay, accommodation).primaryName
            : point.name
      return renderProfileMarker(point, label, x, y, min, pauseByPointId.get(point.id)?.durationMinutes)
    })
    .join('')
  container.innerHTML = `<figure class="elevation-profile"><svg viewBox="0 0 800 240" role="img" aria-labelledby="profile-title-${timeline.day.id}" preserveAspectRatio="none"><title id="profile-title-${timeline.day.id}">Profil altimétrique de ${timeline.day.id}</title><path class="profile-area" d="${line} L780,214 L20,214 Z"/><path class="profile-line" d="${line}"/>${markers}<text x="20" y="20">${Math.round(max)} m</text><text x="20" y="230">${Math.round(min)} m</text><text x="700" y="230">${total.toFixed(1)} km</text></svg><figcaption>Profil GPX échantillonné · départ/arrivée, cols et passages documentés ; hors parcours en contour.</figcaption></figure>`
}
