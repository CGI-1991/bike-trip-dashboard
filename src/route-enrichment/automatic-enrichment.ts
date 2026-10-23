import { enrichStoredTripEndpoints, tripNeedsEndpointGeocoding } from '../geocoding/endpoint-enrichment.ts'
import type { GeocodingProvider } from '../geocoding/types.ts'
import { enrichStoredTripPracticalPlaces, tripNeedsPracticalPlacesEnrichment } from '../practical-places/enrichment.ts'
import type { PracticalPlacesProgress } from '../practical-places/enrichment.ts'
import type { PracticalPlacesProvider } from '../practical-places/types.ts'
import { createTripRepository } from '../storage/indexeddb/trip-repository.ts'
import type { TripBundle, TripId } from '../trip-core/index.ts'
import { selectAutomaticPoiSearch } from '../trip-core/index.ts'
import { ensureAutomaticPausePlans, tripNeedsAutomaticPausePlans } from './automatic-pause-plan.ts'
import { enrichStoredTripRoute, tripNeedsRouteEnrichment } from './enrichment.ts'
import { enrichableStageIds, isStagePhaseComplete } from './enrichment-jobs.ts'
import { migrateEnrichmentJobs } from './settled-stages.ts'
import type { RouteEnrichmentProgress, RouteEnrichmentProvider } from './types.ts'
import { EnrichmentStorageError } from './enrichment-failure.ts'

export type AutomaticEnrichmentProgress =
  | { readonly phase: 'endpoints' }
  | { readonly phase: 'route'; readonly detail: RouteEnrichmentProgress }
  | { readonly phase: 'practical-places'; readonly detail: PracticalPlacesProgress }

export interface AutomaticEnrichmentInput {
  readonly database: IDBDatabase
  readonly tripId: TripId
  readonly geocodingProvider?: GeocodingProvider
  readonly routeEnrichmentProvider?: RouteEnrichmentProvider
  /**
   * C2's automatic runtime source (CDC C2 section 2) — Postpass practical
   * POI, run once per trip open exactly like the other two providers, well
   * before the Étape screen's own fullscreen map/Calques panel could ever
   * need the data (CDC section 15: by the time a stage's fullscreen map
   * opens, its practical places are already persisted — opening it never
   * itself triggers a search, tests AR/AS).
   */
  readonly practicalPlacesProvider?: PracticalPlacesProvider
  readonly idFactory: () => string
  readonly now: () => string
  readonly onProgress?: (progress: AutomaticEnrichmentProgress) => void
  /**
   * DER-DES-DER sections 38-39 — cooperative cancellation. Exactly ONE trip
   * may have an active enrichment orchestration at a time: opening trip B
   * makes this return `false` for trip A, which then stops cleanly at its
   * next stage/phase boundary.
   *
   * Cooperative rather than an `AbortController` on purpose: every phase
   * already persists what it has finished (the practical-places pass saves
   * stage by stage), so stopping between units keeps everything acquired,
   * needs no rollback, and leaves the trip in a state a later reopen simply
   * resumes from (section 40). Omitted = never cancelled.
   */
  readonly shouldContinue?: () => boolean
  readonly onUpdated?: (bundle: TripBundle, dayId: import('../trip-core/index.ts').TripDayId) => void | Promise<void>
}

export interface AutomaticEnrichmentReport {
  readonly bundle: TripBundle | null
  readonly endpointAttempted: boolean
  readonly routeAttempted: boolean
  readonly practicalPlacesAttempted: boolean
  readonly partial: boolean
}

export function tripNeedsAutomaticEnrichment(
  bundle: TripBundle,
  providers: Pick<AutomaticEnrichmentInput, 'geocodingProvider' | 'routeEnrichmentProvider' | 'practicalPlacesProvider'>,
): boolean {
  const migrated = migrateEnrichmentJobs(bundle)
  return (providers.geocodingProvider !== undefined && tripNeedsEndpointGeocoding(migrated))
    || (providers.routeEnrichmentProvider !== undefined && tripNeedsRouteEnrichment(migrated))
    || (selectAutomaticPoiSearch(bundle) && providers.practicalPlacesProvider !== undefined && tripNeedsPracticalPlacesEnrichment(migrated))
    // Integrity-hardening: a trip whose structural/practical work was
    // ALREADY complete before this feature existed would otherwise never
    // run this orchestration again at all, so its automatic pause plans
    // would stay unpersisted forever — this makes such a trip's next open
    // backfill them, exactly once, with no network call of its own.
    || ((providers.routeEnrichmentProvider !== undefined || providers.practicalPlacesProvider !== undefined) && tripNeedsAutomaticPausePlans(migrated))
}

