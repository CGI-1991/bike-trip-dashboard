import { distanceBetweenCoordinatesMeters, locatePointOnRoute } from '../route/route-proximity.ts'
import { createRouteEnrichmentCacheRepository } from '../storage/indexeddb/route-enrichment-cache-repository.ts'
import type { RouteEnrichmentCacheRepository } from '../storage/indexeddb/route-enrichment-cache-repository.ts'
import { createTripRepository } from '../storage/indexeddb/trip-repository.ts'
import type { Climb, EnrichmentProviderState, RideStage, Route, RouteGeometryPoint, RoutePoint, RoutePointId, TripBundle, TripId } from '../trip-core/index.ts'
import { routePointId } from '../trip-core/index.ts'
import { cumulativeGeometryDistances } from './chunking.ts'
import { routeFingerprint, routeGeometry } from './route-fingerprint.ts'
import { classifyEnrichmentFailure, currentOnlineState } from './enrichment-failure.ts'
import {
  ensureStageJobs,
  enrichableStageIds,
  isJobComplete,
  isStagePhaseComplete,
  jobId,
  MAX_TOO_HEAVY_FAILURES_PER_PASS,
  subdivideJob,
  withStageJobs,
} from './enrichment-jobs.ts'
import type { EnrichmentJob, EnrichmentJobStatus } from './enrichment-jobs.ts'
import { migrateEnrichmentJobs } from './settled-stages.ts'
import { structuralSearchGeometry } from './search-geometry.ts'
import {
  KNOWN_ROUTE_FEATURE_TYPES,
  STRUCTURAL_LANDMARK_COLLECTION_RADIUS_METERS,
  STRUCTURAL_LOCALITY_COLLECTION_RADIUS_METERS,
  structuralClientRadiusMeters,
} from './types.ts'
import type { OsmRouteFeatureCandidate, RouteEnrichmentProgress, RouteEnrichmentProvider } from './types.ts'

// Bumped from @3 to @4 (stability/UX hardening 2026-08-04): hamlet/peak
// dropped from the Postpass query entirely (V1 final scope: city/town/
// village/mountain-pass/saddle only) — any cache entry from before this
// change must never be reused as-is (it may still contain hamlet/peak
// candidates), so the version bump forces one fresh, smaller query per
// stage the next time each trip is opened.
export const ROUTE_ENRICHMENT_ENGINE_VERSION = 'route-enrichment@4'
export const ROUTE_ENRICHMENT_PROVIDER_STATE = 'postpass-route-enrichment'

interface LocatedFeature extends OsmRouteFeatureCandidate {
  readonly trackDistanceKm: number
  readonly lateralDistanceMeters: number
}

interface StageResult {
  readonly stage: RideStage
  readonly route: Route
  readonly geometry: readonly RouteGeometryPoint[]
  readonly localities: readonly LocatedFeature[]
  readonly landmarks: readonly LocatedFeature[]
  readonly successRequests: number
  readonly errorRequests: number
  readonly networkRequests: number
  readonly source: 'cache' | 'network'
  readonly durationMs: number
  readonly rawCandidateCount: number
  readonly retainedCandidateCount: number
  readonly rejectedCandidateCount: number
  readonly sentPointCount: number
}

export interface RouteEnrichmentReport {
  readonly bundle: TripBundle
  readonly saved: boolean
  readonly requestCount: number
  readonly cacheHitCount: number
  readonly networkErrorCount: number
  readonly localityCount: number
  readonly landmarkCount: number
  readonly renamedClimbCount: number
  readonly adjustedClimbCount: number
}

export interface EnrichTripRouteInput {
  readonly bundle: TripBundle
  readonly provider: RouteEnrichmentProvider
  readonly cache: RouteEnrichmentCacheRepository
  readonly idFactory: () => string
  readonly now: () => string
  readonly onProgress?: (progress: RouteEnrichmentProgress) => void
  /** DER-DES-DER sections 38-39 — checked between stages; `false` stops the pass cleanly, keeping every stage already collected. */
  readonly shouldContinue?: () => boolean
}

export interface EnrichStoredTripRouteInput extends Omit<EnrichTripRouteInput, 'bundle' | 'cache'> {
  readonly database: IDBDatabase
  readonly tripId: TripId
}

export function normalizeName(value: string | null): string | null {
  if (value === null) return null
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/gu, '').toLocaleLowerCase('fr').replace(/[^a-z0-9]+/gu, '') || null
}

