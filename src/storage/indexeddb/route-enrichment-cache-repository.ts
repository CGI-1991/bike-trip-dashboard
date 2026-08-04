import { OBJECT_STORE_NAMES } from './constants.ts'
import { promisifyRequest } from './request.ts'
import { runInTransaction } from './transaction.ts'

const CACHE_KIND = 'route-enrichment-chunk-v1'

export interface RouteEnrichmentCacheIdentity {
  readonly providerId: string
  readonly routeFingerprint: string
  readonly enrichmentType: string
  readonly chunkKey: string
  readonly engineVersion: string
}

interface RouteEnrichmentCacheRecord extends RouteEnrichmentCacheIdentity {
  readonly cacheKey: string
  readonly kind: typeof CACHE_KIND
  readonly results: readonly unknown[]
  readonly storedAt: string
  readonly expiresAt: null
}

export interface RouteEnrichmentCacheEntry<T> {
  readonly results: readonly T[]
  readonly storedAt: string
}

export interface RouteEnrichmentCacheRepository {
  get<T>(identity: RouteEnrichmentCacheIdentity): Promise<RouteEnrichmentCacheEntry<T> | null>
  put<T>(identity: RouteEnrichmentCacheIdentity, results: readonly T[], storedAt: string): Promise<void>
}

function key(identity: RouteEnrichmentCacheIdentity): string {
  return [CACHE_KIND, identity.providerId, identity.routeFingerprint, identity.enrichmentType, identity.chunkKey, identity.engineVersion]
    .map(encodeURIComponent)
    .join(':')
}

function isRecord(value: unknown): value is RouteEnrichmentCacheRecord {
  if (value === null || typeof value !== 'object') return false
  const record = value as Partial<RouteEnrichmentCacheRecord>
  return record.kind === CACHE_KIND && Array.isArray(record.results) && typeof record.storedAt === 'string'
}

export function createRouteEnrichmentCacheRepository(database: IDBDatabase): RouteEnrichmentCacheRepository {
  return {
    async get<T>(identity: RouteEnrichmentCacheIdentity) {
      const value = await runInTransaction(database, [OBJECT_STORE_NAMES.providerCache], 'readonly', (transaction) =>
        promisifyRequest(transaction.objectStore(OBJECT_STORE_NAMES.providerCache).get(key(identity))),
      )
      return isRecord(value) ? { results: value.results as readonly T[], storedAt: value.storedAt } : null
    },
    async put<T>(identity: RouteEnrichmentCacheIdentity, results: readonly T[], storedAt: string) {
      const record: RouteEnrichmentCacheRecord = {
        ...identity,
        cacheKey: key(identity),
        kind: CACHE_KIND,
        results,
        storedAt,
        expiresAt: null,
      }
      await runInTransaction(database, [OBJECT_STORE_NAMES.providerCache], 'readwrite', (transaction) =>
        promisifyRequest(transaction.objectStore(OBJECT_STORE_NAMES.providerCache).put(record)).then(() => undefined),
      )
    },
  }
}
