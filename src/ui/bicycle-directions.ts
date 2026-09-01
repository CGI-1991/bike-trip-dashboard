/**
 * C3.B — a pure Google Maps Directions URL builder for the generic
 * pipeline's POI popup (CDC C3 sections 51-55). Deliberately separate from
 * the legacy RGA pipeline's own `practical-map-model.ts::buildGoogleMapsBicyclingUrl`
 * (different point shape, different popup) — no shared runtime dependency,
 * same officially documented URL scheme.
 */

export interface BicycleDirectionsDestination {
  readonly latitude: number
  readonly longitude: number
}

/**
 * `https://www.google.com/maps/dir/?api=1&destination=<lat>,<lon>&travelmode=bicycling`,
 * plus `&origin=<lat>,<lon>` when a current position is known (CDC section
 * 52). Never omits/disables the link just because the origin is unknown
 * (section 53) — Google Maps then asks the user for a starting point
 * itself. Coordinates are fixed to 6 decimal places (~11 cm) before
 * `encodeURIComponent`, comfortably more precise than any GPS fix, and
 * avoids float noise in the URL.
 */
export function buildBicycleDirectionsUrl(destination: BicycleDirectionsDestination, origin: BicycleDirectionsDestination | null = null): string {
  const params = new URLSearchParams({ api: '1', travelmode: 'bicycling', destination: formatCoordinate(destination) })
  if (origin !== null) params.set('origin', formatCoordinate(origin))
  return `https://www.google.com/maps/dir/?${params.toString()}`
}

function formatCoordinate(point: BicycleDirectionsDestination): string {
  return `${point.latitude.toFixed(6)},${point.longitude.toFixed(6)}`
}
