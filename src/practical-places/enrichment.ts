import { computeStagePracticalPlaceAnchors } from './anchors.ts'
import { cumulativeGeometryDistances } from '../route-enrichment/chunking.ts'
import { routeFingerprint, routeGeometry } from '../route-enrichment/route-fingerprint.ts'
import { buildRouteSegments, MAX_POSTPASS_SEGMENT_KM } from '../route-enrichment/segmentation.ts'
import type { RouteSegment } from '../route-enrichment/segmentation.ts'
import { providerHasPendingStages, stageFingerprint, withSettledFingerprints } from '../route-enrichment/settled-stages.ts'
import { PRACTICAL_PLACES_ANCHOR_RADIUS_METERS, PRACTICAL_PLACES_CORRIDOR_RADIUS_METERS } from './postpass-provider.ts'
import { createPracticalPlacesCacheRepository } from '../storage/indexeddb/practical-places-cache-repository.ts'
import type { PracticalPlacesCacheRepository } from '../storage/indexeddb/practical-places-cache-repository.ts'
import { createTripRepository } from '../storage/indexeddb/trip-repository.ts'
import type { EnrichmentProviderState, PracticalPlace, RideStage, Route, RouteGeometryPoint, TripBundle, TripDay, TripDayId, TripId } from '../trip-core/index.ts'
import { practicalPlaceId } from '../trip-core/index.ts'
import { locateAndDeduplicatePostpassPracticalPlaces } from './route-proximity.ts'
import type { LocatedPracticalPlaceCandidate } from './route-proximity.ts'
import type { PracticalPlaceAnchor, PracticalPlaceCandidate, PracticalPlacesProvider } from './types.ts'

/**
 * C2 (CDC section 14): Postpass replaces the chunked Overpass engine —
 * bumped so a bundle enriched under `practical-places-osm@2` (chunk-cached,
 * single-corridor, includes categories C2 no longer surfaces — fast-food,
 * sports) is never mistaken for already-current. `isAutomaticPracticalPlace`
 * only ever recognises `practical-places-` prefixed engine versions as
 * "safe to replace wholesale on a fresh success" — an old `@2` entry simply
 * stops being recognised as current and is naturally superseded the next
 * time its stage is (re-)enriched, never migrated in place.
 */
export const PRACTICAL_PLACES_ENGINE_VERSION = 'practical-places-postpass@1'
export const PRACTICAL_PLACES_PROVIDER_STATE = 'postpass-practical-places'

type LookupStatus = 'success' | 'no-result' | 'error'

interface StageLookup {
  readonly stage: RideStage
  readonly day: TripDay
  readonly route: Route
  readonly geometry: readonly RouteGeometryPoint[]
  readonly anchors: readonly PracticalPlaceAnchor[]
  readonly candidates: readonly PracticalPlaceCandidate[]
  readonly status: LookupStatus
  readonly fromCache: boolean
}

export interface PracticalPlacesProgress {
  readonly stageIndex: number
  readonly stageCount: number
  readonly fromCache: boolean
  readonly status: 'cache' | 'success' | 'error'
  readonly errorCount: number
}

export interface PracticalPlacesEnrichmentReport {
  readonly bundle: TripBundle
  readonly saved: boolean
  readonly stageCount: number
  readonly requestCount: number
  readonly placeCount: number
  readonly cacheHitCount: number
  readonly networkErrorCount: number
}

export interface EnrichTripPracticalPlacesInput {
  readonly bundle: TripBundle
  readonly provider: PracticalPlacesProvider
  readonly cache: PracticalPlacesCacheRepository
  readonly now: () => string
  readonly onProgress?: (progress: PracticalPlacesProgress) => void
  /**
   * DER-DES-DER sections 42/46/49 — maximum route length covered by one
   * corridor query. Defaults to `MAX_POSTPASS_SEGMENT_KM` (60 km); the manual
   * "Réessayer" passes the smaller `RETRY_POSTPASS_SEGMENT_KM` (30 km).
   */
  readonly segmentLengthKm?: number
  /**
   * DER-DES-DER sections 38-40 — checked before each stage's own lookup.
   * `false` stops the pass cleanly: every stage already persisted stays
   * persisted (no rollback), and the stages never reached stay unsettled, so
   * a later reopen resumes at exactly the right place.
   */
  readonly shouldContinue?: () => boolean
}

