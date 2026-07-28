import { addIsoDays } from '../../trip/calendar.ts'
import type { IsoDate } from '../../trip/calendar.ts'
import type { TripDayId } from '../../trip/types.ts'
import type { RouteClockTime } from '../../route/types.ts'
import {
  getSuccessfulLocationForecast,
  selectNearestHourlyForecast,
  summarizeHourlyWeather,
} from '../selectors.ts'
import type {
  DepartureScenarioWaypoints,
  LocalIsoDateTime,
  WaypointWeather,
  WeatherDayDefinition,
  WeatherForecastResult,
  WeatherSamplePoint,
} from '../types.ts'
import type { DayRiskContext } from './evaluate-day.ts'
import { evaluateRideDayRisk } from './evaluate-day.ts'
import { getWeatherExposureContext } from './exposure.ts'
import { DEPARTURE_SCENARIO_OFFSETS_MINUTES } from './thresholds.ts'
import type { DepartureWeatherScenario } from './types.ts'

export { DEPARTURE_SCENARIO_OFFSETS_MINUTES }
export type { DepartureScenarioWaypoints }

const MINUTES_PER_DAY = 1_440
const INCOHERENCE_REASON =
  'Ce décalage ferait partir avant le début de la journée : scénario écarté des comparaisons et des recommandations.'

/**
 * Shifts an ETA by a departure-time offset. Elapsed time from departure is
 * speed/pause-invariant, so shifting the configured departure time by N
 * minutes shifts every waypoint's absolute clock time by exactly N minutes —
 * no need to re-run the route engine per scenario, and no new Open-Meteo call
 * either (see `shiftWaypoint`, which reassociates against the forecast already
 * fetched for the real departure time).
 */
