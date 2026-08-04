import type { RouteGeometryPoint } from '../trip-core/index.ts'

const METERS_PER_LATITUDE_DEGREE = 111_320

export interface OverpassBoundingBox {
  readonly south: number
  readonly west: number
  readonly north: number
  readonly east: number
}

export function expandedRouteBoundingBox(
  geometry: readonly RouteGeometryPoint[],
  marginMeters: number,
): OverpassBoundingBox {
  if (geometry.length === 0) throw new Error('La géométrie Overpass ne peut pas être vide.')
  const latitudes = geometry.map((point) => point.latitude)
  const longitudes = geometry.map((point) => point.longitude)
  const minimumLatitude = Math.min(...latitudes)
  const maximumLatitude = Math.max(...latitudes)
  const minimumLongitude = Math.min(...longitudes)
  const maximumLongitude = Math.max(...longitudes)
  const latitudeMargin = Math.max(0, marginMeters) / METERS_PER_LATITUDE_DEGREE
  const referenceLatitude = (minimumLatitude + maximumLatitude) / 2
  const longitudeScale = Math.max(0.1, Math.cos(referenceLatitude * Math.PI / 180))
  const longitudeMargin = Math.max(0, marginMeters) / (METERS_PER_LATITUDE_DEGREE * longitudeScale)
  return {
    south: Math.max(-90, minimumLatitude - latitudeMargin),
    west: Math.max(-180, minimumLongitude - longitudeMargin),
    north: Math.min(90, maximumLatitude + latitudeMargin),
    east: Math.min(180, maximumLongitude + longitudeMargin),
  }
}

export function formatOverpassBoundingBox(box: OverpassBoundingBox): string {
  return [box.south, box.west, box.north, box.east].map((value) => value.toFixed(6)).join(',')
}
