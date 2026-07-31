import type { IsoDate } from './common.ts'
import type { AccommodationId, RideStageId, TripDayId } from './ids.ts'

export type TripDayType = 'ride' | 'off' | 'transfer'

/**
 * Generic enrichment lifecycle for a day's derived/enriched content. Not tied
 * to any specific provider or computation.
 */
export type TripDayEnrichmentStatus = 'not-started' | 'partial' | 'complete'

/**
 * One day of the trip.
 *
 * Invariants (checked by `validateTripBundle`, not by this type):
 * - days are stored in ascending `index` order;
 * - `index` values are unique and contiguous starting at 0;
 * - `displayNumber` values are positive integers;
 * - a `ride` day references exactly one stage via `stageId`;
 * - an `off` day never references a ride stage (`stageId` is `null`);
 * - a `transfer` day may or may not reference a ride stage;
 * - `accommodationId`, when set, must resolve to a known accommodation.
 *
 * No geographic continuity between consecutive days is imposed here — that
 * was a Route des Grandes Alpes 2026 specific constraint (see
 * `assertTripPlan` in `src/trip/plan.ts`) and does not belong in the generic
 * model.
 */
export interface TripDay {
  readonly id: TripDayId
  readonly index: number
  readonly displayNumber: number
  readonly date: IsoDate | null
  readonly type: TripDayType
  readonly stageId: RideStageId | null
  readonly startLocationName: string | null
  readonly endLocationName: string | null
  readonly accommodationId: AccommodationId | null
  readonly notes: string | null
  readonly enrichmentStatus: TripDayEnrichmentStatus
}
