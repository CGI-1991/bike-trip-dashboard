import { weatherConfig } from './config.ts'
import {
  isAbortError,
  WeatherProviderError,
} from './provider.ts'
import type {
  LocalIsoDateTime,
  NormalizedDailyWeather,
  NormalizedHourlyWeather,
  NormalizedLocationForecast,
  WeatherDailyVariable,
  WeatherDayDefinition,
  WeatherForecastResult,
  WeatherHourlyVariable,
  WeatherLocationResult,
  WeatherProvider,
  WeatherRequest,
  WeatherRequestLocation,
} from './types.ts'
import type { IsoDate } from '../trip/calendar.ts'

export type WeatherFetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

type UnknownRecord = Record<string, unknown>

const LOCAL_DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

const HOURLY_FIELD_MAP = {
  temperature_2m: 'temperatureC',
  apparent_temperature: 'apparentTemperatureC',
  relative_humidity_2m: 'relativeHumidityPct',
  precipitation_probability: 'precipitationProbabilityPct',
  precipitation: 'precipitationMm',
  rain: 'rainMm',
  showers: 'showersMm',
  snowfall: 'snowfallCm',
  weather_code: 'weatherCode',
  cloud_cover: 'cloudCoverPct',
  visibility: 'visibilityM',
  wind_speed_10m: 'windSpeedKph',
  wind_direction_10m: 'windDirectionDeg',
  wind_gusts_10m: 'windGustsKph',
  freezing_level_height: 'freezingLevelM',
} as const satisfies Record<
  WeatherHourlyVariable,
  Exclude<keyof NormalizedHourlyWeather, 'time'>
>

const DAILY_FIELD_MAP = {
  temperature_2m_min: 'temperatureMinC',
  temperature_2m_max: 'temperatureMaxC',
  apparent_temperature_min: 'apparentTemperatureMinC',
  apparent_temperature_max: 'apparentTemperatureMaxC',
  precipitation_sum: 'precipitationSumMm',
  precipitation_probability_max: 'precipitationProbabilityMaxPct',
  weather_code: 'weatherCode',
  wind_speed_10m_max: 'windSpeedMaxKph',
  wind_gusts_10m_max: 'windGustsMaxKph',
  wind_direction_10m_dominant: 'windDirectionDominantDeg',
  sunrise: 'sunrise',
  sunset: 'sunset',
} as const satisfies Record<
  WeatherDailyVariable,
  Exclude<keyof NormalizedDailyWeather, 'date'>
>

const EXPECTED_HOURLY_UNITS = new Map<WeatherHourlyVariable, string>([
  ['temperature_2m', '°c'],
  ['apparent_temperature', '°c'],
  ['relative_humidity_2m', '%'],
  ['precipitation_probability', '%'],
  ['precipitation', 'mm'],
  ['rain', 'mm'],
  ['showers', 'mm'],
  ['snowfall', 'cm'],
  ['weather_code', 'wmo code'],
  ['cloud_cover', '%'],
  ['visibility', 'm'],
  ['wind_speed_10m', 'km/h'],
  ['wind_direction_10m', '°'],
  ['wind_gusts_10m', 'km/h'],
  ['freezing_level_height', 'm'],
])

const EXPECTED_DAILY_UNITS = new Map<WeatherDailyVariable, string>([
  ['temperature_2m_min', '°c'],
  ['temperature_2m_max', '°c'],
  ['apparent_temperature_min', '°c'],
  ['apparent_temperature_max', '°c'],
  ['precipitation_sum', 'mm'],
  ['precipitation_probability_max', '%'],
  ['weather_code', 'wmo code'],
  ['wind_speed_10m_max', 'km/h'],
  ['wind_gusts_10m_max', 'km/h'],
  ['wind_direction_10m_dominant', '°'],
  ['sunrise', 'iso8601'],
  ['sunset', 'iso8601'],
])

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function assertLocation(location: WeatherRequestLocation): void {
  if (
    !Number.isFinite(location.latitude) ||
    location.latitude < -90 ||
    location.latitude > 90 ||
    !Number.isFinite(location.longitude) ||
    location.longitude < -180 ||
    location.longitude > 180 ||
    !Number.isFinite(location.elevationM)
  ) {
    throw new WeatherProviderError(
      'invalid-response',
      `Coordonnées météo invalides : ${location.id}.`,
    )
  }
}

