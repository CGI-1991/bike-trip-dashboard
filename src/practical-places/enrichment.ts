import { buildRouteChunks } from '../route-enrichment/chunking.ts'
import { routeFingerprint, routeGeometry } from '../route-enrichment/route-fingerprint.ts'
import { createPracticalPlacesCacheRepository } from '../storage/indexeddb/practical-places-cache-repository.ts'
import type { PracticalPlacesCacheRepository } from '../storage/indexeddb/practical-places-cache-repository.ts'
import { createTripRepository } from '../storage/indexeddb/trip-repository.ts'
import type { EnrichmentProviderState, PracticalPlace, RideStage, Route, RouteGeometryPoint, TripBundle, TripDay, TripId } from '../trip-core/index.ts'
import { practicalPlaceId } from '../trip-core/index.ts'
import { locateAndDeduplicatePracticalPlaces } from './route-proximity.ts'
import type { LocatedPracticalPlaceCandidate } from './route-proximity.ts'
import type { PracticalPlaceCandidate, PracticalPlacesProvider } from './types.ts'

export const PRACTICAL_PLACES_ENGINE_VERSION = 'practical-places-osm@2'
export const PRACTICAL_PLACES_PROVIDER_STATE = 'osm-practical-places'
const SEARCH_RADIUS_METERS = 300
const MAXIMUM_LATERAL_DISTANCE_METERS = 250
const PRACTICAL_PLACES_CHUNK_LENGTH_KM = 10

type LookupStatus = 'success' | 'no-result' | 'partial' | 'error'

interface StageLookup {
  readonly stage: RideStage
  readonly day: TripDay
  readonly route: Route
  readonly geometry: readonly RouteGeometryPoint[]
  readonly candidates: readonly PracticalPlaceCandidate[]
  readonly status: LookupStatus
  readonly cacheHitCount: number
  readonly successChunkCount: number
  readonly errorChunkCount: number
  readonly chunkCount: number
}

export interface PracticalPlacesProgress {
  readonly stageIndex: number
  readonly stageCount: number
  readonly chunkIndex: number
  readonly chunkCount: number
  readonly fromCache: boolean
  readonly status: 'cache' | 'success' | 'error'
  readonly errorCount: number
}

export interface PracticalPlacesEnrichmentReport {
  readonly bundle: TripBundle
  readonly saved: boolean
  readonly stageCount: number
  readonly chunkCount: number
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
}

export interface EnrichStoredTripPracticalPlacesInput extends Omit<EnrichTripPracticalPlacesInput, 'bundle' | 'cache'> {
  readonly database: IDBDatabase
  readonly tripId: TripId
}

function pendingLookups(bundle: TripBundle): readonly Omit<StageLookup, 'candidates' | 'status' | 'cacheHitCount' | 'successChunkCount' | 'errorChunkCount' | 'chunkCount'>[] {
  const routes = new Map(bundle.routes.map((route) => [route.id, route]))
  const days = new Map(bundle.days.map((day) => [day.id, day]))
  return bundle.stages.flatMap((stage) => {
    const route = routes.get(stage.sourceRouteId)
    const day = days.get(stage.dayId)
    const geometry = route === undefined ? null : routeGeometry(route)
    return route === undefined || day === undefined || geometry === null ? [] : [{ stage, day, route, geometry }]
  })
}

async function resolveLookup(
  bundle: TripBundle,
  lookup: ReturnType<typeof pendingLookups>[number],
  provider: PracticalPlacesProvider,
  cache: PracticalPlacesCacheRepository,
  attemptedAt: string,
  stageIndex: number,
  stageCount: number,
  onProgress?: (progress: PracticalPlacesProgress) => void,
): Promise<StageLookup> {
  const chunks = buildRouteChunks(lookup.geometry, PRACTICAL_PLACES_CHUNK_LENGTH_KM)
  const candidates: PracticalPlaceCandidate[] = []
  let cacheHitCount = 0
  let successChunkCount = 0
  let errorChunkCount = 0
  for (const chunk of chunks) {
    const identity = {
      providerId: provider.id,
      routeFingerprint: routeFingerprint(bundle, lookup.route),
      enrichmentType: 'practical-places',
      chunkKey: chunk.key,
      engineVersion: PRACTICAL_PLACES_ENGINE_VERSION,
    }
    const cached = await cache.get(identity).catch(() => null)
    if (cached !== null) {
      candidates.push(...cached.results)
      cacheHitCount++
      successChunkCount++
      onProgress?.({
        stageIndex, stageCount, chunkIndex: chunk.index, chunkCount: chunks.length,
        fromCache: true, status: 'cache', errorCount: errorChunkCount,
      })
      continue
    }
    try {
      const found = await provider.findCandidates({ geometry: chunk.geometry, radiusMeters: SEARCH_RADIUS_METERS })
      await cache.put(identity, found, attemptedAt)
      candidates.push(...found)
      successChunkCount++
      onProgress?.({
        stageIndex, stageCount, chunkIndex: chunk.index, chunkCount: chunks.length,
        fromCache: false, status: 'success', errorCount: errorChunkCount,
      })
    } catch {
      errorChunkCount++
      onProgress?.({
        stageIndex, stageCount, chunkIndex: chunk.index, chunkCount: chunks.length,
        fromCache: false, status: 'error', errorCount: errorChunkCount,
      })
    }
  }
  const status: LookupStatus = errorChunkCount === 0
    ? candidates.length === 0 ? 'no-result' : 'success'
    : successChunkCount > 0 ? 'partial' : 'error'
  return { ...lookup, candidates, status, cacheHitCount, successChunkCount, errorChunkCount, chunkCount: chunks.length }
}

