import { enrichStoredTripEndpoints, tripNeedsEndpointGeocoding } from '../geocoding/endpoint-enrichment.ts'
import type { GeocodingProvider } from '../geocoding/types.ts'
import { enrichStoredTripPracticalPlaces, tripNeedsPracticalPlacesEnrichment } from '../practical-places/enrichment.ts'
import type { PracticalPlacesProgress } from '../practical-places/enrichment.ts'
import type { PracticalPlacesProvider } from '../practical-places/types.ts'
import { createTripRepository } from '../storage/indexeddb/trip-repository.ts'
import type { TripBundle, TripId } from '../trip-core/index.ts'
import { ensureAutomaticPausePlans, tripNeedsAutomaticPausePlans } from './automatic-pause-plan.ts'
import { enrichStoredTripRoute, tripNeedsRouteEnrichment } from './enrichment.ts'
import { isStructuralGloballyComplete } from './enrichment-jobs.ts'
import { migrateEnrichmentJobs } from './settled-stages.ts'
import type { RouteEnrichmentProgress, RouteEnrichmentProvider } from './types.ts'

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
    || (providers.practicalPlacesProvider !== undefined && tripNeedsPracticalPlacesEnrichment(migrated))
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

  if (active() && input.routeEnrichmentProvider !== undefined && tripNeedsRouteEnrichment(bundle)) {
    routeAttempted = true
    await enrichStoredTripRoute({
      database: input.database,
      tripId: input.tripId,
      provider: input.routeEnrichmentProvider,
      idFactory: input.idFactory,
      now: input.now,
      onProgress: (detail) => input.onProgress?.({ phase: 'route', detail }),
      ...(input.shouldContinue === undefined ? {} : { shouldContinue: input.shouldContinue }),
    })
    bundle = await repository.loadTripBundle(input.tripId)
    if (bundle === null) return { bundle: null, endpointAttempted, routeAttempted, practicalPlacesAttempted, partial: true }
  }

  // The hard gate between the two Postpass phases. POI are searched around
  // the real places the structural phase found, so no stage may start its
  // POI work until EVERY ride stage knows all of its places. Checked here as
  // well as inside `enrichStoredTripPracticalPlaces` so the ordering is
  // visible at the orchestration level, not only enforced deep inside.
  //
  // Only meaningful when a structural provider exists: with none configured,
  // structural completion is unreachable by construction and gating on it
  // would block POI forever rather than ordering them.
  if (input.routeEnrichmentProvider !== undefined && !isStructuralGloballyComplete(migrateEnrichmentJobs(bundle))) {
    return { bundle, endpointAttempted, routeAttempted, practicalPlacesAttempted, partial: true }
  }

  if (active() && input.practicalPlacesProvider !== undefined && tripNeedsPracticalPlacesEnrichment(bundle)) {
    practicalPlacesAttempted = true
    await enrichStoredTripPracticalPlaces({
      database: input.database,
      tripId: input.tripId,
      provider: input.practicalPlacesProvider,
      now: input.now,
      onProgress: (detail) => input.onProgress?.({ phase: 'practical-places', detail }),
      ...(input.shouldContinue === undefined ? {} : { shouldContinue: input.shouldContinue }),
    })
    bundle = await repository.loadTripBundle(input.tripId)
  }

  // Integrity-hardening — CDC's own "PHASE 5 — Pauses de Ei" step: once a
  // stage's structural+POI work is genuinely complete (whether it just
  // finished above, or was already complete before this feature existed —
  // see `tripNeedsAutomaticEnrichment`'s own extra OR-clause), its automatic
  // pause plan is computed and persisted here, exactly once. Pure and local
  // — no network, no provider, so it runs regardless of `shouldContinue`
  // (nothing here could be a long-running operation worth cancelling) and
  // regardless of which providers this deployment even configures.
  if (bundle !== null) {
    const withPausePlans = ensureAutomaticPausePlans(bundle, input.idFactory)
    if (withPausePlans !== bundle) {
      await repository.saveTripBundle(withPausePlans)
      bundle = withPausePlans
    }
  }

  const partial = bundle?.enrichmentMetadata.providers.some((state) =>
    (state.provider === 'osm' || state.provider === 'postpass-route-enrichment' || state.provider === 'postpass-practical-places')
    && (state.status === 'partial' || state.status === 'error')) ?? false
  return { bundle, endpointAttempted, routeAttempted, practicalPlacesAttempted, partial }
}