function locateAndDeduplicate(candidates: readonly OsmRouteFeatureCandidate[], geometry: readonly RouteGeometryPoint[], radiusFor: (candidate: OsmRouteFeatureCandidate) => number): readonly LocatedFeature[] {
  const exact = new Map<string, LocatedFeature>()
  for (const candidate of candidates) {
    const located = locatePointOnRoute(candidate, geometry)
    if (located === null || located.lateralDistanceMeters > radiusFor(candidate)) continue
    const item = { ...candidate, ...located }
    const key = `${candidate.osmType}:${candidate.osmId}`
    const previous = exact.get(key)
    if (previous === undefined || item.lateralDistanceMeters < previous.lateralDistanceMeters) exact.set(key, item)
  }
  const result: LocatedFeature[] = []
  for (const candidate of [...exact.values()].sort((left, right) => left.lateralDistanceMeters - right.lateralDistanceMeters)) {
    const duplicate = result.some((existing) => {
      const sameName = normalizeName(existing.name) !== null && normalizeName(existing.name) === normalizeName(candidate.name)
      const samePosition = distanceBetweenCoordinatesMeters(existing, candidate) <= 25
      return existing.featureType === candidate.featureType && sameName && samePosition
    })
    if (!duplicate) result.push(candidate)
  }
  return result.sort((left, right) => left.trackDistanceKm - right.trackDistanceKm)
}

function pointAtDistance(geometry: readonly RouteGeometryPoint[], targetKm: number): RouteGeometryPoint | null {
  const distances = cumulativeGeometryDistances(geometry)
  for (let index = 1; index < geometry.length; index++) {
    const beforeDistance = distances[index - 1] ?? 0
    const afterDistance = distances[index] ?? beforeDistance
    if (targetKm > afterDistance) continue
    const before = geometry[index - 1]
    const after = geometry[index]
    if (before === undefined || after === undefined) return null
    const ratio = afterDistance <= beforeDistance ? 0 : Math.max(0, Math.min(1, (targetKm - beforeDistance) / (afterDistance - beforeDistance)))
    const altitudeM = before.altitudeM === null || after.altitudeM === null
      ? after.altitudeM ?? before.altitudeM
      : before.altitudeM + (after.altitudeM - before.altitudeM) * ratio
    return {
      latitude: before.latitude + (after.latitude - before.latitude) * ratio,
      longitude: before.longitude + (after.longitude - before.longitude) * ratio,
      altitudeM,
    }
  }
  return geometry[geometry.length - 1] ?? null
}

function altitudeRange(geometry: readonly RouteGeometryPoint[], startKm: number, endKm: number): readonly number[] {
  const distances = cumulativeGeometryDistances(geometry)
  const low = Math.min(startKm, endKm)
  const high = Math.max(startKm, endKm)
  const values = geometry.flatMap((point, index) => {
    const distance = distances[index] ?? 0
    return distance >= low && distance <= high && point.altitudeM !== null ? [point.altitudeM] : []
  })
  const start = pointAtDistance(geometry, low)?.altitudeM
  const end = pointAtDistance(geometry, high)?.altitudeM
  if (start !== null && start !== undefined) values.push(start)
  if (end !== null && end !== undefined) values.push(end)
  return values
}

function cumulativeGain(geometry: readonly RouteGeometryPoint[], startKm: number, endKm: number): number | null {
  const distances = cumulativeGeometryDistances(geometry)
  const low = Math.min(startKm, endKm)
  const high = Math.max(startKm, endKm)
  const samples: { readonly distanceKm: number; readonly altitudeM: number }[] = []
  const startAltitude = pointAtDistance(geometry, low)?.altitudeM
  const endAltitude = pointAtDistance(geometry, high)?.altitudeM
  if (startAltitude !== null && startAltitude !== undefined) samples.push({ distanceKm: low, altitudeM: startAltitude })
  geometry.forEach((point, index) => {
    const distanceKm = distances[index] ?? 0
    if (distanceKm > low && distanceKm < high && point.altitudeM !== null) samples.push({ distanceKm, altitudeM: point.altitudeM })
  })
  if (endAltitude !== null && endAltitude !== undefined) samples.push({ distanceKm: high, altitudeM: endAltitude })
  if (samples.length < 2) return null
  let gain = 0
  for (let index = 1; index < samples.length; index++) gain += Math.max(0, (samples[index]?.altitudeM ?? 0) - (samples[index - 1]?.altitudeM ?? 0))
  return gain
}

