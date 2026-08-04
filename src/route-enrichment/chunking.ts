import type { RouteGeometryPoint } from '../trip-core/index.ts'

export const DEFAULT_ROUTE_CHUNK_LENGTH_KM = 25
export const DEFAULT_ROUTE_CHUNK_MAX_POINTS = 80

export interface RouteChunk {
  readonly index: number
  readonly key: string
  readonly startDistanceKm: number
  readonly endDistanceKm: number
  readonly geometry: readonly RouteGeometryPoint[]
}

const radians = Math.PI / 180

export function geometryDistanceMeters(left: Pick<RouteGeometryPoint, 'latitude' | 'longitude'>, right: Pick<RouteGeometryPoint, 'latitude' | 'longitude'>): number {
  const latitudeDelta = (right.latitude - left.latitude) * radians
  const longitudeDelta = (right.longitude - left.longitude) * radians
  const latitude = ((left.latitude + right.latitude) / 2) * radians
  return Math.sqrt(latitudeDelta ** 2 + (longitudeDelta * Math.cos(latitude)) ** 2) * 6_371_000
}

export function cumulativeGeometryDistances(geometry: readonly RouteGeometryPoint[]): readonly number[] {
  const distances = [0]
  for (let index = 1; index < geometry.length; index++) {
    const previous = geometry[index - 1]
    const current = geometry[index]
    distances.push((distances[index - 1] ?? 0) + (previous === undefined || current === undefined ? 0 : geometryDistanceMeters(previous, current) / 1_000))
  }
  return distances
}

function simplify(points: readonly RouteGeometryPoint[], maximumPoints: number): readonly RouteGeometryPoint[] {
  if (points.length <= maximumPoints) return points
  const result: RouteGeometryPoint[] = []
  for (let index = 0; index < maximumPoints; index++) {
    const sourceIndex = Math.round(index * (points.length - 1) / (maximumPoints - 1))
    const point = points[sourceIndex]
    if (point !== undefined && result[result.length - 1] !== point) result.push(point)
  }
  return result
}

export function buildRouteChunks(
  geometry: readonly RouteGeometryPoint[],
  targetLengthKm = DEFAULT_ROUTE_CHUNK_LENGTH_KM,
  maximumPoints = DEFAULT_ROUTE_CHUNK_MAX_POINTS,
): readonly RouteChunk[] {
  if (geometry.length < 2) return []
  const distances = cumulativeGeometryDistances(geometry)
  const chunks: RouteChunk[] = []
  let startIndex = 0

  while (startIndex < geometry.length - 1) {
    const startDistanceKm = distances[startIndex] ?? 0
    let endIndex = startIndex + 1
    while (endIndex < geometry.length - 1 && (distances[endIndex] ?? startDistanceKm) - startDistanceKm < targetLengthKm) endIndex++
    const endDistanceKm = distances[endIndex] ?? startDistanceKm
    const points = geometry.slice(startIndex, endIndex + 1)
    const index = chunks.length
    chunks.push({
      index,
      key: `${index}:${startDistanceKm.toFixed(3)}-${endDistanceKm.toFixed(3)}`,
      startDistanceKm,
      endDistanceKm,
      geometry: simplify(points, Math.max(2, maximumPoints)),
    })
    startIndex = endIndex
  }

  return chunks
}
