import type { RouteClockTime } from '../route/types.ts'
import type {
  RoadbookPointSubtype,
  RoadbookPointType,
} from '../trip/roadbook-types.ts'
import type { IsoDate } from '../trip/calendar.ts'

export type LocalIsoDateTime = `${IsoDate}T${string}`

/**
 * CDC Jalon C1: this whole module's `dayId` fields used to be typed as the
 * historical RGA `TripDayId` (`` `J${TripDayNumber}` `` from `trip/types.ts`)
 * — a hardcoded 12-day numbering scheme. Nothing in `src/weather/*` ever
 * actually depends on that literal shape (no code parses/validates the "J"
 * prefix or the specific number range — verified across
 * `cache.ts`/`coordinator.ts`/`alerts/*`/`documented-point-view-model.ts`);
 * it was only ever used as an opaque, stable per-day correlation key. Widened
 * to a plain `string` so the exact same types/provider/cache/coordinator/
 * alerts engine can serve both the historical RGA pipeline (which still only
 * ever passes `"J1"`..`"J12"` — still valid strings, so this is a
 * non-breaking widening) and the generic `TripBundle` pipeline (arbitrary
 * `TripDayId` from `trip-core`, e.g. `"day-alpha"`) — see
 * `src/weather/generic/` for the generic adapter layer built on top.
 */
export type WeatherDayKey = string

export type WeatherHourlyVariable =
  | 'temperature_2m'
  | 'apparent_temperature'
  | 'relative_humidity_2m'
  | 'precipitation_probability'
  | 'precipitation'
  | 'rain'
  | 'showers'
  | 'snowfall'
  | 'weather_code'
  | 'cloud_cover'
  | 'visibility'
  | 'wind_speed_10m'
  | 'wind_direction_10m'
  | 'wind_gusts_10m'
  | 'freezing_level_height'

export type WeatherDailyVariable =
  | 'temperature_2m_min'
  | 'temperature_2m_max'
  | 'apparent_temperature_min'
  | 'apparent_temperature_max'
  | 'precipitation_sum'
  | 'precipitation_probability_max'
  | 'weather_code'
  | 'wind_speed_10m_max'
  | 'wind_gusts_10m_max'
  | 'wind_direction_10m_dominant'
  | 'sunrise'
  | 'sunset'

export type WeatherAvailability =
  | 'loading'
  | 'available'
  | 'partial'
  | 'outside-horizon'
  | 'stale-cache'
  | 'unavailable'
  | 'error'

export type WeatherCacheState = 'miss' | 'fresh' | 'stale'
export type WeatherDataSource = 'network' | 'cache' | 'none'

export interface WeatherSampleReference {
  readonly pointId: string
  readonly name: string
  readonly type: RoadbookPointType
  readonly subtype?: RoadbookPointSubtype
  readonly trackDistanceKm: number
  readonly eta: RouteClockTime
}

export interface WeatherSamplePoint {
  readonly id: string
  readonly dayId: WeatherDayKey
  readonly dayType: 'ride' | 'off'
  readonly tripDate: IsoDate
  readonly name: string
  readonly type: RoadbookPointType | 'off-location'
  readonly latitude: number
  readonly longitude: number
  readonly elevationM: number
  readonly trackDistanceKm?: number
  readonly eta?: RouteClockTime
  readonly sourcePointIds: readonly string[]
  readonly references: readonly WeatherSampleReference[]
  readonly source: 'roadbook-matched' | 'roadbook-weather-reference' | 'adjacent-endpoint'
  readonly role?: 'route-point' | 'weather-reference'
  readonly contributesToDayRisk?: boolean
}

export interface WeatherRequestLocation {
  readonly id: string
  readonly name: string
  readonly latitude: number
  readonly longitude: number
  readonly elevationM: number
  readonly samplePointIds: readonly string[]
}

export interface WeatherDayDefinition {
  readonly dayId: WeatherDayKey
  readonly dayType: 'ride' | 'off'
  readonly tripDate: IsoDate
  readonly samplePoints: readonly WeatherSamplePoint[]
  readonly locations: readonly WeatherRequestLocation[]
  readonly requiredDates: readonly IsoDate[]
  readonly unavailableReason?: string
}

