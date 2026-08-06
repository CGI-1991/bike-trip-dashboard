import { calculateHaversineDistanceKm } from '../gpx/parser.ts'
import type { GpxAnalysisSuccess, GpxTrackPoint } from '../gpx/types.ts'
import type { CanonicalWaypoint } from '../analysis/canonical-waypoints.ts'
import { cumulativeGeometryDistances } from '../route-enrichment/chunking.ts'
import type { Accommodation } from '../trip/accommodations.ts'
import { resolveArrivalDisplay, resolveDepartureDisplay } from '../trip/endpoint-display.ts'
import type { RoadbookMatchReport } from '../trip/roadbook-match.ts'
import type { RideDayTimeline } from '../trip/types.ts'
import { buildTerrainProfileSeries } from '../route/terrain-profile.ts'
import type { RouteProfilePosition, TerrainProfilePoint } from '../route/types.ts'
import type { RouteGeometryPoint } from '../trip-core/index.ts'
import { PAUSE_ACCENT_COLOR_HEX, getGenericRouteMarkerCategory, getRouteMarkerCategory, getRouteMarkerStyle } from './route-marker-style.ts'
import type { RouteMarkerCategory } from './route-marker-style.ts'

export interface ProfileSample extends TerrainProfilePoint { readonly altitudeM: number }

