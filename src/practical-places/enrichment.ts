import { computeStagePracticalPlaceAnchors } from './anchors.ts'
import { cumulativeGeometryDistances } from '../route-enrichment/chunking.ts'
import { routeFingerprint, routeGeometry } from '../route-enrichment/route-fingerprint.ts'
import { classifyEnrichmentFailure, currentOnlineState } from '../route-enrichment/enrichment-failure.ts'
import {
  ensureStageJobs,
  enrichableStageIds,
  isJobComplete,
  isStagePhaseComplete,
  isStructuralGloballyComplete,
  jobId,
  MAX_TOO_HEAVY_FAILURES_PER_PASS,
  subdivideJob,
  withStageJobs,
} from '../route-enrichment/enrichment-jobs.ts'
import type { EnrichmentJob, EnrichmentJobStatus } from '../route-enrichment/enrichment-jobs.ts'
import { migrateEnrichmentJobs } from '../route-enrichment/settled-stages.ts'
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
   * When set, only this one ride day's stage is (re-)processed — used when a
   * pause anchor moves and that stage's POI search genuinely needs redoing.
   * Omitted for the ordinary trip-open pass, which covers every stage with
   * outstanding work, one at a time, in chronological order.
   */
  readonly onlyDayId?: TripDayId
}

/**
 * Every enrichable stage, in strict chronological (`bundle.stages`) order —
 * never reordered by "today"/priority. Which of them still need work is
 * decided by the caller from the job record, not here.
 */
