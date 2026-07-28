import { getDateInTimezone } from '../trip/calendar.ts'
import type { TripDayId } from '../trip/types.ts'
import { attachRiskToScenarios } from '../weather/alerts/departure-scenarios.ts'
import { evaluateDayRisk } from '../weather/alerts/evaluate-day.ts'
import type { DayRiskContext } from '../weather/alerts/evaluate-day.ts'
import { buildDepartureRecommendation } from '../weather/alerts/recommendations.ts'
import type {
  DayWeatherRiskSummary,
  DepartureRecommendation,
  WeatherRiskLevel,
} from '../weather/alerts/types.ts'
import { weatherConfig } from '../weather/config.ts'
import { getCoverageFromDates, selectWeatherDisplayMode } from '../weather/display-policy.ts'
import type { WeatherDisplayMode } from '../weather/display-policy.ts'
import type {
  OffDayWeather,
  RideDayWeather,
  TodayReferenceWeather,
  WeatherDayData,
  WeatherDayState,
  WeatherSnapshot,
} from '../weather/types.ts'

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

const decimalFormatter = new Intl.NumberFormat('fr-FR', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
})
const integerFormatter = new Intl.NumberFormat('fr-FR', {
  maximumFractionDigits: 0,
})

function formatTemperatureRange(
  minimumC: number | null,
  maximumC: number | null,
): string | null {
  if (minimumC === null && maximumC === null) {
    return null
  }

  if (minimumC === null) {
    return `${decimalFormatter.format(maximumC ?? 0)} °C max`
  }

  if (maximumC === null) {
    return `${decimalFormatter.format(minimumC)} °C min`
  }

  return `${decimalFormatter.format(minimumC)}–${decimalFormatter.format(maximumC)} °C`
}

function formatPrecipitation(
  probabilityPct: number | null,
  amountMm: number | null,
): string | null {
  if (probabilityPct !== null) {
    return `Pluie ${integerFormatter.format(probabilityPct)} %`
  }

  return amountMm === null
    ? null
    : `Pluie ${decimalFormatter.format(amountMm)} mm`
}

function formatWind(
  windSpeedKph: number | null,
  windGustsKph: number | null,
): string | null {
  if (windGustsKph !== null) {
    return `Rafales ${integerFormatter.format(windGustsKph)} km/h`
  }

  return windSpeedKph === null
    ? null
    : `Vent ${integerFormatter.format(windSpeedKph)} km/h`
}

function renderRideSummary(data: RideDayWeather): string {
  const summary = data.routeSummary
  return [
    formatTemperatureRange(summary.temperatureMinC, summary.temperatureMaxC),
    formatPrecipitation(
      summary.precipitationProbabilityMaxPct,
      summary.hourlyPrecipitationMaxMm,
    ),
    formatWind(summary.windSpeedMaxKph, summary.windGustsMaxKph),
  ]
    .filter((value): value is string => value !== null)
    .join(' · ')
}

function renderOffSummary(data: OffDayWeather): string {
  const daily = data.daily
  const summary = data.localSummary
  return [
    formatTemperatureRange(
      daily?.temperatureMinC ?? summary.temperatureMinC,
      daily?.temperatureMaxC ?? summary.temperatureMaxC,
    ),
    formatPrecipitation(
      daily?.precipitationProbabilityMaxPct ??
        summary.precipitationProbabilityMaxPct,
      daily?.precipitationSumMm ?? summary.hourlyPrecipitationMaxMm,
    ),
    formatWind(
      daily?.windSpeedMaxKph ?? summary.windSpeedMaxKph,
      daily?.windGustsMaxKph ?? summary.windGustsMaxKph,
    ),
  ]
    .filter((value): value is string => value !== null)
    .join(' · ')
}

function renderDataSummary(data: WeatherDayData): string {
  const summary =
    data.type === 'ride' ? renderRideSummary(data) : renderOffSummary(data)
  return summary.length === 0 ? 'Données météo partielles' : summary
}

function getStatePrefix(state: WeatherDayState): string | null {
  if (state.isRefreshing) {
    return 'Actualisation'
  }

  switch (state.availability) {
    case 'loading':
      return 'Chargement'
    case 'available':
      return null
    case 'partial':
      return 'Partielle'
    case 'outside-horizon':
      return 'Hors horizon'
    case 'stale-cache':
      return 'Cache à actualiser'
    case 'unavailable':
      return 'Indisponible'
    case 'error':
      return 'Erreur météo'
  }
}