function downsampleProfile(values: readonly ProfileSample[], maximumPoints: number): readonly ProfileSample[] {
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

export function sampleElevationProfile(gpx: GpxAnalysisSuccess, maximumPoints = 280): readonly ProfileSample[] {
  const points = gpx.segments.flatMap(({ points }) => points)
  const source: RouteProfilePosition[] = []
  let distanceKm = 0
  points.forEach((point, index) => {
    if (index > 0) distanceKm += calculateHaversineDistanceKm(points[index - 1] as GpxTrackPoint, point)
    source.push({ latitude: point.latitude, longitude: point.longitude, sourceFileNumber: gpx.summary?.fileNumber ?? 1, sourceFileName: gpx.summary?.fileName ?? 'profile.gpx', distanceKm, elevationGainM: 0, elevationLossM: 0, altitudeM: point.elevationM, localSlopePercent: 0, speedMultiplier: 1, weightedDistanceKm: distanceKm })
  })
  const values: ProfileSample[] = buildTerrainProfileSeries(source).map((point) => ({ ...point, altitudeM: point.elevationM }))
  return downsampleProfile(values, maximumPoints)
}

/** Generic counterpart of `sampleElevationProfile`, built from `Route.geometry` instead of a GPX analysis result. */
export function sampleElevationProfileFromGeometry(geometry: readonly RouteGeometryPoint[], maximumPoints = 280): readonly ProfileSample[] {
  const distances = cumulativeGeometryDistances(geometry)
  const source: RouteProfilePosition[] = geometry.map((point, index) => ({
    latitude: point.latitude,
    longitude: point.longitude,
    sourceFileNumber: 1,
    sourceFileName: 'route.gpx',
    distanceKm: distances[index] ?? 0,
    elevationGainM: 0,
    elevationLossM: 0,
    altitudeM: point.altitudeM,
    localSlopePercent: 0,
    speedMultiplier: 1,
    weightedDistanceKm: distances[index] ?? 0,
  }))
  const values: ProfileSample[] = buildTerrainProfileSeries(source).map((point) => ({ ...point, altitudeM: point.elevationM }))
  return downsampleProfile(values, maximumPoints)
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

// Matches `.profile-tooltip`'s CSS `width: min(190px, calc(100% - 16px))` /
// implicit rendered height — used only when a real measurement is
// unavailable (e.g. a minimal test shim with no layout engine). Keep this
// in sync with `style.css` if that rule ever changes.
const PROFILE_TOOLTIP_FALLBACK_WIDTH_PX = 190
const PROFILE_TOOLTIP_FALLBACK_HEIGHT_PX = 64
const PROFILE_TOOLTIP_EDGE_MARGIN_PX = 6

/**
 * Clamps a tooltip's centered position so it never overflows its
 * container along one axis, "flipping" it away from the cursor near an
 * edge instead of letting half of it render outside — real bug fixed
 * 2026-08-04: the previous horizontal clamp used a fixed 14%–86% window
 * regardless of the container's actual pixel width, which still let the
 * tooltip overflow on narrow containers where 14% of the width is less
 * than half the tooltip's own width. Exported for direct unit testing —
 * pure arithmetic, no DOM required.
 */
export function clampCenteredOffsetPercent(targetCenterPercent: number, containerSizePx: number, contentSizePx: number, marginPx: number = PROFILE_TOOLTIP_EDGE_MARGIN_PX): number {
  if (!(containerSizePx > 0)) return Math.min(86, Math.max(14, targetCenterPercent))
  const halfPercent = (contentSizePx / 2 / containerSizePx) * 100
  const marginPercent = (marginPx / containerSizePx) * 100
  const min = halfPercent + marginPercent
  const max = 100 - halfPercent - marginPercent
  if (min > max) return 50
  return Math.min(max, Math.max(min, targetCenterPercent))
}

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
    tooltip.hidden = false
    // Clamp inside the profile's own bounding box, in both axes, using the
    // container's and the tooltip's real rendered size — a fixed percentage
    // window (the previous approach) does not scale with actual pixel width
    // and can still let the tooltip overflow on a narrow container.
    const containerRect = svg.getBoundingClientRect()
    const tooltipRect = tooltip.getBoundingClientRect()
    const tooltipWidthPx = tooltipRect.width > 0 ? tooltipRect.width : PROFILE_TOOLTIP_FALLBACK_WIDTH_PX
    const tooltipHeightPx = tooltipRect.height > 0 ? tooltipRect.height : PROFILE_TOOLTIP_FALLBACK_HEIGHT_PX
    const cursorPercent = (x / 800) * 100
    tooltip.style.left = `${clampCenteredOffsetPercent(cursorPercent, containerRect.width, tooltipWidthPx).toFixed(1)}%`
    const defaultTopPx = 8
    const desiredCenterPercent = ((defaultTopPx + tooltipHeightPx / 2) / Math.max(containerRect.height, 1)) * 100
    const clampedTopPercent = clampCenteredOffsetPercent(desiredCenterPercent, containerRect.height, tooltipHeightPx)
    tooltip.style.top = `${((clampedTopPercent / 100) * Math.max(containerRect.height, 1) - tooltipHeightPx / 2).toFixed(1)}px`
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

/** Structural shape `renderProfileMarker` actually needs — decoupled from the RGA-specific `RoadbookPointMatch`, so a generic caller can build one directly from a `CanonicalWaypoint`. */
interface ProfileMarkerSpec {
  readonly category: RouteMarkerCategory
  readonly distanceKm: number
  readonly altitudeM: number
  readonly offRoute: boolean
  readonly pauseDurationMinutes?: number
}

/**
 * Renders one documented point as the same category/shape/color used on the
 * map (`route-marker-style.ts`) — a col is always the same diamond and orange
 * on both surfaces, never a plain colored dot on one and something else on
 * the other. A pause is a secondary ring around that same marker — never a
 * second position, never a separate line elsewhere on the profile.
 */
function renderProfileMarker(spec: ProfileMarkerSpec, label: string, x: (distance: number) => number, y: (altitude: number) => number): string {
  const style = getRouteMarkerStyle(spec.category)
  const radius = style.sizePx / 2
  const cx = x(spec.distanceKm).toFixed(1)
  const cy = y(spec.altitudeM).toFixed(1)
  const fill = spec.offRoute ? '#ffffff' : style.colorHex
  const stroke = spec.offRoute ? style.colorHex : '#ffffff'
  const strokeWidth = spec.offRoute ? 3 : 2
  const shape =
    style.shape === 'circle'
      ? `<circle r="${radius}" />`
      : style.shape === 'rounded-square'
        ? `<rect x="${-radius}" y="${-radius}" width="${radius * 2}" height="${radius * 2}" rx="${(radius * 0.35).toFixed(1)}" />`
        : `<rect x="${-radius}" y="${-radius}" width="${radius * 2}" height="${radius * 2}" rx="${(radius * 0.2).toFixed(1)}" transform="rotate(45)" />`
  const symbol =
    style.symbol === ''
      ? ''
      : `<text text-anchor="middle" dominant-baseline="central" font-size="${radius}" font-weight="700" fill="${spec.offRoute ? style.colorHex : '#ffffff'}">${style.symbol}</text>`
  const pauseRing = spec.pauseDurationMinutes === undefined ? '' : `<circle r="${(radius + 3).toFixed(1)}" fill="none" stroke="${PAUSE_ACCENT_COLOR_HEX}" stroke-width="2" />`
  const titleSuffix = spec.pauseDurationMinutes === undefined ? '' : ` · Pause ${spec.pauseDurationMinutes} min`
  return `<g class="profile-marker profile-marker--${spec.category}${spec.offRoute ? ' profile-marker--off-route' : ''}${spec.pauseDurationMinutes === undefined ? '' : ' profile-marker--pause'}" transform="translate(${cx} ${cy})" style="fill:${fill};stroke:${stroke};stroke-width:${strokeWidth};"><title>${escapeHtml(label)} · ${spec.distanceKm.toFixed(1)} km${titleSuffix}</title>${pauseRing}${shape}${symbol}</g>`
}

/** Shared SVG shell (path, axis labels, cursor, tooltip) for both the RGA and generic profiles — only the markers markup and title differ. */
function renderProfileSvgMarkup(
  samples: readonly ProfileSample[],
  markersHtml: string,
  bounds: { readonly min: number; readonly max: number; readonly total: number; readonly x: (distance: number) => number; readonly y: (altitude: number) => number },
  titleId: string,
  titleLabel: string,
): string {
  const { min, max, total, x, y } = bounds
  const line = samples.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(point.distanceKm).toFixed(1)},${y(point.altitudeM).toFixed(1)}`).join(' ')
  return `<figure class="elevation-profile"><div class="elevation-profile__stage"><svg data-profile-interactive tabindex="0" viewBox="0 0 800 240" role="group" aria-labelledby="profile-title-${titleId}" aria-describedby="profile-live-${titleId}" preserveAspectRatio="none"><title id="profile-title-${titleId}">${escapeHtml(titleLabel)}</title><path class="profile-area" d="${line} L780,214 L20,214 Z"/><path class="profile-line" d="${line}"/>${markersHtml}<g class="profile-cursor" data-profile-cursor hidden><line data-profile-cursor-line y1="25" y2="214"/><circle data-profile-cursor-dot r="6"/></g><text x="20" y="20">${Math.round(max)} m</text><text x="20" y="230">${Math.round(min)} m</text><text x="700" y="230">${total.toFixed(1)} km</text></svg><div class="profile-tooltip" data-profile-tooltip hidden></div></div><p class="visually-hidden" id="profile-live-${titleId}" data-profile-live aria-live="polite"></p><figcaption>Survolez, touchez ou utilisez les flèches pour lire distance, altitude et pente moyenne.</figcaption></figure>`
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
  const min = Math.min(...samples.map(({ altitudeM }) => altitudeM))
  const max = Math.max(...samples.map(({ altitudeM }) => altitudeM))
  const total = samples.at(-1)?.distanceKm ?? 1
  const x = (distance: number) => 20 + 760 * distance / Math.max(total, 0.1)
  const y = (alt: number) => 210 - 180 * (alt - min) / Math.max(max - min, 1)
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
      const spec: ProfileMarkerSpec = {
        category: getRouteMarkerCategory(point),
        distanceKm: point.matchedTrackDistanceKm as number,
        altitudeM: point.matchedElevationM ?? point.elevationM ?? min,
        offRoute: point.resolution !== 'matched',
        pauseDurationMinutes: pauseByPointId.get(point.id)?.durationMinutes,
      }
      return renderProfileMarker(spec, label, x, y)
    })
    .join('')
  container.innerHTML = renderProfileSvgMarkup(samples, markers, { min, max, total, x, y }, timeline.day.id, `Profil altimétrique interactif de ${timeline.day.id}`)
  installProfileInteraction(container, samples, min, max, total)
}

/**
 * Generic counterpart of `renderElevationProfile` for the TripBundle
 * pipeline: built from `Route.geometry` and `CanonicalWaypoint[]`
 * (`analysis/canonical-waypoints.ts`) instead of RGA-shaped GPX/timeline/
 * report/accommodation inputs. Reuses the same SVG shell, marker drawing
 * and interactive cursor as the RGA profile.
 */
/** `[startDistanceKm, endDistanceKm, startAltitudeM, endAltitudeM, averageGradientPercent]` — the trimmed shape `day-detail-view.ts::renderClimbProfileShape` embeds as `data-segments` JSON; kept in sync with that function deliberately. */
type ClimbSegmentTuple = readonly [number, number, number | null, number | null, number | null]

function formatClimbKm(value: number): string {
  return `${value.toFixed(1).replace('.', ',')} km`
}

function formatClimbPercent(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1).replace('.', ',')} %`
}

/**
 * Real pointer/touch/keyboard tooltip for the climb mini-profile (CDC Jalon
 * B4.4 sections 28-30) — reuses this module's own `clampCenteredOffsetPercent`
 * (same tooltip-clamping arithmetic as the main elevation profile) and the
 * same `.profile-cursor`/`.profile-tooltip` CSS, rather than a second,
 * divergent interaction model. Never depends on `title=""` (poor touch/
 * screen-reader support, no synced cursor) — see the CDC section 30
 * complaint this fixes.
 *
 * Reads its data from the `svg`'s own `data-segments`/`data-start-km`
 * attributes (embedded once by `renderClimbProfileShape`) — never a second
 * recomputation of the climb profile from the GPX/route geometry here.
 */
export function mountClimbProfileInteraction(svg: SVGSVGElement): void {
  if (typeof svg.closest !== 'function') return
  const scope = svg.closest<HTMLElement>('[data-climb-profile]')
  const cursor = svg.querySelector<SVGGElement>('[data-profile-cursor]')
  const line = svg.querySelector<SVGLineElement>('[data-profile-cursor-line]')
  const dot = svg.querySelector<SVGCircleElement>('[data-profile-cursor-dot]')
  const tooltip = scope?.querySelector<HTMLElement>('[data-profile-tooltip]') ?? null
  const live = scope?.querySelector<HTMLElement>('[data-profile-live]') ?? null
  if (cursor === null || line === null || dot === null || tooltip === null || live === null) return

  let segments: ClimbSegmentTuple[]
  try {
    segments = JSON.parse(svg.dataset.segments ?? '[]') as ClimbSegmentTuple[]
  } catch {
    return
  }
  const firstSegment = segments[0]
  const lastSegment = segments[segments.length - 1]
  if (firstSegment === undefined || lastSegment === undefined) return

  const startKm = Number(svg.dataset.startKm ?? '0')
  const totalKm = Math.max(lastSegment[1] - firstSegment[0], 0.001)
  const altitudes = segments.flatMap((segment) => [segment[2], segment[3]]).filter((value): value is number => value !== null)
  const minAltitude = altitudes.length === 0 ? 0 : Math.min(...altitudes)
  const maxAltitude = altitudes.length === 0 ? 1 : Math.max(...altitudes)
  const span = Math.max(maxAltitude - minAltitude, 1)
  const width = 300
  const height = 130
  const x = (km: number): number => ((km - startKm) / totalKm) * width
  const y = (altitude: number): number => height - ((altitude - minAltitude) / span) * (height - 10) - 5

  const findSegment = (km: number): ClimbSegmentTuple =>
    segments.find((segment) => km >= segment[0] && km <= segment[1]) ?? lastSegment

  const interpolateAltitude = (segment: ClimbSegmentTuple, km: number): number | null => {
    const [s0, s1, a0, a1] = segment
    if (a0 === null || a1 === null) return a0 ?? a1
    const ratio = s1 - s0 <= 1e-9 ? 0 : Math.min(1, Math.max(0, (km - s0) / (s1 - s0)))
    return a0 + (a1 - a0) * ratio
  }

  let selectedIndex = 0
  const show = (km: number): void => {
    const clampedKm = Math.min(lastSegment[1], Math.max(firstSegment[0], km))
    const segment = findSegment(clampedKm)
    selectedIndex = segments.indexOf(segment)
    const altitude = interpolateAltitude(segment, clampedKm)
    const cx = x(clampedKm)
    const cy = altitude === null ? height / 2 : y(altitude)
    line.setAttribute('x1', cx.toFixed(1)); line.setAttribute('x2', cx.toFixed(1))
    dot.setAttribute('cx', cx.toFixed(1)); dot.setAttribute('cy', cy.toFixed(1))
    cursor.removeAttribute('hidden')

    const afterText = formatClimbKm(clampedKm - startKm)
    const altitudeText = altitude === null ? '—' : `${Math.round(altitude)} m`
    const gradeText = formatClimbPercent(segment[4])
    live.textContent = `Après ${afterText} · Altitude ${altitudeText} · Pente ${gradeText}`
    tooltip.innerHTML = `<strong>Après ${afterText}</strong><span>Altitude : ${altitudeText}</span><span>Pente : ${gradeText}</span><span>Km absolu de l’étape : ${formatClimbKm(clampedKm)}</span>`
    tooltip.hidden = false

    const containerRect = svg.getBoundingClientRect()
    const tooltipRect = tooltip.getBoundingClientRect()
    const tooltipWidthPx = tooltipRect.width > 0 ? tooltipRect.width : PROFILE_TOOLTIP_FALLBACK_WIDTH_PX
    const tooltipHeightPx = tooltipRect.height > 0 ? tooltipRect.height : PROFILE_TOOLTIP_FALLBACK_HEIGHT_PX
    const cursorPercent = (cx / width) * 100
    tooltip.style.left = `${clampCenteredOffsetPercent(cursorPercent, containerRect.width, tooltipWidthPx).toFixed(1)}%`
    const defaultTopPx = 8
    const desiredCenterPercent = ((defaultTopPx + tooltipHeightPx / 2) / Math.max(containerRect.height, 1)) * 100
    const clampedTopPercent = clampCenteredOffsetPercent(desiredCenterPercent, containerRect.height, tooltipHeightPx)
    tooltip.style.top = `${((clampedTopPercent / 100) * Math.max(containerRect.height, 1) - tooltipHeightPx / 2).toFixed(1)}px`
  }

  const fromPointer = (event: PointerEvent): void => {
    const rect = svg.getBoundingClientRect()
    show(startKm + ((event.clientX - rect.left) / Math.max(rect.width, 1)) * totalKm)
  }
  svg.addEventListener('pointerdown', (event) => { svg.setPointerCapture?.(event.pointerId); fromPointer(event) })
  svg.addEventListener('pointermove', fromPointer)
  svg.addEventListener('pointerleave', () => { cursor.setAttribute('hidden', ''); tooltip.hidden = true })
  svg.addEventListener('pointerup', (event) => { svg.releasePointerCapture?.(event.pointerId) })
  svg.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    selectedIndex = Math.min(segments.length - 1, Math.max(0, selectedIndex + (event.key === 'ArrowRight' ? 1 : -1)))
    const segment = segments[selectedIndex]
    if (segment !== undefined) show(segment[0])
  })
}

