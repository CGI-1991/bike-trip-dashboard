import type { PracticalPlaceCandidate } from '../../practical-places/types.ts'
import { OBJECT_STORE_NAMES } from './constants.ts'
import { promisifyRequest } from './request.ts'
import { runInTransaction } from './transaction.ts'

const CACHE_KIND = 'practical-places-v1'

interface PracticalPlacesCacheRecord {
  readonly cacheKey: string
  readonly kind: typeof CACHE_KIND
  readonly providerId: string
  readonly routeFingerprint: string
  readonly results: readonly PracticalPlaceCandidate[]
  readonly storedAt: string
  readonly expiresAt: null
}

export interface PracticalPlacesCacheEntry {
  readonly results: readonly PracticalPlaceCandidate[]
  readonly storedAt: string
}

export interface PracticalPlacesCacheRepository {
  get(providerId: string, routeFingerprint: string): Promise<PracticalPlacesCacheEntry | null>
  put(providerId: string, routeFingerprint: string, results: readonly PracticalPlaceCandidate[], storedAt: string): Promise<void>
}

function isRecord(value: unknown): value is PracticalPlacesCacheRecord {
  if (value === null || typeof value !== 'object') return false
  const record = value as Partial<PracticalPlacesCacheRecord>
  return record.kind === CACHE_KIND && typeof record.providerId === 'string'
    && typeof record.routeFingerprint === 'string' && Array.isArray(record.results) && typeof record.storedAt === 'string'
}

function cacheKey(providerId: string, routeFingerprint: string): string {
  return `${CACHE_KIND}:${encodeURIComponent(providerId)}:${encodeURIComponent(routeFingerprint)}`
}

export function createPracticalPlacesCacheRepository(database: IDBDatabase): PracticalPlacesCacheRepository {
  return {
    async get(providerId, routeFingerprint) {
      const value = await runInTransaction(database, [OBJECT_STORE_NAMES.providerCache], 'readonly', (transaction) =>
        promisifyRequest(transaction.objectStore(OBJECT_STORE_NAMES.providerCache).get(cacheKey(providerId, routeFingerprint))),
      )
      return isRecord(value) ? { results: value.results, storedAt: value.storedAt } : null
    },
    async put(providerId, routeFingerprint, results, storedAt) {
      const record: PracticalPlacesCacheRecord = {
        cacheKey: cacheKey(providerId, routeFingerprint),
        kind: CACHE_KIND,
        providerId,
        routeFingerprint,
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
