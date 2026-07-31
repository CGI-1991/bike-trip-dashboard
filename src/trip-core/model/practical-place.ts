import type { Kilometers, LatitudeDegrees, LongitudeDegrees } from './common.ts'
import type { PracticalPlaceId } from './ids.ts'
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
  readonly name: string
  readonly latitude: LatitudeDegrees
  readonly longitude: LongitudeDegrees
  readonly description: string | null
  readonly trackDistanceKm: Kilometers | null
  readonly detourKm: Kilometers | null
  readonly openingHours: string | null
  readonly hidden: boolean
  readonly pinned: boolean
  readonly provenance: DataProvenance
}
