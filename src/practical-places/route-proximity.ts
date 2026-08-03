import type { RouteGeometryPoint } from '../trip-core/index.ts'
import type { PracticalPlaceCandidate } from './types.ts'

const EARTH_RADIUS_METERS = 6_371_000

export interface LocatedPracticalPlaceCandidate extends PracticalPlaceCandidate {
  readonly trackDistanceKm: number
  readonly lateralDistanceMeters: number
}

function segmentProjection(
  candidate: { readonly latitude: number; readonly longitude: number },
  start: RouteGeometryPoint,
  end: RouteGeometryPoint,
): { readonly segmentMeters: number; readonly ratio: number; readonly distanceMeters: number } {
  const radians = Math.PI / 180
  const referenceLatitude = ((start.latitude + end.latitude + candidate.latitude) / 3) * radians
  const xScale = EARTH_RADIUS_METERS * Math.cos(referenceLatitude) * radians
  const yScale = EARTH_RADIUS_METERS * radians
  const endX = (end.longitude - start.longitude) * xScale
  const endY = (end.latitude - start.latitude) * yScale
  const pointX = (candidate.longitude - start.longitude) * xScale
  const pointY = (candidate.latitude - start.latitude) * yScale
  const squaredLength = endX ** 2 + endY ** 2
  const ratio = squaredLength === 0 ? 0 : Math.max(0, Math.min(1, (pointX * endX + pointY * endY) / squaredLength))
  return {
    segmentMeters: Math.sqrt(squaredLength),
    ratio,
    distanceMeters: Math.sqrt((pointX - ratio * endX) ** 2 + (pointY - ratio * endY) ** 2),
  }
}

export interface LocatedRoutePosition {
  readonly trackDistanceKm: number
  readonly lateralDistanceMeters: number
}

export function locatePointOnRoute(
  candidate: { readonly latitude: number; readonly longitude: number },
  geometry: readonly RouteGeometryPoint[],
): LocatedRoutePosition | null {
  if (geometry.length < 2) return null
  let accumulatedMeters = 0
  let best: { readonly alongMeters: number; readonly lateralMeters: number } | null = null
  for (let index = 1; index < geometry.length; index++) {
    const start = geometry[index - 1]
    const end = geometry[index]
    if (start === undefined || end === undefined) continue
    const projection = segmentProjection(candidate, start, end)
    const alongMeters = accumulatedMeters + projection.segmentMeters * projection.ratio
    if (best === null || projection.distanceMeters < best.lateralMeters) {
      best = { alongMeters, lateralMeters: projection.distanceMeters }
    }
    accumulatedMeters += projection.segmentMeters
  }
  return best === null ? null : {
    trackDistanceKm: best.alongMeters / 1_000,
    lateralDistanceMeters: best.lateralMeters,
  }
}

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
  const syntheticStart = { latitude: left.latitude, longitude: left.longitude, altitudeM: null }
  const syntheticEnd = { latitude: right.latitude, longitude: right.longitude, altitudeM: null }
  return segmentProjection(left, syntheticStart, syntheticEnd).segmentMeters
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
