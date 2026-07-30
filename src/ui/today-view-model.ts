import type { GpxAnalysisSuccess } from '../gpx/types.ts'
import { formatRouteClockTime } from '../route/time.ts'
import type { Accommodation } from '../trip/accommodations.ts'
import { getAccommodationMapsUrl } from '../trip/accommodations.ts'
import { getTripDate } from '../trip/calendar.ts'
import { resolveArrivalDisplay, resolveDepartureDisplay } from '../trip/endpoint-display.ts'
import type { RoadbookDayMatchReport, RoadbookMatchReport } from '../trip/roadbook-match.ts'
import type { TripDay, TripDayId, TripPlan, TripTimeline } from '../trip/types.ts'
import { getTripTimelineDay } from '../trip/timeline.ts'
import { evaluateDayRisk } from '../weather/alerts/evaluate-day.ts'
import type { DayWeatherRiskSummary, WeatherAlert, WeatherRiskLevel } from '../weather/alerts/types.ts'
import type { WeatherDayState, WeatherSnapshot, WaypointWeather } from '../weather/types.ts'
import { buildRouteMapModel } from './route-map-model.ts'
import type { RouteMapModel } from './route-map-model.ts'
import { getTripPeriod } from './app-state.ts'
import type { TripPeriod } from './app-state.ts'
import { formatPrecipitation, formatWind, renderDataSummary, renderTodayReferenceSummary } from './weather-summary.ts'

export interface TodayWeatherPointViewModel {
  readonly id: string
  readonly role: 'start' | 'main-col' | 'end'
  readonly name: string
  readonly eta: string | null
  readonly altitudeM: number | null
  readonly temperature: string | null
  readonly precipitation: string | null
  readonly wind: string | null
  readonly riskLevel: WeatherRiskLevel | null
}

export interface TodayAlertViewModel {
  readonly level: 'orange' | 'red'
  readonly title: string
  readonly summary: string
  readonly place: string | null
  readonly time: string | null
}

export interface TodayWeatherViewModel {
  readonly status: string
  readonly summary: string
  readonly context: string | null
  readonly points: readonly TodayWeatherPointViewModel[]
  readonly primaryAlert: TodayAlertViewModel | null
}

export interface TodayAccommodationViewModel {
  readonly id: string
  readonly name: string
  readonly locality: string
  readonly address: string
  readonly confirmed: true
  readonly website: string | null
  readonly mapsUrl: string
}

export interface TodayRideStatsViewModel {
  readonly distanceKm: number
  readonly elevationGainM: number
  readonly departureTime: string
  readonly arrivalTime: string
  /** Computed output (distance / moving time) — never the configured reference speed. */
  readonly resultingAverageSpeedKph: number
  readonly totalBreakMinutes: number
}

interface TodayCommonViewModel {
  readonly period: TripPeriod['kind']
  readonly statusLabel: string
  readonly dayId: TripDayId
  readonly dayNumber: number
  readonly date: string
  readonly dateLabel: string
  readonly title: string
  readonly dayHref: string
  readonly accommodation: TodayAccommodationViewModel | null
  readonly weather: TodayWeatherViewModel
  readonly errors: readonly string[]
}

export interface TodayRideViewModel extends TodayCommonViewModel {
  readonly type: 'ride'
  readonly departureName: string
  readonly arrivalName: string
  readonly arrivalFunction: string
  readonly stats: TodayRideStatsViewModel | null
  readonly mapModel: RouteMapModel | null
  readonly gpxHref: string | null
  readonly gpxDownloadName: string | null
}

export interface TodayOffViewModel extends TodayCommonViewModel {
  readonly type: 'off'
  readonly locationName: string
  readonly recoveryText: readonly string[]
}

export type TodayViewModel = TodayRideViewModel | TodayOffViewModel

export interface BuildTodayViewModelInput {
  readonly now: Date
  readonly plan: TripPlan
  readonly timeline: TripTimeline | null
  readonly roadbookReport: RoadbookMatchReport | null
  readonly accommodations: readonly Accommodation[]
  readonly weatherSnapshot: WeatherSnapshot
  readonly gpx: GpxAnalysisSuccess | null
  readonly publicBaseUrl?: string
}

const dateFormatter = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
const decimalFormatter = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 })

function formatDate(value: string): string {
  const date = new Date(`${value}T12:00:00Z`)
  return Number.isNaN(date.getTime()) ? value : dateFormatter.format(date)
}

function statusLabel(period: TripPeriod, day: TripDay): string {
  if (period.kind === 'after') return 'Voyage terminé'
  if (period.kind === 'before') return period.daysUntilStart === 1 ? 'Départ demain' : `Départ dans ${period.daysUntilStart} jours`
  if (day.id === 'J1') return 'Départ aujourd’hui'
  return day.type === 'off' ? 'Journée OFF' : 'Étape du jour'
}

function roadbookDay(report: RoadbookMatchReport | null, dayId: TripDayId): RoadbookDayMatchReport | null {
  return report?.days.find(({ dayId: candidate }) => candidate === dayId) ?? null
}

