import type { Kilometers, LatitudeDegrees, LongitudeDegrees } from './common.ts'
import type { PracticalPlaceId, RideStageId, TripDayId } from './ids.ts'
import type { DataProvenance } from './provenance.ts'

/** The generic amenity categories from CDC section 19.1. */
export type PracticalPlaceCategory =
  | 'shelter'
  | 'bakery'
  | 'cafe-or-ice-cream'
  | 'water'
  | 'fast-food'
  | 'bike-service'
  | 'supermarket'
  | 'toilet'

/** A practical amenity near the route (bakery, water point, shelter, ...). */
export interface PracticalPlace {
  readonly id: PracticalPlaceId
  readonly category: PracticalPlaceCategory
  readonly name: string | null
  readonly latitude: LatitudeDegrees
  readonly longitude: LongitudeDegrees
  readonly description: string | null
  readonly trackDistanceKm: Kilometers | null
  readonly detourKm: Kilometers | null
  readonly openingHours: string | null
  readonly hidden: boolean
  readonly pinned: boolean
  /**
   * Days this place is near enough to be relevant for — a place can serve
   * more than one consecutive day. Empty when no day association is known
   * yet; never a day the source data doesn't actually associate it with.
   */
  readonly dayIds: readonly TripDayId[]
  /** Present for route-derived places created from phase 7B1 onward. */
  readonly stageId?: RideStageId | null
  /** Small allow-listed OSM tag subset; absent on historical v1 records. */
  readonly usefulTags?: Readonly<Record<string, string>> | null
  readonly provenance: DataProvenance
}