function isGenericClimbName(name: string | null): boolean {
  return name === null || /^Montée \d+$/u.test(name)
}

function featurePriority(feature: LocatedFeature): number {
  return feature.featureType === 'mountain-pass' ? 0 : 1
}

function matchingLandmark(climb: Climb, landmarks: readonly LocatedFeature[]): LocatedFeature | null {
  return landmarks
    .filter((feature) => feature.name !== null && Math.abs(feature.trackDistanceKm - climb.endDistanceKm) <= 1)
    .sort((left, right) => featurePriority(left) - featurePriority(right)
      || Math.abs(left.trackDistanceKm - climb.endDistanceKm) - Math.abs(right.trackDistanceKm - climb.endDistanceKm))[0] ?? null
}

function canAdjustSummit(climb: Climb, feature: LocatedFeature, geometry: readonly RouteGeometryPoint[], nextStartKm: number | null): boolean {
  if (feature.featureType !== 'mountain-pass' && feature.featureType !== 'saddle') return false
  if (feature.lateralDistanceMeters > 250 || Math.abs(feature.trackDistanceKm - climb.endDistanceKm) > 1) return false
  if (nextStartKm !== null && feature.trackDistanceKm >= nextStartKm) return false
  const routeAltitude = pointAtDistance(geometry, feature.trackDistanceKm)?.altitudeM ?? null
  const referenceAltitude = feature.elevationM ?? routeAltitude
  if (referenceAltitude !== null && climb.endAltitudeM !== null && Math.abs(referenceAltitude - climb.endAltitudeM) > 120) return false
  if (routeAltitude === null) return false
  const localAltitudes = altitudeRange(geometry, feature.trackDistanceKm - 0.5, feature.trackDistanceKm + 0.5)
  if (localAltitudes.length > 0 && Math.max(...localAltitudes) - routeAltitude > 35) return false
  const between = altitudeRange(geometry, climb.endDistanceKm, feature.trackDistanceKm)
  if (between.length > 0 && Math.max(...between) - Math.min(routeAltitude, climb.endAltitudeM ?? routeAltitude) > 60) return false
  return true
}

function enrichClimbs(climbs: readonly Climb[], route: Route, geometry: readonly RouteGeometryPoint[], landmarks: readonly LocatedFeature[], attemptedAt: string): readonly Climb[] {
  const routeClimbs = climbs.filter((climb) => climb.routeId === route.id).slice().sort((left, right) => left.startDistanceKm - right.startDistanceKm)
  const replacements = new Map<string, Climb>()
  routeClimbs.forEach((climb, index) => {
    if (climb.provenance.sourceType === 'user' || climb.provenance.manuallyOverridden || !isGenericClimbName(climb.name)) return
    const feature = matchingLandmark(climb, landmarks)
    if (feature === null) return
    const nextStartKm = routeClimbs[index + 1]?.startDistanceKm ?? null
    const adjusted = canAdjustSummit(climb, feature, geometry, nextStartKm)
    const endDistanceKm = adjusted ? feature.trackDistanceKm : climb.endDistanceKm
    const endAltitudeM = adjusted ? pointAtDistance(geometry, endDistanceKm)?.altitudeM ?? climb.endAltitudeM : climb.endAltitudeM
    const gain = adjusted ? cumulativeGain(geometry, climb.startDistanceKm, endDistanceKm) ?? climb.elevationGainM : climb.elevationGainM
    const lengthKm = endDistanceKm - climb.startDistanceKm
    const averageGradientPercent = adjusted && lengthKm > 0 && endAltitudeM !== null && climb.startAltitudeM !== null
      ? ((endAltitudeM - climb.startAltitudeM) / (lengthKm * 1_000)) * 100
      : climb.averageGradientPercent
    replacements.set(climb.id, {
      ...climb,
      name: feature.name,
      endDistanceKm,
      endAltitudeM,
      elevationGainM: gain,
      averageGradientPercent,
      confidence: 'confirmed',
      provenance: {
        sourceType: 'osm',
        sourceId: `postpass-osm:${feature.featureType}:${feature.osmType}:${feature.osmId}`,
        fetchedAt: attemptedAt,
        engineVersion: ROUTE_ENRICHMENT_ENGINE_VERSION,
        confidence: 'high',
        manuallyOverridden: false,
      },
    })
  })
  return climbs.map((climb) => replacements.get(climb.id) ?? climb)
}

