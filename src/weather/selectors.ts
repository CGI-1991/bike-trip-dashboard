import {
  addIsoDays,
  differenceInIsoDays,
  getDateInTimezone,
} from '../trip/calendar.ts'
import type { IsoDate } from '../trip/calendar.ts'
import type { RouteClockTime } from '../route/types.ts'
import { weatherConfig } from './config.ts'
import { selectWorstWeatherCode } from './weather-code.ts'
import type {
  LocalIsoDateTime,
  NormalizedHourlyWeather,
  NormalizedLocationForecast,
  RideDayWeather,
  RideWeatherSummary,
  TodayReferenceWeather,
  WeatherDayData,
  WeatherDayDefinition,
  WeatherForecastResult,
  WeatherSamplePoint,
  WaypointWeather,
} from './types.ts'

const LOCAL_DATETIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/

function parseLocalDateTimeMinutes(value: LocalIsoDateTime): number {
  const match = LOCAL_DATETIME_PATTERN.exec(value)

  if (match === null) {
    throw new Error(`Date-heure locale invalide : ${value}`)
  }

  return (
    Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
    ) / 60_000
  )
}

function formatClockMinutes(clockMinutes: number): string {
  const hours = Math.floor(clockMinutes / 60)
  const minutes = clockMinutes % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

export function toEtaLocal(
  tripDate: IsoDate,
  eta: RouteClockTime,
): LocalIsoDateTime {
  if (
    !Number.isInteger(eta.dayOffset) ||
    eta.dayOffset < 0 ||
    !Number.isInteger(eta.clockMinutes) ||
    eta.clockMinutes < 0 ||
    eta.clockMinutes >= 1_440
  ) {
    throw new Error('ETA de point invalide.')
  }

  return `${addIsoDays(tripDate, eta.dayOffset)}T${formatClockMinutes(
    eta.clockMinutes,
  )}` as LocalIsoDateTime
}

export interface NearestHourlyForecast {
  readonly weather: NormalizedHourlyWeather
  readonly offsetMinutes: number
}

export function selectNearestHourlyForecast(
  hourly: readonly NormalizedHourlyWeather[],
  target: LocalIsoDateTime,
  maximumOffsetMinutes = weatherConfig.maxEtaForecastOffsetMinutes,
): NearestHourlyForecast | null {
  if (hourly.length === 0) {
    return null
  }

  const targetMinutes = parseLocalDateTimeMinutes(target)
  let low = 0
  let high = hourly.length

  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    const value = hourly[middle]
    if (
      value !== undefined &&
      parseLocalDateTimeMinutes(value.time) < targetMinutes
    ) {
      low = middle + 1
    } else {
      high = middle
    }
  }

  const candidates = [hourly[low - 1], hourly[low]].filter(
    (value): value is NormalizedHourlyWeather => value !== undefined,
  )
  const selected = candidates.sort((left, right) => {
    const leftOffset = parseLocalDateTimeMinutes(left.time) - targetMinutes
    const rightOffset = parseLocalDateTimeMinutes(right.time) - targetMinutes
    return (
      Math.abs(leftOffset) - Math.abs(rightOffset) ||
      leftOffset - rightOffset
    )
  })[0]

  if (selected === undefined) {
    return null
  }

  const offsetMinutes =
    parseLocalDateTimeMinutes(selected.time) - targetMinutes

  return Math.abs(offsetMinutes) <= maximumOffsetMinutes
    ? { weather: selected, offsetMinutes }
    : null
}

function minNullable(values: readonly (number | null)[]): number | null {
  const finiteValues = values.filter(
    (value): value is number => value !== null && Number.isFinite(value),
  )
  return finiteValues.length === 0 ? null : Math.min(...finiteValues)
}

function maxNullable(values: readonly (number | null)[]): number | null {
  const finiteValues = values.filter(
    (value): value is number => value !== null && Number.isFinite(value),
  )
  return finiteValues.length === 0 ? null : Math.max(...finiteValues)
}

