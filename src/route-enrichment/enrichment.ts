import { locatePointOnRoute } from '../practical-places/route-proximity.ts'
import { createRouteEnrichmentCacheRepository } from '../storage/indexeddb/route-enrichment-cache-repository.ts'
import type { RouteEnrichmentCacheRepository } from '../storage/indexeddb/route-enrichment-cache-repository.ts'
import { createTripRepository } from '../storage/indexeddb/trip-repository.ts'
import type { Climb, EnrichmentProviderState, RideStage, Route, RouteGeometryPoint, RoutePoint, RoutePointId, TripBundle, TripId } from '../trip-core/index.ts'
import { routePointId } from '../trip-core/index.ts'
import { buildRouteChunks, cumulativeGeometryDistances } from './chunking.ts'
import { routeFingerprint, routeGeometry } from './route-fingerprint.ts'
import type { OsmRouteFeatureCandidate, RouteEnrichmentKind, RouteEnrichmentProgress, RouteEnrichmentProvider } from './types.ts'

export const ROUTE_ENRICHMENT_ENGINE_VERSION = 'route-enrichment@2'
export const ROUTE_ENRICHMENT_PROVIDER_STATE = 'osm-route-enrichment'

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
  readonly successChunks: number
  readonly errorChunks: number
}

export interface RouteEnrichmentReport {
  readonly bundle: TripBundle
  readonly saved: boolean
  readonly chunkCount: number
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
}

export interface EnrichStoredTripRouteInput extends Omit<EnrichTripRouteInput, 'bundle' | 'cache'> {
  readonly database: IDBDatabase
  readonly tripId: TripId
}

function normalizeName(value: string | null): string | null {
  if (value === null) return null
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/gu, '').toLocaleLowerCase('fr').replace(/[^a-z0-9]+/gu, '') || null
}

function locateAndDeduplicate(candidates: readonly OsmRouteFeatureCandidate[], geometry: readonly RouteGeometryPoint[], maximumLateralMeters: number): readonly LocatedFeature[] {
  const exact = new Map<string, LocatedFeature>()
  for (const candidate of candidates) {
    const located = locatePointOnRoute(candidate, geometry)
    if (located === null || located.lateralDistanceMeters > maximumLateralMeters) continue
    const item = { ...candidate, ...located }
    const key = `${candidate.osmType}:${candidate.osmId}`
    const previous = exact.get(key)
    if (previous === undefined || item.lateralDistanceMeters < previous.lateralDistanceMeters) exact.set(key, item)
  }
  const result: LocatedFeature[] = []
  for (const candidate of [...exact.values()].sort((left, right) => left.lateralDistanceMeters - right.lateralDistanceMeters)) {
    const duplicate = result.some((existing) => {
      const sameName = normalizeName(existing.name) !== null && normalizeName(existing.name) === normalizeName(candidate.name)
      const closeAlong = Math.abs(existing.trackDistanceKm - candidate.trackDistanceKm) <= 0.05
      return existing.featureType === candidate.featureType && sameName && closeAlong
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
  return feature.featureType === 'mountain-pass' ? 0 : feature.featureType === 'saddle' ? 1 : 2
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
      confidence: feature.featureType === 'peak' ? 'probable' : 'confirmed',
      provenance: {
        sourceType: 'osm',
        sourceId: `overpass-osm:${feature.featureType}:${feature.osmType}:${feature.osmId}`,
        fetchedAt: attemptedAt,
        engineVersion: ROUTE_ENRICHMENT_ENGINE_VERSION,
        confidence: feature.featureType === 'peak' ? 'medium' : 'high',
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
  onProgress?: (progress: RouteEnrichmentProgress) => void,
): Promise<{ readonly result: StageResult; readonly chunkCount: number; readonly cacheHits: number }> {
  const chunks = buildRouteChunks(geometry)
  const byKind = new Map<RouteEnrichmentKind, OsmRouteFeatureCandidate[]>([['localities', []], ['landmarks', []]])
  let successChunks = 0
  let errorChunks = 0
  let cacheHits = 0
  for (const kind of ['localities', 'landmarks'] as const) {
    for (const chunk of chunks) {
      const identity = {
        providerId: provider.id,
        routeFingerprint: routeFingerprint(bundle, route),
        enrichmentType: kind,
        chunkKey: chunk.key,
        engineVersion: ROUTE_ENRICHMENT_ENGINE_VERSION,
      }
      const cached = await cache.get<OsmRouteFeatureCandidate>(identity).catch(() => null)
      if (cached !== null) {
        byKind.get(kind)?.push(...cached.results)
        successChunks++
        cacheHits++
        onProgress?.({
          stageIndex, stageCount, kind, chunkIndex: chunk.index, chunkCount: chunks.length,
          fromCache: true, status: 'cache', errorCount: errorChunks,
        })
        continue
      }
      try {
        const candidates = await provider.findCandidates({ kind, geometry: chunk.geometry, radiusMeters: kind === 'localities' ? 1_500 : 500 })
        await cache.put(identity, candidates, attemptedAt)
        byKind.get(kind)?.push(...candidates)
        successChunks++
        onProgress?.({
          stageIndex, stageCount, kind, chunkIndex: chunk.index, chunkCount: chunks.length,
          fromCache: false, status: 'success', errorCount: errorChunks,
        })
      } catch {
        errorChunks++
        onProgress?.({
          stageIndex, stageCount, kind, chunkIndex: chunk.index, chunkCount: chunks.length,
          fromCache: false, status: 'error', errorCount: errorChunks,
        })
      }
    }
  }
  return {
    result: {
      stage,
      route,
      geometry,
      localities: locateAndDeduplicate(byKind.get('localities') ?? [], geometry, 1_500).filter((feature) => feature.name !== null),
      landmarks: locateAndDeduplicate(byKind.get('landmarks') ?? [], geometry, 250),
      successChunks,
      errorChunks,
    },
    chunkCount: chunks.length * 2,
    cacheHits,
  }
}

function featurePoint(feature: LocatedFeature, route: Route, idFactory: () => string, attemptedAt: string): RoutePoint | null {
  if (feature.name === null) return null
  return {
    id: routePointId(idFactory()),
    routeId: route.id,
    type: feature.featureType === 'city' || feature.featureType === 'town' || feature.featureType === 'village' ? 'village' : 'summit',
    name: feature.name,
    latitude: feature.latitude,
    longitude: feature.longitude,
    elevationM: feature.elevationM,
    trackDistanceKm: feature.trackDistanceKm,
    osmFeatureType: feature.featureType,
    lateralDistanceKm: feature.lateralDistanceMeters / 1_000,
    provenance: {
      sourceType: 'osm',
      sourceId: `overpass-osm:${feature.featureType}:${feature.osmType}:${feature.osmId}`,
      fetchedAt: attemptedAt,
      engineVersion: ROUTE_ENRICHMENT_ENGINE_VERSION,
      confidence: feature.featureType === 'peak' ? 'medium' : 'high',
      manuallyOverridden: false,
    },
  }
}

function applyResults(bundle: TripBundle, results: readonly StageResult[], idFactory: () => string, attemptedAt: string): TripBundle {
  const completelyRefreshedRouteIds = new Set(results.filter((result) => result.errorChunks === 0).map((result) => result.route.id))
  const retainedPoints = bundle.routePoints.filter((point) =>
    point.provenance.engineVersion !== ROUTE_ENRICHMENT_ENGINE_VERSION || !completelyRefreshedRouteIds.has(point.routeId))
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
      ...stage.routePointIds.filter((id) => bundle.routePoints.find((point) => point.id === id)?.provenance.engineVersion !== ROUTE_ENRICHMENT_ENGINE_VERSION),
      ...(routePointIdsByRoute.get(stage.sourceRouteId) ?? []),
    ],
  }))
  const successes = results.reduce((total, result) => total + result.successChunks, 0)
  const errors = results.reduce((total, result) => total + result.errorChunks, 0)
  const existing = bundle.enrichmentMetadata.providers.find((state) => state.provider === ROUTE_ENRICHMENT_PROVIDER_STATE)
  const providerState: EnrichmentProviderState = {
    provider: ROUTE_ENRICHMENT_PROVIDER_STATE,
    lastAttemptedAt: attemptedAt,
    lastSuccessAt: successes > 0 ? attemptedAt : existing?.lastSuccessAt ?? null,
    status: errors === 0 ? 'success' : successes > 0 ? 'partial' : 'error',
    message: errors === 0 ? null : `${errors} zone(s) OSM restent à reprendre ; les résultats acquis sont conservés.`,
  }
  return {
    ...bundle,
    metadata: { ...bundle.metadata, updatedAt: attemptedAt },
    stages,
    climbs,
    routePoints,
    enrichmentMetadata: {
      providers: [...bundle.enrichmentMetadata.providers.filter((state) => state.provider !== ROUTE_ENRICHMENT_PROVIDER_STATE), providerState],
    },
  }
}

