import type { IsoDate } from './common.ts'
import type { AccommodationId, RideStageId, TripDayId } from './ids.ts'

export type TripDayType = 'ride' | 'off' | 'transfer'

/**
 * When a `transfer` day actually happens on the calendar (CDC Jalon B4.3
 * section 12): `'dedicated'` occupies its own calendar day (the historical,
 * only supported shape); `'after_previous'`/`'before_next'` happen on the
 * same calendar date as the neighbouring ride day, so the trip's calendar
 * day count must not count it twice. Optional/absent on historical records
 * — always treated as `'dedicated'` when missing, so this is purely
 * additive. Meaningless (and always `undefined`) for non-`transfer` days.
 */
export type TransferTiming = 'dedicated' | 'after_previous' | 'before_next'

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
 * - a `ride` day references exactly one stage via `stageId` (required);
 * - an `off` day never references a stage (`stageId` is `null`);
 * - a `transfer` day never references a stage either (`stageId` is `null`) —
 *   `RideStage` only ever models a cyclable ride, and v1 has no generic
 *   transfer-stage model (car, train, ferry, ...) to attach to a transfer
 *   day. A future phase may introduce a dedicated `TransferStage` type; until
 *   then, `stageId` on a `transfer` day is always `null`, exactly like `off`;
 * - `accommodationId`, when set, must resolve to a known accommodation.
 *
 * No geographic continuity between consecutive days is imposed here — that
 * is a constraint specific to the legacy, hardcoded trip plan this generic
 * model replaces, and does not belong here.
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
  /** Only meaningful when `type === 'transfer'` — see `TransferTiming`. */
  readonly transferTiming?: TransferTiming
}
