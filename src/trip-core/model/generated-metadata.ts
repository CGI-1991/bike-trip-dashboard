import type { IsoDateTime } from './common.ts'
import type { DataSourceType } from './provenance.ts'

/**
 * Adaptation note: the recommended file list has a single
 * `generated-metadata.ts`, but the root `TripBundle` structure (CDC section
 * 8) needs two distinct concepts — enrichment (external providers) and
 * derived data (local computations), per the sources/enrichments/derived
 * split in section 4.3. Both live here rather than splitting into a second
 * file, since they are small and always read together.
 */

export type EnrichmentProviderStatus =
  | 'not-configured'
  | 'pending'
  | 'success'
  | 'partial'
  | 'error'

export type EnrichmentProvider =
  | Exclude<DataSourceType, 'user' | 'generated' | 'migrated'>
  | 'osm-practical-places'

/** Last known state of one external enrichment provider for this trip. */
export interface EnrichmentProviderState {
  readonly provider: EnrichmentProvider
  readonly lastAttemptedAt: IsoDateTime | null
  readonly lastSuccessAt: IsoDateTime | null
  readonly status: EnrichmentProviderStatus
  readonly message: string | null
}

/** Bundle-level view of external enrichment (OSM, Open-Meteo, ...) freshness. */
export interface TripEnrichmentMetadata {
  readonly providers: readonly EnrichmentProviderState[]
}

/** Freshness of the locally derived data (distances, D+/D-, ETA, climbs...). */
export type DerivedDataStatus = 'not-generated' | 'stale' | 'partial' | 'fresh'

/** Bundle-level view of local computation freshness. */
export interface TripGeneratedMetadata {
  readonly engineVersion: string
  readonly generatedAt: IsoDateTime | null
  readonly derivedDataStatus: DerivedDataStatus
}
