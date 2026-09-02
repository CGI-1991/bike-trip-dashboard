import type { IsoDate, LatitudeDegrees, LongitudeDegrees } from './common.ts'
import type { AccommodationId, RideStageId, TripDayId } from './ids.ts'

export type TripDayType = 'ride' | 'off' | 'transfer'

/**
 * R2.1 section 36 — a short, closed, pragmatic list (CDC: "pas d'autres
 * modes pour R2.1"). `transferMode` itself stays a plain `string` below
 * (never this literal union) so an already-saved free-text value from R2
 * (before this list existed) is never silently dropped/invalidated — the
 * edit UI offers exactly these seven as a `<select>`, plus the current
 * value verbatim if it happens to be something else already.
 */
export const TRANSFER_MODES = ['train', 'bus', 'car', 'ferry', 'taxi', 'bike', 'other'] as const
export type TransferMode = (typeof TRANSFER_MODES)[number]

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
  /**
   * R2 section 2: pragmatic, free-text transfer fields — a mode of transport
   * ("Train", "Voiture"…), and its own départ/arrivée wall-clock times
   * ("HH:MM"), entirely optional/manually entered (never inferred, never a
   * multimodal provider). Optional/absent on historical records — always
   * treated as unset when missing, exactly like `transferTiming`, so this is
   * purely additive (no schema version bump, no migration). Meaningless
   * (and always `undefined`) for non-`transfer` days. Duration is never
   * stored — only ever derived from these two times at display time, and
   * only when both are present and consistent (never fabricated).
   */
  readonly transferMode?: string
  readonly transferDepartureTime?: string
  readonly transferArrivalTime?: string
  /**
   * R2.1 section 37: a short, mode-appropriate compagnie/opérateur label
   * ("SNCF", "FlixBus"…) and a booking/ticket link — both entirely optional,
   * free text, never inferred. Meaningless for non-`transfer` days.
   */
  readonly transferOperator?: string
  readonly transferLink?: string
  /**
   * R2.1 sections 40-41: "Choisir sur la carte" — a manual coordinate
   * override for `startLocationName`/`endLocationName` when neither a
   * neighbouring ride stage nor the existing text override can resolve a
   * location. Purely additive, like every other field here. Reused for an
   * `off` day too (its own single location, via the *Start pair only —
   * `resolveOffLocation` already prefers `startLocationName` first).
   * Deliberately paired 1:1 with the existing string field it accompanies —
   * never persisted without a corresponding name, never resolved on its
   * own (CDC section 41: "autoriser un libellé manuel" when no name can be
   * resolved any other way).
   */
  readonly overrideStartLatitude?: LatitudeDegrees
  readonly overrideStartLongitude?: LongitudeDegrees
  readonly overrideEndLatitude?: LatitudeDegrees
  readonly overrideEndLongitude?: LongitudeDegrees
}
