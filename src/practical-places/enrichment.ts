import { createPracticalPlacesCacheRepository } from '../storage/indexeddb/practical-places-cache-repository.ts'
import type { PracticalPlacesCacheRepository } from '../storage/indexeddb/practical-places-cache-repository.ts'
import { createTripRepository } from '../storage/indexeddb/trip-repository.ts'
import type { EnrichmentProviderState, PracticalPlace, RideStage, Route, RouteGeometryPoint, TripBundle, TripDay, TripId } from '../trip-core/index.ts'
import { practicalPlaceId } from '../trip-core/index.ts'
import { locateAndDeduplicatePracticalPlaces } from './route-proximity.ts'
import type { LocatedPracticalPlaceCandidate } from './route-proximity.ts'
import type { PracticalPlaceCandidate, PracticalPlacesProvider } from './types.ts'

export const PRACTICAL_PLACES_ENGINE_VERSION = 'practical-places-osm@1'
export const PRACTICAL_PLACES_PROVIDER_STATE = 'osm-practical-places'
const SEARCH_RADIUS_METERS = 300
const MAXIMUM_LATERAL_DISTANCE_METERS = 250

type LookupStatus = 'success' | 'no-result' | 'error'

interface StageLookup {
  readonly stage: RideStage
  readonly day: TripDay
  readonly route: Route
  readonly geometry: readonly RouteGeometryPoint[]
  readonly routeFingerprint: string
  readonly candidates: readonly PracticalPlaceCandidate[]
  readonly status: LookupStatus
  readonly cacheHit: boolean
}

export interface PracticalPlacesEnrichmentReport {
  readonly bundle: TripBundle
  readonly saved: boolean
  readonly stageCount: number
  readonly placeCount: number
  readonly cacheHitCount: number
  readonly networkErrorCount: number
}

export interface EnrichTripPracticalPlacesInput {
  readonly bundle: TripBundle
  readonly provider: PracticalPlacesProvider
  readonly cache: PracticalPlacesCacheRepository
  readonly now: () => string
}

export interface EnrichStoredTripPracticalPlacesInput {
  readonly database: IDBDatabase
  readonly tripId: TripId
  readonly provider: PracticalPlacesProvider
  readonly now: () => string
}

function routeGeometry(route: Route): readonly RouteGeometryPoint[] | null {
  const geometry = route.geometry?.full ?? route.geometry?.simplified ?? null
  return geometry !== null && geometry.length >= 2 ? geometry : null
}

function routeFingerprint(bundle: TripBundle, route: Route): string {
  const source = route.sourceFileId === null ? null : bundle.sourceFiles.find((candidate) => candidate.id === route.sourceFileId)
  if (source?.sha256 !== null && source?.sha256 !== undefined) return `sha256:${source.sha256}`
  const geometry = routeGeometry(route)
  const geometryKey = geometry === null
    ? 'no-geometry'
    : geometry.map((point) => `${point.latitude.toFixed(6)},${point.longitude.toFixed(6)}`).join(';')
  return `route:${route.id}:${geometryKey}`
}

function pendingLookups(bundle: TripBundle): readonly StageLookup[] {
  const routes = new Map(bundle.routes.map((route) => [route.id, route]))
  const days = new Map(bundle.days.map((day) => [day.id, day]))
  return bundle.stages.flatMap((stage) => {
    const route = routes.get(stage.sourceRouteId)
    const day = days.get(stage.dayId)
    const geometry = route === undefined ? null : routeGeometry(route)
    return route === undefined || day === undefined || geometry === null ? [] : [{
      stage,
      day,
      route,
      geometry,
      routeFingerprint: routeFingerprint(bundle, route),
      candidates: [],
      status: 'no-result' as const,
      cacheHit: false,
    }]
  })
}