function isAutomaticPracticalPlace(place: PracticalPlace): boolean {
  return place.provenance.sourceType === 'osm' && place.provenance.engineVersion.startsWith('practical-places-osm@')
}

function toPracticalPlace(candidate: LocatedPracticalPlaceCandidate, lookup: StageLookup, provider: PracticalPlacesProvider, attemptedAt: string): PracticalPlace {
  return {
    id: practicalPlaceId(`osm-practical:${lookup.stage.id}:${candidate.osmType}:${candidate.osmId}`),
    stageId: lookup.stage.id,
    category: candidate.category,
    name: candidate.name,
    latitude: candidate.latitude,
    longitude: candidate.longitude,
    description: null,
    trackDistanceKm: candidate.trackDistanceKm,
    detourKm: candidate.lateralDistanceMeters / 1_000,
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

function providerState(bundle: TripBundle, lookups: readonly StageLookup[], attemptedAt: string): EnrichmentProviderState {
  const errors = lookups.reduce((total, lookup) => total + lookup.errorChunkCount, 0)
  const completed = lookups.reduce((total, lookup) => total + lookup.successChunkCount, 0)
  const existing = bundle.enrichmentMetadata.providers.find((state) => state.provider === PRACTICAL_PLACES_PROVIDER_STATE)
  return {
    provider: PRACTICAL_PLACES_PROVIDER_STATE,
    lastAttemptedAt: attemptedAt,
    lastSuccessAt: completed > 0 ? attemptedAt : existing?.lastSuccessAt ?? null,
    status: errors === 0 ? 'success' : completed > 0 ? 'partial' : 'error',
    message: errors === 0 ? null : `${errors} zone(s) restent à rechercher ; les lieux acquis sont conservés.`,
  }
}

function applyLookups(bundle: TripBundle, lookups: readonly StageLookup[], provider: PracticalPlacesProvider, attemptedAt: string): TripBundle {
  let practicalPlaces = [...bundle.practicalPlaces]
  for (const lookup of lookups) {
    if (lookup.status === 'error') continue
    const generated = locateAndDeduplicatePracticalPlaces(lookup.candidates, lookup.geometry, MAXIMUM_LATERAL_DISTANCE_METERS)
      .map((candidate) => toPracticalPlace(candidate, lookup, provider, attemptedAt))
    if (lookup.status === 'success' || lookup.status === 'no-result') {
      practicalPlaces = practicalPlaces.filter((place) => !isAutomaticPracticalPlace(place) || place.stageId !== lookup.stage.id)
    }
    const byId = new Map(practicalPlaces.map((place) => [place.id, place]))
    for (const place of generated) byId.set(place.id, place)
    practicalPlaces = [...byId.values()]
  }
  return {
    ...bundle,
    metadata: { ...bundle.metadata, updatedAt: attemptedAt },
    practicalPlaces,
    enrichmentMetadata: {
      providers: [...bundle.enrichmentMetadata.providers.filter((state) => state.provider !== PRACTICAL_PLACES_PROVIDER_STATE), providerState(bundle, lookups, attemptedAt)],
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

export async function enrichTripPracticalPlaces(input: EnrichTripPracticalPlacesInput): Promise<PracticalPlacesEnrichmentReport> {
  const attemptedAt = input.now()
  const lookups: StageLookup[] = []
  const pending = pendingLookups(input.bundle)
  for (let index = 0; index < pending.length; index++) {
    const lookup = pending[index]
    if (lookup !== undefined) lookups.push(await resolveLookup(input.bundle, lookup, input.provider, input.cache, attemptedAt, index, pending.length, input.onProgress))
  }
  const bundle = applyLookups(input.bundle, lookups, input.provider, attemptedAt)
  return {
    bundle,
    saved: false,
    stageCount: lookups.length,
    chunkCount: lookups.reduce((total, lookup) => total + lookup.chunkCount, 0),
    placeCount: bundle.practicalPlaces.filter(isAutomaticPracticalPlace).length,
    cacheHitCount: lookups.reduce((total, lookup) => total + lookup.cacheHitCount, 0),
    networkErrorCount: lookups.reduce((total, lookup) => total + lookup.errorChunkCount, 0),
  }
}

export async function enrichStoredTripPracticalPlaces(input: EnrichStoredTripPracticalPlacesInput): Promise<PracticalPlacesEnrichmentReport | null> {
  const repository = createTripRepository(input.database)
  const original = await repository.loadTripBundle(input.tripId)
  if (original === null) return null
  const report = await enrichTripPracticalPlaces({
    bundle: original,
    provider: input.provider,
    cache: createPracticalPlacesCacheRepository(input.database),
    now: input.now,
    onProgress: input.onProgress,
  })
  const latest = await repository.loadTripBundle(input.tripId)
  if (latest === null || latest.metadata.updatedAt !== original.metadata.updatedAt) return { ...report, bundle: latest ?? report.bundle, saved: false }
  await repository.saveTripBundle(report.bundle)
  return { ...report, saved: true }
}
