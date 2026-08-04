import { distanceFromPointToSegmentMeters, locatePointOnRoute } from '../route/route-proximity.ts'
import type { Route, RouteGeometryPoint } from '../trip-core/index.ts'
import { routeGeometry } from './route-fingerprint.ts'

export const MAX_STRUCTURAL_SEARCH_POINTS = 100

interface SegmentError {
  readonly startIndex: number
  readonly endIndex: number
  readonly splitIndex: number
  readonly distanceMeters: number
}

export interface StructuralSearchGeometry {
  readonly geometry: readonly RouteGeometryPoint[]
  readonly source: 'stored-simplified' | 'derived-from-full'
  readonly originalPointCount: number
  readonly maximumDeviationMeters: number
}

function segmentError(points: readonly RouteGeometryPoint[], startIndex: number, endIndex: number): SegmentError {
  const start = points[startIndex]
  const end = points[endIndex]
  if (start === undefined || end === undefined || endIndex <= startIndex + 1) {
    return { startIndex, endIndex, splitIndex: -1, distanceMeters: 0 }
  }
  let splitIndex = -1
  let distanceMeters = 0
  for (let index = startIndex + 1; index < endIndex; index++) {
    const point = points[index]
    if (point === undefined) continue
    const distance = distanceFromPointToSegmentMeters(point, start, end)
    if (distance > distanceMeters) {
      splitIndex = index
      distanceMeters = distance
    }
  }
  return { startIndex, endIndex, splitIndex, distanceMeters }
}

/**
 * Bounded Douglas-Peucker variant: retain the globally most significant turn
 * until the point budget is exhausted. This preserves switchbacks much better
 * than uniform sampling while keeping the SQL payload deterministic. This
 * geometry only collects candidates; the full GPX decides final eligibility.
 */
export function simplifyStructuralSearchGeometry(
  points: readonly RouteGeometryPoint[],
  maximumPoints = MAX_STRUCTURAL_SEARCH_POINTS,
): readonly RouteGeometryPoint[] {
  if (points.length <= maximumPoints) return points
  const retained = new Set([0, points.length - 1])
  const segments = [segmentError(points, 0, points.length - 1)]
  while (retained.size < Math.max(2, maximumPoints)) {
    segments.sort((left, right) => right.distanceMeters - left.distanceMeters)
    const current = segments.shift()
    if (current === undefined || current.splitIndex < 0) break
    retained.add(current.splitIndex)
    segments.push(
      segmentError(points, current.startIndex, current.splitIndex),
      segmentError(points, current.splitIndex, current.endIndex),
    )
  }
  return [...retained].sort((left, right) => left - right).map((index) => points[index]).filter((point): point is RouteGeometryPoint => point !== undefined)
}

function maximumDeviationMeters(full: readonly RouteGeometryPoint[], simplified: readonly RouteGeometryPoint[]): number {
  let maximum = 0
  for (const point of full) {
    maximum = Math.max(maximum, locatePointOnRoute(point, simplified)?.lateralDistanceMeters ?? 0)
  }
  return maximum
}

export function structuralSearchGeometry(route: Route): StructuralSearchGeometry | null {
  const full = routeGeometry(route)
  if (full === null) return null
  const stored = route.geometry?.simplified
  const sourcePoints = stored !== null && stored !== undefined && stored.length >= 2 ? stored : full
  const geometry = simplifyStructuralSearchGeometry(sourcePoints)
  return {
    geometry,
    source: sourcePoints === full ? 'derived-from-full' : 'stored-simplified',
    originalPointCount: sourcePoints.length,
    maximumDeviationMeters: maximumDeviationMeters(full, geometry),
  }
}
