import type { RouteGeometryPoint } from '../trip-core/index.ts'
import { distanceBetweenCoordinatesMeters, locatePointOnRoute } from '../route/route-proximity.ts'
import type { LocatedRoutePosition } from '../route/route-proximity.ts'
import { isPracticalPlaceCorridorCategory } from './taxonomy.ts'
import type { PracticalPlaceAnchor, PracticalPlaceCandidate } from './types.ts'

export interface LocatedPracticalPlaceCandidate extends PracticalPlaceCandidate {
  readonly trackDistanceKm: number
  readonly lateralDistanceMeters: number
  /** Distance to the nearest anchor (CDC C2 section 10.B) — `null` for a corridor category, which has no anchor concept of its own. */
  readonly anchorDistanceMeters?: number | null
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

export interface LocatePostpassPracticalPlacesOptions {
  readonly corridorMaximumLateralDistanceMeters: number
  readonly anchorMaximumDistanceMeters: number
}

function nearestAnchorDistanceMeters(candidate: { readonly latitude: number; readonly longitude: number }, anchors: readonly PracticalPlaceAnchor[]): number | null {
  if (anchors.length === 0) return null
  return Math.min(...anchors.map((anchor) => distanceBetweenCoordinatesMeters(candidate, anchor)))
}

/** Same anonymous-name policy as `locateAndDeduplicatePracticalPlaces` (CDC C2 section 29): water/toilet/shelter — and a real bike-repair station — never need a name to be useful; a commerce (bike shop/supermarket/bakery) with no name is dropped rather than pollute the map with an unlabelled marker. */
function anonymousNameAllowed(candidate: Pick<PracticalPlaceCandidate, 'category' | 'usefulTags'>): boolean {
  return candidate.category === 'water' || candidate.category === 'toilet' || candidate.category === 'shelter'
    || (candidate.category === 'bike-service' && candidate.usefulTags.amenity === 'bicycle_repair_station')
}

/**
 * C2's dual-strategy proximity/dedup (CDC C2 sections 10-13): a corridor
 * category (Eau/Abris/Toilette) is retained anywhere within
 * `corridorMaximumLateralDistanceMeters` of the GPX trace; an anchor
 * category (Vélo/Supermarché/Boulangerie) is retained only within
 * `anchorMaximumDistanceMeters` of at least one anchor (départ/arrivée/
 * localité retenue/pause) — never scanned along the whole corridor. Every
 * accepted candidate still gets `trackDistanceKm` from its own projection
 * onto the route (needed for the fused Parcours-style sort and the ETA
 * lookup downstream); `anchorDistanceMeters` is the "détour" an anchor
 * category candidate actually represents (section 19's popup), `null` for a
 * corridor category (whose own `lateralDistanceMeters` already says that).
 */
export function locateAndDeduplicatePostpassPracticalPlaces(
  candidates: readonly PracticalPlaceCandidate[],
  geometry: readonly RouteGeometryPoint[],
  anchors: readonly PracticalPlaceAnchor[],
  options: LocatePostpassPracticalPlacesOptions,
): readonly LocatedPracticalPlaceCandidate[] {
  const exact = new Map<string, LocatedPracticalPlaceCandidate>()
  for (const candidate of candidates) {
    const located = locateCandidateOnRoute(candidate, geometry)
    if (located === null) continue
    const isCorridor = isPracticalPlaceCorridorCategory(candidate.category)
    const anchorDistance = isCorridor ? null : nearestAnchorDistanceMeters(candidate, anchors)
    const accepted = isCorridor
      ? located.lateralDistanceMeters <= options.corridorMaximumLateralDistanceMeters
      : anchorDistance !== null && anchorDistance <= options.anchorMaximumDistanceMeters
    if (!accepted) continue
    if (located.name === null && !anonymousNameAllowed(located)) continue
    const withAnchor: LocatedPracticalPlaceCandidate = { ...located, anchorDistanceMeters: anchorDistance }
    const key = `${located.osmType}:${located.osmId}`
    const previous = exact.get(key)
    const rank = (item: LocatedPracticalPlaceCandidate) => item.anchorDistanceMeters ?? item.lateralDistanceMeters
    if (previous === undefined || rank(withAnchor) < rank(previous)) exact.set(key, withAnchor)
  }

  const deduplicated: LocatedPracticalPlaceCandidate[] = []
  for (const candidate of [...exact.values()].sort((left, right) => (left.anchorDistanceMeters ?? left.lateralDistanceMeters) - (right.anchorDistanceMeters ?? right.lateralDistanceMeters))) {
    const name = normalizedName(candidate.name)
    const duplicate = deduplicated.some((existing) => {
      const existingName = normalizedName(existing.name)
      if (name !== null && existingName === name) return distanceMeters(existing, candidate) <= 40
      return name === null && existingName === null && existing.category === candidate.category && distanceMeters(existing, candidate) <= 5
    })
    if (!duplicate) deduplicated.push(candidate)
  }
  return deduplicated.sort((left, right) => left.trackDistanceKm - right.trackDistanceKm || (left.anchorDistanceMeters ?? left.lateralDistanceMeters) - (right.anchorDistanceMeters ?? right.lateralDistanceMeters))
}
