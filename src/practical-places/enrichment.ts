import { computeStagePracticalPlaceAnchors } from './anchors.ts'
import { indexRouteGeometry, simplifySearchCorridor, sliceRouteGeometry } from '../route-enrichment/segment-geometry.ts'
import { createRouteLocator } from '../route/route-proximity.ts'
import { routeFingerprint, routeGeometry } from '../route-enrichment/route-fingerprint.ts'
import { classifyEnrichmentFailure, currentOnlineState, enrichmentFailureMessage, EnrichmentStorageError } from '../route-enrichment/enrichment-failure.ts'
import {
  ensureStageJobs,
  enrichableStageIds,
  isJobComplete,
  isStagePhaseComplete,
  isStageStructureReady,
  jobId,
  MAX_TOO_HEAVY_FAILURES_PER_PASS,
  subdivideJob,
  withStageJobs,
} from '../route-enrichment/enrichment-jobs.ts'
import type { EnrichmentJob } from '../route-enrichment/enrichment-jobs.ts'
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
  readonly failureMessage?: string | undefined
  readonly stage: RideStage
  readonly day: TripDay
  readonly route: Route
  readonly geometry: readonly RouteGeometryPoint[]
  readonly anchors: readonly PracticalPlaceAnchor[]
  readonly candidates: readonly PracticalPlaceCandidate[]
  readonly status: LookupStatus
  readonly fromCache: boolean
  readonly requestCount?: number
  readonly cacheHits?: number
  readonly networkErrors?: number
  readonly storageErrors?: number
  readonly replaceExisting?: boolean
}

export interface PracticalPlacesProgress {
  readonly stageId?: string
  readonly dayId?: TripDayId
  readonly completedJobs?: number
  readonly totalJobs?: number
  readonly placeCount?: number
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
  readonly storageErrorCount?: number
}

