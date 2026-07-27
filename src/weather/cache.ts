import type { IsoDate } from '../trip/calendar.ts'
import type { TripDayId } from '../trip/types.ts'
import { weatherConfig } from './config.ts'
import type {
  WeatherCacheState,
  WeatherForecastResult,
  WeatherRequest,
} from './types.ts'

export interface WeatherStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface WeatherCacheEntry {
  readonly requestKey: string
  readonly dayId: TripDayId
  readonly tripDate: IsoDate
  readonly fetchedAt: string
  readonly expiresAt: string
  readonly datesCovered: readonly IsoDate[]
  readonly locationIds: readonly string[]
  readonly requestParameters: {
    readonly timezone: 'Europe/Paris'
    readonly forecastDays: 16
    readonly hourlyVariables: WeatherRequest['hourlyVariables']
    readonly dailyVariables: WeatherRequest['dailyVariables']
    readonly coordinates: readonly {
      readonly id: string
      readonly latitude: number
      readonly longitude: number
      readonly elevationM: number
    }[]
  }
  readonly result: WeatherForecastResult
}

interface WeatherCacheDocument {
  readonly version: 1
  readonly provider: 'open-meteo'
  readonly savedAt: string
  readonly entries: readonly WeatherCacheEntry[]
}

export interface WeatherCacheLookup {
  readonly state: Exclude<WeatherCacheState, 'miss'>
  readonly entry: WeatherCacheEntry
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isValidForecastResult(
  value: unknown,
  requestKey: string,
): value is WeatherForecastResult {
  if (
    !isRecord(value) ||
    value.provider !== 'open-meteo' ||
    value.requestKey !== requestKey ||
    typeof value.fetchedAt !== 'string' ||
    !['success', 'partial', 'error'].includes(String(value.status)) ||
    !Array.isArray(value.locations) ||
    !Array.isArray(value.datesCovered) ||
    !Array.isArray(value.issues)
  ) {
    return false
  }

  return value.locations.every((location) => {
    if (
      !isRecord(location) ||
      typeof location.requestLocationId !== 'string' ||
      !['success', 'error'].includes(String(location.status))
    ) {
      return false
    }

    if (location.status === 'error') {
      return typeof location.message === 'string'
    }

    return (
      Array.isArray(location.hourly) &&
      location.hourly.every(
        (hour) => isRecord(hour) && typeof hour.time === 'string',
      ) &&
      Array.isArray(location.daily) &&
      location.daily.every(
        (day) => isRecord(day) && typeof day.date === 'string',
      ) &&
      Array.isArray(location.missingVariables) &&
      Array.isArray(location.issues)
    )
  })
}

function isValidEntry(value: unknown): value is WeatherCacheEntry {
  return (
    isRecord(value) &&
    typeof value.requestKey === 'string' &&
    /^J(?:[1-9]|1[0-2])$/.test(String(value.dayId)) &&
    typeof value.tripDate === 'string' &&
    typeof value.fetchedAt === 'string' &&
    Number.isFinite(Date.parse(value.fetchedAt)) &&
    typeof value.expiresAt === 'string' &&
    Number.isFinite(Date.parse(value.expiresAt)) &&
    Array.isArray(value.datesCovered) &&
    Array.isArray(value.locationIds) &&
    isRecord(value.requestParameters) &&
    isValidForecastResult(value.result, value.requestKey)
  )
}

function readDocument(storage: WeatherStorage): WeatherCacheDocument {
  let raw: string | null

  try {
    raw = storage.getItem(weatherConfig.cacheKey)
  } catch {
    return createEmptyDocument()
  }

  if (raw === null) {
    return createEmptyDocument()
  }

  try {
    const parsed: unknown = JSON.parse(raw)
    if (
      !isRecord(parsed) ||
      parsed.version !== weatherConfig.cacheVersion ||
      parsed.provider !== weatherConfig.provider ||
      !Array.isArray(parsed.entries)
    ) {
      return createEmptyDocument()
    }

    return {
      version: 1,
      provider: 'open-meteo',
      savedAt:
        typeof parsed.savedAt === 'string'
          ? parsed.savedAt
          : new Date(0).toISOString(),
      entries: parsed.entries.filter(isValidEntry),
    }
  } catch {
    return createEmptyDocument()
  }
}

function createEmptyDocument(): WeatherCacheDocument {
  return {
    version: 1,
    provider: 'open-meteo',
    savedAt: new Date(0).toISOString(),
    entries: [],
  }
}

function getBrowserStorage(): WeatherStorage | null {
  try {
    return globalThis.localStorage
  } catch {
    return null
  }
}

export class WeatherCache {
  readonly storage: WeatherStorage | null