function overlapKm(left: Climb, right: Climb): number {
  return Math.max(0, Math.min(left.endDistanceKm, right.endDistanceKm) - Math.max(left.startDistanceKm, right.startDistanceKm))
}

export function removeGeometricDuplicateClimbs(climbs: readonly Climb[]): readonly Climb[] {
  const result: Climb[] = []
  for (const climb of climbs) {
    const duplicateIndex = result.findIndex((existing) => {
      if (existing.routeId !== climb.routeId) return false
      const shortest = Math.min(existing.endDistanceKm - existing.startDistanceKm, climb.endDistanceKm - climb.startDistanceKm)
      const sameAnchor = existing.provenance.sourceId !== null && existing.provenance.sourceId === climb.provenance.sourceId
      return shortest > 0 && overlapKm(existing, climb) / shortest >= 0.8
        && Math.abs(existing.endDistanceKm - climb.endDistanceKm) <= 0.25
        && (sameAnchor || Math.abs(existing.endDistanceKm - climb.endDistanceKm) <= 0.1)
    })
    if (duplicateIndex < 0) {
      result.push(climb)
      continue
    }
    const previous = result[duplicateIndex] as Climb
    const previousManual = previous.provenance.sourceType === 'user' || previous.provenance.manuallyOverridden
    const currentManual = climb.provenance.sourceType === 'user' || climb.provenance.manuallyOverridden
    if ((!previousManual && currentManual) || (previousManual === currentManual && climb.elevationGainM > previous.elevationGainM)) result[duplicateIndex] = climb
  }
  return result
}