export interface EnrichStoredTripPracticalPlacesInput extends Omit<EnrichTripPracticalPlacesInput, 'bundle' | 'cache'> {
  readonly database: IDBDatabase
  readonly tripId: TripId
  /**
   * RC2 final-closeout section 14 — when set, only this one ride day's stage
   * is (re-)processed (a targeted "Réessayer"/pause-anchor-change retry),
   * instead of every currently-pending stage. Omitted for the ordinary
   * trip-open pass, which still covers every pending stage, one at a time,
   * in chronological order.
   */
  readonly onlyDayId?: TripDayId
}

/**
 * The stages still to look up, in strict chronological (`bundle.stages`)
 * order — never reordered by "today"/priority (DER-DES-DER section 15).
 *
 * Section 40: a stage already settled under its current route fingerprint is
 * skipped outright, so reopening a partially-enriched trip resumes at the
 * first stage that genuinely still needs work instead of walking the whole
 * trip again. `includeSettled` re-admits them for the explicit retry paths
 * (`onlyDayId`) and for the pure in-memory batch API, whose callers decide
 * for themselves what to pass in.
 */
function pendingLookups(bundle: TripBundle, includeSettled = false): readonly Omit<StageLookup, 'candidates' | 'status' | 'fromCache'>[] {
  const routes = new Map(bundle.routes.map((route) => [route.id, route]))
  const days = new Map(bundle.days.map((day) => [day.id, day]))
  const settled = new Set(bundle.enrichmentMetadata.providers.find((state) => state.provider === PRACTICAL_PLACES_PROVIDER_STATE)?.settledFingerprints ?? [])
  return bundle.stages.flatMap((stage) => {
    const route = routes.get(stage.sourceRouteId)
    const day = days.get(stage.dayId)
    const geometry = route === undefined ? null : routeGeometry(route)
    if (route === undefined || day === undefined || geometry === null) return []
    if (!includeSettled && settled.has(stageFingerprint(bundle, route))) return []
    return [{ stage, day, route, geometry, anchors: computeStagePracticalPlaceAnchors(bundle, stage, route) }]
  })
}

/**
 * C2.5 section 28: anchors (départ/arrivée/pauses — `anchors.ts`) are
 * derived live from the CURRENT pause state every time a lookup is built,
 * but until now never entered the cache key at all — `routeFingerprint`
 * alone (GPX/geometry) decided it. Moving a pause to a different waypoint
 * silently kept serving the stale candidate set forever, with no cache-miss
 * to ever refresh it. Folding a stable fingerprint of the anchor set into
 * `chunkKey` (an existing, optional slot on `RouteEnrichmentCacheIdentity` —
 * no schema/type change) makes a genuine anchor change a real cache-miss for
 * THIS stage only; every other stage's anchors (and cache key) are
 * unaffected. Order-independent (a stable sort) since anchors describe a
 * SET of positions, not a sequence.
 */
function anchorsFingerprint(anchors: readonly PracticalPlaceAnchor[]): string {
  return anchors
    .map((anchor) => `${anchor.latitude.toFixed(5)},${anchor.longitude.toFixed(5)}`)
    .sort()
    .join(';')
}

/**
 * One Postpass request per stage (CDC C2 section 11 — never one per anchor,
 * never per-chunk like the retired Overpass engine): a cache hit skips the
 * network entirely; a network failure returns `status: 'error'` so
 * `applyLookups` below preserves whatever this stage already had.
 */
