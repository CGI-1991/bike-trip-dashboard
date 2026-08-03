import type { RouteGeometryPoint } from '../trip-core/index.ts'

export type OsmElementType = 'node' | 'way' | 'relation'
export type RouteEnrichmentKind = 'landmarks' | 'localities'
export type RouteFeatureType = 'mountain-pass' | 'saddle' | 'peak' | 'city' | 'town' | 'village'

export interface OsmRouteFeatureCandidate {
  readonly osmType: OsmElementType
  readonly osmId: string
  readonly featureType: RouteFeatureType
  readonly name: string | null
  readonly latitude: number
  readonly longitude: number
  readonly elevationM: number | null
  readonly usefulTags: Readonly<Record<string, string>>
}

export interface RouteFeatureSearch {
  readonly kind: RouteEnrichmentKind
  readonly geometry: readonly RouteGeometryPoint[]
  readonly radiusMeters: number
}

export interface RouteEnrichmentProvider {
  readonly id: string
  readonly sourceType: 'osm'
  readonly attribution: string
  findCandidates(search: RouteFeatureSearch, signal?: AbortSignal): Promise<readonly OsmRouteFeatureCandidate[]>
}

export interface RouteEnrichmentProgress {
  readonly stageIndex: number
  readonly stageCount: number
  readonly kind: RouteEnrichmentKind
  readonly chunkIndex: number
  readonly chunkCount: number
  readonly fromCache: boolean
  readonly status: 'cache' | 'success' | 'error'
  readonly errorCount: number
}