async function fetchStage(
  bundle: TripBundle,
  stage: RideStage,
  route: Route,
  geometry: readonly RouteGeometryPoint[],
  provider: RouteEnrichmentProvider,
  cache: RouteEnrichmentCacheRepository,
  attemptedAt: string,
  stageIndex: number,
  stageCount: number,
  plannedJobs: readonly EnrichmentJob[],
  shouldContinue: () => boolean | Promise<boolean>,
  onProgress?: (progress: RouteEnrichmentProgress) => void,
): Promise<{ readonly result: StageResult; readonly cacheHits: number; readonly jobs: readonly EnrichmentJob[] }> {
  const searchGeometry = structuralSearchGeometry(route)
  if (searchGeometry === null) throw new Error(`Géométrie indisponible pour l’étape ${stage.id}.`)
  const fingerprint = routeFingerprint(bundle, route)

  function resultFromCandidates(
    candidates: readonly OsmRouteFeatureCandidate[],
    source: 'cache' | 'network',
    durationMs: number,
    rawCandidateCount: number,
    networkRequests: number,
    successRequests: number,
    errorRequests: number,
    sentPointCount: number,
  ): StageResult {
    // Defense-in-depth (V1 final scope hardening): a provider is only
    // trusted at the TS type level — filter out anything outside the
    // current allowlist (e.g. a stale `hamlet`/`peak` from before the
    // engine-version bump) before it can ever become a stored RoutePoint.
    const knownCandidates = candidates.filter((candidate) => KNOWN_ROUTE_FEATURE_TYPES.has(candidate.featureType))
    // Only mountain-pass/saddle may rename/adjust a climb
    // (`enrichClimbs`/`matchingLandmark`) — city/town/village share the
    // generic "localities" bucket, each retained at its own per-type radius
    // (`structuralClientRadiusMeters`).
    const landmarkCandidates = knownCandidates.filter((candidate) =>
      (candidate.featureType === 'mountain-pass' || candidate.featureType === 'saddle') && candidate.name !== null)
    const localityCandidates = knownCandidates.filter((candidate) =>
      candidate.featureType !== 'mountain-pass' && candidate.featureType !== 'saddle' && candidate.name !== null)
    const radiusFor = (candidate: OsmRouteFeatureCandidate) => structuralClientRadiusMeters(candidate.featureType)
    const localities = locateAndDeduplicate(localityCandidates, geometry, radiusFor)
    const landmarks = locateAndDeduplicate(landmarkCandidates, geometry, radiusFor)
    const retainedCandidateCount = localities.length + landmarks.length
    return {
      stage,
      route,
      geometry,
      localities,
      landmarks,
      successRequests,
      errorRequests,
      networkRequests,
      source,
      durationMs,
      rawCandidateCount,
      retainedCandidateCount,
      rejectedCandidateCount: Math.max(0, rawCandidateCount - retainedCandidateCount),
      sentPointCount,
    }
  }

  // Work through this stage's OUTSTANDING micro-jobs. Anything already
  // marked success/empty is replayed from cache without a request, so a
  // resumed pass costs nothing for the ground it has already covered.
  const collected: OsmRouteFeatureCandidate[] = []
  let cacheHits = 0
  let networkRequests = 0
  let durationMs = 0
  let rawCandidateCount = 0
  let sentPointCount = 0
  let tooHeavyFailures = 0

  let jobs = [...plannedJobs]
  const outcomes: JobOutcome[] = []
  // A job that fails as "too heavy" is replaced by its two halves, which are
  // then attempted in the same pass. The queue is walked by index rather
  // than iterated so those children are picked up immediately.
  for (let index = 0; index < jobs.length; index++) {
    const job = jobs[index]
    if (job === undefined || job.kind !== 'structural') continue
    if (!(await shouldContinue())) break

    const segment = jobGeometry(searchGeometry.geometry, job)
    const identity = jobCacheIdentity(provider.id, fingerprint, job)
    sentPointCount += segment.length

    const cached = await cache.get<OsmRouteFeatureCandidate>(identity).catch(() => null)
    if (cached !== null) {
      collected.push(...cached.results)
      rawCandidateCount += cached.results.length
      cacheHits += 1
      outcomes.push({ job, status: cached.results.length === 0 ? 'empty' : 'success' })
      continue
    }
    if (isJobComplete(job)) {
      // Marked done but its cache entry is gone (evicted, or cleared). Treat
      // it as outstanding again rather than silently losing its content.
      jobs[index] = { ...job, status: 'pending' }
    }

    try {
      const response = await provider.findStructuralCandidates({
        stageId: stage.id,
        routeFingerprint: fingerprint,
        geometry: segment,
        routeLengthKm: job.endKm - job.startKm,
        localityCollectionRadiusMeters: STRUCTURAL_LOCALITY_COLLECTION_RADIUS_METERS,
        landmarkCollectionRadiusMeters: STRUCTURAL_LANDMARK_COLLECTION_RADIUS_METERS,
      })
      await cache.put(identity, response.candidates, attemptedAt)
      collected.push(...response.candidates)
      rawCandidateCount += response.rawCandidateCount
      durationMs += response.durationMs
      networkRequests += 1
      outcomes.push({ job, status: response.candidates.length === 0 ? 'empty' : 'success' })
    } catch (error) {
      networkRequests += 1
      const failure = classifyEnrichmentFailure(error, { online: currentOnlineState() })
      if (failure === 'unavailable') {
        // No connection: splitting would only multiply failures. Park the
        // job and stop this stage — the rest of the queue would fail too.
        outcomes.push({ job, status: 'waiting-for-network' })
        jobs = jobs.map((candidate, candidateIndex) => (candidateIndex > index && candidate !== undefined && candidate.kind === 'structural' && !isJobComplete(candidate)
          ? { ...candidate, status: 'waiting-for-network' as const }
          : candidate))
        break
      }
      tooHeavyFailures += 1
      const children = tooHeavyFailures > MAX_TOO_HEAVY_FAILURES_PER_PASS ? null : subdivideJob(job)
      if (children === null) {
        // At the subdivision floor, or this stage has failed too often in
        // this pass to keep halving. Leave the job outstanding: the stage
        // stays incomplete and a later pass tries again, rather than the
        // stage being declared finished with a hole in it.
        outcomes.push({ job, status: 'pending' })
        if (tooHeavyFailures > MAX_TOO_HEAVY_FAILURES_PER_PASS) break
        continue
      }
      // The parent is replaced by its halves — it must not remain in the
      // plan alongside them, or the stage could never reach completion.
      jobs = [...jobs.slice(0, index), ...children, ...jobs.slice(index + 1)]
      index -= 1
      outcomes.push({ job, status: 'subdivided' })
    }
  }

  const remaining = applyOutcomes(jobs, outcomes)
  const incomplete = remaining.filter((job) => job.kind === 'structural' && !isJobComplete(job))
  const source = networkRequests === 0 ? 'cache' : 'network'
  // `locateAndDeduplicate` (inside `resultFromCandidates`) already keys on
  // `osmType:osmId`, so the deliberate overlap between neighbouring segments
  // collapses there — no separate merge step needed.
  const result = resultFromCandidates(
    collected, source, durationMs, rawCandidateCount, networkRequests,
    collected.length > 0 || incomplete.length === 0 ? 1 : 0,
    incomplete.length > 0 ? 1 : 0,
    sentPointCount,
  )
  onProgress?.({
    stageIndex, stageCount, stageId: stage.id, source,
    status: incomplete.length > 0 ? 'error' : source === 'cache' ? 'cache' : 'success',
    errorCount: incomplete.length,
    durationMs: result.durationMs, rawCandidateCount: result.rawCandidateCount, retainedCandidateCount: result.retainedCandidateCount,
    rejectedCandidateCount: result.rejectedCandidateCount, sentPointCount: result.sentPointCount,
  })
  return { result, cacheHits, jobs: remaining }
}

