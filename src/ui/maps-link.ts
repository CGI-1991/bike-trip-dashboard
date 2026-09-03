/**
 * RC2 final-closeout sections 45-50 — a shared, priority-ordered Google
 * Maps link resolver, reused by every surface that can point somewhere on
 * a map (lodging, an OFF/transfer's own résumé): (1) an explicit Maps URL
 * the visitor already provided always wins outright (section 50); (2)
 * failing that, a text address becomes a Maps SEARCH query — never
 * requiring the visitor to hand-craft a URL themselves (section 49); (3)
 * failing that too, known coordinates become a search query on that exact
 * point (section 48). `null` only when none of the three is available —
 * never an empty/dead action button (section 45: "aucun champ → aucun
 * bouton vide").
 */

export interface MapsLinkCoordinates {
  readonly latitude: number
  readonly longitude: number
}

export interface MapsLinkSources {
  readonly explicitUrl?: string | null
  readonly address?: string | null
  readonly coordinates?: MapsLinkCoordinates | null
}

function formatCoordinate(point: MapsLinkCoordinates): string {
  return `${point.latitude.toFixed(6)},${point.longitude.toFixed(6)}`
}

export function resolveMapsSearchUrl(sources: MapsLinkSources): string | null {
  const explicitUrl = sources.explicitUrl?.trim()
  if (explicitUrl !== undefined && explicitUrl !== '') return explicitUrl
  const address = sources.address?.trim()
  if (address !== undefined && address !== '') return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
  const coordinates = sources.coordinates
  if (coordinates !== undefined && coordinates !== null) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(formatCoordinate(coordinates))}`
  return null
}

/**
 * A generic (mode-agnostic — a transfer may be train/bus/car/ferry/taxi,
 * never forced into `travelmode=bicycling`, unlike `bicycle-directions.ts`)
 * directions link between two known points, for the TRAJET block's own
 * "Itinéraire" action (section 39). `null` when either side is unresolved —
 * never a one-sided/fabricated route.
 */
export function resolveMapsDirectionsUrl(origin: MapsLinkCoordinates | null, destination: MapsLinkCoordinates | null): string | null {
  if (origin === null || destination === null) return null
  const params = new URLSearchParams({
    api: '1',
    origin: formatCoordinate(origin),
    destination: formatCoordinate(destination),
  })
  return `https://www.google.com/maps/dir/?${params.toString()}`
}
