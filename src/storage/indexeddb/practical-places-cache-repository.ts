import type { PracticalPlaceCandidate } from '../../practical-places/types.ts'
import { createRouteEnrichmentCacheRepository } from './route-enrichment-cache-repository.ts'
import type { RouteEnrichmentCacheIdentity } from './route-enrichment-cache-repository.ts'

export interface PracticalPlacesCacheEntry {
  readonly results: readonly PracticalPlaceCandidate[]
  readonly storedAt: string
}

export interface PracticalPlacesCacheRepository {
  get(identity: RouteEnrichmentCacheIdentity): Promise<PracticalPlacesCacheEntry | null>
  put(identity: RouteEnrichmentCacheIdentity, results: readonly PracticalPlaceCandidate[], storedAt: string): Promise<void>
}

/** Compatibility-named adapter over the common route/chunk cache. */
export function createPracticalPlacesCacheRepository(database: IDBDatabase): PracticalPlacesCacheRepository {
  const cache = createRouteEnrichmentCacheRepository(database)
  return {
    get(identity) {
      return cache.get<PracticalPlaceCandidate>(identity)
    },
    put(identity, results, storedAt) {
      return cache.put(identity, results, storedAt)
    },
  }
}