export interface EnrichTripPracticalPlacesInput {
  readonly bundle: TripBundle
  readonly provider: PracticalPlacesProvider
  readonly cache: PracticalPlacesCacheRepository
  readonly now: () => string
  readonly onProgress?: (progress: PracticalPlacesProgress) => void | Promise<void>
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
  readonly onUpdated?: (bundle: TripBundle, dayId: TripDayId) => void | Promise<void>
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

/** Structural anchors are a stable part of the search identity. */
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
  onProgress?: EnrichTripPracticalPlacesInput['onProgress'],
  onCheckpoint?: (snapshot: StageLookup & { readonly jobs: readonly EnrichmentJob[] }) => Promise<void>,
): Promise<StageLookup & { readonly jobs: readonly EnrichmentJob[] }> {
  const fingerprint = routeFingerprint(bundle, lookup.route)
  const anchorsKey = anchorsFingerprint(lookup.anchors)
  const indexedGeometry = indexRouteGeometry(lookup.geometry)
  const collected: PracticalPlaceCandidate[] = []
  let requestCount = 0, cacheHits = 0, networkErrors = 0, storageErrors = 0, tooHeavyFailures = 0
  let jobs = [...plannedJobs]
  let replayComplete = true
  let failureMessage: string | undefined
  function snapshot(): StageLookup & { readonly jobs: readonly EnrichmentJob[] } {
    const incomplete = jobs.some(job => job.kind === 'practical' && !isJobComplete(job))
    return { ...lookup, candidates: [...collected], jobs: [...jobs],
      status: incomplete ? 'error' : collected.length === 0 ? 'no-result' : 'success',
      fromCache: requestCount === 0, requestCount, cacheHits, networkErrors, storageErrors,
      replaceExisting: !incomplete && replayComplete, failureMessage: incomplete ? failureMessage : undefined }
  }
  async function checkpoint(): Promise<void> {
    const current = snapshot()
    await onCheckpoint?.(current)
    const phaseJobs = jobs.filter(job => job.kind === 'practical')
    await onProgress?.({ stageId: lookup.stage.id, dayId: lookup.day.id, stageIndex, stageCount,
      completedJobs: phaseJobs.filter(isJobComplete).length, totalJobs: phaseJobs.length,
      placeCount: new Set(collected.map(candidate => `${candidate.osmType}:${candidate.osmId}`)).size,
      fromCache: current.fromCache, status: current.status === 'error' ? 'error' : current.fromCache ? 'cache' : 'success',
      errorCount: phaseJobs.filter(job => !isJobComplete(job)).length })
  }
  for (let index = 0; index < jobs.length; index++) {
    const job = jobs[index]
    if (job === undefined || job.kind !== 'practical') continue
    if (!shouldContinue()) break
    const identity = { providerId: provider.id, routeFingerprint: fingerprint, enrichmentType: 'practical-places',
      chunkKey: `geometry-v2|trip:${bundle.metadata.id}|generation:${bundle.enrichmentMetadata.practicalPlacesGeneration ?? 0}|anchors:${anchorsKey}|${jobId(job)}`, engineVersion: PRACTICAL_PLACES_ENGINE_VERSION }
    const cached = await cache.get(identity).catch(() => null)
    if (cached !== null) {
      cacheHits++
      collected.push(...cached.results)
      jobs[index] = { ...job, status: cached.results.length === 0 ? 'empty' : 'success' }
      await checkpoint()
      continue
    }
    // A completed job also has a durable POI snapshot in the stored path.
    // Without its raw cache, preserve that snapshot instead of losing it.
    if (isJobComplete(job) && onCheckpoint !== undefined) { replayComplete = false; continue }
    // In the pure API there is no durable checkpoint to replay. A missing
    // raw answer makes this job outstanding BEFORE calling the provider:
    // a failed refresh must never look like an empty, completed success.
    if (isJobComplete(job)) jobs[index] = { ...job, status: 'pending' }
    const segmentGeometry = simplifySearchCorridor(sliceRouteGeometry(indexedGeometry, job.startKm, job.endKm), 25)
    let response
    requestCount++
    try {
      response = await provider.findCandidates({ stageId: lookup.stage.id, routeFingerprint: fingerprint,
        geometry: segmentGeometry, routeLengthKm: job.endKm - job.startKm,
        anchors: anchorsWithin(lookup.anchors, lookup.geometry, job),
        corridorRadiusMeters: PRACTICAL_PLACES_CORRIDOR_RADIUS_METERS + 30,
        anchorRadiusMeters: PRACTICAL_PLACES_ANCHOR_RADIUS_METERS })
    } catch (error) {
      networkErrors++
      const failure = classifyEnrichmentFailure(error, { online: currentOnlineState() })
      failureMessage = enrichmentFailureMessage(error)
      if (failure === 'unavailable') {
        jobs = jobs.map((candidate, i) => i >= index && candidate.kind === 'practical' && !isJobComplete(candidate)
          ? { ...candidate, status: 'waiting-for-network' as const, attempts: candidate.attempts + (i === index ? 1 : 0) } : candidate)
        await checkpoint()
        break
      }
      if (failure !== 'too-heavy') {
        jobs[index] = { ...job, status: 'pending', attempts: job.attempts + 1 }
        await checkpoint()
        break
      }
      tooHeavyFailures++
      const children = tooHeavyFailures > MAX_TOO_HEAVY_FAILURES_PER_PASS ? null : subdivideJob(job)
      if (children === null) {
        jobs[index] = { ...job, status: 'pending', attempts: job.attempts + 1 }
        await checkpoint()
        if (tooHeavyFailures > MAX_TOO_HEAVY_FAILURES_PER_PASS) break
        continue
      }
      jobs = [...jobs.slice(0, index), ...children, ...jobs.slice(index + 1)]
      index--
      await checkpoint()
      continue
    }
    collected.push(...response.candidates)
    jobs[index] = { ...job, status: response.candidates.length === 0 ? 'empty' : 'success', attempts: job.attempts + 1 }
    // A quota/storage failure must never trigger network subdivision.
    try { await cache.put(identity, response.candidates, attemptedAt) }
    catch { storageErrors++ }
    await checkpoint()
    if (storageErrors > 0) break
  }
  return snapshot()
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
  job: EnrichmentJob,
): readonly PracticalPlaceAnchor[] {
  return anchors.filter((anchor) => {
    const distanceKm = createRouteLocator(geometry).locate(anchor)?.trackDistanceKm ?? 0
    return distanceKm >= job.startKm - 0.001 && distanceKm <= job.endKm + 0.001
  })
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
    message: errors === 0 ? null : lookups.find(lookup => lookup.failureMessage !== undefined)?.failureMessage ?? `${errors} étape(s) restent à rechercher ; les lieux acquis sont conservés.`,
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
    const geometry = geometryByStageId.get(lookup.stage.id) ?? []
    const anchors = anchorsByStageId.get(lookup.stage.id) ?? []
    const generated = locateAndDeduplicatePostpassPracticalPlaces(lookup.candidates, geometry, anchors, {
      corridorMaximumLateralDistanceMeters: PRACTICAL_PLACES_CORRIDOR_RADIUS_METERS,
      anchorMaximumDistanceMeters: PRACTICAL_PLACES_ANCHOR_RADIUS_METERS,
    }).map((candidate) => toPracticalPlace(candidate, lookup, provider, attemptedAt))
    if (lookup.status !== 'error' && lookup.replaceExisting !== false) {
      practicalPlaces = practicalPlaces.filter((place) => !isAutomaticPracticalPlace(place) || place.stageId !== lookup.stage.id || place.provenance.manuallyOverridden || place.pinned)
    }
    const byId = new Map(practicalPlaces.map((place) => [place.id, place]))
    for (const place of generated) {
      const existing = bundle.practicalPlaces.find(candidate => candidate.id === place.id)
      if (existing?.provenance.manuallyOverridden) { byId.set(existing.id, existing); continue }
      byId.set(place.id, existing === undefined ? place : { ...place, hidden: existing.hidden, pinned: existing.pinned })
    }
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

/** Merge a checkpoint; incomplete searches never remove acquired places. */
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

/** Derive the aggregate from every stage's saved jobs, including stages
 * not reached by this pass. A single successful stage cannot finish a trip.
 */
function finalizeAggregateFromStageErrors(bundle: TripBundle, allStageDayIds: readonly TripDayId[], attemptedAt: string, failureMessage?: string): TripBundle {
  const pendingSet = new Set(allStageDayIds)
  const outstanding = bundle.stages.filter(stage => pendingSet.has(stage.dayId) && !isStagePhaseComplete(bundle, stage.id, 'practical')).map(stage => stage.dayId)
  const errors = outstanding.length
  const existing = bundle.enrichmentMetadata.providers.find((state) => state.provider === PRACTICAL_PLACES_PROVIDER_STATE)
  const successes = allStageDayIds.length - errors
  const aggregate: EnrichmentProviderState = {
    provider: PRACTICAL_PLACES_PROVIDER_STATE,
    lastAttemptedAt: attemptedAt,
    lastSuccessAt: successes > 0 ? attemptedAt : existing?.lastSuccessAt ?? null,
    status: errors === 0 ? 'success' : successes > 0 ? 'partial' : 'error',
    message: errors === 0 ? null : failureMessage
      ?? (existing?.status === 'error' || existing?.status === 'partial' ? existing.message : null)
      ?? `${errors} étape(s) restent à rechercher ; les lieux acquis sont conservés.`,
  }
  return {
    ...bundle,
    metadata: { ...bundle.metadata, updatedAt: attemptedAt },
    enrichmentMetadata: {
      ...withStageErrors(bundle.enrichmentMetadata, outstanding),
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

/** A ready stage can progress independently of other stages' geography. */
export function tripNeedsPracticalPlacesEnrichment(bundle: TripBundle): boolean {
  const migrated = migrateEnrichmentJobs(bundle)
  return enrichableStageIds(migrated).some((stageId) => isStageStructureReady(migrated, stageId) && !isStagePhaseComplete(migrated, stageId, 'practical'))
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
    requestCount: lookups.reduce((sum, lookup) => sum + (lookup.requestCount ?? 0), 0),
    placeCount: bundle.practicalPlaces.filter(isAutomaticPracticalPlace).length,
    cacheHitCount: lookups.reduce((sum, lookup) => sum + (lookup.cacheHits ?? 0), 0),
    networkErrorCount: lookups.reduce((sum, lookup) => sum + (lookup.networkErrors ?? 0), 0),
    storageErrorCount: lookups.reduce((sum, lookup) => sum + (lookup.storageErrors ?? 0), 0),
  }
}

/** Persist each POI segment atomically against the latest trip. Only
 * geometry, anchors or an explicit refresh supersede its acquired results;
 * unrelated edits are merged and a deleted trip is never recreated.
 */
export async function enrichStoredTripPracticalPlaces(input: EnrichStoredTripPracticalPlacesInput): Promise<PracticalPlacesEnrichmentReport | null> {
  const repository = createTripRepository(input.database)
  const cache = createPracticalPlacesCacheRepository(input.database, { now: input.now })
  const loaded = await repository.loadTripBundle(input.tripId)
  if (loaded === null) return null
  let bundle = migrateEnrichmentJobs(loaded)
  const targets = pendingLookups(bundle).filter(lookup =>
    isStageStructureReady(bundle, lookup.stage.id)
    && (input.onlyDayId === undefined ? !isStagePhaseComplete(bundle, lookup.stage.id, 'practical') : lookup.day.id === input.onlyDayId))
  const lookups: StageLookup[] = []
  let anySaved = false
  for (let index = 0; index < targets.length; index++) {
    if (!(input.shouldContinue?.() ?? true)) break
    const base = await repository.loadTripBundle(input.tripId)
    if (base === null) break
    bundle = migrateEnrichmentJobs(base)
    // Rebuild anchors from the latest saved structure, not the first read.
    const target = pendingLookups(bundle).find(lookup => lookup.stage.id === targets[index]?.stage.id)
    if (target === undefined || !isStageStructureReady(bundle, target.stage.id)) continue
    const planned = ensureStageJobs(bundle, target.stage.id, 'practical')
    if (planned === null) continue
    const fingerprint = routeFingerprint(bundle, target.route)
    const generation = bundle.enrichmentMetadata.practicalPlacesGeneration ?? 0
    const anchorKey = anchorsFingerprint(target.anchors)
    let unchanged = true
    const attemptedAt = input.now()
    const lookup = await resolveLookup(bundle, target, input.provider, cache, attemptedAt, index, targets.length,
      planned.jobs, () => unchanged && (input.shouldContinue?.() ?? true), input.onProgress,
      async current => {
        const saved = await repository.updateTripBundle(input.tripId, latest => {
          const migrated = migrateEnrichmentJobs(latest)
          const currentTarget = pendingLookups(migrated).find(item => item.stage.id === target.stage.id)
          if (currentTarget === undefined || (migrated.enrichmentMetadata.practicalPlacesGeneration ?? 0) !== generation || routeFingerprint(migrated, currentTarget.route) !== fingerprint
            || anchorsFingerprint(currentTarget.anchors) !== anchorKey) { unchanged = false; return null }
          const currentPlan = ensureStageJobs(migrated, target.stage.id, 'practical')
          if (currentPlan === null) return null
          const applied = withStageJobs(applyStageLookup(migrated, current, target.geometry, target.anchors, input.provider, attemptedAt),
            { ...currentPlan, jobs: [...currentPlan.jobs.filter(job => job.kind !== 'practical'), ...current.jobs.filter(job => job.kind === 'practical')] })
          const dayIds = pendingLookups(applied).map(item => item.day.id)
          return finalizeAggregateFromStageErrors(applied, dayIds, attemptedAt, current.failureMessage)
        }).catch(error => { throw new EnrichmentStorageError(error) })
        if (saved !== null) {
          bundle = saved
          anySaved = true
          await input.onUpdated?.(saved, target.day.id)
        }
      })
    lookups.push(lookup)
    if ((lookup.storageErrors ?? 0) > 0) break
  }
  return { bundle, saved: anySaved, stageCount: lookups.length,
    requestCount: lookups.reduce((sum, lookup) => sum + (lookup.requestCount ?? 0), 0),
    placeCount: bundle.practicalPlaces.filter(isAutomaticPracticalPlace).length,
    cacheHitCount: lookups.reduce((sum, lookup) => sum + (lookup.cacheHits ?? 0), 0),
    networkErrorCount: lookups.reduce((sum, lookup) => sum + (lookup.networkErrors ?? 0), 0),
    storageErrorCount: lookups.reduce((sum, lookup) => sum + (lookup.storageErrors ?? 0), 0) }
}
