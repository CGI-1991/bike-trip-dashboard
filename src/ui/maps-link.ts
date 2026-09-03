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
 * DER-DES-DER section 99 — the transfer mode the traveller chose, mapped to
 * Google Maps' own `travelmode`.
 *
 * `null` means "do not force one" and is a deliberate answer, not a gap:
 * - **ferry** has no Maps travel mode of its own; forcing `driving` or
 *   `transit` would describe a different journey than the one being taken,
 *   so Maps is left to work out the crossing itself.
 * - **other** is by definition unknown — inventing a mode for it would be
 *   guessing.
 * A value outside the known list (a free-text mode saved before the list
 * existed) is treated the same way.
 */
export function googleMapsTravelMode(transferMode: string | null | undefined): 'transit' | 'driving' | 'bicycling' | null {
  switch (transferMode) {
    case 'train':
    case 'bus':
      return 'transit'
    case 'car':
    case 'taxi':
      return 'driving'
    case 'bike':
      return 'bicycling'
    default:
      return null
  }
}

/**
 * A directions link between two known points, for the TRAJET block's own
 * "Itinéraire" action (RC2 section 39 / DER-DES-DER sections 98-101).
 *
 * Section 98: built from the endpoints' real COORDINATES, never their text
 * names — a station and the town it is named after are rarely the same
 * point. Section 100: built fresh from the day's current data on every
 * render, so changing the mode from Train to Voiture immediately yields a
 * driving itinerary; no link is ever stored and left to go stale.
 * Section 101: `null` when either side is unresolved — never a one-sided,
 * fabricated, or dead button.
 */
export function resolveMapsDirectionsUrl(
  origin: MapsLinkCoordinates | null,
  destination: MapsLinkCoordinates | null,
  transferMode?: string | null,
): string | null {
  if (origin === null || destination === null) return null
  const params = new URLSearchParams({
    api: '1',
    origin: formatCoordinate(origin),
    destination: formatCoordinate(destination),
  })
  const travelMode = googleMapsTravelMode(transferMode)
  if (travelMode !== null) params.set('travelmode', travelMode)
  return `https://www.google.com/maps/dir/?${params.toString()}`
}
