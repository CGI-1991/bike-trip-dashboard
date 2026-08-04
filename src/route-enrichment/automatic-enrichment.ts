import { enrichStoredTripEndpoints, tripNeedsEndpointGeocoding } from '../geocoding/endpoint-enrichment.ts'
import type { GeocodingProvider } from '../geocoding/types.ts'
import { createTripRepository } from '../storage/indexeddb/trip-repository.ts'
import type { TripBundle, TripId } from '../trip-core/index.ts'
import { enrichStoredTripRoute, tripNeedsRouteEnrichment } from './enrichment.ts'
import type { RouteEnrichmentProgress, RouteEnrichmentProvider } from './types.ts'

export type AutomaticEnrichmentProgress =
  | { readonly phase: 'endpoints' }
  | { readonly phase: 'route'; readonly detail: RouteEnrichmentProgress }

export interface AutomaticEnrichmentInput {
  readonly database: IDBDatabase
  readonly tripId: TripId
  readonly geocodingProvider?: GeocodingProvider
  readonly routeEnrichmentProvider?: RouteEnrichmentProvider
  readonly idFactory: () => string
  readonly now: () => string
  readonly onProgress?: (progress: AutomaticEnrichmentProgress) => void
}

export interface AutomaticEnrichmentReport {
  readonly bundle: TripBundle | null
  readonly endpointAttempted: boolean
  readonly routeAttempted: boolean
  readonly partial: boolean
}

export function tripNeedsAutomaticEnrichment(
  bundle: TripBundle,
  providers: Pick<AutomaticEnrichmentInput, 'geocodingProvider' | 'routeEnrichmentProvider'>,
): boolean {
  return (providers.geocodingProvider !== undefined && tripNeedsEndpointGeocoding(bundle))
    || (providers.routeEnrichmentProvider !== undefined && tripNeedsRouteEnrichment(bundle))
}

export async function runStoredTripAutomaticEnrichment(input: AutomaticEnrichmentInput): Promise<AutomaticEnrichmentReport> {
  const repository = createTripRepository(input.database)
  let bundle = await repository.loadTripBundle(input.tripId)
  if (bundle === null) return { bundle: null, endpointAttempted: false, routeAttempted: false, partial: false }
  let endpointAttempted = false
  let routeAttempted = false

  if (input.geocodingProvider !== undefined && tripNeedsEndpointGeocoding(bundle)) {
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
    if (bundle === null) return { bundle: null, endpointAttempted, routeAttempted, partial: true }
  }

  if (input.routeEnrichmentProvider !== undefined && tripNeedsRouteEnrichment(bundle)) {
    routeAttempted = true
    await enrichStoredTripRoute({
      database: input.database,
      tripId: input.tripId,
      provider: input.routeEnrichmentProvider,
      idFactory: input.idFactory,
      now: input.now,
      onProgress: (detail) => input.onProgress?.({ phase: 'route', detail }),
    })
    bundle = await repository.loadTripBundle(input.tripId)
  }

  const partial = bundle?.enrichmentMetadata.providers.some((state) =>
    (state.provider === 'osm' || state.provider === 'postpass-route-enrichment') && (state.status === 'partial' || state.status === 'error')) ?? false
  return { bundle, endpointAttempted, routeAttempted, partial }
}
