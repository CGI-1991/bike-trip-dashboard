import type { RouteGeometryPoint } from '../trip-core/index.ts'
import type { WaypointWeather } from './types.ts'
import { indexRouteGeometry } from '../route-enrichment/segment-geometry.ts'
import type { DistanceIndexedGeometry } from '../route-enrichment/segment-geometry.ts'

export const PROFILE_WIND_SMOOTHING_METERS = 100
export const WAYPOINT_WIND_SMOOTHING_METERS = 1000
const RADIANS = Math.PI / 180
const indexedRoutes = new WeakMap<readonly RouteGeometryPoint[], DistanceIndexedGeometry>()
function indexedRoute(geometry: readonly RouteGeometryPoint[]): DistanceIndexedGeometry {
  let indexed = indexedRoutes.get(geometry)
  if (indexed === undefined) {
    const crossesDateLine = geometry.some((point, i) => i > 0 && Math.abs(point.longitude - geometry[i - 1]!.longitude) > 180)
    if (crossesDateLine) {
      let offset = 0
      const continuous = geometry.map((point, i) => {
        if (i > 0) {
          const delta = point.longitude - geometry[i - 1]!.longitude
          if (delta > 180) offset -= 360
          if (delta < -180) offset += 360
        }
        return { ...point, longitude: point.longitude + offset }
      })
      indexed = { ...indexRouteGeometry(continuous), points: geometry }
    } else indexed = indexRouteGeometry(geometry)
    indexedRoutes.set(geometry, indexed)
  }
  return indexed
}
export function windRouteLengthKm(geometry: readonly RouteGeometryPoint[]): number { return indexedRoute(geometry).lengthKm }

export interface RelativeWindReading {
  readonly kind: 'directional' | 'calm' | 'variable'
  /** Meteorological FROM direction in the rider frame: 0=front, 90=right. */
  readonly relativeFromDeg: number | null
  readonly speedKph: number
  /** Positive opposes travel, negative assists it. */
  readonly headwindKph: number
  /** Positive comes from the rider's right. */
  readonly crosswindKph: number
  readonly gustsKph: number | null
  readonly crosswindGustsKph: number | null
  readonly coverage: number
  readonly maximumWeatherGapKm: number
}

export interface RouteWindSummary {
  readonly mean: RelativeWindReading | null
  readonly headwindFraction: number
  readonly tailwindFraction: number
  readonly crosswindFraction: number
  readonly calmFraction: number
  readonly coveredFraction: number
  readonly maximumCrosswindGustsKph: number | null
}

export interface RouteWindModel {
  /** Active length. at() still receives the original GPX chainage. */
  readonly lengthKm: number
  readonly resolutionMeters: number
  readonly summary: RouteWindSummary
  at(distanceKm: number, windowMeters?: number): RelativeWindReading | null
}

export function normalizeDegrees(value: number): number { return ((value % 360) + 360) % 360 }

export function relativeWindComponents(speedKph: number, fromDeg: number, travelBearingDeg: number): { readonly headwindKph: number; readonly crosswindKph: number; readonly relativeFromDeg: number } {
  const relativeFromDeg = normalizeDegrees(fromDeg - travelBearingDeg)
  return { relativeFromDeg, headwindKph: speedKph * Math.cos(relativeFromDeg * RADIANS), crosswindKph: speedKph * Math.sin(relativeFromDeg * RADIANS) }
}

function upperBound(values: readonly number[], target: number): number {
  let low = 0, high = values.length
  while (low < high) { const mid = (low + high) >>> 1; if (values[mid]! <= target) low = mid + 1; else high = mid }
  return low
}

function routePointAt(route: DistanceIndexedGeometry, distanceKm: number): { latitude: number; longitude: number } {
  const next = upperBound(route.distancesKm, Math.max(0, Math.min(route.lengthKm, distanceKm)))
  const beforeIndex = Math.max(0, next - 1)
  const before = route.points[beforeIndex]!
  const after = route.points[next]
  if (after === undefined) return before
  const span = route.distancesKm[next]! - route.distancesKm[beforeIndex]!
  const ratio = span <= 0 ? 0 : Math.max(0, Math.min(1, (distanceKm - route.distancesKm[beforeIndex]!) / span))
  const longitudeDelta = normalizeDegrees(after.longitude - before.longitude + 180) - 180
  return { latitude: before.latitude + (after.latitude - before.latitude) * ratio,
    longitude: normalizeDegrees(before.longitude + longitudeDelta * ratio + 180) - 180 }
}