export function shiftClockTime(eta: RouteClockTime, offsetMinutes: number): RouteClockTime {
  const absoluteMinutes = eta.dayOffset * MINUTES_PER_DAY + eta.clockMinutes + offsetMinutes
  return {
    totalMinutesFromDeparture: eta.totalMinutesFromDeparture,
    clockMinutes: ((absoluteMinutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY,
    dayOffset: Math.floor(absoluteMinutes / MINUTES_PER_DAY),
  }
}

function getAbsoluteMinutes(eta: RouteClockTime): number {
  return eta.dayOffset * MINUTES_PER_DAY + eta.clockMinutes
}

function formatShiftedLocal(
  tripDate: WeatherSamplePoint['tripDate'],
  shifted: RouteClockTime,
): LocalIsoDateTime {
  const hours = Math.floor(shifted.clockMinutes / 60)
  const minutes = shifted.clockMinutes % 60
  const clock = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
  return `${addIsoDays(tripDate, shifted.dayOffset)}T${clock}` as LocalIsoDateTime
}

function shiftWaypoint(
  samplePoint: WeatherSamplePoint,
  result: WeatherForecastResult,
  locationIdBySamplePointId: ReadonlyMap<string, string>,
  offsetMinutes: number,
): WaypointWeather {
  if (samplePoint.eta === undefined) {
    throw new Error(`ETA météo absente : ${samplePoint.id}`)
  }

  const shiftedEta = shiftClockTime(samplePoint.eta, offsetMinutes)
  const etaLocal = formatShiftedLocal(samplePoint.tripDate, shiftedEta)

  const locationId = locationIdBySamplePointId.get(samplePoint.id)
  const forecast = locationId === undefined ? null : getSuccessfulLocationForecast(result, locationId)

  if (forecast === null) {
    return {
      samplePoint,
      etaLocal,
      forecastTimeLocal: null,
      forecastOffsetMinutes: null,
      weather: null,
      state: 'unavailable',
      reason: 'Prévision de localisation indisponible.',
    }
  }

  const nearest = selectNearestHourlyForecast(forecast.hourly, etaLocal)

  if (nearest === null) {
    return {
      samplePoint,
      etaLocal,
      forecastTimeLocal: null,
      forecastOffsetMinutes: null,
      weather: null,
      state: 'unavailable',
      reason: 'Aucune heure prévisionnelle assez proche de cet horaire décalé.',
    }
  }

  return {
    samplePoint,
    etaLocal,
    forecastTimeLocal: nearest.weather.time,
    forecastOffsetMinutes: nearest.offsetMinutes,
    weather: nearest.weather,
    state: 'available',
  }
}

function computeScenario(
  definition: WeatherDayDefinition,
  result: WeatherForecastResult,
  locationIdBySamplePointId: ReadonlyMap<string, string>,
  offsetMinutes: number,
): DepartureScenarioWaypoints {
  const minimumAbsoluteMinutes = Math.min(
    ...definition.samplePoints.map((point) =>
      point.eta === undefined ? Number.POSITIVE_INFINITY : getAbsoluteMinutes(point.eta),
    ),
  )
  const isCoherent = !Number.isFinite(minimumAbsoluteMinutes) || minimumAbsoluteMinutes + offsetMinutes >= 0
  const waypoints = definition.samplePoints
    .map((samplePoint) => shiftWaypoint(samplePoint, result, locationIdBySamplePointId, offsetMinutes))
    .sort(
      (left, right) =>
        (left.samplePoint.trackDistanceKm ?? 0) - (right.samplePoint.trackDistanceKm ?? 0) ||
        left.samplePoint.id.localeCompare(right.samplePoint.id),
    )
  const coveredPointCount = waypoints.filter(({ state }) => state === 'available').length
  const startWaypoint = waypoints.find(({ samplePoint }) => samplePoint.type === 'start')
  const endWaypoint = waypoints.find(({ samplePoint }) => samplePoint.type === 'end')

  return {
    offsetMinutes,
    isCurrent: offsetMinutes === 0,
    isCoherent,
    incoherenceReason: isCoherent ? null : INCOHERENCE_REASON,
    departureTimeLocal: startWaypoint?.etaLocal ?? null,
    arrivalTimeLocal: endWaypoint?.etaLocal ?? null,
    waypoints,
    coveredPointCount,
    missingPointCount: waypoints.length - coveredPointCount,
  }
}

/**
 * Computes N departure-time scenarios from a single already-fetched forecast
 * result, by shifting each sample point's ETA and reassociating it against the
 * same per-location hourly series used for the real departure time. Returns
 * `[]` for OFF days and for ride days with no active sample points — there is
 * no cyclist departure to compare there (Phase D, section K).
 */
export function computeDepartureScenarios(
  definition: WeatherDayDefinition,
  result: WeatherForecastResult,
  offsets: readonly number[] = DEPARTURE_SCENARIO_OFFSETS_MINUTES,
): readonly DepartureScenarioWaypoints[] {
  if (definition.dayType !== 'ride' || definition.samplePoints.length === 0) {
    return []
  }

  const locationIdBySamplePointId = new Map(
    definition.locations.flatMap((location) =>
      location.samplePointIds.map((samplePointId) => [samplePointId, location.id]),
    ),
  )

  return offsets.map((offsetMinutes) =>
    computeScenario(definition, result, locationIdBySamplePointId, offsetMinutes),
  )
}

function computeMinimumExposedApparentTemperatureC(
  waypoints: readonly WaypointWeather[],
): number | null {
  const values = waypoints
    .filter(({ samplePoint }) => getWeatherExposureContext(samplePoint).isExposed)
    .map(({ weather }) => weather?.apparentTemperatureC ?? null)
    .filter((value): value is number => value !== null)

  return values.length === 0 ? null : Math.min(...values)
}

/**
 * Turns the weather-only scenarios from `computeDepartureScenarios` into the
 * full, risk-aware `DepartureWeatherScenario` shape by evaluating alerts for
 * each one — kept as a separate step because risk evaluation depends on `now`
 * (staleness, live-mode "upcoming" split), while the scenarios themselves do
 * not and can be cached on `WeatherDayState` from fetch time.
 */
export function attachRiskToScenarios(
  dayId: TripDayId,
  tripDate: IsoDate,
  scenarios: readonly DepartureScenarioWaypoints[],
  context: DayRiskContext,
): readonly DepartureWeatherScenario[] {
  return scenarios.map((scenario): DepartureWeatherScenario => {
    const routeSummary = summarizeHourlyWeather(
      scenario.waypoints.flatMap(({ weather }) => (weather === null ? [] : [weather])),
      scenario.coveredPointCount,
      scenario.missingPointCount,
    )
    const risk = evaluateRideDayRisk(
      dayId,
      {
        type: 'ride',
        dayId,
        tripDate,
        waypoints: scenario.waypoints,
        routeSummary,
        dailyByLocation: [],
        todayReference: null,
      },
      context,
    )

    return {
      offsetMinutes: scenario.offsetMinutes,
      isCurrent: scenario.isCurrent,
      isCoherent: scenario.isCoherent,
      incoherenceReason: scenario.incoherenceReason,
      departureTimeLocal: scenario.departureTimeLocal,
      arrivalTimeLocal: scenario.arrivalTimeLocal,
      coveredPointCount: scenario.coveredPointCount,
      missingPointCount: scenario.missingPointCount,
      maximumRainMm: routeSummary.hourlyPrecipitationMaxMm,
      maximumGustKph: routeSummary.windGustsMaxKph,
      minimumApparentTemperatureC: routeSummary.apparentTemperatureMinC,
      minimumExposedApparentTemperatureC: computeMinimumExposedApparentTemperatureC(
        scenario.waypoints,
      ),
      minimumVisibilityM: routeSummary.visibilityMinM,
      risk,
    }
  })
}