  constructor(storage: WeatherStorage | null = getBrowserStorage()) {
    this.storage = storage
  }

  get(request: WeatherRequest, now: Date): WeatherCacheLookup | null {
    if (this.storage === null) {
      return null
    }

    const entry = readDocument(this.storage).entries.find(
      ({ requestKey }) => requestKey === request.key,
    )

    if (
      entry === undefined ||
      entry.result.status === 'error' ||
      entry.locationIds.some(
        (id, index) => id !== request.locations[index]?.id,
      ) ||
      entry.locationIds.length !== request.locations.length
    ) {
      return null
    }

    const expiresAt = Date.parse(entry.expiresAt)
    const fetchedAt = Date.parse(entry.fetchedAt)
    const nowTime = now.getTime()
    const state =
      Number.isFinite(expiresAt) &&
      Number.isFinite(fetchedAt) &&
      fetchedAt <= nowTime &&
      nowTime < expiresAt
        ? 'fresh'
        : 'stale'

    return { state, entry }
  }

  put(
    request: WeatherRequest,
    result: WeatherForecastResult,
    now: Date,
  ): boolean {
    if (
      this.storage === null ||
      result.status === 'error' ||
      result.requestKey !== request.key ||
      !result.locations.some(({ status }) => status === 'success')
    ) {
      return false
    }

    const document = readDocument(this.storage)
    const entry: WeatherCacheEntry = {
      requestKey: request.key,
      dayId: request.dayId,
      tripDate: request.tripDate,
      fetchedAt: result.fetchedAt,
      expiresAt: new Date(
        Date.parse(result.fetchedAt) + weatherConfig.cacheFreshMs,
      ).toISOString(),
      datesCovered: result.datesCovered,
      locationIds: request.locations.map(({ id }) => id),
      requestParameters: {
        timezone: request.timezone,
        forecastDays: request.forecastDays,
        hourlyVariables: request.hourlyVariables,
        dailyVariables: request.dailyVariables,
        coordinates: request.locations.map(
          ({ id, latitude, longitude, elevationM }) => ({
            id,
            latitude,
            longitude,
            elevationM,
          }),
        ),
      },
      result,
    }
    let entries = [
      ...document.entries.filter(
        ({ requestKey }) => requestKey !== request.key,
      ),
      entry,
    ]
      .sort(
        (left, right) =>
          Date.parse(right.fetchedAt) - Date.parse(left.fetchedAt),
      )
      .slice(0, weatherConfig.cacheMaximumEntries)
    let serialized = ''

    while (entries.length > 0) {
      serialized = JSON.stringify({
        version: 1,
        provider: 'open-meteo',
        savedAt: now.toISOString(),
        entries,
      } satisfies WeatherCacheDocument)
      if (serialized.length <= weatherConfig.cacheMaximumCharacters) {
        break
      }
      entries = entries.slice(0, -1)
    }

    if (entries.length === 0 || serialized.length === 0) {
      return false
    }

    try {
      this.storage.setItem(weatherConfig.cacheKey, serialized)
      return true
    } catch {
      return false
    }
  }

  clear(): boolean {
    if (this.storage === null) {
      return false
    }

    try {
      this.storage.removeItem(weatherConfig.cacheKey)
      return true
    } catch {
      return false
    }
  }
}
