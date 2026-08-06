/**
 * Single generic per-day weather view-model (CDC Jalon C1 section 22) — the
 * one thing Aperçu/Voyage/Étape all read from, at whatever level of detail
 * each screen needs; none of them re-derives weather independently. Reuses
 * the already-generic risk/policy pieces directly: `display-policy.ts`
 * (`selectWeatherDisplayMode`), `alerts/evaluate-day.ts`
 * (`evaluateRideDayRisk`/`evaluateOffDayRisk`), `alerts/evaluate-point.ts`
 * (`evaluateHourlyRisk`, for each point's own risk level), `alerts/
 * exposure.ts` (`getWeatherExposureContext`), and `weather-code.ts` — never
 * a second, parallel risk/formatting model.
 */

import { evaluateOffDayRisk, evaluateRideDayRisk } from '../alerts/evaluate-day.ts'
import type { DayRiskContext } from '../alerts/evaluate-day.ts'
import { evaluateHourlyRisk } from '../alerts/evaluate-point.ts'
import { getWeatherExposureContext } from '../alerts/exposure.ts'
import { WEATHER_ALERT_THRESHOLDS } from '../alerts/thresholds.ts'
import type { WeatherAlert, WeatherRiskLevel } from '../alerts/types.ts'
import { weatherConfig } from '../config.ts'
import { getNowLocalDateTime, selectWeatherDisplayMode } from '../display-policy.ts'
import type { WeatherDisplayMode } from '../display-policy.ts'
import { getWeatherCodeLabel } from '../weather-code.ts'
import type {
  OffDayWeather,
  RideDayWeather,
  RideWeatherSummary,
  WaypointWeather,
  WeatherAvailability,
  WeatherDayState,
} from '../types.ts'
import type { RoadbookPointType } from '../../trip/roadbook-types.ts'
import type { IsoDate } from '../../trip/calendar.ts'

const ROLE_LABELS: Readonly<Record<RoadbookPointType | 'off-location', string>> = {
  start: 'Départ',
  end: 'Arrivée',
  col: 'Col',
  summit: 'Sommet',
  village: 'Ville',
  passage: 'Arrêt',
  resupply: 'Ravitaillement',
  pause: 'Pause',
  shelter: 'Abri',
  lodging: 'Hébergement',
  poi: 'Point d’intérêt',
  'off-location': 'Lieu',
}

export interface GenericWeatherPointViewModel {
  readonly id: string
  readonly name: string
  readonly role: string
  /** "HH:MM" wall-clock, or `null` when this point has no known ETA (should not happen for a resolvable ride point — defensive only). */
  readonly etaLabel: string | null
  readonly temperatureC: number | null
  readonly apparentTemperatureC: number | null
  readonly precipitationProbabilityPct: number | null
  readonly precipitationMm: number | null
  readonly windSpeedKph: number | null
  readonly windGustsKph: number | null
  readonly weatherCodeLabel: string | null
  readonly available: boolean
  readonly riskLevel: WeatherRiskLevel
  readonly riskReasons: readonly string[]
}

export interface GenericWeatherSummaryViewModel {
  readonly temperatureMinC: number | null
  readonly temperatureMaxC: number | null
  readonly precipitationProbabilityMaxPct: number | null
  readonly precipitationMaxMm: number | null
  readonly windSpeedMaxKph: number | null
  readonly windGustsMaxKph: number | null
  readonly worstWeatherLabel: string | null
}

export interface GenericDayWeatherViewModel {
  readonly dayId: string
  readonly dayType: 'ride' | 'off'
  readonly availability: WeatherAvailability
  readonly mode: WeatherDisplayMode | null
  readonly fetchedAt: string | null
  readonly isRefreshing: boolean
  readonly message: string | null
  readonly summary: GenericWeatherSummaryViewModel | null
  readonly points: readonly GenericWeatherPointViewModel[]
  readonly riskLevel: WeatherRiskLevel
  readonly alerts: readonly WeatherAlert[]
}

function formatEtaLabel(etaLocal: string): string {
  const match = /T(?<time>\d{2}:\d{2})/.exec(etaLocal)
  return match?.groups?.time ?? etaLocal
}

function toSummary(routeSummary: RideWeatherSummary): GenericWeatherSummaryViewModel {
  return {
    temperatureMinC: routeSummary.temperatureMinC,
    temperatureMaxC: routeSummary.temperatureMaxC,
    precipitationProbabilityMaxPct: routeSummary.precipitationProbabilityMaxPct,
    precipitationMaxMm: routeSummary.hourlyPrecipitationMaxMm,
    windSpeedMaxKph: routeSummary.windSpeedMaxKph,
    windGustsMaxKph: routeSummary.windGustsMaxKph,
    worstWeatherLabel: routeSummary.worstWeatherCode === null ? null : getWeatherCodeLabel(routeSummary.worstWeatherCode),
  }
}