async function resolveLookup(
  bundle: TripBundle,
  lookup: ReturnType<typeof pendingLookups>[number],
  provider: PracticalPlacesProvider,
  cache: PracticalPlacesCacheRepository,
  attemptedAt: string,
  stageIndex: number,
  stageCount: number,
  segmentLengthKm: number,
  onProgress?: (progress: PracticalPlacesProgress) => void,
): Promise<StageLookup> {
  const fingerprint = routeFingerprint(bundle, lookup.route)
  const anchorsKey = anchorsFingerprint(lookup.anchors)
  // DER-DES-DER section 46: the corridor search is split the same way the
  // structural one is, and for the same reason — a 200 km corridor is a
  // single huge query that reliably times out. Anchors are partitioned onto
  // the segment that actually contains them, so each query stays local.
  const segments = buildRouteSegments(lookup.geometry, segmentLengthKm)
  const distances = cumulativeGeometryDistances(lookup.geometry)

  const collected: PracticalPlaceCandidate[] = []
  let anySucceeded = false
  let anyFailed = false
  let allFromCache = true

  for (const segment of segments) {
    const identity = {
      providerId: provider.id,
      routeFingerprint: fingerprint,
      enrichmentType: 'practical-places',
      // Single-segment stages keep their historical cache key byte-for-byte,
      // so no existing cached stage is invalidated by segmentation landing.
      chunkKey: segments.length === 1 ? `anchors:${anchorsKey}` : `anchors:${anchorsKey}|${segment.key}`,
      engineVersion: PRACTICAL_PLACES_ENGINE_VERSION,
    }
    const cached = await cache.get(identity).catch(() => null)
    if (cached !== null) {
      collected.push(...cached.results)
      anySucceeded = true
      continue
    }
    allFromCache = false
    try {
      const result = await provider.findCandidates({
        stageId: lookup.stage.id,
        routeFingerprint: fingerprint,
        geometry: segment.geometry,
        routeLengthKm: segments.length === 1
          ? lookup.stage.distanceKm ?? lookup.route.segments[0]?.distanceKm ?? null
          : segment.endDistanceKm - segment.startDistanceKm,
        anchors: anchorsForSegment(lookup.anchors, lookup.geometry, distances, segment, segments.length),
        corridorRadiusMeters: PRACTICAL_PLACES_CORRIDOR_RADIUS_METERS,
        anchorRadiusMeters: PRACTICAL_PLACES_ANCHOR_RADIUS_METERS,
      })
      await cache.put(identity, result.candidates, attemptedAt)
      collected.push(...result.candidates)
      anySucceeded = true
    } catch {
      // Section 47: a failed segment never fails the stage — the ones that
      // succeeded are kept and cached, and this loop moves on.
      anyFailed = true
    }
  }

  if (!anySucceeded) {
    onProgress?.({ stageIndex, stageCount, fromCache: false, status: 'error', errorCount: 1 })
    return { ...lookup, candidates: [], status: 'error', fromCache: false }
  }
  // A stage with a failed segment stays `error` for status purposes (so it
  // keeps its "À compléter / Réessayer" affordance) but its acquired
  // candidates are still returned and merged — nothing collected is thrown
  // away.
  onProgress?.({
    stageIndex, stageCount, fromCache: allFromCache,
    status: anyFailed ? 'error' : allFromCache ? 'cache' : 'success',
    errorCount: anyFailed ? 1 : 0,
  })
  return {
    ...lookup,
    candidates: collected,
    status: anyFailed ? 'error' : collected.length === 0 ? 'no-result' : 'success',
    fromCache: allFromCache,
  }
}

/**
 * Section 46: an anchor-based search ("supermarché autour de ce village")
 * stays local by nature, so each anchor is sent with the ONE segment whose
 * distance range contains it — never repeated on every segment, which would
 * multiply the query cost by the segment count for no benefit. A single-
 * segment stage keeps the whole anchor list, exactly as before.
 */