interface JobOutcome {
  readonly job: EnrichmentJob
  readonly status: EnrichmentJobStatus | 'subdivided'
}

/**
 * Folds this pass's outcomes back into the job list. A subdivided parent is
 * already gone from `jobs` (replaced by its children), so its outcome is
 * simply skipped here.
 */
function applyOutcomes(jobs: readonly EnrichmentJob[], outcomes: readonly JobOutcome[]): readonly EnrichmentJob[] {
  const byId = new Map(outcomes.map((outcome) => [jobId(outcome.job), outcome]))
  return jobs.map((job) => {
    const outcome = byId.get(jobId(job))
    if (outcome === undefined || outcome.status === 'subdivided') return job
    return { ...job, status: outcome.status, attempts: job.attempts + 1 }
  })
}

/** The cache identity of one micro-job — stable across subdivision, so a successful range is never re-requested. */
function jobCacheIdentity(providerId: string, fingerprint: string, job: EnrichmentJob): {
  readonly providerId: string
  readonly routeFingerprint: string
  readonly enrichmentType: string
  readonly chunkKey: string
  readonly engineVersion: string
} {
  return {
    providerId,
    routeFingerprint: fingerprint,
    enrichmentType: 'structural-points',
    chunkKey: jobId(job),
    engineVersion: ROUTE_ENRICHMENT_ENGINE_VERSION,
  }
}

/** The simplified search geometry covering one job's kilometre range. */
function jobGeometry(geometry: readonly RouteGeometryPoint[], job: EnrichmentJob): readonly RouteGeometryPoint[] {
  const distances = cumulativeGeometryDistances(geometry)
  const points = geometry.filter((_point, index) => {
    const distance = distances[index] ?? 0
    return distance >= job.startKm && distance <= job.endKm
  })
  // A search area must always be a line, never a single point — a very
  // sparse geometry can otherwise leave a short range with one sample.
  if (points.length >= 2) return points
  const startIndex = Math.max(0, distances.findIndex((distance) => distance >= job.startKm))
  return geometry.slice(startIndex, startIndex + 2).length >= 2 ? geometry.slice(startIndex, startIndex + 2) : geometry.slice(0, 2)
}

function featurePoint(feature: LocatedFeature, route: Route, idFactory: () => string, attemptedAt: string): RoutePoint | null {
  if (feature.name === null) return null
  return {
    id: routePointId(idFactory()),
    routeId: route.id,
    type: feature.featureType === 'mountain-pass' || feature.featureType === 'saddle' ? 'summit' : 'passage',
    name: feature.name,
    latitude: feature.latitude,
    longitude: feature.longitude,
    elevationM: feature.elevationM,
    trackDistanceKm: feature.trackDistanceKm,
    osmFeatureType: feature.featureType,
    lateralDistanceKm: feature.lateralDistanceMeters / 1_000,
    provenance: {
      sourceType: 'osm',
      sourceId: `postpass-osm:${feature.featureType}:${feature.osmType}:${feature.osmId}`,
      fetchedAt: attemptedAt,
      engineVersion: ROUTE_ENRICHMENT_ENGINE_VERSION,
      confidence: 'high',
      manuallyOverridden: false,
    },
  }
}

