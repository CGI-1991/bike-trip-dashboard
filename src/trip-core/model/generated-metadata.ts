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
   * DER-DES-DER sections 31-33 — the `routeFingerprint` of every stage this
   * provider has already SETTLED (attempted to completion at least once,
   * whether it succeeded, found nothing, or failed). This is the explicit
   * "already done" record section 32 asks for, replacing the old inference
   * from `status !== 'success'`: a stage that timed out is settled too, so
   * merely reopening the trip never silently re-runs it (section 50: no
   * automatic retry — only the explicit "Réessayer", or the manual
   * "Recalculer les données du parcours", ever runs it again).
   *
   * Keyed by route fingerprint rather than stage id so section 33's real
   * invalidation causes are structural by construction: replacing the GPX
   * (or otherwise changing the route geometry) changes the fingerprint, and
   * that stage — only that stage — becomes pending again. Purely additive
   * and optional: `undefined` means "no explicit record yet" and falls back
   * to the historical status-based gate, so an existing bundle self-heals on
   * its next pass and no already-complete fixture gains the key at all.
   */
  readonly settledFingerprints?: readonly string[]
}

/** Bundle-level view of external enrichment (OSM, Open-Meteo, ...) freshness. */
export interface TripEnrichmentMetadata {
  readonly providers: readonly EnrichmentProviderState[]
  /**
   * RC2 final-closeout section 18 — the ride days whose practical-places
   * (POI) lookup specifically errored/timed out on the last progressive
   * per-stage pass (`practical-places/enrichment.ts`), still pending a
   * targeted retry. Purely additive and optional: absent (or empty) means
   * "no known per-stage POI issue", so an already-fully-enriched bundle
   * (including every existing golden/canonical fixture) never gains this
   * key at all. This is what lets `deriveStagePreparationStatus` show
   * "À compléter / Réessayer" on exactly the stage(s) that actually need
   * it, instead of the whole trip's aggregate `postpass-practical-places`
   * provider status (a single value for the entire trip) flagging every
   * ride day as `partial` while only one stage genuinely failed.
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