function anchorsForSegment(
  anchors: readonly PracticalPlaceAnchor[],
  geometry: readonly RouteGeometryPoint[],
  distances: readonly number[],
  segment: RouteSegment,
  segmentCount: number,
): readonly PracticalPlaceAnchor[] {
  if (segmentCount === 1) return anchors
  return anchors.filter((anchor) => {
    const distanceKm = nearestGeometryDistanceKm(anchor, geometry, distances)
    return distanceKm >= segment.startDistanceKm && distanceKm <= segment.endDistanceKm
  })
}

function nearestGeometryDistanceKm(
  anchor: PracticalPlaceAnchor,
  geometry: readonly RouteGeometryPoint[],
  distances: readonly number[],
): number {
  let bestIndex = 0
  let bestSquared = Number.POSITIVE_INFINITY
  for (let index = 0; index < geometry.length; index++) {
    const point = geometry[index]
    if (point === undefined) continue
    const squared = (point.latitude - anchor.latitude) ** 2 + (point.longitude - anchor.longitude) ** 2
    if (squared < bestSquared) {
      bestSquared = squared
      bestIndex = index
    }
  }
  return distances[bestIndex] ?? 0
}

function isAutomaticPracticalPlace(place: PracticalPlace): boolean {
  return place.provenance.sourceType === 'osm' && place.provenance.engineVersion.startsWith('practical-places-')
}

function toPracticalPlace(candidate: LocatedPracticalPlaceCandidate, lookup: StageLookup, provider: PracticalPlacesProvider, attemptedAt: string): PracticalPlace {
  const detourMeters = candidate.anchorDistanceMeters ?? candidate.lateralDistanceMeters
  return {
    id: practicalPlaceId(`postpass-practical:${lookup.stage.id}:${candidate.osmType}:${candidate.osmId}`),
    stageId: lookup.stage.id,
    category: candidate.category,
    name: candidate.name,
    latitude: candidate.latitude,
    longitude: candidate.longitude,
    description: null,
    trackDistanceKm: candidate.trackDistanceKm,
    detourKm: detourMeters / 1_000,
    openingHours: candidate.usefulTags.opening_hours ?? null,
    usefulTags: candidate.usefulTags,
    hidden: false,
    pinned: false,
    dayIds: [lookup.day.id],
    provenance: {
      sourceType: provider.sourceType,
      sourceId: `${provider.id}:${candidate.osmType}:${candidate.osmId}`,
      fetchedAt: attemptedAt,
      engineVersion: PRACTICAL_PLACES_ENGINE_VERSION,
      confidence: 'high',
      manuallyOverridden: false,
    },
  }
}

function providerState(lookups: readonly StageLookup[], attemptedAt: string, existing: EnrichmentProviderState | undefined): EnrichmentProviderState {
  const errors = lookups.filter((lookup) => lookup.status === 'error').length
  const successes = lookups.filter((lookup) => lookup.status !== 'error').length
  return {
    provider: PRACTICAL_PLACES_PROVIDER_STATE,
    lastAttemptedAt: attemptedAt,
    lastSuccessAt: successes > 0 ? attemptedAt : existing?.lastSuccessAt ?? null,
    status: errors === 0 ? 'success' : successes > 0 ? 'partial' : 'error',
    message: errors === 0 ? null : `${errors} étape(s) restent à rechercher ; les lieux acquis sont conservés.`,
    // DER-DES-DER sections 31-33: the settled record is bookkeeping that
    // outlives any single pass — recomputing the aggregate must never drop it.
    ...(existing?.settledFingerprints === undefined ? {} : { settledFingerprints: existing.settledFingerprints }),
  }
}

/**
 * DER-DES-DER sections 31/40 — marks one stage settled for this provider the
 * moment its own lookup has been applied and persisted, WITHOUT touching the
 * provider's `status` (that aggregate is only ever finalized once a full pass
 * has completed — see `finalizeAggregate*` below).
 *
 * This is what makes the pipeline genuinely resumable: a pass interrupted
 * after E1 leaves E1 settled, so the next trip open picks up at E2 instead of
 * re-querying everything (section 40), and a fully-settled trip queries
 * nothing at all on reopen (section 31).
 */