function toPointViewModel(waypoint: WaypointWeather): GenericWeatherPointViewModel {
  const { samplePoint, weather } = waypoint
  const findings = weather === null ? [] : evaluateHourlyRisk(weather, samplePoint.elevationM, getWeatherExposureContext(samplePoint), WEATHER_ALERT_THRESHOLDS)
  const riskLevel: WeatherRiskLevel = weather === null
    ? 'unknown'
    : findings.some(({ level }) => level === 'red')
      ? 'red'
      : findings.some(({ level }) => level === 'orange')
        ? 'orange'
        : 'green'
  return {
    id: samplePoint.id,
    name: samplePoint.name,
    role: ROLE_LABELS[samplePoint.type],
    etaLabel: waypoint.etaLocal === undefined ? null : formatEtaLabel(waypoint.etaLocal),
    temperatureC: weather?.temperatureC ?? null,
    apparentTemperatureC: weather?.apparentTemperatureC ?? null,
    precipitationProbabilityPct: weather?.precipitationProbabilityPct ?? null,
    precipitationMm: weather?.precipitationMm ?? null,
    windSpeedKph: weather?.windSpeedKph ?? null,
    windGustsKph: weather?.windGustsKph ?? null,
    weatherCodeLabel: weather?.weatherCode === null || weather?.weatherCode === undefined ? null : getWeatherCodeLabel(weather.weatherCode),
    available: waypoint.state === 'available',
    riskLevel,
    riskReasons: [...new Set(findings.map(({ title }) => title))],
  }
}

function toRideViewModel(dayId: string, data: RideDayWeather, availability: WeatherAvailability, fetchedAt: string | null, isRefreshing: boolean, message: string | undefined, now: Date): GenericDayWeatherViewModel {
  const context: DayRiskContext = { fetchedAt, now, upcomingPointIds: null }
  const risk = evaluateRideDayRisk(dayId, data, context)
  return {
    dayId, dayType: 'ride', availability, mode: null, fetchedAt, isRefreshing, message: message ?? null,
    summary: toSummary(data.routeSummary),
    points: data.waypoints.map(toPointViewModel),
    riskLevel: risk.level,
    alerts: risk.alerts,
  }
}

function toOffViewModel(dayId: string, data: OffDayWeather, availability: WeatherAvailability, fetchedAt: string | null, isRefreshing: boolean, message: string | undefined, now: Date): GenericDayWeatherViewModel {
  const context: DayRiskContext = { fetchedAt, now, upcomingPointIds: null }
  const risk = evaluateOffDayRisk(dayId, data, context)
  const point: WaypointWeather = {
    samplePoint: data.samplePoint,
    etaLocal: `${data.tripDate}T12:00`,
    forecastTimeLocal: null,
    forecastOffsetMinutes: null,
    weather: data.hourly[Math.floor(data.hourly.length / 2)] ?? null,
    state: data.hourly.length > 0 ? 'available' : 'unavailable',
  }
  return {
    dayId, dayType: 'off', availability, mode: null, fetchedAt, isRefreshing, message: message ?? null,
    summary: toSummary(data.localSummary),
    points: [toPointViewModel(point)],
    riskLevel: risk.level,
    alerts: risk.alerts,
  }
}

/**
 * Builds the one view-model a `WeatherDayState` (real or virtual — see
 * `generic/sample-points.ts`'s transfer origin/destination keys) turns into,
 * for whichever real day it represents. `dayType` is passed explicitly
 * (rather than trusted from `state.dayType`, which is always `'ride'`/
 * `'off'` even for a transfer's virtual halves) so the caller decides how
 * this fits into the day's own screen.
 */
export function buildGenericDayWeatherViewModel(dayId: string, state: WeatherDayState | null, now: Date = new Date()): GenericDayWeatherViewModel | null {
  if (state === null) return null
  const today = getNowLocalDateTime(now, weatherConfig.timezone).slice(0, 10) as IsoDate
  const mode = selectWeatherDisplayMode({ today, tripDate: state.tripDate, coverage: null })

  if (state.data === null) {
    return {
      dayId, dayType: state.dayType, availability: state.availability, mode, fetchedAt: state.fetchedAt,
      isRefreshing: state.isRefreshing, message: state.message ?? null, summary: null, points: [], riskLevel: 'unknown', alerts: [],
    }
  }

  const base = state.data.type === 'ride'
    ? toRideViewModel(dayId, state.data, state.availability, state.fetchedAt, state.isRefreshing, state.message, now)
    : toOffViewModel(dayId, state.data, state.availability, state.fetchedAt, state.isRefreshing, state.message, now)
  return { ...base, mode }
}