export function smoothedTravelBearing(route: DistanceIndexedGeometry, distanceKm: number, windowMeters = PROFILE_WIND_SMOOTHING_METERS): number | null {
  if (route.points.length < 2 || route.lengthKm <= 0 || !(windowMeters > 0)) return null
  const half = windowMeters / 2000
  const before = routePointAt(route, Math.max(0, distanceKm - half))
  const after = routePointAt(route, Math.min(route.lengthKm, distanceKm + half))
  const phi1 = before.latitude * RADIANS, phi2 = after.latitude * RADIANS
  const delta = (after.longitude - before.longitude) * RADIANS
  const east = Math.sin(delta) * Math.cos(phi2)
  const north = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(delta)
  // A closed smoothing window has no unique direction; never invent north.
  return Math.hypot(east, north) < 1e-8 ? null : normalizeDegrees(Math.atan2(east, north) / RADIANS)
}

interface WindAnchor {
  readonly km: number
  readonly north: number | null
  readonly east: number | null
  readonly speed: number | null
  readonly gusts: number | null
}

function anchorsFor(waypoints: readonly WaypointWeather[]): readonly WindAnchor[] {
  const anchors = new Map<number, WindAnchor>()
  for (const point of waypoints) {
    const km = point.samplePoint.trackDistanceKm
    if (typeof km !== 'number' || !Number.isFinite(km) || km < 0) continue
    const weather = point.state === 'available' ? point.weather : null
    const speed = weather?.windSpeedKph
    const direction = weather?.windDirectionDeg
    const validSpeed = typeof speed === 'number' && Number.isFinite(speed) && speed >= 0
    const validDirection = typeof direction === 'number' && Number.isFinite(direction) && direction >= 0 && direction <= 360
    const known = validSpeed && (speed < 1 || validDirection)
    const gusts = weather?.windGustsKph
    anchors.set(km, { km, speed: known ? speed : null,
      north: known ? speed * Math.cos((validDirection ? direction : 0) * RADIANS) : null,
      east: known ? speed * Math.sin((validDirection ? direction : 0) * RADIANS) : null,
      gusts: typeof gusts === 'number' && Number.isFinite(gusts) && gusts >= 0 ? gusts : null })
  }
  return [...anchors.values()].sort((a, b) => a.km - b.km)
}

interface Cell {
  readonly head: number
  readonly cross: number
  readonly speed: number
  readonly gusts: number | null
  readonly gustCross: number | null
  readonly gap: number
}

function makeReading(headwindKph: number, crosswindKph: number, speedKph: number, gustsKph: number | null, crosswindGustsKph: number | null, coverage: number, maximumWeatherGapKm: number): RelativeWindReading {
  const kind = speedKph < 1 ? 'calm' : Math.hypot(headwindKph, crosswindKph) < speedKph * 0.25 ? 'variable' : 'directional'
  return { kind, relativeFromDeg: kind === 'directional' ? normalizeDegrees(Math.atan2(crosswindKph, headwindKph) / RADIANS) : null,
    speedKph, headwindKph, crosswindKph, gustsKph, crosswindGustsKph, coverage, maximumWeatherGapKm }
}

/** Combine local rider frames, weighted by covered distance, never by the
 * number of GPS vertices or by averaging meteorological angles. */
