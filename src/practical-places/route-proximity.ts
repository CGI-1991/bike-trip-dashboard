import type { RouteGeometryPoint } from '../trip-core/index.ts'
import { distanceBetweenCoordinatesMeters, locatePointOnRoute } from '../route/route-proximity.ts'
import type { LocatedRoutePosition } from '../route/route-proximity.ts'
import type { PracticalPlaceCandidate } from './types.ts'

export interface LocatedPracticalPlaceCandidate extends PracticalPlaceCandidate {
  readonly trackDistanceKm: number
  readonly lateralDistanceMeters: number
}

export { locatePointOnRoute }
export type { LocatedRoutePosition }

export function locateCandidateOnRoute(
  candidate: PracticalPlaceCandidate,
  geometry: readonly RouteGeometryPoint[],
): LocatedPracticalPlaceCandidate | null {
  const located = locatePointOnRoute(candidate, geometry)
  return located === null ? null : { ...candidate, ...located }
}

function normalizedName(name: string | null): string | null {
  if (name === null) return null
  return name.normalize('NFKD').replace(/[\u0300-\u036f]/gu, '').toLocaleLowerCase('fr').replace(/[^a-z0-9]+/gu, '') || null
}

function distanceMeters(left: LocatedPracticalPlaceCandidate, right: LocatedPracticalPlaceCandidate): number {
  return distanceBetweenCoordinatesMeters(left, right)
}

export function locateAndDeduplicatePracticalPlaces(
  candidates: readonly PracticalPlaceCandidate[],
  geometry: readonly RouteGeometryPoint[],
  maximumLateralDistanceMeters = 250,
): readonly LocatedPracticalPlaceCandidate[] {
  const exact = new Map<string, LocatedPracticalPlaceCandidate>()
  for (const candidate of candidates) {
    const located = locateCandidateOnRoute(candidate, geometry)
    if (located === null || located.lateralDistanceMeters > maximumLateralDistanceMeters) continue
    const anonymousAllowed = located.category === 'water'
      || located.category === 'toilet'
      || located.category === 'shelter'
      || (located.category === 'bike-service' && located.usefulTags.amenity === 'bicycle_repair_station')
    if (located.name === null && !anonymousAllowed) continue
    const key = `${located.osmType}:${located.osmId}`
    const previous = exact.get(key)
    if (previous === undefined || located.lateralDistanceMeters < previous.lateralDistanceMeters) exact.set(key, located)
  }

  const deduplicated: LocatedPracticalPlaceCandidate[] = []
  for (const candidate of [...exact.values()].sort((left, right) => left.lateralDistanceMeters - right.lateralDistanceMeters)) {
    const name = normalizedName(candidate.name)
    const duplicate = deduplicated.some((existing) => {
      const existingName = normalizedName(existing.name)
      if (name !== null && existingName === name) return distanceMeters(existing, candidate) <= 40
      return name === null && existingName === null && existing.category === candidate.category && distanceMeters(existing, candidate) <= 5
    })
    if (!duplicate) deduplicated.push(candidate)
  }
  return deduplicated.sort((left, right) => left.trackDistanceKm - right.trackDistanceKm || left.lateralDistanceMeters - right.lateralDistanceMeters)
}