function accommodationForDay(accommodations: readonly Accommodation[], dayId: TripDayId): Accommodation | null {
  return accommodations.find(({ dayIds }) => dayIds.includes(dayId)) ?? null
}

function accommodationLocality(accommodation: Accommodation, fallback: string): string {
  const match = /\b\d{5}\s+([^,]+)$/u.exec(accommodation.address.trim())
  return match?.[1]?.trim() || fallback
}

function accommodationView(accommodation: Accommodation | null, fallbackLocality: string): TodayAccommodationViewModel | null {
  return accommodation === null ? null : {
    id: accommodation.id,
    name: accommodation.name,
    locality: accommodationLocality(accommodation, fallbackLocality),
    address: accommodation.address,
    confirmed: true,
    website: accommodation.website ?? null,
    mapsUrl: getAccommodationMapsUrl(accommodation),
  }
}

function weatherStateLabel(state: WeatherDayState | null): string {
  if (state === null) return 'Météo temporairement indisponible'
  switch (state.availability) {
    case 'loading': return 'Chargement de la météo'
    case 'available': return 'Météo disponible'
    case 'partial': return 'Météo partielle'
    case 'outside-horizon': return 'Hors horizon prévisionnel'
    case 'stale-cache': return 'Dernière météo en cache'
    case 'unavailable': return 'Météo temporairement indisponible'
    case 'error': return 'Météo temporairement indisponible'
  }
}

function getRisk(state: WeatherDayState | null, now: Date): DayWeatherRiskSummary | null {
  if (state?.data === null || state === null || state.availability === 'outside-horizon') return null
  return evaluateDayRisk(state.dayId, state.data, { fetchedAt: state.fetchedAt, now, upcomingPointIds: null })
}

function alertForPoint(risk: DayWeatherRiskSummary | null, pointId: string): WeatherAlert | null {
  const alerts = risk?.alerts.filter((alert) => alert.pointId === pointId || alert.memberPointIds?.includes(pointId) === true) ?? []
  return [...alerts].sort((left, right) => riskOrder(right.level) - riskOrder(left.level))[0] ?? null
}

function riskOrder(level: WeatherRiskLevel): number {
  return level === 'red' ? 3 : level === 'orange' ? 2 : level === 'unknown' ? 1 : 0
}

function weatherPoint(item: WaypointWeather, role: TodayWeatherPointViewModel['role'], name: string, risk: DayWeatherRiskSummary | null): TodayWeatherPointViewModel {
  const weather = item.weather
  const alert = alertForPoint(risk, item.samplePoint.id)
  return {
    id: item.samplePoint.id,
    role,
    name,
    eta: item.samplePoint.eta === undefined ? null : formatRouteClockTime(item.samplePoint.eta),
    altitudeM: Number.isFinite(item.samplePoint.elevationM) ? item.samplePoint.elevationM : null,
    temperature: weather?.temperatureC === null || weather?.temperatureC === undefined ? null : `${decimalFormatter.format(weather.temperatureC)} °C`,
    precipitation: weather === null ? null : formatPrecipitation(weather.precipitationProbabilityPct, weather.precipitationMm),
    wind: weather === null ? null : formatWind(weather.windSpeedKph, weather.windGustsKph),
    riskLevel: alert?.level ?? null,
  }
}

function primaryAlert(risk: DayWeatherRiskSummary | null, mainColId: string | null): TodayAlertViewModel | null {
  const significant = risk?.alerts.filter(({ level, isOperational }) => isOperational !== false && (level === 'red' || level === 'orange')) ?? []
  const selected = [...significant].sort((left, right) =>
    riskOrder(right.level) - riskOrder(left.level) ||
    Number(right.pointId === mainColId) - Number(left.pointId === mainColId) ||
    (left.etaLocal ?? '').localeCompare(right.etaLocal ?? '')
  )[0]
  if (selected === undefined || (selected.level !== 'red' && selected.level !== 'orange')) return null
  const time = selected.etaLocal === undefined ? null : /T(\d{2}:\d{2})/.exec(selected.etaLocal)?.[1] ?? null
  return { level: selected.level, title: selected.title, summary: selected.summary, place: selected.pointName ?? null, time }
}