export interface WeatherRequest {
  readonly key: string
  readonly dayId: WeatherDayKey
  readonly tripDate: IsoDate
  readonly timezone: 'Europe/Paris'
  readonly locations: readonly WeatherRequestLocation[]
  readonly requiredDates: readonly IsoDate[]
  readonly forecastDays: 16
  readonly hourlyVariables: readonly WeatherHourlyVariable[]
  readonly dailyVariables: readonly WeatherDailyVariable[]
}

export interface NormalizedHourlyWeather {
  readonly time: LocalIsoDateTime
  readonly temperatureC: number | null
  readonly apparentTemperatureC: number | null
  readonly relativeHumidityPct: number | null
  readonly precipitationProbabilityPct: number | null
  readonly precipitationMm: number | null
  readonly rainMm: number | null
  readonly showersMm: number | null
  readonly snowfallCm: number | null
  readonly weatherCode: number | null
  readonly cloudCoverPct: number | null
  readonly visibilityM: number | null
  readonly windSpeedKph: number | null
  readonly windDirectionDeg: number | null
  readonly windGustsKph: number | null
  readonly freezingLevelM: number | null
}

export interface NormalizedDailyWeather {
  readonly date: IsoDate
  readonly temperatureMinC: number | null
  readonly temperatureMaxC: number | null
  readonly apparentTemperatureMinC: number | null
  readonly apparentTemperatureMaxC: number | null
  readonly precipitationSumMm: number | null
  readonly precipitationProbabilityMaxPct: number | null
  readonly weatherCode: number | null
  readonly windSpeedMaxKph: number | null
  readonly windGustsMaxKph: number | null
  readonly windDirectionDominantDeg: number | null
  readonly sunrise: LocalIsoDateTime | null
  readonly sunset: LocalIsoDateTime | null
}

export interface NormalizedLocationForecast {
  readonly status: 'success'
  readonly requestLocationId: string
  readonly requestedLatitude: number
  readonly requestedLongitude: number
  readonly requestedElevationM: number
  readonly providerLatitude: number
  readonly providerLongitude: number
  readonly providerElevationM: number | null
  readonly timezone: string
  readonly utcOffsetSeconds: number | null
  readonly hourly: readonly NormalizedHourlyWeather[]
  readonly daily: readonly NormalizedDailyWeather[]
  readonly missingVariables: readonly (
    | WeatherHourlyVariable
    | WeatherDailyVariable
  )[]
  readonly issues: readonly string[]
}

export interface NormalizedLocationForecastError {
  readonly status: 'error'
  readonly requestLocationId: string
  readonly message: string
}

export type WeatherLocationResult =
  | NormalizedLocationForecast
  | NormalizedLocationForecastError

export interface WeatherForecastResult {
  readonly provider: 'open-meteo'
  readonly requestKey: string
  readonly fetchedAt: string
  readonly status: 'success' | 'partial' | 'error'
  readonly locations: readonly WeatherLocationResult[]
  readonly datesCovered: readonly IsoDate[]
  readonly issues: readonly string[]
}

export interface WeatherProvider {
  readonly id: 'open-meteo'
  fetchForecast(
    request: WeatherRequest,
    signal?: AbortSignal,
  ): Promise<WeatherForecastResult>
}

export interface WaypointWeather {
  readonly samplePoint: WeatherSamplePoint
  readonly etaLocal: LocalIsoDateTime
  readonly forecastTimeLocal: LocalIsoDateTime | null
  readonly forecastOffsetMinutes: number | null
  readonly weather: NormalizedHourlyWeather | null
  readonly state: 'available' | 'unavailable'
  readonly reason?: string
  /** Forecasts reassociated to each stable documented roadbook point id. */
  readonly documentedForecasts?: readonly DocumentedPointForecast[]
}

export interface DocumentedPointForecast {
  readonly pointId: string
  readonly etaLocal: LocalIsoDateTime
  readonly forecastTimeLocal: LocalIsoDateTime | null
  readonly forecastOffsetMinutes: number | null
  readonly weather: NormalizedHourlyWeather | null
  readonly state: 'available' | 'unavailable'
  readonly reason?: string
}