export function combineRouteWindSummaries(parts: readonly { readonly lengthKm: number; readonly summary: RouteWindSummary | null }[]): RouteWindSummary {
  let total = 0, covered = 0, head = 0, cross = 0, speed = 0, gap = 0
  let headDistance = 0, tailDistance = 0, crossDistance = 0, calmDistance = 0
  let gusts: number | null = null, gustCross: number | null = null
  for (const part of parts) {
    if (!(part.lengthKm > 0)) continue
    total += part.lengthKm
    const stats = part.summary, mean = stats?.mean
    if (stats === null || mean === null || mean === undefined) continue
    const distance = part.lengthKm * stats.coveredFraction
    covered += distance; head += mean.headwindKph * distance; cross += mean.crosswindKph * distance; speed += mean.speedKph * distance
    headDistance += part.lengthKm * stats.headwindFraction; tailDistance += part.lengthKm * stats.tailwindFraction
    crossDistance += part.lengthKm * stats.crosswindFraction; calmDistance += part.lengthKm * stats.calmFraction
    gap = Math.max(gap, mean.maximumWeatherGapKm)
    if (mean.gustsKph !== null) gusts = Math.max(gusts ?? 0, mean.gustsKph)
    if (mean.crosswindGustsKph !== null) gustCross = Math.max(gustCross ?? 0, mean.crosswindGustsKph)
  }
  const fraction = total > 0 ? Math.min(1, covered / total) : 0
  return { mean: covered > 0 ? makeReading(head / covered, cross / covered, speed / covered, gusts, gustCross, fraction, gap) : null,
    headwindFraction: total > 0 ? headDistance / total : 0, tailwindFraction: total > 0 ? tailDistance / total : 0,
    crosswindFraction: total > 0 ? crossDistance / total : 0, calmFraction: total > 0 ? calmDistance / total : 0,
    coveredFraction: fraction, maximumCrosswindGustsKph: gustCross }
}

/** Rotate existing ETA-associated forecasts into the local route frame.
 * Uniform cells and prefix integrals bound work on pointer events. Missing
 * anchors are retained as holes; no extrapolation or averaging raw degrees. */