function withStageSettled(bundle: TripBundle, route: Route, attemptedAt: string): readonly EnrichmentProviderState[] {
  const existing = bundle.enrichmentMetadata.providers.find((state) => state.provider === PRACTICAL_PLACES_PROVIDER_STATE)
  const base: EnrichmentProviderState = existing ?? {
    provider: PRACTICAL_PLACES_PROVIDER_STATE,
    lastAttemptedAt: attemptedAt,
    lastSuccessAt: null,
    status: 'pending',
    message: null,
  }
  const updated = withSettledFingerprints(bundle, base, [stageFingerprint(bundle, route)])
  return [...bundle.enrichmentMetadata.providers.filter((state) => state.provider !== PRACTICAL_PLACES_PROVIDER_STATE), updated]
}

/**
 * RC2 final-closeout section 18 — merges this pass's per-stage outcomes into
 * the persisted `practicalPlacesStageErrors` list: a stage that errored is
 * added, a stage that settled (success or no-result) is removed; every
 * other stage's existing entry (untouched by this pass — e.g. a targeted
 * single-stage retry) is left exactly as it was. Order doesn't matter (it's
 * only ever tested with `.includes`) but stays stable/deduplicated.
 */
function mergeStageErrors(existing: readonly TripDayId[] | undefined, lookups: readonly StageLookup[]): readonly TripDayId[] {
  const next = new Set(existing ?? [])
  for (const lookup of lookups) {
    if (lookup.status === 'error') next.add(lookup.day.id)
    else next.delete(lookup.day.id)
  }
  return [...next]
}

function applyPracticalPlacesForLookups(bundle: TripBundle, lookups: readonly StageLookup[], geometryByStageId: Map<string, readonly RouteGeometryPoint[]>, anchorsByStageId: Map<string, readonly PracticalPlaceAnchor[]>, provider: PracticalPlacesProvider, attemptedAt: string): readonly PracticalPlace[] {
  let practicalPlaces = [...bundle.practicalPlaces]
  for (const lookup of lookups) {
    if (lookup.status === 'error') continue
    const geometry = geometryByStageId.get(lookup.stage.id) ?? []
    const anchors = anchorsByStageId.get(lookup.stage.id) ?? []
    const generated = locateAndDeduplicatePostpassPracticalPlaces(lookup.candidates, geometry, anchors, {
      corridorMaximumLateralDistanceMeters: PRACTICAL_PLACES_CORRIDOR_RADIUS_METERS,
      anchorMaximumDistanceMeters: PRACTICAL_PLACES_ANCHOR_RADIUS_METERS,
    }).map((candidate) => toPracticalPlace(candidate, lookup, provider, attemptedAt))
    practicalPlaces = practicalPlaces.filter((place) => !isAutomaticPracticalPlace(place) || place.stageId !== lookup.stage.id)
    const byId = new Map(practicalPlaces.map((place) => [place.id, place]))
    for (const place of generated) byId.set(place.id, place)
    practicalPlaces = [...byId.values()]
  }
  return practicalPlaces
}

/**
 * The pure, in-memory batch path (`enrichTripPracticalPlaces` below) always
 * covers every currently-pending stage in one call, so the trip-wide
 * aggregate can be (and always was) recomputed in the same step as the
 * per-stage data and the per-stage error list — unchanged behaviour/shape,
 * just now also stamping `practicalPlacesStageErrors`.
 */
