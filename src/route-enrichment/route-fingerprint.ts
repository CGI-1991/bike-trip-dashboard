import type { Route, RouteGeometryPoint, TripBundle } from '../trip-core/index.ts'

export function routeGeometry(route: Route): readonly RouteGeometryPoint[] | null {
  const geometry = route.geometry?.full ?? route.geometry?.simplified ?? null
  return geometry !== null && geometry.length >= 2 ? geometry : null
}

export function routeFingerprint(bundle: TripBundle, route: Route): string {
  const source = route.sourceFileId === null ? null : bundle.sourceFiles.find((candidate) => candidate.id === route.sourceFileId)
  if (source?.sha256 !== null && source?.sha256 !== undefined) return `sha256:${source.sha256}`
  const geometry = routeGeometry(route)
  const geometryKey = geometry === null
    ? 'no-geometry'
    : geometry.map((point) => `${point.latitude.toFixed(6)},${point.longitude.toFixed(6)}`).join(';')
  return `route:${route.id}:${geometryKey}`
}