async function resolveLookup(
  lookup: StageLookup,
  provider: PracticalPlacesProvider,
  cache: PracticalPlacesCacheRepository,
  attemptedAt: string,
): Promise<StageLookup> {
  try {
    const cached = await cache.get(provider.id, lookup.routeFingerprint).catch(() => null)
    if (cached !== null) {
      return { ...lookup, candidates: cached.results, status: cached.results.length === 0 ? 'no-result' : 'success', cacheHit: true }
    }
    const candidates = await provider.findCandidates({ geometry: lookup.geometry, radiusMeters: SEARCH_RADIUS_METERS })
    await cache.put(provider.id, lookup.routeFingerprint, candidates, attemptedAt).catch(() => undefined)
    return { ...lookup, candidates, status: candidates.length === 0 ? 'no-result' : 'success' }
  } catch {
    return { ...lookup, status: 'error' }
  }
}

function isAutomaticPracticalPlace(place: PracticalPlace): boolean {
  return place.provenance.sourceType === 'osm' && place.provenance.engineVersion === PRACTICAL_PLACES_ENGINE_VERSION
}

function toPracticalPlace(
  candidate: LocatedPracticalPlaceCandidate,
  lookup: StageLookup,
  provider: PracticalPlacesProvider,
  attemptedAt: string,
): PracticalPlace {
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
  const errors = lookups.filter((lookup) => lookup.status === 'error').length
  const completed = lookups.length - errors
  const existing = bundle.enrichmentMetadata.providers.find((state) => state.provider === PRACTICAL_PLACES_PROVIDER_STATE)
  return {
    provider: PRACTICAL_PLACES_PROVIDER_STATE,
    lastAttemptedAt: attemptedAt,
    lastSuccessAt: completed > 0 ? attemptedAt : existing?.lastSuccessAt ?? null,
    status: errors === 0 ? 'success' : completed > 0 ? 'partial' : 'error',
    message: errors === 0 ? null : `${errors} étape(s) n’ont pas pu être enrichies ; les lieux existants sont conservés.`,
  }
}

function applyLookups(bundle: TripBundle, lookups: readonly StageLookup[], provider: PracticalPlacesProvider, attemptedAt: string): TripBundle {
  const successfulStageIds = new Set(lookups.filter((lookup) => lookup.status !== 'error').map((lookup) => lookup.stage.id))
  const retained = bundle.practicalPlaces.filter((place) =>
    !isAutomaticPracticalPlace(place) || place.stageId === undefined || place.stageId === null || !successfulStageIds.has(place.stageId),
  )
  const generated = lookups.flatMap((lookup) => lookup.status === 'error' ? [] : locateAndDeduplicatePracticalPlaces(
    lookup.candidates,
    lookup.geometry,
    MAXIMUM_LATERAL_DISTANCE_METERS,
  ).map((candidate) => toPracticalPlace(candidate, lookup, provider, attemptedAt)))
  const providers = bundle.enrichmentMetadata.providers.filter((state) => state.provider !== PRACTICAL_PLACES_PROVIDER_STATE)
  return {
    ...bundle,
    metadata: { ...bundle.metadata, updatedAt: attemptedAt },
    practicalPlaces: [...retained, ...generated],
    enrichmentMetadata: { providers: [...providers, providerState(bundle, lookups, attemptedAt)] },
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
  for (const lookup of pendingLookups(input.bundle)) {
    lookups.push(await resolveLookup(lookup, input.provider, input.cache, attemptedAt))
  }
  const bundle = applyLookups(input.bundle, lookups, input.provider, attemptedAt)
  return {
    bundle,
    saved: false,
    stageCount: lookups.length,
    placeCount: bundle.practicalPlaces.filter(isAutomaticPracticalPlace).length,
    cacheHitCount: lookups.filter((lookup) => lookup.cacheHit).length,
    networkErrorCount: lookups.filter((lookup) => lookup.status === 'error').length,
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
  })
  const latest = await repository.loadTripBundle(input.tripId)
  if (latest === null || latest.metadata.updatedAt !== original.metadata.updatedAt) {
    return { ...report, bundle: latest ?? report.bundle, saved: false }
  }
  await repository.saveTripBundle(report.bundle)
  return { ...report, saved: true }
}