const modeLabels: Record<WeatherDisplayMode, string> = {
  'today-reference': 'Hors horizon',
  trend: 'Tendance',
  planning: 'Planification',
  operational: 'Opérationnel',
  live: 'En cours',
  past: 'Terminée',
}

function renderTodayReferenceSummary(reference: TodayReferenceWeather | null): string {
  if (reference === null) {
    return 'donnée indisponible'
  }

  const parts = [
    formatTemperatureRange(reference.temperatureMinC, reference.temperatureMaxC),
    formatPrecipitation(reference.precipitationProbabilityMaxPct, reference.precipitationSumMm),
    formatWind(reference.windSpeedMaxKph, reference.windGustsMaxKph),
  ].filter((value): value is string => value !== null)

  return parts.length === 0 ? 'donnée indisponible' : parts.join(' · ')
}

function getStateText(state: WeatherDayState, mode: WeatherDisplayMode): string {
  if (mode === 'past') {
    return 'Terminée'
  }

  if (mode === 'today-reference') {
    return `Aujourd’hui : ${renderTodayReferenceSummary(state.data?.todayReference ?? null)}`
  }

  const prefix = getStatePrefix(state)

  if (state.data === null) {
    return prefix ?? 'Météo indisponible'
  }

  const summary = renderDataSummary(state.data)
  return prefix === null ? `${modeLabels[mode]} · ${summary}` : `${prefix} · ${summary}`
}

const riskLevelLabels: Record<WeatherRiskLevel, string> = {
  green: 'Vert',
  orange: 'Orange',
  red: 'Rouge',
  unknown: 'Indéterminé',
}

function riskLevelOrder(level: WeatherRiskLevel): number {
  switch (level) {
    case 'red':
      return 3
    case 'orange':
      return 2
    case 'unknown':
      return 1
    case 'green':
      return 0
  }
}

/**
 * Exactly what the compact day card is allowed to show (Phase D, section L):
 * global level, a one-line headline, the alert count (or coverage when there
 * is nothing to flag), and — only when one exists — the departure-time hint.
 * Never the full alert list or raw metric values here.
 */
function buildRiskSummaryLines(
  risk: DayWeatherRiskSummary,
  recommendation: DepartureRecommendation | null,
): readonly string[] {
  const priorityAlert = [...risk.alerts]
    .filter((alert) => alert.isOperational !== false)
    .sort((left, right) => riskLevelOrder(right.level) - riskLevelOrder(left.level))[0]
  const headline =
    priorityAlert === undefined
      ? risk.level === 'unknown'
        ? 'couverture météo incomplète'
        : 'aucun risque notable détecté'
      : priorityAlert.title.toLowerCase()
  const attentionCount = risk.redCount + risk.orangeCount
  const totalPointCount = risk.coveredPointCount + risk.missingPointCount
  const secondaryLine =
    attentionCount > 0
      ? `${integerFormatter.format(attentionCount)} point${attentionCount > 1 ? 's' : ''} d’attention`
      : `${integerFormatter.format(risk.coveredPointCount)}/${integerFormatter.format(totalPointCount)} points couverts`
  const lines = [`${riskLevelLabels[risk.level]} — ${headline}`, secondaryLine]

  if (recommendation?.status === 'recommended-change') {
    lines.push(recommendation.title)
  }

  return lines
}

function setSlotState(
  slot: HTMLElement,
  state: WeatherDayState | null,
  mode: WeatherDisplayMode | null,
  risk: DayWeatherRiskSummary | null,
  recommendation: DepartureRecommendation | null,
): void {
  delete slot.dataset.weatherError

  if (state === null || mode === null) {
    slot.dataset.weatherState = 'unavailable'
    slot.dataset.weatherSource = 'none'
    slot.dataset.weatherCacheState = 'miss'
    slot.dataset.weatherRefreshing = 'false'
    slot.dataset.weatherHasData = 'false'
    delete slot.dataset.weatherFetchedAt
    delete slot.dataset.weatherMode
    delete slot.dataset.weatherRiskLevel
    slot.textContent = 'Météo indisponible'
    return
  }

  slot.dataset.weatherState = state.availability
  slot.dataset.weatherMode = mode
  slot.dataset.weatherSource = state.source
  slot.dataset.weatherCacheState = state.cacheState
  slot.dataset.weatherRefreshing = String(state.isRefreshing)
  slot.dataset.weatherHasData = String(state.data !== null)

  if (state.fetchedAt === null) {
    delete slot.dataset.weatherFetchedAt
  } else {
    slot.dataset.weatherFetchedAt = state.fetchedAt
  }

  if (risk === null) {
    delete slot.dataset.weatherRiskLevel
    const text = getStateText(state, mode)
    slot.textContent = text
    slot.setAttribute('aria-label', `${state.dayId} : ${text}`)
    return
  }

  slot.dataset.weatherRiskLevel = risk.level
  const lines = buildRiskSummaryLines(risk, recommendation)
  slot.innerHTML = lines
    .map((line) => `<span class="trip-day__weather-line">${escapeHtml(line)}</span>`)
    .join('')
  slot.setAttribute('aria-label', `${state.dayId} : ${lines.join(' · ')}`)
}

