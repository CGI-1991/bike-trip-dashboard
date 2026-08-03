import { createClimbNameCacheRepository } from '../storage/indexeddb/climb-name-cache-repository.ts'
import type { ClimbNameCacheRepository } from '../storage/indexeddb/climb-name-cache-repository.ts'
import { createTripRepository } from '../storage/indexeddb/trip-repository.ts'
import type { Climb, EnrichmentProviderState, Route, TripBundle, TripId } from '../trip-core/index.ts'
import type { GeocodingCoordinates } from '../geocoding/types.ts'
import { selectRelevantClimbName } from './relevance.ts'
import type { ClimbNameCandidate, ClimbNameProvider } from './types.ts'

const ENGINE_VERSION = 'climb-name-enrichment@1'
const SEARCH_RADIUS_METERS = 500

type LookupStatus = 'success' | 'no-result' | 'missing' | 'error'

interface ClimbLookup {
  readonly climbId: string
  readonly summit: GeocodingCoordinates | null
  readonly summitElevationM: number | null
  readonly result: ClimbNameCandidate | null
  readonly status: LookupStatus
  readonly cacheHit: boolean
}

export interface ClimbNameEnrichmentReport {
  readonly bundle: TripBundle
  readonly saved: boolean
  readonly lookupCount: number
  readonly namedCount: number
  readonly noResultCount: number
  readonly cacheHitCount: number
  readonly networkErrorCount: number
}

export interface EnrichTripClimbNamesInput {
  readonly bundle: TripBundle
  readonly provider: ClimbNameProvider
  readonly cache: ClimbNameCacheRepository
  readonly now: () => string
}

export interface EnrichStoredTripClimbNamesInput {
  readonly database: IDBDatabase
  readonly tripId: TripId
  readonly provider: ClimbNameProvider
  readonly now: () => string
}

function isGenericClimbName(climb: Climb): boolean {
  return climb.name === null || /^Montée \d+$/u.test(climb.name)
}

function isEligible(climb: Climb): boolean {
  if (climb.provenance.sourceType === 'user' || climb.provenance.manuallyOverridden) return false
  if (climb.provenance.sourceType === 'osm') return false
  return isGenericClimbName(climb)
}

function distanceMeters(left: GeocodingCoordinates, right: GeocodingCoordinates): number {
  const radians = Math.PI / 180
  const latitudeDelta = (right.latitude - left.latitude) * radians
  const longitudeDelta = (right.longitude - left.longitude) * radians
  const latitude = ((left.latitude + right.latitude) / 2) * radians
  return Math.sqrt((longitudeDelta * Math.cos(latitude)) ** 2 + latitudeDelta ** 2) * 6_371_000
}

function summitAtDistance(route: Route, distanceKm: number): { readonly coordinates: GeocodingCoordinates; readonly elevationM: number | null } | null {
  const geometry = route.geometry?.full ?? route.geometry?.simplified ?? null
  const first = geometry?.[0]
  if (first === undefined || geometry === null) return null
  if (geometry.length === 1 || distanceKm <= 0) return { coordinates: first, elevationM: first.altitudeM }

  let accumulatedKm = 0
  for (let index = 1; index < geometry.length; index++) {
    const previous = geometry[index - 1]
    const current = geometry[index]
    if (previous === undefined || current === undefined) continue
    const segmentKm = distanceMeters(previous, current) / 1_000
    if (segmentKm > 0 && accumulatedKm + segmentKm >= distanceKm) {
      const ratio = Math.max(0, Math.min(1, (distanceKm - accumulatedKm) / segmentKm))
      const elevationM = previous.altitudeM === null || current.altitudeM === null
        ? current.altitudeM ?? previous.altitudeM
        : previous.altitudeM + (current.altitudeM - previous.altitudeM) * ratio
      return {
        coordinates: {
          latitude: previous.latitude + (current.latitude - previous.latitude) * ratio,
          longitude: previous.longitude + (current.longitude - previous.longitude) * ratio,
        },
        elevationM,
      }
    }
    accumulatedKm += segmentKm
  }

  const last = geometry[geometry.length - 1] as (typeof geometry)[number]
  return { coordinates: last, elevationM: last.altitudeM }
}

function buildPendingLookups(bundle: TripBundle): readonly ClimbLookup[] {
  const routeById = new Map(bundle.routes.map((route) => [route.id, route]))
  return bundle.climbs.filter(isEligible).map((climb) => {
    const route = routeById.get(climb.routeId)
    const summit = route === undefined ? null : summitAtDistance(route, climb.endDistanceKm)
    return {
      climbId: climb.id,
      summit: summit?.coordinates ?? null,
      summitElevationM: summit?.elevationM ?? climb.endAltitudeM,
      result: null,
      status: 'missing' as const,
      cacheHit: false,
    }
  })
}

