import { createGeocodingCacheRepository } from '../storage/indexeddb/provider-cache-repository.ts'
import type { GeocodingCacheRepository } from '../storage/indexeddb/provider-cache-repository.ts'
import { createTripRepository } from '../storage/indexeddb/trip-repository.ts'
import type { EnrichmentProviderState, RoutePoint, RoutePointType, TripBundle, TripId } from '../trip-core/index.ts'
import { routePointId } from '../trip-core/index.ts'
import type { GeocodingCoordinates, GeocodingProvider, ReverseGeocodingResult } from './types.ts'

const ENGINE_VERSION = 'endpoint-geocoding@1'

type EndpointType = Extract<RoutePointType, 'start' | 'end'>
type LookupStatus = 'success' | 'missing' | 'not-found' | 'error'

interface EndpointLookup {
  readonly stageId: string
  readonly routeId: string
  readonly type: EndpointType
  readonly coordinates: GeocodingCoordinates | null
  readonly elevationM: number | null
  readonly trackDistanceKm: number | null
  readonly status: LookupStatus
  readonly result: ReverseGeocodingResult | null
  readonly cacheHit: boolean
}

export interface EndpointEnrichmentReport {
  readonly bundle: TripBundle
  readonly saved: boolean
  readonly endpointCount: number
  readonly successCount: number
  readonly cacheHitCount: number
  readonly networkErrorCount: number
}

export interface EnrichTripEndpointsInput {
  readonly bundle: TripBundle
  readonly provider: GeocodingProvider
  readonly cache: GeocodingCacheRepository
  readonly idFactory: () => string
  readonly now: () => string
}

export interface EnrichStoredTripEndpointsInput {
  readonly database: IDBDatabase
  readonly tripId: TripId
  readonly provider: GeocodingProvider
  readonly idFactory: () => string
  readonly now: () => string
}

function endpointCoordinates(bundle: TripBundle, routeId: string): readonly [EndpointLookup, EndpointLookup] | null {
  const route = bundle.routes.find((candidate) => candidate.id === routeId)
  const geometry = route?.geometry?.full ?? route?.geometry?.simplified ?? null
  const first = geometry?.[0]
  const last = geometry?.[geometry.length - 1]
  if (first === undefined || last === undefined) return null

  return [
    {
      stageId: '', routeId, type: 'start',
      coordinates: { latitude: first.latitude, longitude: first.longitude },
      elevationM: first.altitudeM, trackDistanceKm: 0,
      status: 'missing', result: null, cacheHit: false,
    },
    {
      stageId: '', routeId, type: 'end',
      coordinates: { latitude: last.latitude, longitude: last.longitude },
      elevationM: last.altitudeM, trackDistanceKm: route?.segments[0]?.distanceKm ?? null,
      status: 'missing', result: null, cacheHit: false,
    },
  ]
}

async function resolveLookup(
  lookup: EndpointLookup,
  provider: GeocodingProvider,
  cache: GeocodingCacheRepository,
  fetchedAt: string,
): Promise<EndpointLookup> {
  if (lookup.coordinates === null) return lookup
  try {
    const cached = await cache.findNearby(provider.id, lookup.coordinates).catch(() => null)
    if (cached !== null) return { ...lookup, status: 'success', result: cached.result, cacheHit: true }
    const result = await provider.reverse(lookup.coordinates)
    if (result === null) return { ...lookup, status: 'not-found' }
    await cache.put(provider.id, lookup.coordinates, result, fetchedAt).catch(() => undefined)
    return { ...lookup, status: 'success', result }
  } catch {
    return { ...lookup, status: 'error' }
  }
}

function isGeocodedEndpoint(point: RoutePoint, type: EndpointType): boolean {
  return point.type === type && point.provenance.sourceType === 'osm' && point.provenance.engineVersion === ENGINE_VERSION
}

/**
 * Whether ONE stage's ONE endpoint already has a geocoded name — the single
 * per-endpoint predicate `tripNeedsEndpointGeocoding` and `enrichTripEndpoints`
 * both build on, so "does this stage still need it" can never drift between
 * the trip-wide gate and the actual lookup-building (integrity-hardening
 * section 10-13).
 */
function isEndpointGeocoded(bundle: TripBundle, stage: TripBundle['stages'][number], type: EndpointType): boolean {
  const pointsById = new Map(bundle.routePoints.map((point) => [point.id, point]))
  return stage.routePointIds.some((id) => {
    const point = pointsById.get(id)
    return point !== undefined && isGeocodedEndpoint(point, type)
  })
}

