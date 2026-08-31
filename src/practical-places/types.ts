import type { PracticalPlaceCategory, RouteGeometryPoint } from '../trip-core/index.ts'

export type OsmElementType = 'node' | 'way' | 'relation'

export interface PracticalPlaceCandidate {
  readonly osmType: OsmElementType
  readonly osmId: string
  readonly category: PracticalPlaceCategory
  readonly name: string | null
  readonly latitude: number
  readonly longitude: number
  readonly usefulTags: Readonly<Record<string, string>>
}

/**
 * Legacy (pre-C2) single-corridor search/provider contract — kept only for
 * `overpass-provider.ts`, which stays in the repo, testable, but is no
 * longer invoked automatically by the runtime (CDC C2 section 2/33: Postpass
 * is the sole automatic runtime source; Overpass may still serve a future
 * manual/debug fallback). Renamed from the original bare `PracticalPlacesSearch`/
 * `PracticalPlacesProvider` when C2 introduced the dual corridor/anchor
 * strategy those clean names now describe below — never reused for the new
 * Postpass provider, which needs anchors this shape has no room for.
 */
export interface LegacyPracticalPlacesSearch {
  readonly geometry: readonly RouteGeometryPoint[]
  readonly radiusMeters: number
}

export interface LegacyPracticalPlacesProvider {
  readonly id: string
  readonly sourceType: 'osm'
  readonly attribution: string
  findCandidates(search: LegacyPracticalPlacesSearch, signal?: AbortSignal): Promise<readonly PracticalPlaceCandidate[]>
}

/** A single search anchor (CDC C2 section 10.B) — plain coordinates, no identity needed beyond position. */
export interface PracticalPlaceAnchor {
  readonly latitude: number
  readonly longitude: number
}

/**
 * C2's dual-strategy search (CDC sections 10-12): `geometry` drives the
 * continuous corridor categories (Eau/Abris/Toilette, `corridorRadiusMeters`
 * laterally off the GPX trace); `anchors` drives the anchor categories
 * (Vélo/Supermarché/Boulangerie, `anchorRadiusMeters` around each départ/
 * arrivée/localité retenue/pause) — one query per stage covers both at once
 * (section 11: never one request per anchor).
 */
export interface PracticalPlacesSearch {
  readonly stageId: string
  readonly routeFingerprint: string
  readonly geometry: readonly RouteGeometryPoint[]
  readonly routeLengthKm: number | null
  readonly anchors: readonly PracticalPlaceAnchor[]
  readonly corridorRadiusMeters: number
  readonly anchorRadiusMeters: number
}

export interface PracticalPlacesResult {
  readonly candidates: readonly PracticalPlaceCandidate[]
  readonly durationMs: number
  readonly rawCandidateCount: number
  readonly httpStatus: number
  readonly payloadBytes: number
  readonly startedAt: string
  readonly finishedAt: string
}

export interface PracticalPlacesProvider {
  readonly id: string
  readonly sourceType: 'osm'
  readonly attribution: string
  findCandidates(search: PracticalPlacesSearch, signal?: AbortSignal): Promise<PracticalPlacesResult>
}