function applyLookups(bundle: TripBundle, lookups: readonly StageLookup[], geometryByStageId: Map<string, readonly RouteGeometryPoint[]>, anchorsByStageId: Map<string, readonly PracticalPlaceAnchor[]>, provider: PracticalPlacesProvider, attemptedAt: string): TripBundle {
  const practicalPlaces = applyPracticalPlacesForLookups(bundle, lookups, geometryByStageId, anchorsByStageId, provider, attemptedAt)
  const stageErrors = mergeStageErrors(bundle.enrichmentMetadata.practicalPlacesStageErrors, lookups)
  const aggregate = withSettledFingerprints(
    bundle,
    providerState(lookups, attemptedAt, bundle.enrichmentMetadata.providers.find((state) => state.provider === PRACTICAL_PLACES_PROVIDER_STATE)),
    lookups.map((lookup) => stageFingerprint(bundle, lookup.route)),
  )
  return {
    ...bundle,
    metadata: { ...bundle.metadata, updatedAt: attemptedAt },
    practicalPlaces,
    enrichmentMetadata: {
      providers: [...bundle.enrichmentMetadata.providers.filter((state) => state.provider !== PRACTICAL_PLACES_PROVIDER_STATE), aggregate],
      ...(stageErrors.length === 0 ? {} : { practicalPlacesStageErrors: stageErrors }),
    },
  }
}

/**
 * RC2 final-closeout sections 11-13 — the progressive, per-stage-persisted
 * counterpart of `applyLookups`: applies exactly ONE stage's own result and
 * updates only its own entry in `practicalPlacesStageErrors`, WITHOUT
 * touching the trip-wide `postpass-practical-places` provider aggregate at
 * all (that aggregate is only ever safe to recompute once a full pass over
 * every currently-pending stage has actually happened — see
 * `finalizeAggregateFromLookups`/`finalizeAggregateFromStageErrors` below;
 * recomputing it from a single stage mid-pass could otherwise persist a
 * premature "success" while sibling stages further down the same pass
 * haven't been attempted yet at all).
 */
function applyStageLookup(bundle: TripBundle, lookup: StageLookup, geometry: readonly RouteGeometryPoint[], anchors: readonly PracticalPlaceAnchor[], provider: PracticalPlacesProvider, attemptedAt: string): TripBundle {
  const practicalPlaces = applyPracticalPlacesForLookups(bundle, [lookup], new Map([[lookup.stage.id, geometry]]), new Map([[lookup.stage.id, anchors]]), provider, attemptedAt)
  const stageErrors = mergeStageErrors(bundle.enrichmentMetadata.practicalPlacesStageErrors, [lookup])
  return {
    ...bundle,
    metadata: { ...bundle.metadata, updatedAt: attemptedAt },
    practicalPlaces,
    enrichmentMetadata: {
      providers: withStageSettled(bundle, lookup.route, attemptedAt),
      ...(stageErrors.length === 0 ? {} : { practicalPlacesStageErrors: stageErrors }),
    },
  }
}

/**
 * Finalizes the trip-wide aggregate at the very end of a pass, from the
 * PERSISTED per-stage error list rather than from the lookups this
 * particular call happened to perform.
 *
 * DER-DES-DER sections 31/40 collapsed two near-identical finalizers into
 * this one. `applyStageLookup` maintains `practicalPlacesStageErrors` stage
 * by stage as it goes, so by the last index of any pass — a first full pass,
 * a resumed pass covering only the stages that were still missing, or a
 * targeted single-stage retry — every enrichable stage is settled and that
 * list is the authoritative record of which ones are still incomplete.
 * Computing the aggregate from it is therefore correct in all three cases,
 * and can never report a premature "success" for a stage this pass never
 * touched.
 */
