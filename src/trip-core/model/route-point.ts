import type { Kilometers, LatitudeDegrees, LongitudeDegrees, Meters } from './common.ts'
import type { RouteId, RoutePointId } from './ids.ts'
import type { DataProvenance } from './provenance.ts'

/**
 * Generic category for a named/documented point along a route — the
 * generic counterpart of the legacy roadbook point type
 * (`src/trip/roadbook-types.ts`), without any trip-specific subtype.
 */
export type RoutePointType =
  | 'start'
  | 'end'
  | 'summit'
  | 'village'
  | 'passage'
  | 'resupply'
  | 'pause'
  | 'shelter'
  | 'lodging'
  | 'poi'

export type OsmRouteFeatureType =
  | 'city'
  | 'town'
  | 'village'
  | 'mountain-pass'
  | 'saddle'
  | 'peak'

/**
 * A named point of interest along a route (start/end, village, resupply,
 * etc.) — distinct from the raw track coordinates stored in
 * `Route.geometry`, and distinct from a `PracticalPlace` (an OSM-style
 * amenity, not necessarily tied to a single route).
 */
export interface RoutePoint {
  readonly id: RoutePointId
  readonly routeId: RouteId
  readonly type: RoutePointType
  readonly name: string
  readonly latitude: LatitudeDegrees
  readonly longitude: LongitudeDegrees
  readonly elevationM: Meters | null
  readonly trackDistanceKm: Kilometers | null
  /** OSM subtype for route-enrichment points; absent on historical records. */
  readonly osmFeatureType?: OsmRouteFeatureType | null
  /** Straight-line distance to the GPX trace; absent on historical records. */
  readonly lateralDistanceKm?: Kilometers | null
  readonly provenance: DataProvenance
}
