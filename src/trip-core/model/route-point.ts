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
  | 'hamlet'
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
  /**
   * For a point that came from a GPX `<wpt>`: its declared role (`<type>`,
   * else `<sym>`) — "Segment Start", "Segment End", "Alert", "Summit"…
   * Kept because it is what tells a real place from a route annotation
   * (`analysis/gpx-marker-names.ts`), and re-running climb detection over a
   * stored trip needs the same signal the import had. Optional/absent on
   * historical records and on every non-GPX point.
   */
  readonly gpxMarkerType?: string | null
  readonly provenance: DataProvenance
}
