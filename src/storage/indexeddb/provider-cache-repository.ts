import type { GeocodingCoordinates, ReverseGeocodingResult } from '../../geocoding/types.ts'
import { OBJECT_STORE_NAMES } from './constants.ts'
import { promisifyRequest } from './request.ts'
import { runInTransaction } from './transaction.ts'

const CACHE_KIND = 'reverse-geocoding-v1'
const DEFAULT_NEARBY_RADIUS_METERS = 25

interface GeocodingCacheRecord {
  readonly cacheKey: string
  readonly kind: typeof CACHE_KIND
  readonly providerId: string
  readonly latitude: number
  readonly longitude: number
  readonly result: ReverseGeocodingResult
  readonly storedAt: string
  readonly expiresAt: null
}

export interface GeocodingCacheEntry {
  readonly coordinates: GeocodingCoordinates
  readonly result: ReverseGeocodingResult
  readonly storedAt: string
}

export interface GeocodingCacheRepository {
  findNearby(providerId: string, coordinates: GeocodingCoordinates): Promise<GeocodingCacheEntry | null>
  put(providerId: string, coordinates: GeocodingCoordinates, result: ReverseGeocodingResult, storedAt: string): Promise<void>
}

function isCacheRecord(value: unknown): value is GeocodingCacheRecord {
  if (value === null || typeof value !== 'object') return false
  const record = value as Partial<GeocodingCacheRecord>
  return record.kind === CACHE_KIND
    && typeof record.providerId === 'string'
    && typeof record.latitude === 'number'
    && typeof record.longitude === 'number'
    && record.result !== null
    && typeof record.result === 'object'
    && typeof record.result.name === 'string'
    && typeof record.storedAt === 'string'
}

function distanceMeters(left: GeocodingCoordinates, right: GeocodingCoordinates): number {
  const radians = Math.PI / 180
  const latitudeDelta = (right.latitude - left.latitude) * radians
  const longitudeDelta = (right.longitude - left.longitude) * radians
  const latitude = ((left.latitude + right.latitude) / 2) * radians
  const x = longitudeDelta * Math.cos(latitude)
  return Math.sqrt(x * x + latitudeDelta * latitudeDelta) * 6_371_000
}

function coordinateKey(value: number): string {
  const rounded = Math.round(value * 100_000) / 100_000
  return Object.is(rounded, -0) ? '0.00000' : rounded.toFixed(5)
}

function cacheKey(providerId: string, coordinates: GeocodingCoordinates): string {
  return `${CACHE_KIND}:${encodeURIComponent(providerId)}:${coordinateKey(coordinates.latitude)}:${coordinateKey(coordinates.longitude)}`
}

export function createGeocodingCacheRepository(
  database: IDBDatabase,
  nearbyRadiusMeters = DEFAULT_NEARBY_RADIUS_METERS,
): GeocodingCacheRepository {
  return {
    async findNearby(providerId, coordinates) {
      const records = await runInTransaction(database, [OBJECT_STORE_NAMES.providerCache], 'readonly', (transaction) =>
        promisifyRequest(transaction.objectStore(OBJECT_STORE_NAMES.providerCache).getAll()),
      )
      const candidates = (records as readonly unknown[])
        .filter(isCacheRecord)
        .filter((record) => record.providerId === providerId)
        .map((record) => ({ record, distance: distanceMeters(coordinates, record) }))
        .filter((candidate) => candidate.distance <= nearbyRadiusMeters)
        .sort((left, right) => left.distance - right.distance)
      const closest = candidates[0]?.record
      return closest === undefined
        ? null
        : { coordinates: { latitude: closest.latitude, longitude: closest.longitude }, result: closest.result, storedAt: closest.storedAt }
    },

    async put(providerId, coordinates, result, storedAt) {
      const record: GeocodingCacheRecord = {
        cacheKey: cacheKey(providerId, coordinates),
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