export function createWeatherRequest(
  definition: WeatherDayDefinition,
): WeatherRequest {
  const fingerprint = JSON.stringify({
    version: weatherConfig.cacheVersion,
    provider: weatherConfig.provider,
    dayId: definition.dayId,
    tripDate: definition.tripDate,
    timezone: weatherConfig.timezone,
    forecastDays: weatherConfig.forecastDays,
    requiredDates: definition.requiredDates,
    coordinates: definition.locations.map(
      ({ id, latitude, longitude, elevationM }) => ({
        id,
        latitude,
        longitude,
        elevationM,
      }),
    ),
    hourly: weatherConfig.hourlyVariables,
    daily: weatherConfig.dailyVariables,
    units: {
      temperature: weatherConfig.temperatureUnit,
      windSpeed: weatherConfig.windSpeedUnit,
      precipitation: weatherConfig.precipitationUnit,
      timeformat: weatherConfig.timeformat,
    },
  })

  return {
    key: fingerprint,
    dayId: definition.dayId,
    tripDate: definition.tripDate,
    timezone: weatherConfig.timezone,
    locations: definition.locations,
    requiredDates: definition.requiredDates,
    forecastDays: weatherConfig.forecastDays,
    hourlyVariables: weatherConfig.hourlyVariables,
    dailyVariables: weatherConfig.dailyVariables,
  }
}

export function buildOpenMeteoUrl(request: WeatherRequest): string {
  if (
    request.locations.length === 0 ||
    request.locations.length > weatherConfig.maxLocationsPerRequest
  ) {
    throw new WeatherProviderError(
      'invalid-response',
      `Nombre de coordonnées météo invalide : ${request.locations.length}.`,
    )
  }

  request.locations.forEach(assertLocation)
  const parameters = new URLSearchParams({
    latitude: request.locations.map(({ latitude }) => latitude).join(','),
    longitude: request.locations.map(({ longitude }) => longitude).join(','),
    elevation: request.locations.map(({ elevationM }) => elevationM).join(','),
    timezone: request.timezone,
    forecast_days: String(request.forecastDays),
    temperature_unit: weatherConfig.temperatureUnit,
    wind_speed_unit: weatherConfig.windSpeedUnit,
    precipitation_unit: weatherConfig.precipitationUnit,
    timeformat: weatherConfig.timeformat,
    hourly: request.hourlyVariables.join(','),
    daily: request.dailyVariables.join(','),
  })

  return `${weatherConfig.endpoint}?${parameters.toString()}`
}

function readTimeAxis(
  container: UnknownRecord,
  property: 'hourly' | 'daily',
): readonly string[] {
  const value = container[property]

  if (!isRecord(value) || !Array.isArray(value.time)) {
    throw new Error(`Axe ${property}.time absent.`)
  }

  const pattern = property === 'hourly' ? LOCAL_DATETIME_PATTERN : ISO_DATE_PATTERN
  const times = value.time

  if (
    times.length === 0 ||
    times.some((time) => typeof time !== 'string' || !pattern.test(time))
  ) {
    throw new Error(`Axe ${property}.time invalide.`)
  }

  for (let index = 1; index < times.length; index += 1) {
    if ((times[index - 1] as string) >= (times[index] as string)) {
      throw new Error(`Axe ${property}.time non strictement croissant.`)
    }
  }

  return times as readonly string[]
}

function validateUnit(
  variable: WeatherHourlyVariable | WeatherDailyVariable,
  units: UnknownRecord | null,
  expectedUnits:
    | ReadonlyMap<WeatherHourlyVariable, string>
    | ReadonlyMap<WeatherDailyVariable, string>,
  issues: string[],
): boolean {
  const actual = units?.[variable]
  const expected = (
    expectedUnits as ReadonlyMap<
      WeatherHourlyVariable | WeatherDailyVariable,
      string
    >
  ).get(variable)

  if (
    typeof actual !== 'string' ||
    expected === undefined ||
    actual.toLocaleLowerCase('en-US') !== expected
  ) {
    issues.push(`Unité ${variable} absente ou inattendue.`)
    return false
  }

  return true
}

