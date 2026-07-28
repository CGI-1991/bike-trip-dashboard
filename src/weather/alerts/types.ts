import type { TripDayId } from '../../trip/types.ts'
import type { LocalIsoDateTime } from '../types.ts'

export type WeatherRiskLevel = 'green' | 'orange' | 'red' | 'unknown'

export type WeatherRiskType =
  | 'precipitation'
  | 'thunderstorm'
  | 'snow'
  | 'cold'
  | 'heat'
  | 'wind'
  | 'gust'
  | 'visibility'
  | 'freezing-level'
  | 'forecast-coverage'
  | 'stale-data'

export interface WeatherExposureContext {
  readonly isSummit: boolean
  readonly isHighAltitude: boolean
  readonly isExposed: boolean
  readonly isResupply: boolean
  readonly isStart: boolean
  readonly isFinish: boolean
}

/**
 * A single risk finding, not yet bound to a point/time. Produced by the pure
 * per-hour evaluators in `evaluate-point.ts` and bound to a waypoint or an
 * off-day hour by their respective callers.
 */
export interface RiskFinding {
  readonly riskType: WeatherRiskType
  readonly level: Exclude<WeatherRiskLevel, 'unknown'>
  readonly title: string
  readonly summary: string
  readonly details?: string
  readonly value?: number
  readonly unit?: string
  readonly threshold?: number
}

export interface WeatherAlert {
  readonly id: string
  readonly dayId: TripDayId
  readonly pointId?: string
  readonly pointName?: string
  readonly pointType?: string
  readonly riskType: WeatherRiskType
  readonly level: WeatherRiskLevel
  readonly title: string
  readonly summary: string
  readonly details?: string
  readonly etaLocal?: LocalIsoDateTime
  readonly etaLocalEnd?: LocalIsoDateTime
  readonly forecastTimeLocal?: LocalIsoDateTime
  readonly value?: number
  readonly unit?: string
  readonly threshold?: number
  readonly isUpcoming?: boolean
  readonly isOperational?: boolean
  readonly firstPointId?: string
  readonly lastPointId?: string
  readonly firstPointName?: string
  readonly lastPointName?: string
  readonly memberPointIds?: readonly string[]
  /**
   * The un-suffixed risk title (e.g. "Rafales notables"), kept alongside the
   * possibly grouped, display-ready `title` so a chain of merges can always
   * regenerate "<baseTitle> entre X et Y" from scratch instead of
   * accumulating a stale suffix from an earlier merge step.
   */
  readonly baseTitle?: string
}

export interface DayWeatherRiskSummary {
  readonly level: WeatherRiskLevel
  readonly redCount: number
  readonly orangeCount: number
  readonly upcomingRedCount: number
  readonly upcomingOrangeCount: number
  readonly coveredPointCount: number
  readonly missingPointCount: number
  readonly essentialCoverageRatio: number | null
  readonly alerts: readonly WeatherAlert[]
}

export interface DepartureWeatherScenario {
  readonly offsetMinutes: number
  readonly isCurrent: boolean
  readonly isCoherent: boolean
  readonly incoherenceReason: string | null
  readonly departureTimeLocal: LocalIsoDateTime | null
  readonly arrivalTimeLocal: LocalIsoDateTime | null
  readonly coveredPointCount: number
  readonly missingPointCount: number
  readonly maximumRainMm: number | null
  readonly maximumGustKph: number | null
  readonly minimumApparentTemperatureC: number | null
  readonly minimumExposedApparentTemperatureC: number | null
  readonly minimumVisibilityM: number | null
  readonly risk: DayWeatherRiskSummary
}

export type DepartureRecommendationStatus =
  | 'recommended-change'
  | 'keep-current'
  | 'insufficient-data'
  | 'not-applicable'

export interface DepartureRecommendation {
  readonly status: DepartureRecommendationStatus
  readonly currentScenario: DepartureWeatherScenario | null
  readonly recommendedScenario: DepartureWeatherScenario | null
  readonly title: string
  readonly explanation: readonly string[]
}