/**
 * The trip's real, whole endpoint-completion picture — every enrichable
 * stage (one with usable route geometry), both endpoints — evaluated
 * against the FINAL merged stages/points, never just the batch this one
 * pass happened to touch (integrity-hardening section 16: a provider state
 * computed only from the current batch loses the true trip-wide picture
 * the moment lookups stop being built for every stage unconditionally).
 */
function overallEndpointCompletion(bundle: TripBundle, stages: readonly TripBundle['stages'][number][], points: readonly RoutePoint[]): { readonly complete: number; readonly total: number } {
  const pointsById = new Map(points.map((point) => [point.id, point]))
  let total = 0
  let complete = 0
  for (const stage of stages) {
    if (endpointCoordinates(bundle, stage.sourceRouteId) === null) continue
    total += 1
    const bothGeocoded = (['start', 'end'] as const).every((type) => stage.routePointIds.some((id) => {
      const point = pointsById.get(id)
      return point !== undefined && isGeocodedEndpoint(point, type)
    }))
    if (bothGeocoded) complete += 1
  }
  return { complete, total }
}

function providerState(
  bundle: TripBundle,
  lookups: readonly EndpointLookup[],
  completion: { readonly complete: number; readonly total: number },
  attemptedAt: string,
): EnrichmentProviderState {
  const successCount = lookups.filter((lookup) => lookup.status === 'success').length
  const errorCount = lookups.filter((lookup) => lookup.status === 'error').length
  const existing = bundle.enrichmentMetadata.providers.find((state) => state.provider === 'osm')
  const status = completion.total === 0 || completion.complete === completion.total
    ? 'success'
    : completion.complete === 0 && errorCount > 0
      ? 'error'
      : 'partial'
  const message = status === 'success'
    ? null
    : `${completion.complete}/${completion.total} étape(s) avec extrémités identifiées ; le voyage reste disponible localement.`
  return {
    provider: 'osm' as const,
    lastAttemptedAt: attemptedAt,
    lastSuccessAt: successCount > 0 ? attemptedAt : existing?.lastSuccessAt ?? null,
    status,
    message,
  }
}

function applyLookups(bundle: TripBundle, lookups: readonly EndpointLookup[], provider: GeocodingProvider, idFactory: () => string, attemptedAt: string): TripBundle {
  const points = [...bundle.routePoints]
  const pointById = new Map(points.map((point) => [point.id, point]))
  const lookupByStage = new Map<string, Map<EndpointType, EndpointLookup>>()
  for (const lookup of lookups) {
    const byType = lookupByStage.get(lookup.stageId) ?? new Map<EndpointType, EndpointLookup>()
    byType.set(lookup.type, lookup)
    lookupByStage.set(lookup.stageId, byType)
  }

  const stages = bundle.stages.map((stage) => {
    const byType = lookupByStage.get(stage.id)
    if (byType === undefined) return stage
    let startLocationName = stage.startLocationName
    let endLocationName = stage.endLocationName
    const stagePointIds = [...stage.routePointIds]

    for (const type of ['start', 'end'] as const) {
      const lookup = byType.get(type)
      if (lookup?.status !== 'success' || lookup.result === null || lookup.coordinates === null) continue
      const existingIndex = stagePointIds.findIndex((id) => {
        const point = pointById.get(id)
        return point !== undefined && isGeocodedEndpoint(point, type)
      })
      const existingId = existingIndex < 0 ? null : stagePointIds[existingIndex] ?? null
      const point: RoutePoint = {
        id: existingId ?? routePointId(idFactory()),
        routeId: stage.sourceRouteId,
        type,
        name: lookup.result.name,
        latitude: lookup.coordinates.latitude,
        longitude: lookup.coordinates.longitude,
        elevationM: lookup.elevationM,
        trackDistanceKm: lookup.trackDistanceKm,
        provenance: {
          sourceType: provider.sourceType,
          sourceId: lookup.result.sourceId,
          fetchedAt: attemptedAt,
          engineVersion: ENGINE_VERSION,
          confidence: 'medium',
          manuallyOverridden: false,
        },
      }
      if (existingId === null) {
        points.push(point)
        stagePointIds.push(point.id)
      } else {
        const globalIndex = points.findIndex((candidate) => candidate.id === existingId)
        points[globalIndex] = point
      }
      pointById.set(point.id, point)
      if (type === 'start') startLocationName = point.name
      else endLocationName = point.name
    }

    return { ...stage, startLocationName, endLocationName, routePointIds: stagePointIds }
  })

  const stageById = new Map(stages.map((stage) => [stage.id, stage]))
  const days = bundle.days.map((day) => {
    if (day.stageId === null) return day
    const stage = stageById.get(day.stageId)
    const byType = lookupByStage.get(day.stageId)
    if (stage === undefined || byType === undefined) return day
    const successes = [...byType.values()].filter((lookup) => lookup.status === 'success').length
    return {
      ...day,
      startLocationName: stage.startLocationName,
      endLocationName: stage.endLocationName,
      enrichmentStatus: successes === 2 ? 'complete' as const : 'partial' as const,
    }
  })

  // Integrity-hardening section 15-16: preserve every OTHER field this pass
  // has nothing to do with (`enrichmentJobs`, `practicalPlacesStageErrors`)
  // — never a wholesale `{ providers: [...] }` reconstruction, which used
  // to silently erase structural/practical completion bookkeeping on every
  // single endpoint-only pass, even a no-op one.
  const completion = overallEndpointCompletion(bundle, stages, points)
  const nextProviderState = providerState(bundle, lookups, completion, attemptedAt)
  const providers = bundle.enrichmentMetadata.providers.filter((state) => state.provider !== 'osm')
  return {
    ...bundle,
    metadata: { ...bundle.metadata, updatedAt: attemptedAt },
    days,
    stages,
    routePoints: points,
    enrichmentMetadata: { ...bundle.enrichmentMetadata, providers: [...providers, nextProviderState] },
  }
}