async function resolveLookup(
  lookup: ClimbLookup,
  provider: ClimbNameProvider,
  cache: ClimbNameCacheRepository,
  attemptedAt: string,
): Promise<ClimbLookup> {
  if (lookup.summit === null) return lookup
  try {
    const cached = await cache.findNearby(provider.id, lookup.summit).catch(() => null)
    if (cached !== null) {
      return { ...lookup, result: cached.result, status: cached.result === null ? 'no-result' : 'success', cacheHit: true }
    }
    const candidates = await provider.findCandidates({
      coordinates: lookup.summit,
      elevationM: lookup.summitElevationM,
      radiusMeters: SEARCH_RADIUS_METERS,
    })
    const result = selectRelevantClimbName(candidates, lookup.summit, lookup.summitElevationM)
    await cache.put(provider.id, lookup.summit, result, attemptedAt).catch(() => undefined)
    return { ...lookup, result, status: result === null ? 'no-result' : 'success' }
  } catch {
    return { ...lookup, status: 'error' }
  }
}

function nextProviderState(bundle: TripBundle, lookups: readonly ClimbLookup[], attemptedAt: string): EnrichmentProviderState {
  const errors = lookups.filter((lookup) => lookup.status === 'error').length
  const completed = lookups.filter((lookup) => lookup.status === 'success' || lookup.status === 'no-result').length
  const existing = bundle.enrichmentMetadata.providers.find((state) => state.provider === 'osm')
  const status = errors === 0 ? 'success' : completed > 0 ? 'partial' : 'error'
  return {
    provider: 'osm',
    lastAttemptedAt: attemptedAt,
    lastSuccessAt: completed > 0 ? attemptedAt : existing?.lastSuccessAt ?? null,
    status,
    message: errors === 0 ? null : `${errors} recherche(s) de nom de montée ont échoué ; le voyage reste utilisable.`,
  }
}

function applyLookups(bundle: TripBundle, lookups: readonly ClimbLookup[], provider: ClimbNameProvider, attemptedAt: string): TripBundle {
  const lookupById = new Map(lookups.map((lookup) => [lookup.climbId, lookup]))
  const climbs = bundle.climbs.map((climb) => {
    const lookup = lookupById.get(climb.id)
    if (lookup?.status !== 'success' || lookup.result === null) return climb
    return {
      ...climb,
      name: lookup.result.name,
      confidence: lookup.result.featureType === 'peak' ? 'probable' as const : 'confirmed' as const,
      provenance: {
        sourceType: provider.sourceType,
        sourceId: lookup.result.sourceId,
        fetchedAt: attemptedAt,
        engineVersion: ENGINE_VERSION,
        confidence: lookup.result.featureType === 'peak' ? 'medium' as const : 'high' as const,
        manuallyOverridden: false,
      },
    }
  })
  const providers = bundle.enrichmentMetadata.providers.filter((state) => state.provider !== 'osm')
  return {
    ...bundle,
    metadata: { ...bundle.metadata, updatedAt: attemptedAt },
    climbs,
    enrichmentMetadata: { providers: [...providers, nextProviderState(bundle, lookups, attemptedAt)] },
  }
}

export function tripNeedsClimbNameEnrichment(bundle: TripBundle): boolean {
  const routeById = new Map(bundle.routes.map((route) => [route.id, route]))
  return bundle.climbs.some((climb) => {
    if (!isEligible(climb)) return false
    const route = routeById.get(climb.routeId)
    return route !== undefined && summitAtDistance(route, climb.endDistanceKm) !== null
  })
}

export async function enrichTripClimbNames(input: EnrichTripClimbNamesInput): Promise<ClimbNameEnrichmentReport> {
  const attemptedAt = input.now()
  const lookups: ClimbLookup[] = []
  for (const pending of buildPendingLookups(input.bundle)) {
    lookups.push(await resolveLookup(pending, input.provider, input.cache, attemptedAt))
  }
  const bundle = applyLookups(input.bundle, lookups, input.provider, attemptedAt)
  return {
    bundle,
    saved: false,
    lookupCount: lookups.length,
    namedCount: lookups.filter((lookup) => lookup.status === 'success').length,
    noResultCount: lookups.filter((lookup) => lookup.status === 'no-result' || lookup.status === 'missing').length,
    cacheHitCount: lookups.filter((lookup) => lookup.cacheHit).length,
    networkErrorCount: lookups.filter((lookup) => lookup.status === 'error').length,
  }
}

export async function enrichStoredTripClimbNames(input: EnrichStoredTripClimbNamesInput): Promise<ClimbNameEnrichmentReport | null> {
  const repository = createTripRepository(input.database)
  const original = await repository.loadTripBundle(input.tripId)
  if (original === null) return null
  const report = await enrichTripClimbNames({
    bundle: original,
    provider: input.provider,
    cache: createClimbNameCacheRepository(input.database),
    now: input.now,
  })
  const latest = await repository.loadTripBundle(input.tripId)
  if (latest === null || latest.metadata.updatedAt !== original.metadata.updatedAt) {
    return { ...report, bundle: latest ?? report.bundle, saved: false }
  }
  await repository.saveTripBundle(report.bundle)
  return { ...report, saved: true }
}
