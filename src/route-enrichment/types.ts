import type { RouteGeometryPoint } from '../trip-core/index.ts'

export type OsmElementType = 'node' | 'way' | 'relation'
export type RouteEnrichmentKind = 'landmarks' | 'localities'
/**
 * V1 final scope (stability/UX hardening 2026-08-04): `hamlet`/`peak` were
 * tried and definitively dropped — too noisy relative to their value, and
 * they never became a strong enough anchor for pauses to justify the extra
 * complexity. Never searched, stored, displayed, or used as a pause anchor
 * again. Old `TripBundle`s that already contain a `hamlet`/`peak`
 * `RoutePoint` from before this change still validate (read compatibility,
 * `trip-core/model/route-point.ts::OsmRouteFeatureType`) but are excluded
 * from every generic-pipeline view (`analysis/canonical-waypoints.ts`).
 */
export type RouteFeatureType = 'mountain-pass' | 'saddle' | 'city' | 'town' | 'village'

/**
 * Runtime allowlist mirroring `RouteFeatureType`, used as a defense-in-depth
 * boundary in `enrichment.ts` — a provider is only trusted at the TS type
 * level; a stale cache entry, a future provider, or a legacy code path could
 * still hand back a `hamlet`/`peak` (or unrecognized) feature type, so
 * `resultFromCandidates` filters against this set rather than assuming.
 */
export const KNOWN_ROUTE_FEATURE_TYPES: ReadonlySet<string> = new Set(['mountain-pass', 'saddle', 'city', 'town', 'village'])

export const STRUCTURAL_LOCALITY_COLLECTION_RADIUS_METERS = 1_800 as const
export const STRUCTURAL_LANDMARK_COLLECTION_RADIUS_METERS = 500 as const
export const STRUCTURAL_LOCALITY_CLIENT_RADIUS_METERS = 1_500 as const
export const STRUCTURAL_LANDMARK_CLIENT_RADIUS_METERS = 250 as const

/** Client-side retention radius (meters) to apply per structural feature type, after server-side collection. */
export function structuralClientRadiusMeters(featureType: RouteFeatureType): number {
  switch (featureType) {
    case 'mountain-pass':
    case 'saddle':
      return STRUCTURAL_LANDMARK_CLIENT_RADIUS_METERS
    case 'city':
    case 'town':
    case 'village':
      return STRUCTURAL_LOCALITY_CLIENT_RADIUS_METERS
  }
}

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

/**
 * The isolated, unwired Overpass implementation predates the `hamlet`/`peak`
 * removal from the live generic pipeline's `RouteFeatureType` and still
 * queries `natural=peak` itself — kept exactly as it always was for
 * history/non-regression, so it gets its own, wider candidate shape rather
 * than sharing the now-narrower `OsmRouteFeatureCandidate`.
 */
export type LegacyRouteFeatureType = RouteFeatureType | 'peak' | 'hamlet'

export interface LegacyOsmRouteFeatureCandidate extends Omit<OsmRouteFeatureCandidate, 'featureType'> {
  readonly featureType: LegacyRouteFeatureType
}

/** Legacy per-kind provider contract retained for the isolated Overpass implementation. */
export interface LegacyRouteEnrichmentProvider {
  readonly id: string
  readonly sourceType: 'osm'
  readonly attribution: string
  findCandidates(search: RouteFeatureSearch, signal?: AbortSignal): Promise<readonly LegacyOsmRouteFeatureCandidate[]>
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
