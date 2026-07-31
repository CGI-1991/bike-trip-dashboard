import type { IanaTimezone, IsoDate, IsoDateTime } from './common.ts'
import type { TripId } from './ids.ts'
import type { TripBundleSchemaVersion } from '../schema/version.ts'

/** Generic lifecycle status. No RGA-specific or itinerary-specific status. */
export type TripStatus = 'draft' | 'ready' | 'archived'

/**
 * Display unit preference only. Storage stays km/m/s/km-h everywhere in the
 * model (see `common.ts`); a UI honoring `imperial` converts at render time.
 */
export type TripUnitsPreference = 'metric' | 'imperial'

export interface TripMetadata {
  readonly id: TripId
  readonly slug: string
  readonly name: string
  readonly description: string | null
  readonly createdAt: IsoDateTime
  readonly updatedAt: IsoDateTime
  readonly startDate: IsoDate | null
  readonly endDate: IsoDate | null
  readonly timezone: IanaTimezone | null
  readonly language: string
  readonly units: TripUnitsPreference
  readonly status: TripStatus
  /**
   * Kept in sync with the bundle root `schemaVersion` — a single source of
   * truth duplicated here only because `TripMetadata` is a natural place to
   * look it up without the whole bundle in scope. `validateTripBundle`
   * rejects any bundle where the two disagree.
   */
  readonly schemaVersion: TripBundleSchemaVersion
  readonly engineVersion: string
}
