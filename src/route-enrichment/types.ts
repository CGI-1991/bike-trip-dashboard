import type { RouteGeometryPoint } from '../trip-core/index.ts'

export type OsmElementType = 'node' | 'way' | 'relation'
export type RouteEnrichmentKind = 'landmarks' | 'localities'
export type RouteFeatureType = 'mountain-pass' | 'saddle' | 'peak' | 'city' | 'town' | 'village'

export const STRUCTURAL_LOCALITY_COLLECTION_RADIUS_METERS = 1_800 as const
export const STRUCTURAL_LANDMARK_COLLECTION_RADIUS_METERS = 500 as const
export const STRUCTURAL_LOCALITY_CLIENT_RADIUS_METERS = 1_500 as const
export const STRUCTURAL_LANDMARK_CLIENT_RADIUS_METERS = 250 as const

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

/** Legacy per-kind provider contract retained for the isolated Overpass implementation. */
export interface LegacyRouteEnrichmentProvider {
  readonly id: string
  readonly sourceType: 'osm'
  readonly attribution: string
  findCandidates(search: RouteFeatureSearch, signal?: AbortSignal): Promise<readonly OsmRouteFeatureCandidate[]>
}

export interface StructuralRouteFeatureSearch {
  readonly stageId: string
  readonly routeFingerprint: string
  readonly geometry: readonly RouteGeometryPoint[]
  readonly routeLengthKm: number | null
  readonly localityCollectionRadiusMeters: typeof STRUCTURAL_LOCALITY_COLLECTION_RADIUS_METERS
  readonly landmarkCollectionRadiusMeters: typeof STRUCTURAL_LANDMARK_COLLECTION_RADIUS_METERS
}

export interface StructuralRouteFeatureResult {
  readonly candidates: readonly OsmRouteFeatureCandidate[]
  readonly durationMs: number
  readonly rawCandidateCount: number
  readonly httpStatus: number
  readonly payloadBytes: number
  readonly startedAt: string
  readonly finishedAt: string
}

export interface RouteEnrichmentProvider {
  readonly id: string
  readonly sourceType: 'osm'
  readonly attribution: string
  findStructuralCandidates(search: StructuralRouteFeatureSearch, signal?: AbortSignal): Promise<StructuralRouteFeatureResult>
}

export interface RouteEnrichmentProgress {
  readonly stageIndex: number
  readonly stageCount: number
  readonly stageId: string
  readonly source: 'cache' | 'network'
  readonly status: 'cache' | 'success' | 'error'
  readonly errorCount: number
  readonly durationMs: number
  readonly rawCandidateCount: number
  readonly retainedCandidateCount: number
  readonly rejectedCandidateCount: number
  readonly sentPointCount: number
}
