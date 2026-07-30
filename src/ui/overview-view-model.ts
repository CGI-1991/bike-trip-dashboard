import type { GpxAnalysisReport, GpxAnalysisSuccess } from '../gpx/types.ts'
import type { Accommodation } from '../trip/accommodations.ts'
import { calculateTripProgress } from '../trip/progress.ts'
import type { TripProgressSummary } from '../trip/progress.ts'
import type { RoadbookMatchReport } from '../trip/roadbook-match.ts'
import type { TripPlan, TripTimeline } from '../trip/types.ts'
import type { WeatherDayState, WeatherSnapshot } from '../weather/types.ts'
import { getTripPeriod } from './app-state.ts'
import { buildOverviewMapModel } from './overview-map-model.ts'
import type { OverviewMapModel } from './overview-map-model.ts'
import { buildTodayViewModel } from './today-view-model.ts'
import type { TodayViewModel } from './today-view-model.ts'

export type OverviewAlertLevel = 'info' | 'warning' | 'danger'

export interface OverviewAlert {
  readonly id: string
  readonly level: OverviewAlertLevel
  readonly message: string
}

export interface OverviewViewModel {
  readonly period: TripProgressSummary['period']
  readonly daysUntilStart: number | null
  readonly progress: TripProgressSummary
  readonly stage: TodayViewModel
  readonly mapModel: OverviewMapModel
  readonly alerts: readonly OverviewAlert[]
}

export interface BuildOverviewViewModelInput {
  readonly now: Date
  readonly plan: TripPlan
  readonly timeline: TripTimeline | null
  readonly roadbookReport: RoadbookMatchReport | null
  readonly roadbookError: unknown
  readonly accommodations: readonly Accommodation[]
  readonly weatherSnapshot: WeatherSnapshot
  readonly gpxReport: GpxAnalysisReport | null
  readonly publicBaseUrl?: string
  readonly isOffline: boolean
}

function resolveGpxForDay(gpxReport: GpxAnalysisReport | null, plan: TripPlan, dayId: string): GpxAnalysisSuccess | null {
  const day = plan.days.find(({ id }) => id === dayId)
  if (day?.type !== 'ride') return null
  const file = gpxReport?.files.find((entry) => entry.status === 'success' && entry.source.fileName === day.gpxFile)
  return file?.status === 'success' ? file : null
}

function weatherAlerts(state: WeatherDayState | null): readonly OverviewAlert[] {
  if (state === null || state.availability === 'unavailable' || state.availability === 'error') {
    return [{ id: 'weather-unavailable', level: 'warning', message: 'Météo temporairement indisponible.' }]
  }
  if (state.availability === 'stale-cache') {
    return [{ id: 'weather-cache', level: 'info', message: 'Dernières prévisions météo en cache.' }]
  }
  return []
}

export function buildOverviewAlerts(input: {
  readonly isOffline: boolean
  readonly weatherState: WeatherDayState | null
  readonly stage: TodayViewModel
  readonly gpxAvailable: boolean
  readonly roadbookAvailable: boolean
  readonly roadbookError: unknown
  readonly timelineAvailable: boolean
}): readonly OverviewAlert[] {
  const alerts: OverviewAlert[] = []
  if (input.isOffline) alerts.push({ id: 'offline', level: 'info', message: 'Mode hors ligne · données locales disponibles.' })

  const primaryWeatherAlert = input.stage.weather.primaryAlert
  if (primaryWeatherAlert !== null) {
    alerts.push({
      id: 'weather-risk',
      level: primaryWeatherAlert.level === 'red' ? 'danger' : 'warning',
      message: [primaryWeatherAlert.title, primaryWeatherAlert.place].filter(Boolean).join(' · '),
    })
  } else {
    alerts.push(...weatherAlerts(input.weatherState))
  }

  if (input.stage.type === 'ride' && !input.gpxAvailable) {
    alerts.push({ id: 'gpx-unavailable', level: 'warning', message: 'GPX de l’étape temporairement indisponible.' })
  }
  if (!input.roadbookAvailable || input.roadbookError !== null) {
    alerts.push({ id: 'roadbook-unavailable', level: 'warning', message: 'Roadbook ou données documentées temporairement indisponibles.' })
  }
  if (!input.timelineAvailable || input.stage.errors.length > 0) {
    alerts.push({ id: 'timeline-unavailable', level: 'warning', message: 'ETA ou chronologie de l’étape temporairement indisponibles.' })
  }
  return alerts
}

export function buildOverviewViewModel(input: BuildOverviewViewModelInput): OverviewViewModel {
  const period = getTripPeriod(input.now)
  const progress = calculateTripProgress(input.now, input.plan, input.timeline)
  const gpx = resolveGpxForDay(input.gpxReport, input.plan, progress.currentDayId)
  const stage = buildTodayViewModel({
    now: input.now,
    plan: input.plan,
    timeline: input.timeline,
    roadbookReport: input.roadbookReport,
    accommodations: input.accommodations,
    weatherSnapshot: input.weatherSnapshot,
    gpx,
    publicBaseUrl: input.publicBaseUrl,
  })
  const mapModel = buildOverviewMapModel(input.plan, input.gpxReport, progress.currentDayId, progress.position)
  const weatherState = input.weatherSnapshot.states.get(progress.currentDayId) ?? null
  const alerts = buildOverviewAlerts({
    isOffline: input.isOffline,
    weatherState,
    stage,
    gpxAvailable: gpx !== null,
    roadbookAvailable: input.roadbookReport !== null,
    roadbookError: input.roadbookError,
    timelineAvailable: input.timeline !== null,
  })

  return {
    period: progress.period,
    daysUntilStart: period.kind === 'before' ? period.daysUntilStart : null,
    progress,
    stage,
    mapModel,
    alerts,
  }
}