function readNumericColumn(
  container: UnknownRecord,
  units: UnknownRecord | null,
  variable: WeatherHourlyVariable | WeatherDailyVariable,
  expectedLength: number,
  expectedUnits:
    | ReadonlyMap<WeatherHourlyVariable, string>
    | ReadonlyMap<WeatherDailyVariable, string>,
  missingVariables: (WeatherHourlyVariable | WeatherDailyVariable)[],
  issues: string[],
): readonly (number | null)[] {
  const raw = container[variable]
  const unitIsValid = validateUnit(variable, units, expectedUnits, issues)

  if (!Array.isArray(raw) || raw.length !== expectedLength || !unitIsValid) {
    missingVariables.push(variable)
    issues.push(`Colonne ${variable} absente ou de longueur incohérente.`)
    return Array.from({ length: expectedLength }, () => null)
  }

  let invalidValue = false
  const values = raw.map((value) => {
    if (value === null) {
      return null
    }

    const number = readFiniteNumber(value)
    if (number === null) {
      invalidValue = true
    }
    return number
  })

  if (invalidValue) {
    issues.push(`Colonne ${variable} contenant une valeur invalide.`)
  }

  return values
}

function readStringColumn(
  container: UnknownRecord,
  units: UnknownRecord | null,
  variable: Extract<WeatherDailyVariable, 'sunrise' | 'sunset'>,
  expectedLength: number,
  missingVariables: (WeatherHourlyVariable | WeatherDailyVariable)[],
  issues: string[],
): readonly (LocalIsoDateTime | null)[] {
  const raw = container[variable]
  const unitIsValid = validateUnit(
    variable,
    units,
    EXPECTED_DAILY_UNITS,
    issues,
  )

  if (!Array.isArray(raw) || raw.length !== expectedLength || !unitIsValid) {
    missingVariables.push(variable)
    issues.push(`Colonne ${variable} absente ou de longueur incohérente.`)
    return Array.from({ length: expectedLength }, () => null)
  }

  return raw.map((value) =>
    typeof value === 'string' && LOCAL_DATETIME_PATTERN.test(value)
      ? (value as LocalIsoDateTime)
      : null,
  )
}

function normalizeHourly(
  value: UnknownRecord,
  requiredDates: ReadonlySet<IsoDate>,
  missingVariables: (WeatherHourlyVariable | WeatherDailyVariable)[],
  issues: string[],
): readonly NormalizedHourlyWeather[] {
  const times = readTimeAxis(value, 'hourly') as readonly LocalIsoDateTime[]
  const container = value.hourly as UnknownRecord
  const units = isRecord(value.hourly_units) ? value.hourly_units : null
  const columns = Object.fromEntries(
    weatherConfig.hourlyVariables.map((variable) => [
      variable,
      readNumericColumn(
        container,
        units,
        variable,
        times.length,
        EXPECTED_HOURLY_UNITS,
        missingVariables,
        issues,
      ),
    ]),
  ) as Record<WeatherHourlyVariable, readonly (number | null)[]>

  return times.flatMap((time, index): NormalizedHourlyWeather[] => {
    if (!requiredDates.has(time.slice(0, 10) as IsoDate)) {
      return []
    }

    const entry: Record<string, unknown> = { time }
    for (const variable of weatherConfig.hourlyVariables) {
      entry[HOURLY_FIELD_MAP[variable]] = columns[variable][index] ?? null
    }
    return [entry as unknown as NormalizedHourlyWeather]
  })
}