export interface CurrentWaypointWeather {
  readonly samplePoint: WeatherSamplePoint
  readonly forecastTimeLocal: LocalIsoDateTime | null
  readonly forecastOffsetMinutes: number | null
  readonly weather: NormalizedHourlyWeather | null
  readonly state: 'available' | 'unavailable'
  readonly reason?: string
}

/**
 * A departure-time scenario before risk evaluation: shifted ETAs reassociated
 * against the day's already-fetched forecast (see
 * `weather/alerts/departure-scenarios.ts`). Declared here, rather than in the
 * alerts module, so `WeatherDayState` can reference it without an import
 * cycle back into `weather/alerts/`.
 */
export interface DepartureScenarioWaypoints {
  readonly offsetMinutes: number
  readonly isCurrent: boolean
  readonly isCoherent: boolean
  readonly incoherenceReason: string | null
  readonly departureTimeLocal: LocalIsoDateTime | null
  readonly arrivalTimeLocal: LocalIsoDateTime | null
  readonly waypoints: readonly WaypointWeather[]
  readonly coveredPointCount: number
  readonly missingPointCount: number
}

export interface RideWeatherSummary {
  readonly temperatureMinC: number | null
  readonly temperatureMaxC: number | null
  readonly apparentTemperatureMinC: number | null
  readonly apparentTemperatureMaxC: number | null
  readonly precipitationProbabilityMaxPct: number | null
  readonly hourlyPrecipitationMaxMm: number | null
  readonly windSpeedMaxKph: number | null
  readonly windGustsMaxKph: number | null
  readonly visibilityMinM: number | null
  readonly freezingLevelMinM: number | null
  readonly worstWeatherCode: number | null
  readonly coveredPointCount: number
  readonly missingPointCount: number
}

/**
 * Aggregated current-day conditions along a day's sample points, used only when
 * the trip date itself is outside the provider's real coverage (see
 * `weather/display-policy.ts`, mode `today-reference`). Never a stand-in forecast
 * for the trip date.
 */
export interface TodayReferenceWeather {
  readonly date: IsoDate
  readonly temperatureMinC: number | null
  readonly temperatureMaxC: number | null
  readonly precipitationSumMm: number | null
  readonly precipitationProbabilityMaxPct: number | null
  readonly windSpeedMaxKph: number | null
  readonly windGustsMaxKph: number | null
  readonly weatherCode: number | null
}

export interface RideDayWeather {
  readonly type: 'ride'
  readonly dayId: WeatherDayKey
  readonly tripDate: IsoDate
  readonly waypoints: readonly WaypointWeather[]
  readonly routeSummary: RideWeatherSummary
  readonly dailyByLocation: readonly {
    readonly samplePointId: string
    readonly weather: NormalizedDailyWeather | null
  }[]
  /** Current conditions, kept separate from the trip-date forecast. */
  readonly currentWaypoints?: readonly CurrentWaypointWeather[]
  readonly todayReference: TodayReferenceWeather | null
}

export interface OffDayWeather {
  readonly type: 'off'
  readonly dayId: WeatherDayKey
  readonly tripDate: IsoDate
  readonly samplePoint: WeatherSamplePoint
  readonly daily: NormalizedDailyWeather | null
  readonly hourly: readonly NormalizedHourlyWeather[]
  readonly localSummary: RideWeatherSummary
  readonly todayReference: TodayReferenceWeather | null
}

export type WeatherDayData = RideDayWeather | OffDayWeather

export interface WeatherDayState {
  readonly dayId: WeatherDayKey
  readonly dayType: 'ride' | 'off'
  readonly tripDate: IsoDate
  readonly availability: WeatherAvailability
  readonly cacheState: WeatherCacheState
  readonly source: WeatherDataSource
  readonly fetchedAt: string | null
  readonly receivedDates: readonly IsoDate[]
  readonly data: WeatherDayData | null
  readonly isRefreshing: boolean
  readonly message?: string
  /**
   * Weather-only departure-time scenarios (no risk yet — see
   * `weather/alerts/departure-scenarios.ts`), computed once per fetch from the
   * raw provider result. `null` for OFF days, and whenever `data` is `null`.
   */
  readonly departureScenarios: readonly DepartureScenarioWaypoints[] | null
}

export interface WeatherSnapshot {
  readonly selectedDayId: WeatherDayKey
  readonly states: ReadonlyMap<WeatherDayKey, WeatherDayState>
}