export function renderGenericElevationProfile(container: HTMLElement, geometry: readonly RouteGeometryPoint[] | null, waypoints: readonly CanonicalWaypoint[], stageLabel = 'étape'): void {
  if (geometry === null || geometry.length < 2) { container.innerHTML = '<p>Profil indisponible.</p>'; return }
  const samples = sampleElevationProfileFromGeometry(geometry)
  if (samples.length < 2) { container.innerHTML = '<p>Profil altimétrique indisponible.</p>'; return }
  const min = Math.min(...samples.map(({ altitudeM }) => altitudeM))
  const max = Math.max(...samples.map(({ altitudeM }) => altitudeM))
  const total = samples.at(-1)?.distanceKm ?? 1
  const x = (distance: number) => 20 + 760 * distance / Math.max(total, 0.1)
  const y = (alt: number) => 210 - 180 * (alt - min) / Math.max(max - min, 1)
  const markers = waypoints
    .map((waypoint) => {
      const spec: ProfileMarkerSpec = {
        category: getGenericRouteMarkerCategory(waypoint.kind),
        distanceKm: waypoint.trackDistanceKm,
        altitudeM: waypoint.elevationM ?? min,
        offRoute: false,
        pauseDurationMinutes: waypoint.pauseDurationMinutes ?? undefined,
      }
      return renderProfileMarker(spec, waypoint.name, x, y)
    })
    .join('')
  container.innerHTML = renderProfileSvgMarkup(samples, markers, { min, max, total, x, y }, 'generic', `Profil altimétrique interactif de ${stageLabel}`)
  installProfileInteraction(container, samples, min, max, total)
}
