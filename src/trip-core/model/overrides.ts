import type { IsoDateTime } from './common.ts'
import type { OverrideId } from './ids.ts'

/** What kind of entity an override's `targetId` points into. */
export type OverrideTargetType =
  | 'trip-day'
  | 'ride-stage'
  | 'route-point'
  | 'climb'
  | 'practical-place'
  | 'accommodation'

/**
 * A single manual correction layered on top of enriched/generated data.
 * Per CDC section 4.4, a manual override always takes precedence over an
 * automatic regeneration of the same field — the validator does not enforce
 * that precedence rule itself (it belongs to whatever applies overrides at
 * read time, out of scope for phase 2); this type only records the fact of
 * the correction.
 */
export interface TripOverride {
  readonly id: OverrideId
  readonly targetType: OverrideTargetType
  readonly targetId: string
  readonly field: string
  readonly value: unknown
  readonly reason: string | null
  readonly createdAt: IsoDateTime
}
