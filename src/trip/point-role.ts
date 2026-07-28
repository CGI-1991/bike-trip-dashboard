import type { RoadbookPointMatch } from './roadbook-match.ts'

export type RoadbookPointRole = 'route-point' | 'weather-reference' | 'information' | 'excluded'

const weatherReferenceIds = new Set([
  'j03-passage-crest-voland',
  'j04-passage-areches',
  'j04-passage-les-chapieux',
  'j09-passage-chateau-queyras',
  'j01-passage-bellevaux',
  'j06-passage-tignes',
])

export function getRoadbookPointRole(point: RoadbookPointMatch): RoadbookPointRole {
  if (weatherReferenceIds.has(point.id)) return 'weather-reference'
  if (point.id === 'j10-option-cime-de-la-bonette') return 'excluded'
  if (point.resolution === 'matched') return 'route-point'
  if (point.resolution === 'excluded') return 'excluded'
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