function finalizeAggregateFromStageErrors(bundle: TripBundle, allStageDayIds: readonly TripDayId[], attemptedAt: string): TripBundle {
  const pendingSet = new Set(allStageDayIds)
  const errors = (bundle.enrichmentMetadata.practicalPlacesStageErrors ?? []).filter((dayId) => pendingSet.has(dayId)).length
  const existing = bundle.enrichmentMetadata.providers.find((state) => state.provider === PRACTICAL_PLACES_PROVIDER_STATE)
  const successes = allStageDayIds.length - errors
  const aggregate: EnrichmentProviderState = {
    provider: PRACTICAL_PLACES_PROVIDER_STATE,
    lastAttemptedAt: attemptedAt,
    lastSuccessAt: successes > 0 ? attemptedAt : existing?.lastSuccessAt ?? null,
    status: errors === 0 ? 'success' : successes > 0 ? 'partial' : 'error',
    message: errors === 0 ? null : `${errors} étape(s) restent à rechercher ; les lieux acquis sont conservés.`,
    ...(existing?.settledFingerprints === undefined ? {} : { settledFingerprints: existing.settledFingerprints }),
  }
  return {
    ...bundle,
    metadata: { ...bundle.metadata, updatedAt: attemptedAt },
    enrichmentMetadata: {
      ...bundle.enrichmentMetadata,
      providers: [...bundle.enrichmentMetadata.providers.filter((state) => state.provider !== PRACTICAL_PLACES_PROVIDER_STATE), aggregate],
    },
  }
}

export function tripCanSearchPracticalPlaces(bundle: TripBundle): boolean {
  const routeById = new Map(bundle.routes.map((route) => [route.id, route]))
  return bundle.stages.some((stage) => {
    const route = routeById.get(stage.sourceRouteId)
    return route !== undefined && routeGeometry(route) !== null
  })
}

/**
 * CDC C2 section 15's "needed" gate — now answered from the explicit
 * per-stage settled record (DER-DES-DER sections 31-33) rather than from
 * `status !== 'success'`: a stage that timed out is settled, so reopening the
 * trip no longer re-queries it on every single open (only "Réessayer" or
 * "Recalculer" does), while a stage whose GPX changed becomes pending again
 * on its own. A mounted Étape screen still never triggers a search of its own.
 */
export function tripNeedsPracticalPlacesEnrichment(bundle: TripBundle): boolean {
  return providerHasPendingStages(bundle, PRACTICAL_PLACES_PROVIDER_STATE)
}

export async function enrichTripPracticalPlaces(input: EnrichTripPracticalPlacesInput): Promise<PracticalPlacesEnrichmentReport> {
  const attemptedAt = input.now()
  const lookups: StageLookup[] = []
  // The pure in-memory API's contract is unchanged: it processes every stage
  // of the bundle it is handed. Skipping already-settled stages (section 40's
  // resume) belongs to the stored/progressive path below, which is the one
  // the app's own trip-open orchestration actually uses.
  const pending = pendingLookups(input.bundle, true)
  const geometryByStageId = new Map(pending.map((lookup) => [lookup.stage.id, lookup.geometry]))
  const anchorsByStageId = new Map(pending.map((lookup) => [lookup.stage.id, lookup.anchors]))
  for (let index = 0; index < pending.length; index++) {
    const lookup = pending[index]
    if (lookup !== undefined) lookups.push(await resolveLookup(input.bundle, lookup, input.provider, input.cache, attemptedAt, index, pending.length, input.segmentLengthKm ?? MAX_POSTPASS_SEGMENT_KM, input.onProgress))
  }
  const bundle = applyLookups(input.bundle, lookups, geometryByStageId, anchorsByStageId, input.provider, attemptedAt)
  return {
    bundle,
    saved: false,
    stageCount: lookups.length,
    requestCount: lookups.filter((lookup) => !lookup.fromCache && lookup.status !== 'error').length + lookups.filter((lookup) => lookup.status === 'error').length,
    placeCount: bundle.practicalPlaces.filter(isAutomaticPracticalPlace).length,
    cacheHitCount: lookups.filter((lookup) => lookup.fromCache).length,
    networkErrorCount: lookups.filter((lookup) => lookup.status === 'error').length,
  }
}

