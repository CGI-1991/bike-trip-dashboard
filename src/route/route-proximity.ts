import type { RouteGeometryPoint } from '../trip-core/index.ts'

const EARTH_RADIUS_METERS = 6_371_000
const RADIANS = Math.PI / 180

export interface SegmentProjection {
  readonly segmentMeters: number
  readonly ratio: number
  readonly distanceMeters: number
}

export function projectOnSegment(
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

interface RouteIndexNode {
  readonly minLatitude: number
  readonly maxLatitude: number
  readonly minLongitude: number
  readonly maxLongitude: number
  readonly first: number
  readonly last: number
  readonly left?: RouteIndexNode
  readonly right?: RouteIndexNode
}

export interface RouteLocator {
  locate(candidate: { readonly latitude: number; readonly longitude: number }): LocatedRoutePosition | null
}

const routeLocators = new WeakMap<readonly RouteGeometryPoint[], RouteLocator>()

/** Reusable spatial hierarchy over contiguous route segments. Building it
 * is linear; a nearby candidate normally visits only a small part of the
 * trace. Chainage is computed once, independently of the candidate.
 */
export function createRouteLocator(geometry: readonly RouteGeometryPoint[]): RouteLocator {
  const cached = routeLocators.get(geometry)
  if (cached !== undefined) return cached
  const distances = [0]
  for (let i = 1; i < geometry.length; i++) {
    const start = geometry[i - 1]!
    const end = geometry[i]!
    const x = (end.longitude - start.longitude) * Math.cos((start.latitude + end.latitude) / 2 * RADIANS)
    const y = end.latitude - start.latitude
    distances.push(distances[i - 1]! + Math.hypot(x, y) * EARTH_RADIUS_METERS * RADIANS)
  }
  function build(first: number, last: number): RouteIndexNode {
    if (last - first <= 8) {
      let minLatitude = Infinity, maxLatitude = -Infinity, minLongitude = Infinity, maxLongitude = -Infinity
      for (let i = first; i <= last; i++) {
        const point = geometry[i]!
        minLatitude = Math.min(minLatitude, point.latitude); maxLatitude = Math.max(maxLatitude, point.latitude)
        minLongitude = Math.min(minLongitude, point.longitude); maxLongitude = Math.max(maxLongitude, point.longitude)
      }
      return { first, last, minLatitude, maxLatitude, minLongitude, maxLongitude }
    }
    const middle = (first + last) >>> 1
    const left = build(first, middle)
    const right = build(middle, last)
    return { first, last, left, right,
      minLatitude: Math.min(left.minLatitude, right.minLatitude), maxLatitude: Math.max(left.maxLatitude, right.maxLatitude),
      minLongitude: Math.min(left.minLongitude, right.minLongitude), maxLongitude: Math.max(left.maxLongitude, right.maxLongitude) }
  }
  const root = geometry.length < 2 ? null : build(0, geometry.length - 1)
  function lowerBound(node: RouteIndexNode, candidate: { readonly latitude: number; readonly longitude: number }): number {
    const dx = Math.max(node.minLongitude - candidate.longitude, 0, candidate.longitude - node.maxLongitude)
    const dy = Math.max(node.minLatitude - candidate.latitude, 0, candidate.latitude - node.maxLatitude)
    // Conservative longitude scale: the exact projection's reference
    // latitude lies inside the candidate/node latitude interval.
    const latitude = Math.max(Math.abs(candidate.latitude), Math.abs(node.minLatitude), Math.abs(node.maxLatitude))
    return Math.hypot(dx * Math.cos(latitude * RADIANS), dy) * EARTH_RADIUS_METERS * RADIANS
  }
  const locator: RouteLocator = {
    locate(candidate) {
      if (root === null) return null
      let bestDistance = Infinity
      let bestAlong = 0
      let bestSegment = Infinity
      function visit(node: RouteIndexNode): void {
        if (lowerBound(node, candidate) > bestDistance) return
        if (node.left !== undefined && node.right !== undefined) {
          const leftFirst = lowerBound(node.left, candidate) <= lowerBound(node.right, candidate)
          visit(leftFirst ? node.left : node.right)
          visit(leftFirst ? node.right : node.left)
          return
        }
        for (let i = node.first; i < node.last; i++) {
          const projected = projectOnSegment(candidate, geometry[i]!, geometry[i + 1]!)
          if (projected.distanceMeters < bestDistance || (projected.distanceMeters === bestDistance && i < bestSegment)) {
            bestDistance = projected.distanceMeters
            bestSegment = i
            bestAlong = distances[i]! + (distances[i + 1]! - distances[i]!) * projected.ratio
          }
        }
      }
      visit(root)
      return { trackDistanceKm: bestAlong / 1_000, lateralDistanceMeters: bestDistance }
    },
  }
  routeLocators.set(geometry, locator)
  return locator
}
