import type { RouteGeometryPoint } from '../trip-core/index.ts'
import { cumulativeGeometryDistances } from './chunking.ts'
import { distanceFromPointToSegmentMeters } from '../route/route-proximity.ts'

export interface DistanceIndexedGeometry {
  readonly points: readonly RouteGeometryPoint[]
  readonly distancesKm: readonly number[]
  readonly lengthKm: number
}

export function indexRouteGeometry(points: readonly RouteGeometryPoint[]): DistanceIndexedGeometry {
  const distancesKm = cumulativeGeometryDistances(points)
  return { points, distancesKm, lengthKm: distancesKm.at(-1) ?? 0 }
}

function upperBound(distances: readonly number[], target: number): number {
  let low = 0
  let high = distances.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if ((distances[middle] ?? 0) <= target) low = middle + 1
    else high = middle
  }
  return low
}

export function pointAtIndexedDistance(indexed: DistanceIndexedGeometry, distanceKm: number): RouteGeometryPoint {
  const afterIndex = upperBound(indexed.distancesKm, distanceKm)
  const before = indexed.points[Math.max(0, afterIndex - 1)]!
  const after = indexed.points[afterIndex]
  if (after === undefined) return before
  const start = indexed.distancesKm[Math.max(0, afterIndex - 1)] ?? 0
  const length = (indexed.distancesKm[afterIndex] ?? start) - start
  const ratio = length <= 0 ? 0 : Math.max(0, Math.min(1, (distanceKm - start) / length))
  return {
    latitude: before.latitude + (after.latitude - before.latitude) * ratio,
    longitude: before.longitude + (after.longitude - before.longitude) * ratio,
    altitudeM: before.altitudeM === null || after.altitudeM === null ? null : before.altitudeM + (after.altitudeM - before.altitudeM) * ratio,
  }
}

/** Clip on the full trace's chainage, including interpolated boundary points.
 * Never substitute a distant pair of vertices when a range is sparsely sampled.
 */
export function sliceRouteGeometry(indexed: DistanceIndexedGeometry, startKm: number, endKm: number): readonly RouteGeometryPoint[] {
  if (indexed.points.length < 2 || indexed.lengthKm <= 0) return []
  const start = Math.max(0, Math.min(indexed.lengthKm, startKm))
  const end = Math.max(start, Math.min(indexed.lengthKm, endKm))
  if (end <= start) return []
  const points: RouteGeometryPoint[] = [pointAtIndexedDistance(indexed, start)]
  for (let i = upperBound(indexed.distancesKm, start); i < indexed.points.length && (indexed.distancesKm[i] ?? 0) < end; i++) {
    points.push(indexed.points[i]!)
  }
  points.push(pointAtIndexedDistance(indexed, end))
  return points
}

/** Simplify a clipped corridor by spatial error, rather than by a global
 * vertex count that can erase whole portions of a long itinerary.
 */
export function simplifySearchCorridor(points: readonly RouteGeometryPoint[], toleranceMeters: number): readonly RouteGeometryPoint[] {
  if (points.length <= 2) return points
  const retained = new Set([0, points.length - 1])
  const pending: [number, number][] = [[0, points.length - 1]]
  while (pending.length > 0) {
    const [start, end] = pending.pop()!
    let split = -1
    let maximum = toleranceMeters
    for (let i = start + 1; i < end; i++) {
      const deviation = distanceFromPointToSegmentMeters(points[i]!, points[start]!, points[end]!)
      if (deviation > maximum) { maximum = deviation; split = i }
    }
    if (split < 0) continue
    retained.add(split)
    pending.push([start, split], [split, end])
  }
  return [...retained].sort((a, b) => a - b).map(i => points[i]!)
}