/**
 * RC2 final-closeout sections 11-13/73 — the progressive, per-stage
 * persisted DB entry point: E1 → lookup → apply → SAVE → E2 → lookup →
 * apply → SAVE → ..., in the trip's own chronological stage order (never
 * "today's stage first" — CDC section 5), instead of resolving every stage
 * in memory and saving once at the very end. A stage that times out or
 * errors (`resolveLookup` already never lets a rejected fetch propagate)
 * keeps whatever it already had, is recorded in
 * `enrichmentMetadata.practicalPlacesStageErrors`, and the loop moves on to
 * the next stage unconditionally (section 13: one slow/failed stage never
 * blocks the rest). Each stage's save keeps the same optimistic-concurrency
 * guard the whole-batch path always had (never overwrite an edit that
 * landed while this stage's own request was in flight) — on a conflict this
 * stage's fresh result is simply dropped (not lost forever: it stays
 * eligible for a future pass) and the loop continues from the newer bundle.
 */
export async function enrichStoredTripPracticalPlaces(input: EnrichStoredTripPracticalPlacesInput): Promise<PracticalPlacesEnrichmentReport | null> {
  const repository = createTripRepository(input.database)
  const cache = createPracticalPlacesCacheRepository(input.database)
  const initial = await repository.loadTripBundle(input.tripId)
  if (initial === null) return null

  // A targeted retry deliberately re-runs a stage that IS already settled
  // (that is what "Réessayer" means); the ordinary pass skips settled stages
  // so it resumes where it left off (sections 31/40).
  const everyStage = pendingLookups(initial, true)
  const targets = input.onlyDayId === undefined
    ? pendingLookups(initial)
    : everyStage.filter((lookup) => lookup.day.id === input.onlyDayId)
  // The aggregate is always computed against EVERY enrichable stage, never
  // just the ones this particular pass happened to touch — otherwise a
  // resumed pass covering only E2/E3 would report "success" while E1's
  // earlier failure is still recorded.
  const allStageDayIds = everyStage.map((lookup) => lookup.day.id)

  let bundle = initial
  const lookups: StageLookup[] = []
  let anySaved = false

  for (let index = 0; index < targets.length; index++) {
    // Sections 38-39: another trip took over — stop here, keeping every
    // stage this pass already saved.
    if (!(input.shouldContinue?.() ?? true)) break
    const target = targets[index]
    if (target === undefined) continue
    // Reload right before this stage's own work: picks up whatever the
    // PREVIOUS stage in this same loop just saved, and any edit that landed
    // from elsewhere (a pause change, a manual override) since the loop
    // started.
    const base = await repository.loadTripBundle(input.tripId)
    if (base === null) break
    bundle = base
    const attemptedAt = input.now()
    const lookup = await resolveLookup(bundle, target, input.provider, cache, attemptedAt, index, targets.length, input.segmentLengthKm ?? MAX_POSTPASS_SEGMENT_KM, input.onProgress)
    lookups.push(lookup)
    const applied = applyStageLookup(bundle, lookup, target.geometry, target.anchors, input.provider, attemptedAt)
    const isLastOfPass = index === targets.length - 1
    const withAggregate = isLastOfPass ? finalizeAggregateFromStageErrors(applied, allStageDayIds, attemptedAt) : applied

    // Optimistic concurrency, scoped to this one stage's save: never clobber
    // an edit that landed since `base` was read.
    const latest = await repository.loadTripBundle(input.tripId)
    if (latest === null) break
    if (latest.metadata.updatedAt !== bundle.metadata.updatedAt) {
      // Someone else changed the trip while this stage's request was in
      // flight — drop this stage's result rather than overwrite theirs, and
      // continue the loop from their newer bundle (section 13: the rest of
      // the trip's stages are never blocked by this).
      bundle = latest
      continue
    }
    await repository.saveTripBundle(withAggregate)
    bundle = withAggregate
    anySaved = true
  }

  return {
    bundle,
    saved: anySaved,
    stageCount: lookups.length,
    requestCount: lookups.filter((lookup) => !lookup.fromCache && lookup.status !== 'error').length + lookups.filter((lookup) => lookup.status === 'error').length,
    placeCount: bundle.practicalPlaces.filter(isAutomaticPracticalPlace).length,
    cacheHitCount: lookups.filter((lookup) => lookup.fromCache).length,
    networkErrorCount: lookups.filter((lookup) => lookup.status === 'error').length,
  }
}