export function summarizeHourlyWeather(
  weather: readonly NormalizedHourlyWeather[],
  coveredPointCount: number,
  missingPointCount: number,
): RideWeatherSummary {
  return {
    temperatureMinC: minNullable(weather.map(({ temperatureC }) => temperatureC)),
    temperatureMaxC: maxNullable(weather.map(({ temperatureC }) => temperatureC)),
    apparentTemperatureMinC: minNullable(
      weather.map(({ apparentTemperatureC }) => apparentTemperatureC),
    ),
    apparentTemperatureMaxC: maxNullable(
      weather.map(({ apparentTemperatureC }) => apparentTemperatureC),
    ),
    precipitationProbabilityMaxPct: maxNullable(
      weather.map(
        ({ precipitationProbabilityPct }) => precipitationProbabilityPct,
      ),
    ),
    hourlyPrecipitationMaxMm: maxNullable(
      weather.map(({ precipitationMm }) => precipitationMm),
    ),
    windSpeedMaxKph: maxNullable(weather.map(({ windSpeedKph }) => windSpeedKph)),
    windGustsMaxKph: maxNullable(weather.map(({ windGustsKph }) => windGustsKph)),
    visibilityMinM: minNullable(weather.map(({ visibilityM }) => visibilityM)),
    freezingLevelMinM: minNullable(
      weather.map(({ freezingLevelM }) => freezingLevelM),
    ),
    worstWeatherCode: selectWorstWeatherCode(
      weather.map(({ weatherCode }) => weatherCode),
    ),
    coveredPointCount,
    missingPointCount,
  }
}

export function extractTodayReference(
  result: WeatherForecastResult,
  today: IsoDate,
): TodayReferenceWeather | null {
  const entries = result.locations.flatMap((location) =>
    location.status === 'success'
      ? location.daily.filter(({ date }) => date === today)
      : [],
  )

  if (entries.length === 0) {
    return null
  }

  return {
    date: today,
    temperatureMinC: minNullable(entries.map(({ temperatureMinC }) => temperatureMinC)),
    temperatureMaxC: maxNullable(entries.map(({ temperatureMaxC }) => temperatureMaxC)),
    precipitationSumMm: maxNullable(
      entries.map(({ precipitationSumMm }) => precipitationSumMm),
    ),
    precipitationProbabilityMaxPct: maxNullable(
      entries.map(
        ({ precipitationProbabilityMaxPct }) => precipitationProbabilityMaxPct,
      ),
    ),
    windSpeedMaxKph: maxNullable(entries.map(({ windSpeedMaxKph }) => windSpeedMaxKph)),
    windGustsMaxKph: maxNullable(entries.map(({ windGustsMaxKph }) => windGustsMaxKph)),
    weatherCode: selectWorstWeatherCode(entries.map(({ weatherCode }) => weatherCode)),
  }
}

function getSuccessfulLocation(
  result: WeatherForecastResult,
  locationId: string,
): NormalizedLocationForecast | null {
  const location = result.locations.find(
    (candidate) => candidate.requestLocationId === locationId,
  )
  return location?.status === 'success' ? location : null
}

function createUnavailableWaypoint(
  samplePoint: WeatherSamplePoint,
  etaLocal: LocalIsoDateTime,
  reason: string,
): WaypointWeather {
  return {
    samplePoint,
    etaLocal,
    forecastTimeLocal: null,
    forecastOffsetMinutes: null,
    weather: null,
    state: 'unavailable',
    reason,
  }
}