function normalizeDaily(
  value: UnknownRecord,
  requiredDates: ReadonlySet<IsoDate>,
  missingVariables: (WeatherHourlyVariable | WeatherDailyVariable)[],
  issues: string[],
): readonly NormalizedDailyWeather[] {
  let times: readonly IsoDate[]

  try {
    times = readTimeAxis(value, 'daily') as readonly IsoDate[]
  } catch (error) {
    missingVariables.push(...weatherConfig.dailyVariables)
    issues.push(error instanceof Error ? error.message : 'Axe daily invalide.')
    return []
  }

  const container = value.daily as UnknownRecord
  const units = isRecord(value.daily_units) ? value.daily_units : null
  const numericVariables = weatherConfig.dailyVariables.filter(
    (
      variable,
    ): variable is Exclude<WeatherDailyVariable, 'sunrise' | 'sunset'> =>
      variable !== 'sunrise' && variable !== 'sunset',
  )
  const numericColumns = Object.fromEntries(
    numericVariables.map((variable) => [
      variable,
      readNumericColumn(
        container,
        units,
        variable,
        times.length,
        EXPECTED_DAILY_UNITS,
        missingVariables,
        issues,
      ),
    ]),
  ) as Record<
    Exclude<WeatherDailyVariable, 'sunrise' | 'sunset'>,
    readonly (number | null)[]
  >
  const sunrise = readStringColumn(
    container,
    units,
    'sunrise',
    times.length,
    missingVariables,
    issues,
  )
  const sunset = readStringColumn(
    container,
    units,
    'sunset',
    times.length,
    missingVariables,
    issues,
  )

  return times.flatMap((date, index): NormalizedDailyWeather[] => {
    if (!requiredDates.has(date)) {
      return []
    }

    const entry: Record<string, unknown> = {
      date,
      sunrise: sunrise[index] ?? null,
      sunset: sunset[index] ?? null,
    }
    for (const variable of numericVariables) {
      entry[DAILY_FIELD_MAP[variable]] = numericColumns[variable][index] ?? null
    }
    return [entry as unknown as NormalizedDailyWeather]
  })
}

function normalizeLocation(
  raw: unknown,
  location: WeatherRequestLocation,
  request: WeatherRequest,
): WeatherLocationResult {
  if (!isRecord(raw)) {
    return {
      status: 'error',
      requestLocationId: location.id,
      message: 'Réponse de localisation absente ou invalide.',
    }
  }

  if (raw.error === true) {
    return {
      status: 'error',
      requestLocationId: location.id,
      message:
        typeof raw.reason === 'string'
          ? raw.reason
          : 'Erreur Open-Meteo non détaillée.',
    }
  }

  const providerLatitude = readFiniteNumber(raw.latitude)
  const providerLongitude = readFiniteNumber(raw.longitude)
  const timezone = typeof raw.timezone === 'string' ? raw.timezone : null

  if (
    providerLatitude === null ||
    providerLongitude === null ||
    timezone === null
  ) {
    return {
      status: 'error',
      requestLocationId: location.id,
      message: 'Métadonnées Open-Meteo incomplètes.',
    }
  }

  const issues: string[] = []
  if (timezone !== request.timezone) {
    issues.push(
      `Fuseau reçu ${timezone}, fuseau demandé ${request.timezone}.`,
    )
  }

  const missingVariables: (
    | WeatherHourlyVariable
    | WeatherDailyVariable
  )[] = []
  const requiredDates = new Set(request.requiredDates)
  let hourly: readonly NormalizedHourlyWeather[]

  try {
    hourly = normalizeHourly(
      raw,
      requiredDates,
      missingVariables,
      issues,
    )
  } catch (error) {
    return {
      status: 'error',
      requestLocationId: location.id,
      message:
        error instanceof Error
          ? error.message
          : 'Série horaire Open-Meteo invalide.',
    }
  }

  const daily = normalizeDaily(raw, requiredDates, missingVariables, issues)

  return {
    status: 'success',
    requestLocationId: location.id,
    requestedLatitude: location.latitude,
    requestedLongitude: location.longitude,
    requestedElevationM: location.elevationM,
    providerLatitude,
    providerLongitude,
    providerElevationM: readFiniteNumber(raw.elevation),
    timezone,
    utcOffsetSeconds: readFiniteNumber(raw.utc_offset_seconds),
    hourly,
    daily,
    missingVariables: [...new Set(missingVariables)],
    issues,
  } satisfies NormalizedLocationForecast
}

function alignRawLocations(
  raw: unknown,
  request: WeatherRequest,
): readonly unknown[] {
  if (request.locations.length === 1) {
    if (!isRecord(raw)) {
      throw new WeatherProviderError(
        'invalid-response',
        'La réponse mono-localisation Open-Meteo doit être un objet.',
      )
    }
    return [raw]
  }

  if (!Array.isArray(raw)) {
    throw new WeatherProviderError(
      'invalid-response',
      'La réponse multi-localisations Open-Meteo doit être un tableau.',
    )
  }

  const aligned: unknown[] = Array.from(
    { length: request.locations.length },
    () => undefined,
  )
  const usedIndexes = new Set<number>()

  for (let rawIndex = 0; rawIndex < raw.length; rawIndex += 1) {
    const item = raw[rawIndex]
    const locationId =
      isRecord(item) &&
      Number.isInteger(item.location_id) &&
      (item.location_id as number) >= 0 &&
      (item.location_id as number) < request.locations.length
        ? (item.location_id as number)
        : rawIndex

    if (
      locationId < request.locations.length &&
      !usedIndexes.has(locationId)
    ) {
      aligned[locationId] = item
      usedIndexes.add(locationId)
    }
  }

  return aligned
}

