import { OBJECT_STORE_NAMES } from './constants.ts'
import { promisifyRequest } from './request.ts'
import { runInTransaction } from './transaction.ts'

const CACHE_KIND = 'route-enrichment-chunk-v1'
const STATS_KEY = `${CACHE_KIND}:statistics`
const DAY_MS = 86_400_000
export const ROUTE_CACHE_MAX_ENTRIES = 500
/** Logical UTF-8 record size, not the browser's physical IndexedDB usage. */
export const ROUTE_CACHE_MAX_BYTES = 16 * 1024 * 1024

export interface RouteEnrichmentCacheOptions {
  readonly now?: () => string
  readonly maxEntries?: number
  readonly maxBytes?: number
}

export interface RouteEnrichmentCacheIdentity {
  readonly providerId: string
  readonly routeFingerprint: string
  readonly enrichmentType: string
  /** Omitted for whole-route providers such as Postpass; retained for legacy chunked consumers. */
  readonly chunkKey?: string
  readonly engineVersion: string
}

interface RouteEnrichmentCacheRecord extends RouteEnrichmentCacheIdentity {
  readonly cacheKey: string
  readonly kind: typeof CACHE_KIND
  readonly results: readonly unknown[]
  readonly storedAt: string
  readonly expiresAt: string | null
  readonly payloadBytes?: number
}

interface CacheStatistics {
  readonly cacheKey: typeof STATS_KEY
  readonly kind: 'route-enrichment-statistics-v1'
  readonly entries: number
  readonly bytes: number
  readonly prunedAt: number
}

interface CacheItem {
  readonly cacheKey: string
  readonly storedAt: number
  readonly bytes: number
}

export interface RouteEnrichmentCacheEntry<T> {
  readonly results: readonly T[]
  readonly storedAt: string
}

export interface RouteEnrichmentCacheRepository {
  get<T>(identity: RouteEnrichmentCacheIdentity): Promise<RouteEnrichmentCacheEntry<T> | null>
  put<T>(identity: RouteEnrichmentCacheIdentity, results: readonly T[], storedAt: string): Promise<void>
  /**
   * Forgets every cached answer for the given route fingerprints.
   *
   * Needed by "Recalculer les données du parcours" and nothing else: that
   * action exists to pick up changes in OSM itself, so clearing the job
   * record alone would achieve nothing — every request would be served from
   * this cache and return exactly what it returned before.
   */
  clearForRouteFingerprints(routeFingerprints: readonly string[]): Promise<void>
}

function key(identity: RouteEnrichmentCacheIdentity): string {
  return [CACHE_KIND, identity.providerId, identity.routeFingerprint, identity.enrichmentType, identity.chunkKey ?? 'whole-route', identity.engineVersion]
    .map(encodeURIComponent)
    .join(':')
}

function isRecord(value: unknown): value is RouteEnrichmentCacheRecord {
  if (value === null || typeof value !== 'object') return false
  const record = value as Partial<RouteEnrichmentCacheRecord>
  return record.kind === CACHE_KIND && Array.isArray(record.results) && typeof record.storedAt === 'string'
}

function ttl(record: Pick<RouteEnrichmentCacheRecord, 'enrichmentType' | 'results'>): number {
  return (record.enrichmentType === 'practical-places' ? record.results.length === 0 ? 1 : 7 : 30) * DAY_MS
}

function isFresh(record: RouteEnrichmentCacheRecord, now: number): boolean {
  const storedAt = Date.parse(record.storedAt)
  const expiresAt = record.expiresAt === null ? storedAt + ttl(record) : Date.parse(record.expiresAt)
  return Number.isFinite(storedAt) && Number.isFinite(expiresAt) && now < Math.min(expiresAt, storedAt + ttl(record))
}

function size(record: RouteEnrichmentCacheRecord): number {
  return typeof record.payloadBytes === 'number' && Number.isFinite(record.payloadBytes) && record.payloadBytes >= 0
    ? record.payloadBytes : new TextEncoder().encode(JSON.stringify(record)).byteLength
}

/** Stream only this cache namespace; never clone all geocoding/weather answers. */
function visitCache(store: IDBObjectStore, visit: (record: RouteEnrichmentCacheRecord, cursor: IDBCursorWithValue) => void): Promise<void> {
  const prefix = `${CACHE_KIND}:`
  return new Promise((resolve, reject) => {
    const request = store.openCursor(IDBKeyRange.bound(prefix, `${prefix}\uffff`))
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const cursor = request.result
      if (cursor === null) { resolve(); return }
      try {
        if (isRecord(cursor.value)) visit(cursor.value, cursor)
        cursor.continue()
      } catch (error) { reject(error) }
    }
  })
}

async function collectFresh(store: IDBObjectStore, now: number): Promise<CacheItem[]> {
  const items: CacheItem[] = []
  await visitCache(store, (record, cursor) => {
    if (!isFresh(record, now)) { cursor.delete(); return }
    items.push({ cacheKey: record.cacheKey, storedAt: Date.parse(record.storedAt), bytes: size(record) })
  })
  return items
}

