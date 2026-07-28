import type { RoadbookPointMatch } from './roadbook-match.ts'

export type RoadbookPointRole = 'route-point' | 'weather-reference' | 'information' | 'not-ridden-option'

/**
 * Off-route points kept for their real position and an independent GPX
 * reference (see `roadbook-resolutions.ts` for the editorial classification).
 * All former entries (Bellevaux, Crest-Voland, Arêches, Les Chapieux, Tignes)
 * are now permanently suppressed (see `roadbook-suppressions.ts`) and never
 * reach this function at all — the set is empty until a future off-route point
 * is documented.
 */
const weatherReferenceIds = new Set<string>([])

// Cime de la Bonette (the only past `not-ridden-option`) is now permanently
// suppressed (see `roadbook-suppressions.ts`) and never reaches this function;
// the role and its type member remain available for a future documented option.
export function getRoadbookPointRole(point: RoadbookPointMatch): RoadbookPointRole {
  if (weatherReferenceIds.has(point.id)) return 'weather-reference'
  if (point.resolution === 'matched') return 'route-point'
  if (point.resolution === 'excluded') return 'information'
  return 'information'
}

export function getDistanceToRouteKm(point: RoadbookPointMatch): number | null {
  return point.matchDistanceM === undefined ? null : point.matchDistanceM / 1_000
}

export function pointContributesToRisk(
  point: RoadbookPointMatch,
  plannedWeatherReferenceIds: ReadonlySet<string> = new Set(),
): boolean {
  const role = getRoadbookPointRole(point)
  return role === 'route-point' || (role === 'weather-reference' && plannedWeatherReferenceIds.has(point.id))
}