export function buildRouteWindModel(geometry: readonly RouteGeometryPoint[], waypoints: readonly WaypointWeather[], range?: { readonly startKm: number; readonly finishKm: number }): RouteWindModel | null {
  if (geometry.length < 2) return null
  const route = indexedRoute(geometry)
  if (!(route.lengthKm > 0)) return null
  const fromKm = range?.startKm ?? 0, toKm = Math.min(range?.finishKm ?? route.lengthKm, route.lengthKm)
  if (!Number.isFinite(fromKm) || !Number.isFinite(toKm) || fromKm < 0 || !(toKm > fromKm)) return null
  const total = toKm - fromKm
  const anchors = anchorsFor(waypoints)
  const positions = anchors.map(anchor => anchor.km)
  const count = Math.min(5000, Math.max(1, Math.ceil(total / 0.05)))
  const step = total / count
  const cells: (Cell | null)[] = []
  const covered = [0], head = [0], cross = [0], speeds = [0]
  let headDistance = 0, tailDistance = 0, crossDistance = 0, calmDistance = 0
  function cellAt(km: number): Cell | null {
    let next = upperBound(positions, km)
    // The last anchor belongs to its final interval, including its endpoint.
    if (next === anchors.length && anchors.at(-1)?.km === km) next--
    const before = anchors[Math.max(0, next - 1)], after = anchors[next]
    if (before === undefined || after === undefined || km < before.km || km > after.km
      || before.north === null || before.east === null || before.speed === null
      || after.north === null || after.east === null || after.speed === null) return null
    const ratio = after.km === before.km ? 0 : (km - before.km) / (after.km - before.km)
    const mix = (a: number, b: number) => a + (b - a) * ratio
    const north = mix(before.north, after.north), east = mix(before.east, after.east)
    const referenceSpeed = mix(before.speed, after.speed)
    const speed = Math.hypot(north, east)
    if (referenceSpeed >= 1 && speed < referenceSpeed * 0.25) return null
    const bearing = smoothedTravelBearing(route!, km)
    if (bearing === null) return null
    const relative = relativeWindComponents(Math.hypot(north, east), normalizeDegrees(Math.atan2(east, north) / RADIANS), bearing)
    const gusts = before.gusts === null || after.gusts === null ? null : mix(before.gusts, after.gusts)
    return { head: relative.headwindKph, cross: relative.crosswindKph, speed,
      gusts, gustCross: gusts === null || speed < 1 ? null : Math.abs(Math.sin(relative.relativeFromDeg * RADIANS)) * gusts, gap: after.km - before.km }
  }
  for (let i = 0; i < count; i++) {
    const cell = cellAt(fromKm + (i + 0.5) * step)
    cells.push(cell)
    covered.push(covered[i]! + (cell === null ? 0 : step))
    head.push(head[i]! + (cell?.head ?? 0) * step)
    cross.push(cross[i]! + (cell?.cross ?? 0) * step)
    speeds.push(speeds[i]! + (cell?.speed ?? 0) * step)
    if (cell === null) continue
    if (cell.speed < 1) calmDistance += step
    else if (cell.head >= Math.abs(cell.cross)) headDistance += step
    else if (cell.head <= -Math.abs(cell.cross)) tailDistance += step
    else crossDistance += step
  }
  const integralAt = (values: readonly number[], km: number): number => {
    const distance = Math.max(0, Math.min(total, km - fromKm))
    const index = Math.min(count - 1, Math.floor(distance / step))
    const ratio = (distance - index * step) / step
    return values[index]! + (values[index + 1]! - values[index]!) * ratio
  }
  const average = (start: number, end: number): RelativeWindReading | null => {
    if (!(end > start)) return null
    const length = integralAt(covered, end) - integralAt(covered, start)
    if (length <= 1e-9) return null
    const avg = (values: readonly number[]) => (integralAt(values, end) - integralAt(values, start)) / length
    let gusts: number | null = null, gustCross: number | null = null, gap = 0
    for (let i = Math.max(0, Math.floor((start - fromKm) / step)); i < Math.min(count, Math.ceil((end - fromKm) / step)); i++) {
      const cell = cells[i]
      if (cell === undefined || cell === null) continue
      if (cell.gusts !== null) gusts = Math.max(gusts ?? 0, cell.gusts)
      if (cell.gustCross !== null) gustCross = Math.max(gustCross ?? 0, cell.gustCross)
      gap = Math.max(gap, cell.gap)
    }
    return makeReading(avg(head), avg(cross), avg(speeds), gusts, gustCross, length / (end - start), gap)
  }
  const mean = average(fromKm, toKm)
  return { lengthKm: total, resolutionMeters: step * 1000,
    at(km, windowMeters = PROFILE_WIND_SMOOTHING_METERS) {
      if (!Number.isFinite(km) || km < fromKm || km > toKm || !(windowMeters > 0)) return null
      const half = windowMeters / 2000
      const averaged = average(Math.max(fromKm, km - half), Math.min(toKm, km + half))
      if (averaged !== null) return averaged
      // A valid forecast at a passage still has a relative direction even
      // if neighbouring forecasts are missing. Do not extend it along the
      // route or pretend a spatial average could be computed around it.
      const index = upperBound(positions, km)
      const nearby = [anchors[index - 1], anchors[index]].find(anchor => anchor !== undefined && Math.abs(anchor.km - km) < 0.0005)
      if (nearby === undefined || nearby.north === null || nearby.east === null || nearby.speed === null) return null
      const bearing = smoothedTravelBearing(route, km, windowMeters)
      if (bearing === null) return null
      const relative = relativeWindComponents(nearby.speed, normalizeDegrees(Math.atan2(nearby.east, nearby.north) / RADIANS), bearing)
      return makeReading(relative.headwindKph, relative.crosswindKph, nearby.speed, nearby.gusts,
        nearby.gusts === null || nearby.speed < 1 ? null : Math.abs(Math.sin(relative.relativeFromDeg * RADIANS)) * nearby.gusts, 0, 0)
    },
    summary: { mean, headwindFraction: headDistance / total, tailwindFraction: tailDistance / total,
      crosswindFraction: crossDistance / total, calmFraction: calmDistance / total,
      coveredFraction: covered.at(-1)! / total, maximumCrosswindGustsKph: mean?.crosswindGustsKph ?? null } }
}

export function relativeWindLabel(reading: RelativeWindReading | null): string {
  if (reading === null) return 'Vent relatif indisponible'
  if (reading.kind === 'calm') return 'Vent calme'
  if (reading.kind === 'variable') return 'Vent relatif variable'
  const labels = ['de face', 'de face à droite', 'de droite', 'de dos à droite', 'de dos', 'de dos à gauche', 'de gauche', 'de face à gauche']
  return `Vent ${labels[Math.round(reading.relativeFromDeg! / 45) % 8]}`
}

/** The blue scale represents an explicit physical quantity, not an opaque
 * safety score: adverse headwind component in km/h. Lateral gusts stay separate. */
export function headwindColor(reading: RelativeWindReading | null): string {
  if (reading === null || reading.kind === 'variable') return '#b7c0c7'
  const value = Math.max(0, reading.headwindKph)
  return value < 1 ? '#e4f4ff' : value < 5 ? '#b4ddf7' : value < 10 ? '#79bce8' : value < 20 ? '#398ac6' : value < 30 ? '#175f9c' : '#123c70'
}
