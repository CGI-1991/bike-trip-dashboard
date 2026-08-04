import type { RouteGeometryPoint } from '../trip-core/index.ts'

const EARTH_RADIUS_METERS = 6_371_000
const RADIANS = Math.PI / 180

interface SegmentProjection {
  readonly segmentMeters: number
  readonly ratio: number
  readonly distanceMeters: number
}

function projectOnSegment(
  candidate: { readonly latitude: number; readonly longitude: number },
  start: Pick<RouteGeometryPoint, 'latitude' | 'longitude'>,
  end: Pick<RouteGeometryPoint, 'latitude' | 'longitude'>,
): SegmentProjection {
  const referenceLatitude = ((start.latitude + end.latitude + candidate.latitude) / 3) * RADIANS
  const xScale = EARTH_RADIUS_METERS * Math.cos(referenceLatitude) * RADIANS
  const yScale = EARTH_RADIUS_METERS * RADIANS
  const endX = (end.longitude - start.longitude) * xScale
  const endY = (end.latitude - start.latitude) * yScale
  const pointX = (candidate.longitude - start.longitude) * xScale
  const pointY = (candidate.latitude - start.latitude) * yScale
  const squaredLength = endX ** 2 + endY ** 2
  const ratio = squaredLength === 0 ? 0 : Math.max(0, Math.min(1, (pointX * endX + pointY * endY) / squaredLength))
  return {
    segmentMeters: Math.sqrt(squaredLength),
    ratio,
    distanceMeters: Math.sqrt((pointX - ratio * endX) ** 2 + (pointY - ratio * endY) ** 2),
  }
}

export interface LocatedRoutePosition {
  readonly trackDistanceKm: number
  readonly lateralDistanceMeters: number
}

export function distanceBetweenCoordinatesMeters(
  left: { readonly latitude: number; readonly longitude: number },
  right: { readonly latitude: number; readonly longitude: number },
): number {
  return projectOnSegment(left, left, right).segmentMeters
}

export function distanceFromPointToSegmentMeters(
  point: { readonly latitude: number; readonly longitude: number },
  start: Pick<RouteGeometryPoint, 'latitude' | 'longitude'>,
  end: Pick<RouteGeometryPoint, 'latitude' | 'longitude'>,
): number {
  return projectOnSegment(point, start, end).distanceMeters
}

export function locatePointOnRoute(
  candidate: { readonly latitude: number; readonly longitude: number },
  geometry: readonly RouteGeometryPoint[],
): LocatedRoutePosition | null {
  if (geometry.length < 2) return null
  let accumulatedMeters = 0
  let best: { readonly alongMeters: number; readonly lateralMeters: number } | null = null
  for (let index = 1; index < geometry.length; index++) {
    const start = geometry[index - 1]
    const end = geometry[index]
    if (start === undefined || end === undefined) continue
    const projection = projectOnSegment(candidate, start, end)
    const alongMeters = accumulatedMeters + projection.segmentMeters * projection.ratio
    if (best === null || projection.distanceMeters < best.lateralMeters) {
      best = { alongMeters, lateralMeters: projection.distanceMeters }
    }
    accumulatedMeters += projection.segmentMeters
  }
  return best === null ? null : {
    trackDistanceKm: best.alongMeters / 1_000,
    lateralDistanceMeters: best.lateralMeters,
  }
}
