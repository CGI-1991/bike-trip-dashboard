import { calculateHaversineDistanceKm } from '../gpx/parser.ts'
import type { GpxAnalysisSuccess, GpxTrackPoint } from '../gpx/types.ts'
import type { Accommodation } from '../trip/accommodations.ts'
import { resolveArrivalDisplay, resolveDepartureDisplay } from '../trip/endpoint-display.ts'
import type { RoadbookMatchReport, RoadbookPointMatch } from '../trip/roadbook-match.ts'
import type { RideDayTimeline } from '../trip/types.ts'
import { buildTerrainProfileSeries } from '../route/terrain-profile.ts'
import type { RouteProfilePosition, TerrainProfilePoint } from '../route/types.ts'
import { PAUSE_ACCENT_COLOR_HEX, getRouteMarkerCategory, getRouteMarkerStyle } from './route-marker-style.ts'

export interface ProfileSample extends TerrainProfilePoint { readonly altitudeM: number }

export function sampleElevationProfile(gpx: GpxAnalysisSuccess, maximumPoints = 280): readonly ProfileSample[] {
  const points = gpx.segments.flatMap(({ points }) => points)
  const source: RouteProfilePosition[] = []
  let distanceKm = 0
  points.forEach((point, index) => {
    if (index > 0) distanceKm += calculateHaversineDistanceKm(points[index - 1] as GpxTrackPoint, point)
    source.push({ latitude: point.latitude, longitude: point.longitude, sourceFileNumber: gpx.summary?.fileNumber ?? 1, sourceFileName: gpx.summary?.fileName ?? 'profile.gpx', distanceKm, elevationGainM: 0, elevationLossM: 0, altitudeM: point.elevationM, localSlopePercent: 0, speedMultiplier: 1, weightedDistanceKm: distanceKm })
  })
  const values: ProfileSample[] = buildTerrainProfileSeries(source).map((point) => ({ ...point, altitudeM: point.elevationM }))
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

export function interpolateProfileSample(samples: readonly ProfileSample[], distanceKm: number): ProfileSample {
  const afterIndex = samples.findIndex((sample) => sample.distanceKm >= distanceKm)
  const after = samples[afterIndex < 0 ? samples.length - 1 : afterIndex] as ProfileSample
  const before = samples[Math.max(0, (afterIndex < 0 ? samples.length - 1 : afterIndex) - 1)] as ProfileSample
  const delta = after.distanceKm - before.distanceKm
  const ratio = delta <= 1e-9 ? 0 : Math.min(1, Math.max(0, (distanceKm - before.distanceKm) / delta))
  const lerp = (a: number, b: number) => a + (b - a) * ratio
  return { distanceKm, altitudeM: lerp(before.altitudeM, after.altitudeM), elevationM: lerp(before.elevationM, after.elevationM), smoothedGradePercent: lerp(before.smoothedGradePercent, after.smoothedGradePercent), latitude: lerp(before.latitude, after.latitude), longitude: lerp(before.longitude, after.longitude) }
}

const profileControllers = new WeakMap<HTMLElement, AbortController>()

function installProfileInteraction(container: HTMLElement, samples: readonly ProfileSample[], min: number, max: number, total: number): void {
  if (typeof container.querySelector !== 'function') return
  profileControllers.get(container)?.abort()
  const controller = new AbortController()
  profileControllers.set(container, controller)
  const svg = container.querySelector<SVGSVGElement>('[data-profile-interactive]')
  const cursor = container.querySelector<SVGGElement>('[data-profile-cursor]')
  const line = container.querySelector<SVGLineElement>('[data-profile-cursor-line]')
  const dot = container.querySelector<SVGCircleElement>('[data-profile-cursor-dot]')
  const tooltip = container.querySelector<HTMLElement>('[data-profile-tooltip]')
  const live = container.querySelector<HTMLElement>('[data-profile-live]')
  if (svg === null || cursor === null || line === null || dot === null || tooltip === null || live === null) return
  let selectedIndex = 0
  const show = (distanceKm: number) => {
    const sample = interpolateProfileSample(samples, Math.min(total, Math.max(0, distanceKm)))
    selectedIndex = Math.max(0, samples.findIndex((candidate) => candidate.distanceKm >= sample.distanceKm))
    const x = 20 + 760 * sample.distanceKm / Math.max(total, 0.1)
    const y = 210 - 180 * (sample.altitudeM - min) / Math.max(max - min, 1)
    line.setAttribute('x1', x.toFixed(1)); line.setAttribute('x2', x.toFixed(1))
    dot.setAttribute('cx', x.toFixed(1)); dot.setAttribute('cy', y.toFixed(1))
    cursor.removeAttribute('hidden')
    const text = `${sample.distanceKm.toFixed(1)} km · ${Math.round(sample.altitudeM)} m · Pente moyenne : ${sample.smoothedGradePercent.toFixed(1)} %`
    live.textContent = text
    tooltip.innerHTML = `<strong>${sample.distanceKm.toFixed(1)} km</strong><span>${Math.round(sample.altitudeM)} m</span><span>Pente moyenne : ${sample.smoothedGradePercent.toFixed(1)} %</span>`
    const ratio = sample.distanceKm / Math.max(total, 0.1)
    tooltip.style.left = `${Math.min(86, Math.max(14, ratio * 100))}%`
    tooltip.hidden = false
  }
  const fromPointer = (event: PointerEvent) => {
    const rect = svg.getBoundingClientRect()
    show(((event.clientX - rect.left) / Math.max(rect.width, 1)) * total)
  }
  svg.addEventListener('pointerdown', (event) => { svg.setPointerCapture?.(event.pointerId); fromPointer(event) }, { signal: controller.signal })
  svg.addEventListener('pointermove', fromPointer, { signal: controller.signal })
  svg.addEventListener('pointerleave', () => { cursor.setAttribute('hidden', ''); tooltip.hidden = true }, { signal: controller.signal })
  svg.addEventListener('pointerup', (event) => { svg.releasePointerCapture?.(event.pointerId) }, { signal: controller.signal })
  svg.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    selectedIndex = Math.min(samples.length - 1, Math.max(0, selectedIndex + (event.key === 'ArrowRight' ? 1 : -1)))
    show((samples[selectedIndex] as ProfileSample).distanceKm)
  }, { signal: controller.signal })
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
  container.innerHTML = `<figure class="elevation-profile"><div class="elevation-profile__stage"><svg data-profile-interactive tabindex="0" viewBox="0 0 800 240" role="group" aria-labelledby="profile-title-${timeline.day.id}" aria-describedby="profile-live-${timeline.day.id}" preserveAspectRatio="none"><title id="profile-title-${timeline.day.id}">Profil altimétrique interactif de ${timeline.day.id}</title><path class="profile-area" d="${line} L780,214 L20,214 Z"/><path class="profile-line" d="${line}"/>${markers}<g class="profile-cursor" data-profile-cursor hidden><line data-profile-cursor-line y1="25" y2="214"/><circle data-profile-cursor-dot r="6"/></g><text x="20" y="20">${Math.round(max)} m</text><text x="20" y="230">${Math.round(min)} m</text><text x="700" y="230">${total.toFixed(1)} km</text></svg><div class="profile-tooltip" data-profile-tooltip hidden></div></div><p class="visually-hidden" id="profile-live-${timeline.day.id}" data-profile-live aria-live="polite"></p><figcaption>Survolez, touchez ou utilisez les flèches pour lire distance, altitude et pente moyenne.</figcaption></figure>`
  installProfileInteraction(container, samples, min, max, total)
}