function extractReceivedDates(raw: unknown): readonly IsoDate[] {
  if (!isRecord(raw)) {
    return []
  }

  const hourlyTimes =
    isRecord(raw.hourly) && Array.isArray(raw.hourly.time)
      ? raw.hourly.time
      : []
  const dailyTimes =
    isRecord(raw.daily) && Array.isArray(raw.daily.time)
      ? raw.daily.time
      : []

  return [
    ...hourlyTimes.flatMap((value): IsoDate[] =>
      typeof value === 'string' && LOCAL_DATETIME_PATTERN.test(value)
        ? [value.slice(0, 10) as IsoDate]
        : [],
    ),
    ...dailyTimes.flatMap((value): IsoDate[] =>
      typeof value === 'string' && ISO_DATE_PATTERN.test(value)
        ? [value as IsoDate]
        : [],
    ),
  ]
}

export function normalizeOpenMeteoResponse(
  raw: unknown,
  request: WeatherRequest,
  fetchedAt: string,
): WeatherForecastResult {
  const rawLocations = alignRawLocations(raw, request)
  const locations = request.locations.map((location, index) =>
    normalizeLocation(rawLocations[index], location, request),
  )
  const successful = locations.filter(
    (location): location is NormalizedLocationForecast =>
      location.status === 'success',
  )
  const issueCount = successful.reduce(
    (total, location) =>
      total + location.issues.length + location.missingVariables.length,
    0,
  )
  const datesCovered = [
    ...new Set(rawLocations.flatMap(extractReceivedDates)),
  ].sort()
  const status =
    successful.length === 0
      ? 'error'
      : successful.length === locations.length && issueCount === 0
        ? 'success'
        : 'partial'
  const issues = locations.flatMap((location) =>
    location.status === 'error'
      ? [`${location.requestLocationId}: ${location.message}`]
      : location.issues.map(
          (issue) => `${location.requestLocationId}: ${issue}`,
        ),
  )

  return {
    provider: 'open-meteo',
    requestKey: request.key,
    fetchedAt,
    status,
    locations,
    datesCovered,
    issues,
  }
}

export function createOpenMeteoProvider(
  fetchImplementation: WeatherFetchImplementation =
    globalThis.fetch.bind(globalThis),
  now: () => Date = () => new Date(),
): WeatherProvider {
  return {
    id: 'open-meteo',
    async fetchForecast(
      request: WeatherRequest,
      signal?: AbortSignal,
    ): Promise<WeatherForecastResult> {
      const url = buildOpenMeteoUrl(request)
      let response: Response

      try {
        response = await fetchImplementation(url, { signal })
      } catch (error) {
        if (isAbortError(error)) {
          throw new WeatherProviderError(
            'aborted',
            'Requête météo annulée.',
            { cause: error },
          )
        }
        throw new WeatherProviderError(
          'network',
          'Service Open-Meteo inaccessible.',
          { cause: error },
        )
      }

      if (!response.ok) {
        throw new WeatherProviderError(
          'http',
          `Open-Meteo a répondu HTTP ${response.status}.`,
          { status: response.status },
        )
      }

      let raw: unknown
      try {
        raw = await response.json()
      } catch (error) {
        throw new WeatherProviderError(
          'invalid-json',
          'Réponse JSON Open-Meteo illisible.',
          { cause: error },
        )
      }

      try {
        return normalizeOpenMeteoResponse(
          raw,
          request,
          now().toISOString(),
        )
      } catch (error) {
        if (error instanceof WeatherProviderError) {
          throw error
        }
        throw new WeatherProviderError(
          'invalid-response',
          'Structure de réponse Open-Meteo invalide.',
          { cause: error },
        )
      }
    },
  }
}
