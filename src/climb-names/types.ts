import type { GeocodingCoordinates } from '../geocoding/types.ts'

export type ClimbFeatureType = 'mountain-pass' | 'saddle' | 'peak'

export interface ClimbNameCandidate {
  readonly name: string
  readonly featureType: ClimbFeatureType
  readonly sourceId: string
  readonly coordinates: GeocodingCoordinates
  readonly elevationM: number | null
}

export interface ClimbSummitSearch {
  readonly coordinates: GeocodingCoordinates
  readonly elevationM: number | null
  readonly radiusMeters: number
}

export interface ClimbNameProvider {
  readonly id: string
  readonly sourceType: 'osm'
  readonly attribution: string
  findCandidates(search: ClimbSummitSearch, signal?: AbortSignal): Promise<readonly ClimbNameCandidate[]>
}