export function tripNeedsEndpointGeocoding(bundle: TripBundle): boolean {
  return bundle.stages.some((stage) => {
    if (endpointCoordinates(bundle, stage.sourceRouteId) === null) return false
    return (['start', 'end'] as const).some((type) => !isEndpointGeocoded(bundle, stage, type))
  })
}

export async function enrichTripEndpoints(input: EnrichTripEndpointsInput): Promise<EndpointEnrichmentReport> {
  const attemptedAt = input.now()
  const pending: EndpointLookup[] = []
  for (const stage of input.bundle.stages) {
    const endpoints = endpointCoordinates(input.bundle, stage.sourceRouteId)
    if (endpoints === null) continue
    // Integrity-hardening section 10-13: the unit of validity is this ONE
    // stage's ONE endpoint — a stage that already has both start and end
    // geocoded contributes ZERO lookups here, never re-queried just because
    // some OTHER stage in the trip still needs it. A stage missing only one
    // side (e.g. `end`) queries exactly that one side, never the other.
    for (const endpoint of endpoints) {
      if (isEndpointGeocoded(input.bundle, stage, endpoint.type)) continue
      pending.push({ ...endpoint, stageId: stage.id })
    }
  }

  const lookups: EndpointLookup[] = []
  for (const lookup of pending) {
    lookups.push(await resolveLookup(lookup, input.provider, input.cache, attemptedAt))
  }
  const bundle = applyLookups(input.bundle, lookups, input.provider, input.idFactory, attemptedAt)
  return {
    bundle,
    saved: false,
    endpointCount: lookups.length,
    successCount: lookups.filter((lookup) => lookup.status === 'success').length,
    cacheHitCount: lookups.filter((lookup) => lookup.cacheHit).length,
    networkErrorCount: lookups.filter((lookup) => lookup.status === 'error').length,
  }
}

export async function enrichStoredTripEndpoints(input: EnrichStoredTripEndpointsInput): Promise<EndpointEnrichmentReport | null> {
  const repository = createTripRepository(input.database)
  const original = await repository.loadTripBundle(input.tripId)
  if (original === null) return null
  const report = await enrichTripEndpoints({
    bundle: original,
    provider: input.provider,
    cache: createGeocodingCacheRepository(input.database),
    idFactory: input.idFactory,
    now: input.now,
  })

  // Do not overwrite an edit that completed while external calls were in flight.
  const latest = await repository.loadTripBundle(input.tripId)
  if (latest === null || latest.metadata.updatedAt !== original.metadata.updatedAt) {
    return { ...report, bundle: latest ?? report.bundle, saved: false }
  }
  await repository.saveTripBundle(report.bundle)
  return { ...report, saved: true }
}
