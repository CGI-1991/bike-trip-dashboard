import type { IsoDateTime } from './common.ts'
import type { RideStageId, TripDayId } from './ids.ts'
import type { DataSourceType } from './provenance.ts'

/**
 * Mirrors `route-enrichment/enrichment-jobs.ts`'s own types. Declared here
 * rather than imported so the core model keeps no dependency on the
 * enrichment layer — the same direction every other field in `TripBundle`
 * points.
 */
export type EnrichmentJobPhase = 'structural' | 'practical'
export type EnrichmentJobStatus = 'pending' | 'success' | 'empty' | 'waiting-for-network'

export interface EnrichmentJob {
  readonly kind: EnrichmentJobPhase
  readonly startKm: number
  readonly endKm: number
  readonly status: EnrichmentJobStatus
  readonly attempts: number
}

export interface StageEnrichmentJobs {
  readonly stageId: RideStageId
  readonly routeFingerprint: string
  readonly jobs: readonly EnrichmentJob[]
}

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
  | 'osm-route-enrichment'
  | 'postpass-route-enrichment'
  /** C2 (CDC C2 section 14) — the Postpass practical-places engine; `osm-practical-places` above stays only for a bundle enriched under the retired chunked Overpass engine, read-compatibility only. */
  | 'postpass-practical-places'

/** Last known state of one external enrichment provider for this trip. */
export interface EnrichmentProviderState {
  readonly provider: EnrichmentProvider
  readonly lastAttemptedAt: IsoDateTime | null
  readonly lastSuccessAt: IsoDateTime | null
  readonly status: EnrichmentProviderStatus
  readonly message: string | null
  /**
   * LEGACY, read-only. The previous model's completion record: the
   * `routeFingerprint` of every stage this provider had ATTEMPTED — errors
   * included, which is why it could not be trusted to mean "finished".
   *
   * Nothing writes it any more. It is still read once, by
   * `settled-stages.ts`, to decide whether a trip saved under that model can
   * be migrated straight to complete or has to be re-checked. Completion
   * itself now lives in `TripEnrichmentMetadata.enrichmentJobs`.
   */
  readonly settledFingerprints?: readonly string[]
}

/** Bundle-level view of external enrichment (OSM, Open-Meteo, ...) freshness. */
export interface TripEnrichmentMetadata {
  readonly providers: readonly EnrichmentProviderState[]
  /**
   * The ride days whose POI phase is not finished, as of the last pass.
   *
   * A convenience index over `enrichmentJobs` for the surfaces that only need
   * "is this day's POI work done?" without walking every micro-job. Absent
   * (never an empty array) means no day has outstanding POI work, so an
   * already-complete bundle — every golden fixture included — never gains
   * this key at all.
   */
  readonly practicalPlacesStageErrors?: readonly TripDayId[]
  /**
   * What enrichment work has actually been COMPLETED, one micro-segment at a
   * time (`route-enrichment/enrichment-jobs.ts`).
   *
   * This is the record the whole pipeline's completion logic reads. It
   * replaces `EnrichmentProviderState.settledFingerprints`, which recorded
   * completion per stage and could therefore not tell "this stage finished"
   * apart from "this stage was attempted and half of it timed out" — the
   * cause of stages that stayed enriched over their first stretch only.
   *
   * Optional and additive: a bundle without it is migrated on first read
   * (`settled-stages.ts`), so no existing trip has to be recreated.
   */
  readonly enrichmentJobs?: readonly StageEnrichmentJobs[]
}

/** Freshness of the locally derived data (distances, D+/D-, ETA, climbs...). */
export type DerivedDataStatus = 'not-generated' | 'stale' | 'partial' | 'fresh'

/** Bundle-level view of local computation freshness. */
export interface TripGeneratedMetadata {
  readonly engineVersion: string
  readonly generatedAt: IsoDateTime | null
  readonly derivedDataStatus: DerivedDataStatus
}
