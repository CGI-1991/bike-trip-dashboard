import type { RouteClockTime } from '../route/types.ts'
import type { RoadbookPointMatch } from '../trip/roadbook-match.ts'
import type { TripDayId } from '../trip/types.ts'
import { evaluateHourlyRisk } from './alerts/evaluate-point.ts'
import { getWeatherExposureContext } from './alerts/exposure.ts'
import type { WeatherRiskLevel } from './alerts/types.ts'
import {
  getCoverageFromDates,
  selectWeatherDisplayMode,
} from './display-policy.ts'
import type { WeatherDisplayMode } from './display-policy.ts'
import type {
  CurrentWaypointWeather,
  DocumentedPointForecast,
  LocalIsoDateTime,
  NormalizedHourlyWeather,
  WeatherDayState,
  WeatherSamplePoint,
} from './types.ts'

export type DocumentedPointWeatherStatus =
  | 'available'
  | 'unavailable'
  | 'eta-unavailable'

export interface DocumentedPointWeatherViewModel {
  readonly pointId: string
  readonly dayId: TripDayId
  readonly forecastMode: WeatherDisplayMode
  readonly forecastStatus: DocumentedPointWeatherStatus
  readonly eta: RouteClockTime | null
  readonly forecastTime: LocalIsoDateTime | null
  readonly temperatureC: number | null
  readonly apparentTemperatureC: number | null
  readonly precipitationProbabilityPercent: number | null
  readonly precipitationMm: number | null
  readonly windSpeedKph: number | null
  readonly windGustKph: number | null
  readonly visibilityM: number | null
  readonly freezingLevelM: number | null
  readonly riskLevel: WeatherRiskLevel
  readonly riskLabel: string
  readonly riskReasons: readonly string[]
  readonly isCurrentNonPredictive: boolean
  readonly errorMessage: string | null
}

export interface DocumentedPointWeatherListViewModel {
  readonly dayId: TripDayId | null
  readonly forecastMode: WeatherDisplayMode | null
  readonly status: 'loading' | 'available' | 'unavailable' | 'hidden'
  readonly note: string | null
  readonly pointWeatherById: ReadonlyMap<string, DocumentedPointWeatherViewModel>
}

export const emptyDocumentedPointWeatherListViewModel: DocumentedPointWeatherListViewModel = {
  dayId: null,
  forecastMode: null,
  status: 'hidden',
  note: null,
  pointWeatherById: new Map(),
}

interface AssociatedWeather {
  readonly samplePoint: WeatherSamplePoint
  readonly forecastTime: LocalIsoDateTime | null
  readonly weather: NormalizedHourlyWeather | null
  readonly status: 'available' | 'unavailable'
  readonly reason: string | null
}

const riskLabels: Record<WeatherRiskLevel, string> = {
  green: 'Vert',
  orange: 'Orange',
  red: 'Rouge',
  unknown: 'Indéterminé',
}

function isFiniteNumber(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value)
}

function getCurrentReferencePointIds(
  points: readonly RoadbookPointMatch[],
): ReadonlySet<string> {
  const operational = points.filter(
    (point) =>
      point.resolution === 'matched' &&
      isFiniteNumber(point.matchedTrackDistanceKm) &&
      isFiniteNumber(point.matchedLatitude) &&
      isFiniteNumber(point.matchedLongitude),
  )
  const start = operational.find(({ type }) => type === 'start')
  const finish = operational.find(({ type }) => type === 'end')
  const mainCol = operational
    .filter(({ type }) => type === 'col')
    .sort(
      (left, right) =>
        (right.matchedElevationM ?? right.elevationM ?? Number.NEGATIVE_INFINITY) -
          (left.matchedElevationM ?? left.elevationM ?? Number.NEGATIVE_INFINITY) ||
        left.id.localeCompare(right.id),
    )[0]

  return new Set(
    [start?.id, mainCol?.id, finish?.id].filter(
      (pointId): pointId is string => pointId !== undefined,
    ),
  )
}

