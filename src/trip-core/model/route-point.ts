import type { Kilometers, LatitudeDegrees, LongitudeDegrees, Meters } from './common.ts'
import type { RouteId, RoutePointId } from './ids.ts'
import type { DataProvenance } from './provenance.ts'

/**
 * Generic category for a named/documented point along a route — the
 * generic counterpart of the RGA's `RoadbookPointType`
 * (`src/trip/roadbook-types.ts`), without any RGA-specific subtype.
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
  readonly provenance: DataProvenance
}