function applyResults(bundle: TripBundle, results: readonly StageResult[], idFactory: () => string, attemptedAt: string): TripBundle {
  const completelyRefreshedRouteIds = new Set(results.filter((result) => result.errorRequests === 0).map((result) => result.route.id))
  const isAutomaticRoutePoint = (point: RoutePoint | undefined): boolean => point?.provenance.engineVersion.startsWith('route-enrichment@') ?? false
  const retainedPoints = bundle.routePoints.filter((point) =>
    !isAutomaticRoutePoint(point) || !completelyRefreshedRouteIds.has(point.routeId))
  const generatedPoints = results.flatMap((result) => [...result.localities, ...result.landmarks]
    .map((feature) => featurePoint(feature, result.route, idFactory, attemptedAt))
    .filter((point): point is RoutePoint => point !== null))
  const routePoints = [...retainedPoints]
  for (const point of generatedPoints) {
    const duplicateIndex = point.provenance.sourceId === null ? -1 : routePoints.findIndex((existing) =>
      existing.provenance.engineVersion === ROUTE_ENRICHMENT_ENGINE_VERSION
      && existing.provenance.sourceId === point.provenance.sourceId)
    if (duplicateIndex < 0) routePoints.push(point)
    else routePoints[duplicateIndex] = point
  }

  let climbs: readonly Climb[] = bundle.climbs
  for (const result of results) climbs = enrichClimbs(climbs, result.route, result.geometry, result.landmarks, attemptedAt)
  climbs = removeGeometricDuplicateClimbs(climbs)
  const climbIds = new Set(climbs.map((climb) => climb.id))
  const routePointIdsByRoute = new Map<string, RoutePointId[]>()
  for (const point of routePoints.filter((candidate) => candidate.provenance.engineVersion === ROUTE_ENRICHMENT_ENGINE_VERSION)) {
    const ids = routePointIdsByRoute.get(point.routeId) ?? []
    ids.push(point.id)
    routePointIdsByRoute.set(point.routeId, ids)
  }
  const stages = bundle.stages.map((stage) => ({
    ...stage,
    climbIds: stage.climbIds.filter((id) => climbIds.has(id)),
    routePointIds: [
      ...stage.routePointIds.filter((id) => !completelyRefreshedRouteIds.has(stage.sourceRouteId) || !isAutomaticRoutePoint(bundle.routePoints.find((point) => point.id === id))),
      ...(routePointIdsByRoute.get(stage.sourceRouteId) ?? []),
    ],
  }))
  const successes = results.reduce((total, result) => total + result.successRequests, 0)
  const errors = results.reduce((total, result) => total + result.errorRequests, 0)
  const networks = results.reduce((total, result) => total + result.networkRequests, 0)
  const durationMs = Math.round(results.reduce((total, result) => total + result.durationMs, 0))
  const rawCandidates = results.reduce((total, result) => total + result.rawCandidateCount, 0)
  const retainedCandidates = results.reduce((total, result) => total + result.retainedCandidateCount, 0)
  const existing = bundle.enrichmentMetadata.providers.find((state) => state.provider === ROUTE_ENRICHMENT_PROVIDER_STATE)
  const baseState: EnrichmentProviderState = {
    provider: ROUTE_ENRICHMENT_PROVIDER_STATE,
    lastAttemptedAt: attemptedAt,
    lastSuccessAt: successes > 0 ? attemptedAt : existing?.lastSuccessAt ?? null,
    status: errors === 0 ? 'success' : successes > 0 ? 'partial' : 'error',
    message: errors === 0
      ? `Postpass · ${networks === 0 ? 'cache' : 'network'} · ${durationMs} ms · ${rawCandidates} candidat(s) / ${retainedCandidates} retenu(s).`
      : `${errors} étape(s) Postpass restent à reprendre ; les résultats acquis sont conservés.`,
  }
  // Completion is recorded per micro-job (`enrichmentJobs`), never here.
  // The provider state stays a human-readable summary of the last pass; it
  // is deliberately no longer the thing the pipeline gates on, because
  // "attempted" and "complete" have to be different facts.
  return {
    ...bundle,
    metadata: { ...bundle.metadata, updatedAt: attemptedAt },
    stages,
    climbs,
    routePoints,
    enrichmentMetadata: {
      ...bundle.enrichmentMetadata,
      providers: [...bundle.enrichmentMetadata.providers.filter((state) => state.provider !== ROUTE_ENRICHMENT_PROVIDER_STATE), baseState],
    },
  }
}