function findForecastAssociation(
  pointId: string,
  waypoints: readonly {
    readonly samplePoint: WeatherSamplePoint
    readonly documentedForecasts?: readonly DocumentedPointForecast[]
    readonly forecastTimeLocal: LocalIsoDateTime | null
    readonly weather: NormalizedHourlyWeather | null
    readonly state: 'available' | 'unavailable'
    readonly reason?: string
  }[],
): AssociatedWeather | null {
  for (const waypoint of waypoints) {
    const documented = waypoint.documentedForecasts?.find(
      (forecast) => forecast.pointId === pointId,
    )
    if (documented !== undefined) {
      return {
        samplePoint: waypoint.samplePoint,
        forecastTime: documented.forecastTimeLocal,
        weather: documented.weather,
        status: documented.state,
        reason: documented.reason ?? null,
      }
    }

    if (waypoint.samplePoint.sourcePointIds.includes(pointId)) {
      return {
        samplePoint: waypoint.samplePoint,
        forecastTime: waypoint.forecastTimeLocal,
        weather: waypoint.weather,
        status: waypoint.state,
        reason: waypoint.reason ?? null,
      }
    }
  }

  return null
}

function findCurrentAssociation(
  pointId: string,
  waypoints: readonly CurrentWaypointWeather[],
): AssociatedWeather | null {
  const waypoint = waypoints.find(({ samplePoint }) =>
    samplePoint.sourcePointIds.includes(pointId),
  )
  return waypoint === undefined
    ? null
    : {
        samplePoint: waypoint.samplePoint,
        forecastTime: waypoint.forecastTimeLocal,
        weather: waypoint.weather,
        status: waypoint.state,
        reason: waypoint.reason ?? null,
      }
}

function buildRisk(
  point: RoadbookPointMatch,
  association: AssociatedWeather,
): Pick<DocumentedPointWeatherViewModel, 'riskLevel' | 'riskLabel' | 'riskReasons'> {
  if (association.weather === null) {
    return { riskLevel: 'unknown', riskLabel: riskLabels.unknown, riskReasons: [] }
  }

  const samplePoint: WeatherSamplePoint = {
    ...association.samplePoint,
    id: `documented-${point.id}`,
    name: point.name,
    type: point.type,
    elevationM:
      point.matchedElevationM ?? point.elevationM ?? association.samplePoint.elevationM,
    sourcePointIds: [point.id],
    references: association.samplePoint.references.filter(
      ({ pointId }) => pointId === point.id,
    ),
  }
  const findings = evaluateHourlyRisk(
    association.weather,
    samplePoint.elevationM,
    getWeatherExposureContext(samplePoint),
  )
  const riskLevel: WeatherRiskLevel = findings.some(({ level }) => level === 'red')
    ? 'red'
    : findings.some(({ level }) => level === 'orange')
      ? 'orange'
      : 'green'
  const riskReasons = [
    ...new Set(
      findings
        .filter(({ level }) => level === riskLevel)
        .map(({ title }) => title.toLocaleLowerCase('fr-FR')),
    ),
  ]

  return { riskLevel, riskLabel: riskLabels[riskLevel], riskReasons }
}

function buildPointViewModel(
  dayId: TripDayId,
  mode: WeatherDisplayMode,
  point: RoadbookPointMatch,
  association: AssociatedWeather,
  isCurrentNonPredictive: boolean,
): DocumentedPointWeatherViewModel {
  const weather = association.weather
  const risk = buildRisk(point, association)
  const forecastStatus: DocumentedPointWeatherStatus =
    point.eta === undefined
      ? 'eta-unavailable'
      : association.status === 'available' && weather !== null
        ? 'available'
        : 'unavailable'

  return {
    pointId: point.id,
    dayId,
    forecastMode: mode,
    forecastStatus,
    eta: point.eta ?? null,
    forecastTime: association.forecastTime,
    temperatureC: weather?.temperatureC ?? null,
    apparentTemperatureC: weather?.apparentTemperatureC ?? null,
    precipitationProbabilityPercent: weather?.precipitationProbabilityPct ?? null,
    precipitationMm: weather?.precipitationMm ?? null,
    windSpeedKph: weather?.windSpeedKph ?? null,
    windGustKph: weather?.windGustsKph ?? null,
    visibilityM: weather?.visibilityM ?? null,
    freezingLevelM: weather?.freezingLevelM ?? null,
    ...risk,
    isCurrentNonPredictive,
    errorMessage:
      forecastStatus === 'eta-unavailable'
        ? 'Prévision horaire indisponible'
        : forecastStatus === 'unavailable'
          ? association.reason ?? 'Météo indisponible'
          : null,
  }
}

