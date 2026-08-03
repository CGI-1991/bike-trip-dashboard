import type { ClimbNameCandidate } from '../../climb-names/types.ts'
import type { GeocodingCoordinates } from '../../geocoding/types.ts'
import { OBJECT_STORE_NAMES } from './constants.ts'
import { promisifyRequest } from './request.ts'
import { runInTransaction } from './transaction.ts'

const CACHE_KIND = 'climb-name-v1'
const NEARBY_RADIUS_METERS = 25

interface ClimbNameCacheRecord {
  readonly cacheKey: string
  readonly kind: typeof CACHE_KIND
  readonly providerId: string
  readonly latitude: number
  readonly longitude: number
  readonly result: ClimbNameCandidate | null
  readonly storedAt: string
  readonly expiresAt: null
}

export interface ClimbNameCacheEntry {
  readonly result: ClimbNameCandidate | null
  readonly storedAt: string
}

export interface ClimbNameCacheRepository {
  findNearby(providerId: string, coordinates: GeocodingCoordinates): Promise<ClimbNameCacheEntry | null>
  put(providerId: string, coordinates: GeocodingCoordinates, result: ClimbNameCandidate | null, storedAt: string): Promise<void>
}

function isRecord(value: unknown): value is ClimbNameCacheRecord {
  if (value === null || typeof value !== 'object') return false
  const record = value as Partial<ClimbNameCacheRecord>
  return record.kind === CACHE_KIND && typeof record.providerId === 'string'
    && typeof record.latitude === 'number' && typeof record.longitude === 'number'
    && typeof record.storedAt === 'string' && (record.result === null || typeof record.result === 'object')
}

function distanceMeters(left: GeocodingCoordinates, right: GeocodingCoordinates): number {
  const radians = Math.PI / 180
  const latitudeDelta = (right.latitude - left.latitude) * radians
  const longitudeDelta = (right.longitude - left.longitude) * radians
  const latitude = ((left.latitude + right.latitude) / 2) * radians
  return Math.sqrt((longitudeDelta * Math.cos(latitude)) ** 2 + latitudeDelta ** 2) * 6_371_000
}

function coordinateKey(value: number): string {
  const rounded = Math.round(value * 100_000) / 100_000
  return Object.is(rounded, -0) ? '0.00000' : rounded.toFixed(5)
}

export function createClimbNameCacheRepository(database: IDBDatabase): ClimbNameCacheRepository {
  return {
    async findNearby(providerId, coordinates) {
      const values = await runInTransaction(database, [OBJECT_STORE_NAMES.providerCache], 'readonly', (transaction) =>
        promisifyRequest(transaction.objectStore(OBJECT_STORE_NAMES.providerCache).getAll()),
      )
      const closest = (values as readonly unknown[]).filter(isRecord)
        .filter((record) => record.providerId === providerId)
        .map((record) => ({ record, distance: distanceMeters(coordinates, record) }))
        .filter(({ distance }) => distance <= NEARBY_RADIUS_METERS)
        .sort((left, right) => left.distance - right.distance)[0]?.record
      return closest === undefined ? null : { result: closest.result, storedAt: closest.storedAt }
    },
    async put(providerId, coordinates, result, storedAt) {
      const record: ClimbNameCacheRecord = {
        cacheKey: `${CACHE_KIND}:${encodeURIComponent(providerId)}:${coordinateKey(coordinates.latitude)}:${coordinateKey(coordinates.longitude)}`,
        kind: CACHE_KIND,
        providerId,
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        result,
        storedAt,
        expiresAt: null,
      }
      await runInTransaction(database, [OBJECT_STORE_NAMES.providerCache], 'readwrite', (transaction) =>
        promisifyRequest(transaction.objectStore(OBJECT_STORE_NAMES.providerCache).put(record)).then(() => undefined),
      )
    },
  }
}
