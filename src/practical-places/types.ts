import type { PracticalPlaceCategory, RouteGeometryPoint } from '../trip-core/index.ts'

export type OsmElementType = 'node' | 'way' | 'relation'

export interface PracticalPlaceCandidate {
  readonly osmType: OsmElementType
  readonly osmId: string
  readonly category: Exclude<PracticalPlaceCategory, 'shelter'>
  readonly name: string | null
  readonly latitude: number
  readonly longitude: number
  readonly usefulTags: Readonly<Record<string, string>>
}

export interface PracticalPlacesSearch {
  readonly geometry: readonly RouteGeometryPoint[]
  readonly radiusMeters: number
}

export interface PracticalPlacesProvider {
  readonly id: string
  readonly sourceType: 'osm'
  readonly attribution: string
  findCandidates(search: PracticalPlacesSearch, signal?: AbortSignal): Promise<readonly PracticalPlaceCandidate[]>
}