function associateRideDay(
  definition: WeatherDayDefinition,
  result: WeatherForecastResult,
  today: IsoDate,
): RideDayWeather {
  const locationBySamplePointId = new Map(
    definition.locations.flatMap((location) =>
      location.samplePointIds.map((samplePointId) => [
        samplePointId,
        location.id,
      ]),
    ),
  )
  const waypoints = definition.samplePoints
    .map((samplePoint): WaypointWeather => {
      if (samplePoint.eta === undefined) {
        throw new Error(`ETA météo absente : ${samplePoint.id}`)
      }

      const etaLocal = toEtaLocal(definition.tripDate, samplePoint.eta)
      const locationId = locationBySamplePointId.get(samplePoint.id)
      if (locationId === undefined) {
        return createUnavailableWaypoint(
          samplePoint,
          etaLocal,
          'Localisation fournisseur absente.',
        )
      }

      const forecast = getSuccessfulLocation(result, locationId)
      if (forecast === null) {
        return createUnavailableWaypoint(
          samplePoint,
          etaLocal,
          'Prévision de localisation indisponible.',
        )
      }

      const nearest = selectNearestHourlyForecast(forecast.hourly, etaLocal)
      if (nearest === null) {
        return createUnavailableWaypoint(
          samplePoint,
          etaLocal,
          'Aucune heure prévisionnelle assez proche.',
        )
      }

      return {
        samplePoint,
        etaLocal,
        forecastTimeLocal: nearest.weather.time,
        forecastOffsetMinutes: nearest.offsetMinutes,
        weather: nearest.weather,
        state: 'available',
      }
    })
    .sort(
      (left, right) =>
        (left.samplePoint.trackDistanceKm ?? 0) -
          (right.samplePoint.trackDistanceKm ?? 0) ||
        left.samplePoint.id.localeCompare(right.samplePoint.id),
    )
  const availableWeather = waypoints.flatMap(({ weather }) =>
    weather === null ? [] : [weather],
  )
  const coveredPointCount = availableWeather.length
  const dailyByLocation = definition.samplePoints.map((samplePoint) => {
    const locationId = locationBySamplePointId.get(samplePoint.id)
    const forecast =
      locationId === undefined
        ? null
        : getSuccessfulLocation(result, locationId)
    return {
      samplePointId: samplePoint.id,
      weather:
        forecast?.daily.find(({ date }) => date === definition.tripDate) ??
        null,
    }
  })

  return {
    type: 'ride',
    dayId: definition.dayId,
    tripDate: definition.tripDate,
    waypoints,
    routeSummary: summarizeHourlyWeather(
      availableWeather,
      coveredPointCount,
      waypoints.length - coveredPointCount,
    ),
    dailyByLocation,
    todayReference: extractTodayReference(result, today),
  }
}

function associateOffDay(
  definition: WeatherDayDefinition,
  result: WeatherForecastResult,
  today: IsoDate,
): WeatherDayData {
  const samplePoint = definition.samplePoints[0]
  const location = definition.locations[0]

  if (samplePoint === undefined || location === undefined) {
    throw new Error(`Localisation OFF absente : ${definition.dayId}`)
  }

  const forecast = getSuccessfulLocation(result, location.id)
  const hourly =
    forecast?.hourly.filter(
      ({ time }) => time.slice(0, 10) === definition.tripDate,
    ) ?? []
  const daily =
    forecast?.daily.find(({ date }) => date === definition.tripDate) ?? null
  const hasLocalWeather = hourly.length > 0 || daily !== null

  return {
    type: 'off',
    dayId: definition.dayId,
    tripDate: definition.tripDate,
    samplePoint,
    daily,
    hourly,
    localSummary: summarizeHourlyWeather(
      hourly,
      hasLocalWeather ? 1 : 0,
      hasLocalWeather ? 0 : 1,
    ),
    todayReference: extractTodayReference(result, today),
  }
}

export function associateWeatherDay(
  definition: WeatherDayDefinition,
  result: WeatherForecastResult,
  today: IsoDate,
): WeatherDayData {
  return definition.dayType === 'ride'
    ? associateRideDay(definition, result, today)
    : associateOffDay(definition, result, today)
}

export function isWeatherDayDataComplete(data: WeatherDayData): boolean {
  if (data.type === 'ride') {
    return data.routeSummary.missingPointCount === 0
  }

  return data.daily !== null && data.hourly.length > 0
}

export interface ExpectedWeatherHorizon {
  readonly startDate: IsoDate
  readonly endDate: IsoDate
}

export function getExpectedWeatherHorizon(
  now: Date,
): ExpectedWeatherHorizon {
  const startDate = getDateInTimezone(now, weatherConfig.timezone)
  return {
    startDate,
    endDate: addIsoDays(startDate, weatherConfig.forecastDays - 1),
  }
}

export function isWithinExpectedWeatherHorizon(
  tripDate: IsoDate,
  now: Date,
): boolean {
  const { startDate } = getExpectedWeatherHorizon(now)
  const difference = differenceInIsoDays(tripDate, startDate)
  return difference >= 0 && difference < weatherConfig.forecastDays
}