function getWeatherSlots(container: HTMLElement): readonly HTMLElement[] {
  return [
    ...container.querySelectorAll<HTMLElement>('[data-trip-day-weather]'),
  ]
}

function getSlotDayId(slot: HTMLElement): TripDayId | null {
  const dayId = slot.dataset.tripDayWeather
  return dayId === undefined ? null : (dayId as TripDayId)
}

export function renderWeatherSummaryLoading(container: HTMLElement): void {
  container.dataset.weatherSummaryState = 'loading'

  for (const slot of getWeatherSlots(container)) {
    const hasData = slot.dataset.weatherHasData === 'true'
    slot.dataset.weatherState = 'loading'
    slot.dataset.weatherRefreshing = 'true'

    if (!hasData) {
      slot.dataset.weatherSource = 'none'
      slot.dataset.weatherCacheState = 'miss'
      slot.dataset.weatherHasData = 'false'
      slot.textContent = 'Météo en cours'
    }
  }
}

export function renderWeatherSummary(
  container: HTMLElement,
  snapshot: WeatherSnapshot,
  now: Date = new Date(),
): void {
  const slots = getWeatherSlots(container)
  const today = getDateInTimezone(now, weatherConfig.timezone)
  let hasLoading = false
  let hasDegradedState = false

  for (const slot of slots) {
    const dayId = getSlotDayId(slot)
    const state = dayId === null ? undefined : snapshot.states.get(dayId)
    const mode =
      state === undefined
        ? null
        : selectWeatherDisplayMode({
            today,
            tripDate: state.tripDate,
            coverage: getCoverageFromDates(state.receivedDates),
          })
    let risk: DayWeatherRiskSummary | null = null
    let recommendation: DepartureRecommendation | null = null

    if (
      state !== undefined &&
      mode !== null &&
      mode !== 'today-reference' &&
      mode !== 'past' &&
      state.data !== null
    ) {
      const riskContext: DayRiskContext = { fetchedAt: state.fetchedAt, now, upcomingPointIds: null }
      risk = evaluateDayRisk(state.dayId, state.data, riskContext)

      if (mode === 'operational') {
        const scenarios =
          state.data.type === 'ride' && Array.isArray(state.departureScenarios)
            ? attachRiskToScenarios(state.dayId, state.tripDate, state.departureScenarios, riskContext)
            : []
        const cacheAgeMs =
          state.fetchedAt === null ? null : now.getTime() - Date.parse(state.fetchedAt)
        recommendation = buildDepartureRecommendation(scenarios, {
          mode,
          hasDeparted: false,
          cacheAgeMs,
        })
      }
    }

    setSlotState(slot, state ?? null, mode, risk, recommendation)

    if (state?.availability === 'loading' || state?.isRefreshing === true) {
      hasLoading = true
    } else if (state?.availability !== 'available') {
      hasDegradedState = true
    }
  }

  container.dataset.weatherSummaryState = hasLoading
    ? 'loading'
    : hasDegradedState
      ? 'partial'
      : 'available'
}

export function renderWeatherSummaryError(
  container: HTMLElement,
  error: unknown,
): void {
  const message = error instanceof Error ? error.message : 'Erreur météo inconnue.'
  container.dataset.weatherSummaryState = 'error'

  for (const slot of getWeatherSlots(container)) {
    const hasData = slot.dataset.weatherHasData === 'true'
    slot.dataset.weatherState = 'error'
    slot.dataset.weatherRefreshing = 'false'
    slot.dataset.weatherError = message

    if (!hasData) {
      slot.dataset.weatherSource = 'none'
      slot.dataset.weatherCacheState = 'miss'
      slot.dataset.weatherHasData = 'false'
      slot.textContent = 'Erreur météo'
    }
  }
}
