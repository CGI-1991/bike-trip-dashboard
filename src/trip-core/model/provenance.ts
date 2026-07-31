import type { ConfidenceLevel, IsoDateTime } from './common.ts'

/** Where a piece of data came from, per CDC section 4.4 / 8.5. */
export type DataSourceType =
  | 'user'
  | 'gpx'
  | 'osm'
  | 'open-meteo'
  | 'generated'
  | 'migrated'

/**
 * Provenance envelope carried by every enriched or generated entity.
 *
 * Null/undefined convention for this model (applied consistently everywhere
 * in TripBundle v1, not just here): every field the business contract
 * considers optional is declared with an explicit `| null` type and always
 * present on the object — never an omitted property, never `undefined`.
 */
export interface DataProvenance {
  readonly sourceType: DataSourceType
  readonly sourceId: string | null
  readonly fetchedAt: IsoDateTime | null
  readonly engineVersion: string
  readonly confidence: ConfidenceLevel | null
  readonly manuallyOverridden: boolean
}