function weatherView(state: WeatherDayState | null, now: Date, departureName: string, arrivalName: string): TodayWeatherViewModel {
  const risk = getRisk(state, now)
  const data = state?.data
  const outsideHorizon = state?.availability === 'outside-horizon'
  const summary = data === null || data === undefined
    ? 'Météo temporairement indisponible'
    : outsideHorizon
      ? renderTodayReferenceSummary(data.todayReference)
      : renderDataSummary(data)
  if (data?.type !== 'ride') {
    return { status: weatherStateLabel(state), summary, context: outsideHorizon ? 'Aujourd’hui · information actuelle, non prévisionnelle' : null, points: [], primaryAlert: primaryAlert(risk, null) }
  }
  const start = data.waypoints.find(({ samplePoint }) => samplePoint.type === 'start')
  const end = data.waypoints.find(({ samplePoint }) => samplePoint.type === 'end')
  const mainCol = [...data.waypoints]
    .filter(({ samplePoint }) => samplePoint.type === 'col' || samplePoint.type === 'summit')
    .sort((left, right) => right.samplePoint.elevationM - left.samplePoint.elevationM)[0]
  const points = [
    ...(start === undefined ? [] : [weatherPoint(start, 'start', departureName, risk)]),
    ...(mainCol === undefined ? [] : [weatherPoint(mainCol, 'main-col', mainCol.samplePoint.name, risk)]),
    ...(end === undefined ? [] : [weatherPoint(end, 'end', arrivalName, risk)]),
  ]
  return {
    status: weatherStateLabel(state),
    summary,
    context: outsideHorizon ? 'Aujourd’hui · information actuelle, non prévisionnelle' : null,
    points,
    primaryAlert: primaryAlert(risk, mainCol?.samplePoint.id ?? null),
  }
}

function offRecovery(dayReport: RoadbookDayMatchReport | null): readonly string[] {
  if (dayReport?.type !== 'off') return []
  const roadbook = dayReport.roadbook
  return [...new Set([
    roadbook.ambiance,
    ...roadbook.recovery.map(({ description }) => description),
    ...roadbook.activities.map(({ description }) => description),
    ...roadbook.logistics.map(({ description }) => description),
    ...roadbook.notes,
  ].filter(Boolean))]
}

export function buildTodayViewModel(input: BuildTodayViewModelInput): TodayViewModel {
  const period = getTripPeriod(input.now)
  const day = input.plan.days.find(({ id }) => id === period.dayId) ?? input.plan.days[0]
  const date = getTripDate(day.dayNumber)
  const timelineDay = input.timeline === null ? null : getTripTimelineDay(input.timeline, day.id)
  const reportDay = roadbookDay(input.roadbookReport, day.id)
  const accommodation = accommodationForDay(input.accommodations, day.id)
  const weatherState = input.weatherSnapshot.states.get(day.id) ?? null
  const fallbackLocality = day.type === 'ride' ? day.endName : day.locationName
  const common = {
    period: period.kind,
    statusLabel: statusLabel(period, day),
    dayId: day.id,
    dayNumber: day.dayNumber,
    date,
    dateLabel: formatDate(date),
    title: day.type === 'ride' ? day.name : day.title,
    dayHref: `#/day/${day.id}`,
    accommodation: accommodationView(accommodation, fallbackLocality),
  } as const

  if (day.type === 'off') {
    return {
      ...common,
      type: 'off',
      locationName: day.locationName,
      recoveryText: offRecovery(reportDay),
      weather: weatherView(weatherState, input.now, day.locationName, day.locationName),
      errors: [],
    }
  }

  const rideReport = reportDay?.type === 'ride' ? reportDay : null
  const departure = rideReport === null ? { primaryName: day.startName } : resolveDepartureDisplay(rideReport.roadbook)
  const arrival = rideReport === null ? { primaryName: day.endName, subLabel: `Arrivée · ${day.endName}` } : resolveArrivalDisplay(rideReport.roadbook, accommodation)
  const readyTimeline = timelineDay?.type === 'ride' && timelineDay.status === 'ready' ? timelineDay : null
  const errors: string[] = []
  if (readyTimeline === null) errors.push('Calcul de l’étape temporairement indisponible')
  let mapModel: RouteMapModel | null = null
  if (readyTimeline !== null && input.gpx !== null) {
    try { mapModel = buildRouteMapModel(input.gpx, readyTimeline, input.roadbookReport, accommodation) }
    catch { mapModel = null }
  }
  const publicBase = input.publicBaseUrl === undefined ? '' : input.publicBaseUrl.endsWith('/') ? input.publicBaseUrl : `${input.publicBaseUrl}/`
  return {
    ...common,
    type: 'ride',
    departureName: departure.primaryName,
    arrivalName: arrival.primaryName,
    arrivalFunction: arrival.subLabel ?? `Arrivée · ${day.endName}`,
    stats: readyTimeline === null ? null : {
      distanceKm: readyTimeline.route.summary.distanceKm,
      elevationGainM: readyTimeline.route.summary.elevationGainM,
      departureTime: readyTimeline.startTime,
      arrivalTime: formatRouteClockTime(readyTimeline.arrivalTime),
      resultingAverageSpeedKph: readyTimeline.route.summary.estimatedAverageSpeedKph,
      totalBreakMinutes: readyTimeline.route.settings.totalBreakMinutes,
    },
    mapModel,
    gpxHref: input.gpx === null ? null : `${publicBase}data/gpx/${encodeURIComponent(day.gpxFile)}`,
    gpxDownloadName: input.gpx === null ? null : `${day.id}-${day.startName}-${day.endName}.gpx`,
    weather: weatherView(weatherState, input.now, departure.primaryName, arrival.primaryName),
    errors,
  }
}