function pendingLookups(bundle: TripBundle, _includeAll = true): readonly Omit<StageLookup, 'candidates' | 'status' | 'fromCache'>[] {
  const routes = new Map(bundle.routes.map((route) => [route.id, route]))
  const days = new Map(bundle.days.map((day) => [day.id, day]))
  return bundle.stages.flatMap((stage) => {
    const route = routes.get(stage.sourceRouteId)
    const day = days.get(stage.dayId)
    const geometry = route === undefined ? null : routeGeometry(route)
    if (route === undefined || day === undefined || geometry === null) return []
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
 * Works through one stage's outstanding POI micro-jobs. A cache hit skips the
 * network entirely; a stretch that cannot be answered leaves the stage
 * incomplete rather than failing it, and whatever WAS found is still merged
 * in — nothing acquired is thrown away.
 */
async function resolveLookup(
  bundle: TripBundle,
  lookup: ReturnType<typeof pendingLookups>[number],
  provider: PracticalPlacesProvider,
  cache: PracticalPlacesCacheRepository,
  attemptedAt: string,
  stageIndex: number,
  stageCount: number,
  plannedJobs: readonly EnrichmentJob[],
  shouldContinue: () => boolean,
  onProgress?: (progress: PracticalPlacesProgress) => void,
): Promise<StageLookup & { readonly jobs: readonly EnrichmentJob[] }> {
  const fingerprint = routeFingerprint(bundle, lookup.route)
  const anchorsKey = anchorsFingerprint(lookup.anchors)
  const distances = cumulativeGeometryDistances(lookup.geometry)

  const collected: PracticalPlaceCandidate[] = []
  let anyFromNetwork = false
  let tooHeavyFailures = 0

  let jobs = [...plannedJobs]
  const outcomes: { readonly job: EnrichmentJob; readonly status: EnrichmentJobStatus | 'subdivided' }[] = []
  for (let index = 0; index < jobs.length; index++) {
    const job = jobs[index]
    if (job === undefined || job.kind !== 'practical') continue
    if (!shouldContinue()) break

    const identity = {
      providerId: provider.id,
      routeFingerprint: fingerprint,
      enrichmentType: 'practical-places',
      // The anchor set is part of the identity: moving a pause to a
      // different place genuinely changes what should be searched around.
      chunkKey: `anchors:${anchorsKey}|${jobId(job)}`,
      engineVersion: PRACTICAL_PLACES_ENGINE_VERSION,
    }
    const cached = await cache.get(identity).catch(() => null)
    if (cached !== null) {
      collected.push(...cached.results)
      outcomes.push({ job, status: cached.results.length === 0 ? 'empty' : 'success' })
      continue
    }
    if (isJobComplete(job)) jobs[index] = { ...job, status: 'pending' }

    const segmentGeometry = jobGeometry(lookup.geometry, distances, job)
    try {
      const result = await provider.findCandidates({
        stageId: lookup.stage.id,
        routeFingerprint: fingerprint,
        geometry: segmentGeometry,
        routeLengthKm: job.endKm - job.startKm,
        anchors: anchorsWithin(lookup.anchors, lookup.geometry, distances, job),
        corridorRadiusMeters: PRACTICAL_PLACES_CORRIDOR_RADIUS_METERS,
        anchorRadiusMeters: PRACTICAL_PLACES_ANCHOR_RADIUS_METERS,
      })
      await cache.put(identity, result.candidates, attemptedAt)
      collected.push(...result.candidates)
      anyFromNetwork = true
      outcomes.push({ job, status: result.candidates.length === 0 ? 'empty' : 'success' })
    } catch (error) {
      anyFromNetwork = true
      const failure = classifyEnrichmentFailure(error, { online: currentOnlineState() })
      if (failure === 'unavailable') {
        outcomes.push({ job, status: 'waiting-for-network' })
        jobs = jobs.map((candidate, candidateIndex) => (candidateIndex > index && candidate !== undefined && candidate.kind === 'practical' && !isJobComplete(candidate)
          ? { ...candidate, status: 'waiting-for-network' as const }
          : candidate))
        break
      }
      tooHeavyFailures += 1
      const children = tooHeavyFailures > MAX_TOO_HEAVY_FAILURES_PER_PASS ? null : subdivideJob(job)
      if (children === null) {
        outcomes.push({ job, status: 'pending' })
        if (tooHeavyFailures > MAX_TOO_HEAVY_FAILURES_PER_PASS) break
        continue
      }
      jobs = [...jobs.slice(0, index), ...children, ...jobs.slice(index + 1)]
      index -= 1
      outcomes.push({ job, status: 'subdivided' })
    }
  }

  const byId = new Map(outcomes.map((outcome) => [jobId(outcome.job), outcome]))
  const resolvedJobs = jobs.map((job) => {
    const outcome = byId.get(jobId(job))
    if (outcome === undefined || outcome.status === 'subdivided') return job
    return { ...job, status: outcome.status, attempts: job.attempts + 1 }
  })
  const incomplete = resolvedJobs.filter((job) => job.kind === 'practical' && !isJobComplete(job))
  const allFromCache = !anyFromNetwork

  if (incomplete.length > 0) {
    // Some of this stage's ground was never covered. The candidates that
    // WERE found are still returned and merged — nothing acquired is thrown
    // away — but the stage stays incomplete, so its pauses are not computed
    // and its POI set is not treated as final.
    onProgress?.({ stageIndex, stageCount, fromCache: false, status: 'error', errorCount: incomplete.length })
    return { ...lookup, candidates: collected, status: 'error', fromCache: false, jobs: resolvedJobs }
  }
  onProgress?.({
    stageIndex, stageCount, fromCache: allFromCache,
    status: allFromCache ? 'cache' : 'success',
    errorCount: 0,
  })
  return {
    ...lookup,
    candidates: collected,
    status: collected.length === 0 ? 'no-result' : 'success',
    fromCache: allFromCache,
    jobs: resolvedJobs,
  }
}

/**
 * An anchor-based search ("supermarché autour de ce village") stays local by
 * nature, so each anchor is sent with the ONE job whose kilometre range
 * contains it — never repeated on every job, which would multiply the query
 * cost by the job count for no benefit.
 */
function anchorsWithin(
  anchors: readonly PracticalPlaceAnchor[],
  geometry: readonly RouteGeometryPoint[],
  distances: readonly number[],
  job: EnrichmentJob,
): readonly PracticalPlaceAnchor[] {
  return anchors.filter((anchor) => {
    const distanceKm = nearestGeometryDistanceKm(anchor, geometry, distances)
    return distanceKm >= job.startKm && distanceKm <= job.endKm
  })
}

/** The stretch of route geometry one job covers — always at least a line, never a single point. */
function jobGeometry(
  geometry: readonly RouteGeometryPoint[],
  distances: readonly number[],
  job: EnrichmentJob,
): readonly RouteGeometryPoint[] {
  const points = geometry.filter((_point, index) => {
    const distance = distances[index] ?? 0
    return distance >= job.startKm && distance <= job.endKm
  })
  if (points.length >= 2) return points
  const startIndex = Math.max(0, distances.findIndex((distance) => distance >= job.startKm))
  const pair = geometry.slice(startIndex, startIndex + 2)
  return pair.length >= 2 ? pair : geometry.slice(0, 2)
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
  }
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
  const aggregate = providerState(lookups, attemptedAt, bundle.enrichmentMetadata.providers.find((state) => state.provider === PRACTICAL_PLACES_PROVIDER_STATE))
  const metadata = withStageErrors(bundle.enrichmentMetadata, stageErrors)
  return {
    ...bundle,
    metadata: { ...bundle.metadata, updatedAt: attemptedAt },
    practicalPlaces,
    enrichmentMetadata: {
      ...metadata,
      providers: [...metadata.providers.filter((state) => state.provider !== PRACTICAL_PLACES_PROVIDER_STATE), aggregate],
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
  return {
    ...bundle,
    metadata: { ...bundle.metadata, updatedAt: attemptedAt },
    practicalPlaces,
    enrichmentMetadata: withStageErrors(bundle.enrichmentMetadata, mergeStageErrors(bundle.enrichmentMetadata.practicalPlacesStageErrors, [lookup])),
  }
}

/**
 * Sets (or removes) the per-stage error list on an existing metadata object.
 *
 * Removing has to be explicit: spreading the previous metadata and then
 * conditionally re-adding the key leaves the OLD list in place when the new
 * one is empty, so a stage that has just recovered would stay flagged
 * forever.
 */
function withStageErrors(metadata: TripBundle['enrichmentMetadata'], stageErrors: readonly TripDayId[]): TripBundle['enrichmentMetadata'] {
  const { practicalPlacesStageErrors: _dropped, ...rest } = metadata
  return stageErrors.length === 0 ? rest : { ...rest, practicalPlacesStageErrors: stageErrors }
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
 * Whether any ride stage still has outstanding POI micro-jobs.
 *
 * Returns `false` while the trip's structural geography is incomplete: POI
 * are searched around real places, so starting before every stage knows its
 * places would search around a half-built map. That gate is enforced again,
 * as a hard precondition, in `enrichStoredTripPracticalPlaces`.
 */
export function tripNeedsPracticalPlacesEnrichment(bundle: TripBundle): boolean {
  const migrated = migrateEnrichmentJobs(bundle)
  if (!isStructuralGloballyComplete(migrated)) return false
  return enrichableStageIds(migrated).some((stageId) => !isStagePhaseComplete(migrated, stageId, 'practical'))
}

export async function enrichTripPracticalPlaces(input: EnrichTripPracticalPlacesInput): Promise<PracticalPlacesEnrichmentReport> {
  const attemptedAt = input.now()
  const lookups: StageLookup[] = []
  // The pure in-memory API's contract is unchanged: it processes every stage
  // of the bundle it is handed. Skipping stages whose jobs are already done
  // belongs to the stored/progressive path below, which is the one the app's
  // own trip-open orchestration actually uses.
  const migrated = migrateEnrichmentJobs(input.bundle)
  const pending = pendingLookups(migrated, true)
  const geometryByStageId = new Map(pending.map((lookup) => [lookup.stage.id, lookup.geometry]))
  const anchorsByStageId = new Map(pending.map((lookup) => [lookup.stage.id, lookup.anchors]))
  let working = migrated
  for (let index = 0; index < pending.length; index++) {
    const lookup = pending[index]
    if (lookup === undefined) continue
    const planned = ensureStageJobs(working, lookup.stage.id, 'practical')
    if (planned === null) continue
    const resolved = await resolveLookup(working, lookup, input.provider, input.cache, attemptedAt, index, pending.length, planned.jobs, () => true, input.onProgress)
    lookups.push(resolved)
    working = withStageJobs(working, { ...planned, jobs: resolved.jobs })
  }
  const bundle = applyLookups(working, lookups, geometryByStageId, anchorsByStageId, input.provider, attemptedAt)
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
 * The progressive, per-stage persisted entry point: E1 → lookup → apply →
 * SAVE → E2 → …, in the trip's own chronological order. Results of E1 never
 * wait for E2 to be persisted.
 *
 * Refuses to run at all while the trip's structural geography is incomplete.
 * That is a hard precondition rather than a consequence of the caller's
 * ordering: POI are searched around real places, and a stage that does not
 * yet know all of its places would be searched around a partial map and then
 * recorded as done.
 *
 * Each stage's save keeps the optimistic-concurrency guard the whole-batch
 * path always had (never overwrite an edit that landed while this stage's
 * request was in flight) — on a conflict this stage's fresh result is
 * dropped, its jobs stay outstanding, and the loop continues from the newer
 * bundle.
 */
export async function enrichStoredTripPracticalPlaces(input: EnrichStoredTripPracticalPlacesInput): Promise<PracticalPlacesEnrichmentReport | null> {
  const repository = createTripRepository(input.database)
  const cache = createPracticalPlacesCacheRepository(input.database)
  const loaded = await repository.loadTripBundle(input.tripId)
  if (loaded === null) return null
  const initial = migrateEnrichmentJobs(loaded)

  // The hard gate. Refusing here rather than trusting call order means no
  // future caller can accidentally start POI work on a half-mapped trip.
  if (!isStructuralGloballyComplete(initial)) {
    return { bundle: initial, saved: false, stageCount: 0, requestCount: 0, placeCount: 0, cacheHitCount: 0, networkErrorCount: 0 }
  }

  const everyStage = pendingLookups(initial, true)
  const targets = input.onlyDayId === undefined
    ? everyStage.filter((lookup) => !isStagePhaseComplete(initial, lookup.stage.id, 'practical'))
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
    // Another trip took over — stop here, keeping every stage this pass
    // already saved.
    if (!(input.shouldContinue?.() ?? true)) break
    const target = targets[index]
    if (target === undefined) continue
    // Reload right before this stage's own work: picks up whatever the
    // PREVIOUS stage in this same loop just saved, and any edit that landed
    // from elsewhere (a pause change, a manual override) since the loop
    // started.
    const base = await repository.loadTripBundle(input.tripId)
    if (base === null) break
    bundle = migrateEnrichmentJobs(base)
    const attemptedAt = input.now()
    const planned = ensureStageJobs(bundle, target.stage.id, 'practical')
    if (planned === null) continue
    const lookup = await resolveLookup(
      bundle, target, input.provider, cache, attemptedAt, index, targets.length,
      planned.jobs, () => input.shouldContinue?.() ?? true, input.onProgress,
    )
    lookups.push(lookup)
    const applied = withStageJobs(
      applyStageLookup(bundle, lookup, target.geometry, target.anchors, input.provider, attemptedAt),
      { ...planned, jobs: lookup.jobs },
    )
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
