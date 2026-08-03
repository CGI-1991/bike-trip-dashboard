import type { GeocodingCoordinates } from '../geocoding/types.ts'
import type { ClimbNameCandidate } from './types.ts'

const PASS_MAX_DISTANCE_M = 250
const SADDLE_MAX_DISTANCE_M = 300
const PEAK_MAX_DISTANCE_M = 75
const PEAK_WITHOUT_ELEVATION_MAX_DISTANCE_M = 40
const PASS_MAX_ELEVATION_DELTA_M = 120
const PEAK_MAX_ELEVATION_DELTA_M = 60

function distanceMeters(left: GeocodingCoordinates, right: GeocodingCoordinates): number {
  const radians = Math.PI / 180
  const latitudeDelta = (right.latitude - left.latitude) * radians
  const longitudeDelta = (right.longitude - left.longitude) * radians
  const latitude = ((left.latitude + right.latitude) / 2) * radians
  const x = longitudeDelta * Math.cos(latitude)
  return Math.sqrt(x * x + latitudeDelta * latitudeDelta) * 6_371_000
}

function isElevationCompatible(candidate: ClimbNameCandidate, summitElevationM: number | null, maximumDeltaM: number): boolean {
  return candidate.elevationM === null || summitElevationM === null || Math.abs(candidate.elevationM - summitElevationM) <= maximumDeltaM
}

function isRelevant(candidate: ClimbNameCandidate, summit: GeocodingCoordinates, summitElevationM: number | null): boolean {
  const distance = distanceMeters(summit, candidate.coordinates)
  if (candidate.featureType === 'mountain-pass') {
    return distance <= PASS_MAX_DISTANCE_M && isElevationCompatible(candidate, summitElevationM, PASS_MAX_ELEVATION_DELTA_M)
  }
  if (candidate.featureType === 'saddle') {
    return distance <= SADDLE_MAX_DISTANCE_M && isElevationCompatible(candidate, summitElevationM, PASS_MAX_ELEVATION_DELTA_M)
  }
  const maximumDistance = candidate.elevationM === null ? PEAK_WITHOUT_ELEVATION_MAX_DISTANCE_M : PEAK_MAX_DISTANCE_M
  return distance <= maximumDistance && isElevationCompatible(candidate, summitElevationM, PEAK_MAX_ELEVATION_DELTA_M)
}

function priority(candidate: ClimbNameCandidate): number {
  return candidate.featureType === 'mountain-pass' ? 0 : candidate.featureType === 'saddle' ? 1 : 2
}

export function selectRelevantClimbName(
  candidates: readonly ClimbNameCandidate[],
  summit: GeocodingCoordinates,
  summitElevationM: number | null,
): ClimbNameCandidate | null {
  return candidates
    .filter((candidate) => isRelevant(candidate, summit, summitElevationM))
    .map((candidate) => ({ candidate, distance: distanceMeters(summit, candidate.coordinates) }))
    .sort((left, right) => priority(left.candidate) - priority(right.candidate) || left.distance - right.distance)[0]?.candidate ?? null
}