export function tripNeedsRouteEnrichment(bundle: TripBundle): boolean {
  if (!bundle.routes.some((route) => routeGeometry(route) !== null)) return false
  return bundle.enrichmentMetadata.providers.find((state) => state.provider === ROUTE_ENRICHMENT_PROVIDER_STATE)?.status !== 'success'
}

export async function enrichTripRoute(input: EnrichTripRouteInput): Promise<RouteEnrichmentReport> {
  const attemptedAt = input.now()
  const routeById = new Map(input.bundle.routes.map((route) => [route.id, route]))
  const results: StageResult[] = []
  let chunkCount = 0
  let cacheHitCount = 0
  for (let stageIndex = 0; stageIndex < input.bundle.stages.length; stageIndex++) {
    const stage = input.bundle.stages[stageIndex]
    const route = stage === undefined ? undefined : routeById.get(stage.sourceRouteId)
    const geometry = route === undefined ? null : routeGeometry(route)
    if (stage === undefined || route === undefined || geometry === null) continue
    const fetched = await fetchStage(input.bundle, stage, route, geometry, input.provider, input.cache, attemptedAt, stageIndex, input.bundle.stages.length, input.onProgress)
    results.push(fetched.result)
    chunkCount += fetched.chunkCount
    cacheHitCount += fetched.cacheHits
  }
  const bundle = applyResults(input.bundle, results, input.idFactory, attemptedAt)
  return {
    bundle,
    saved: false,
    chunkCount,
    cacheHitCount,
    networkErrorCount: results.reduce((total, result) => total + result.errorChunks, 0),
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
  })
  const latest = await repository.loadTripBundle(input.tripId)
  if (latest === null || latest.metadata.updatedAt !== original.metadata.updatedAt) return { ...report, bundle: latest ?? report.bundle, saved: false }
  await repository.saveTripBundle(report.bundle)
  return { ...report, saved: true }
}