function statistics(items: readonly CacheItem[], now: number): CacheStatistics {
  return { cacheKey: STATS_KEY, kind: 'route-enrichment-statistics-v1', entries: items.length,
    bytes: items.reduce((sum, item) => sum + item.bytes, 0), prunedAt: now }
}

function isStatistics(value: unknown): value is CacheStatistics {
  const entry = value as Partial<CacheStatistics> | null
  return entry?.kind === 'route-enrichment-statistics-v1' && Number.isInteger(entry.entries) && (entry.entries ?? -1) >= 0
    && typeof entry.bytes === 'number' && Number.isFinite(entry.bytes) && entry.bytes >= 0
    && typeof entry.prunedAt === 'number' && Number.isFinite(entry.prunedAt)
}

export function createRouteEnrichmentCacheRepository(database: IDBDatabase, options: RouteEnrichmentCacheOptions = {}): RouteEnrichmentCacheRepository {
  const now = options.now ?? (() => new Date().toISOString())
  const maxEntries = options.maxEntries ?? ROUTE_CACHE_MAX_ENTRIES
  const maxBytes = options.maxBytes ?? ROUTE_CACHE_MAX_BYTES
  if (!Number.isInteger(maxEntries) || maxEntries < 1 || !Number.isFinite(maxBytes) || maxBytes < 1) throw new Error('Limites du cache invalides.')
  return {
    async get<T>(identity: RouteEnrichmentCacheIdentity) {
      const value = await runInTransaction(database, [OBJECT_STORE_NAMES.providerCache], 'readonly', (transaction) =>
        promisifyRequest(transaction.objectStore(OBJECT_STORE_NAMES.providerCache).get(key(identity))),
      )
      return isRecord(value) && isFresh(value, Date.parse(now())) ? { results: value.results as readonly T[], storedAt: value.storedAt } : null
    },
    async put<T>(identity: RouteEnrichmentCacheIdentity, results: readonly T[], storedAt: string) {
      const base: RouteEnrichmentCacheRecord = {
        ...identity,
        cacheKey: key(identity),
        kind: CACHE_KIND,
        results,
        storedAt,
        expiresAt: new Date(Date.parse(storedAt) + ttl({ enrichmentType: identity.enrichmentType, results })).toISOString(),
      }
      // Include conservative headroom for the size field itself.
      const record = { ...base, payloadBytes: size(base) + 64 }
      const currentTime = Date.parse(now())
      await runInTransaction(database, [OBJECT_STORE_NAMES.providerCache], 'readwrite', async transaction => {
        const store = transaction.objectStore(OBJECT_STORE_NAMES.providerCache)
        let stats: CacheStatistics
        let items: CacheItem[] | undefined
        const savedStats: unknown = await promisifyRequest(store.get(STATS_KEY))
        if (!isStatistics(savedStats) || currentTime - savedStats.prunedAt >= DAY_MS) {
          items = await collectFresh(store, currentTime)
          stats = statistics(items, currentTime)
        } else stats = savedStats
        const previous: unknown = await promisifyRequest(store.get(record.cacheKey))
        if (isRecord(previous)) stats = { ...stats, entries: stats.entries - 1, bytes: stats.bytes - size(previous) }
        // An individual oversize answer is not cached; its durable trip
        // snapshot is saved by the enrichment engine as usual.
        if (record.payloadBytes > maxBytes || !isFresh(record, currentTime)) {
          await promisifyRequest(store.delete(record.cacheKey))
          await promisifyRequest(store.put(stats))
          return
        }
        if (stats.entries + 1 > maxEntries || stats.bytes + record.payloadBytes > maxBytes) {
          items ??= await collectFresh(store, currentTime)
          const retained = items.filter(item => item.cacheKey !== record.cacheKey)
          stats = statistics(retained, currentTime)
          // Leave headroom: pruning one entry on every subsequent write
          // would repeatedly scan the full cache on a long mobile trip.
          const targetEntries = Math.max(1, Math.floor(maxEntries * 0.75))
          const targetBytes = Math.max(record.payloadBytes, Math.floor(maxBytes * 0.75))
          for (const item of retained.sort((left, right) => left.storedAt - right.storedAt || left.cacheKey.localeCompare(right.cacheKey))) {
            if (stats.entries + 1 <= targetEntries && stats.bytes + record.payloadBytes <= targetBytes) break
            await promisifyRequest(store.delete(item.cacheKey))
            stats = { ...stats, entries: stats.entries - 1, bytes: stats.bytes - item.bytes }
          }
        }
        await promisifyRequest(store.put(record))
        await promisifyRequest(store.put({ ...stats, entries: stats.entries + 1, bytes: stats.bytes + record.payloadBytes }))
      })
    },
    async clearForRouteFingerprints(routeFingerprints: readonly string[]) {
      if (routeFingerprints.length === 0) return
      const wanted = new Set(routeFingerprints)
      await runInTransaction(database, [OBJECT_STORE_NAMES.providerCache], 'readwrite', async (transaction) => {
        const store = transaction.objectStore(OBJECT_STORE_NAMES.providerCache)
        await visitCache(store, (record, cursor) => { if (wanted.has(record.routeFingerprint)) cursor.delete() })
        await promisifyRequest(store.delete(STATS_KEY))
      })
    },
  }
}