export async function runStoredTripAutomaticEnrichment(input: AutomaticEnrichmentInput): Promise<AutomaticEnrichmentReport> {
  const repository = createTripRepository(input.database)
  let bundle = await repository.loadTripBundle(input.tripId)
  if (bundle === null) return { bundle: null, endpointAttempted: false, routeAttempted: false, practicalPlacesAttempted: false, partial: false }
  let endpointAttempted = false
  let routeAttempted = false
  let practicalPlacesAttempted = false
  const active = () => input.shouldContinue?.() ?? true

  if (active() && input.geocodingProvider !== undefined && tripNeedsEndpointGeocoding(bundle)) {
    endpointAttempted = true
    input.onProgress?.({ phase: 'endpoints' })
    await enrichStoredTripEndpoints({
      database: input.database,
      tripId: input.tripId,
      provider: input.geocodingProvider,
      idFactory: input.idFactory,
      now: input.now,
    })
    bundle = await repository.loadTripBundle(input.tripId)
    if (bundle === null) return { bundle: null, endpointAttempted, routeAttempted, practicalPlacesAttempted, partial: true }
  }

  // Work stage by stage: an unfinished remote stage never delays the POI
  // already searchable on the stage the traveller is preparing.
  const enrichable = new Set(enrichableStageIds(bundle))
  for (const stage of bundle.stages) {
    if (!enrichable.has(stage.id)) continue
    if (!active()) break
    let current = migrateEnrichmentJobs(bundle)
    if (input.routeEnrichmentProvider !== undefined && !isStagePhaseComplete(current, stage.id, 'structural')) {
      routeAttempted = true
      await enrichStoredTripRoute({ database: input.database, tripId: input.tripId,
        provider: input.routeEnrichmentProvider, idFactory: input.idFactory, now: input.now,
        onlyDayId: stage.dayId, shouldContinue: input.shouldContinue, onUpdated: input.onUpdated,
        onProgress: detail => input.onProgress?.({ phase: 'route', detail }) })
      bundle = await repository.loadTripBundle(input.tripId)
      if (bundle === null) return { bundle: null, endpointAttempted, routeAttempted, practicalPlacesAttempted, partial: true }
      current = migrateEnrichmentJobs(bundle)
    }
    const structureReady = input.routeEnrichmentProvider === undefined || isStagePhaseComplete(current, stage.id, 'structural')
    if (active() && structureReady && selectAutomaticPoiSearch(current) && input.practicalPlacesProvider !== undefined && !isStagePhaseComplete(current, stage.id, 'practical')) {
      practicalPlacesAttempted = true
      const practicalReport = await enrichStoredTripPracticalPlaces({ database: input.database, tripId: input.tripId,
        provider: input.practicalPlacesProvider, now: input.now, onlyDayId: stage.dayId,
        shouldContinue: input.shouldContinue, onUpdated: input.onUpdated,
        onProgress: detail => input.onProgress?.({ phase: 'practical-places', detail }) })
      if ((practicalReport?.storageErrorCount ?? 0) > 0) throw new EnrichmentStorageError(new Error('Écriture du cache impossible.'))
      bundle = await repository.loadTripBundle(input.tripId)
      if (bundle === null) return { bundle: null, endpointAttempted, routeAttempted, practicalPlacesAttempted, partial: true }
    }
    let plansChanged = false
    const withPlans = await repository.updateTripBundle(input.tripId, latest => {
      const updated = ensureAutomaticPausePlans(latest, input.idFactory)
      plansChanged = updated !== latest
      return updated
    })
    if (withPlans === null) return { bundle: null, endpointAttempted, routeAttempted, practicalPlacesAttempted, partial: true }
    bundle = withPlans
    if (plansChanged) await input.onUpdated?.(withPlans, stage.dayId)
  }

  const partial = bundle?.enrichmentMetadata.providers.some((state) =>
    (state.provider === 'osm' || state.provider === 'postpass-route-enrichment' || state.provider === 'postpass-practical-places')
    && (state.status === 'partial' || state.status === 'error')) ?? false
  return { bundle, endpointAttempted, routeAttempted, practicalPlacesAttempted, partial }
}