/**
 * Whether any ride stage still has outstanding structural micro-jobs.
 *
 * Answered from the job record rather than from the provider's status: a
 * stage whose 60–80 km segment timed out has real work left, however the
 * last pass happened to be summarised.
 */
export function tripNeedsRouteEnrichment(bundle: TripBundle): boolean {
  const migrated = migrateEnrichmentJobs(bundle)
  return enrichableStageIds(migrated).some((stageId) => !isStagePhaseComplete(migrated, stageId, 'structural'))
}

export async function enrichTripRoute(input: EnrichTripRouteInput): Promise<RouteEnrichmentReport> {
  const attemptedAt = input.now()
  // A bundle from the previous, stage-level model is brought up to the
  // micro-job one here, before any decision is made about what still needs
  // doing (`settled-stages.ts` explains how a credible old record is told
  // apart from an unreliable one).
  let working = migrateEnrichmentJobs(input.bundle)
  const routeById = new Map(working.routes.map((route) => [route.id, route]))
  const results: StageResult[] = []
  let requestCount = 0
  let cacheHitCount = 0
  for (let stageIndex = 0; stageIndex < working.stages.length; stageIndex++) {
    // Another trip took over — stop here. Everything already collected is
    // still applied and saved below (no rollback), and the jobs never
    // reached simply stay outstanding for a later pass.
    if (!(input.shouldContinue?.() ?? true)) break
    const stage = working.stages[stageIndex]
    const route = stage === undefined ? undefined : routeById.get(stage.sourceRouteId)
    const geometry = route === undefined ? null : routeGeometry(route)
    if (stage === undefined || route === undefined || geometry === null) continue
    const planned = ensureStageJobs(working, stage.id, 'structural')
    if (planned === null) continue
    // Nothing outstanding for this stage: skip it entirely, no cache read,
    // no request. This is what makes a reopened trip cost zero.
    if (planned.jobs.every((job) => job.kind !== 'structural' || isJobComplete(job))) continue

    const fetched = await fetchStage(
      working, stage, route, geometry, input.provider, input.cache, attemptedAt,
      stageIndex, working.stages.length, planned.jobs,
      () => input.shouldContinue?.() ?? true,
      input.onProgress,
    )
    results.push(fetched.result)
    requestCount += fetched.result.networkRequests
    cacheHitCount += fetched.cacheHits
    working = withStageJobs(working, { ...planned, jobs: fetched.jobs })
  }
  const bundle = applyResults(working, results, input.idFactory, attemptedAt)
  return {
    bundle,
    saved: false,
    requestCount,
    cacheHitCount,
    networkErrorCount: results.reduce((total, result) => total + result.errorRequests, 0),
    localityCount: results.reduce((total, result) => total + result.localities.length, 0),
    landmarkCount: results.reduce((total, result) => total + result.landmarks.length, 0),
    renamedClimbCount: bundle.climbs.filter((climb) => climb.provenance.engineVersion === ROUTE_ENRICHMENT_ENGINE_VERSION).length,
    adjustedClimbCount: bundle.climbs.filter((climb) => climb.provenance.engineVersion === ROUTE_ENRICHMENT_ENGINE_VERSION
      && input.bundle.climbs.find((original) => original.id === climb.id)?.endDistanceKm !== climb.endDistanceKm).length,
  }
}

export async function enrichStoredTripRoute(input: EnrichStoredTripRouteInput): Promise<RouteEnrichmentReport | null> {
  const repository = createTripRepository(input.database)
  const original = await repository.loadTripBundle(input.tripId)
  if (original === null) return null
  const report = await enrichTripRoute({
    bundle: original,
    provider: input.provider,
    cache: createRouteEnrichmentCacheRepository(input.database),
    idFactory: input.idFactory,
    now: input.now,
    onProgress: input.onProgress,
    ...(input.shouldContinue === undefined ? {} : { shouldContinue: input.shouldContinue }),
  })
  const latest = await repository.loadTripBundle(input.tripId)
  if (latest === null || latest.metadata.updatedAt !== original.metadata.updatedAt) return { ...report, bundle: latest ?? report.bundle, saved: false }
  await repository.saveTripBundle(report.bundle)
  return { ...report, saved: true }
}