export function buildDocumentedPointWeatherListViewModel(
  state: WeatherDayState | null,
  points: readonly RoadbookPointMatch[],
  today: string,
): DocumentedPointWeatherListViewModel {
  if (state === null) {
    return {
      dayId: null,
      forecastMode: null,
      status: 'loading',
      note: 'Météo en cours de chargement…',
      pointWeatherById: new Map(),
    }
  }

  if (state.dayType === 'off') {
    return { ...emptyDocumentedPointWeatherListViewModel, dayId: state.dayId }
  }

  const mode = selectWeatherDisplayMode({
    today: today as WeatherDayState['tripDate'],
    tripDate: state.tripDate,
    coverage: getCoverageFromDates(state.receivedDates),
  })

  if (state.data === null) {
    const loading = state.availability === 'loading'
    return {
      dayId: state.dayId,
      forecastMode: mode,
      status: loading ? 'loading' : 'unavailable',
      note: loading
        ? 'Météo en cours de chargement…'
        : mode === 'today-reference'
          ? 'Les prévisions du voyage ne sont pas encore disponibles.'
          : 'Météo temporairement indisponible.',
      pointWeatherById: new Map(),
    }
  }

  if (state.data.type === 'off' || mode === 'past') {
    return {
      dayId: state.dayId,
      forecastMode: mode,
      status: 'hidden',
      note: null,
      pointWeatherById: new Map(),
    }
  }

  const isCurrentNonPredictive = mode === 'today-reference'
  const allowedCurrentIds = getCurrentReferencePointIds(points)
  const pointWeatherById = new Map<string, DocumentedPointWeatherViewModel>()

  for (const point of points) {
    if (isCurrentNonPredictive && !allowedCurrentIds.has(point.id)) {
      continue
    }

    const association = isCurrentNonPredictive
      ? findCurrentAssociation(point.id, state.data.currentWaypoints ?? [])
      : findForecastAssociation(point.id, state.data.waypoints)
    if (association === null) {
      continue
    }

    pointWeatherById.set(
      point.id,
      buildPointViewModel(
        state.dayId,
        mode,
        point,
        association,
        isCurrentNonPredictive,
      ),
    )
  }

  return {
    dayId: state.dayId,
    forecastMode: mode,
    status: pointWeatherById.size === 0 ? 'unavailable' : 'available',
    note: isCurrentNonPredictive
      ? 'Les prévisions du voyage ne sont pas encore disponibles.'
      : pointWeatherById.size === 0
        ? 'Météo temporairement indisponible.'
        : null,
    pointWeatherById,
  }
}

const integerFormatter = new Intl.NumberFormat('fr-FR', {
  maximumFractionDigits: 0,
})
const decimalFormatter = new Intl.NumberFormat('fr-FR', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})

export function formatDocumentedPointWeatherSummary(
  model: DocumentedPointWeatherViewModel,
): string {
  if (model.forecastStatus !== 'available') {
    return model.forecastStatus === 'eta-unavailable'
      ? 'Prévision horaire indisponible'
      : 'Météo indisponible'
  }

  const fragments: string[] = []
  if (model.temperatureC !== null) {
    fragments.push(`${integerFormatter.format(model.temperatureC)} °C`)
  }

  const rainParts: string[] = []
  if (model.precipitationProbabilityPercent !== null) {
    rainParts.push(`${integerFormatter.format(model.precipitationProbabilityPercent)} %`)
  }
  if (model.precipitationMm !== null && model.precipitationMm > 0) {
    rainParts.push(`${decimalFormatter.format(model.precipitationMm)} mm`)
  }
  if (rainParts.length > 0) {
    fragments.push(`pluie ${rainParts.join(' / ')}`)
  }
  if (model.windGustKph !== null) {
    fragments.push(`rafales ${integerFormatter.format(model.windGustKph)} km/h`)
  }

  const summary = fragments.join(' · ')
  return model.isCurrentNonPredictive
    ? `Aujourd’hui · information actuelle, non prévisionnelle${summary === '' ? '' : ` · ${summary}`}`
    : summary
}
