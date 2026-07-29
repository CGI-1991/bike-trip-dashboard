import { getDateInTimezone } from '../trip/calendar.ts'
import {
  computeLiveProgress,
  getCoverageFromDates,
  getNowLocalDateTime,
  selectWeatherDisplayMode,
} from '../weather/display-policy.ts'
import type { LiveProgress, WeatherDisplayMode } from '../weather/display-policy.ts'
import {
  describeRouteClockTime,
  formatRouteClockTime,
} from '../route/time.ts'
import type { RouteClockTime } from '../route/types.ts'
import { attachRiskToScenarios } from '../weather/alerts/departure-scenarios.ts'
import { evaluateDayRisk } from '../weather/alerts/evaluate-day.ts'
import type { DayRiskContext } from '../weather/alerts/evaluate-day.ts'
import { buildDepartureRecommendation } from '../weather/alerts/recommendations.ts'
import type {
  DayWeatherRiskSummary,
  DepartureRecommendation,
  DepartureWeatherScenario,
  WeatherAlert,
  WeatherRiskLevel,
} from '../weather/alerts/types.ts'
import { weatherConfig } from '../weather/config.ts'
import { getWeatherCodeLabel } from '../weather/weather-code.ts'
import type {
  NormalizedDailyWeather,
  NormalizedHourlyWeather,
  OffDayWeather,
  RideDayWeather,
  RideWeatherSummary,
  TodayReferenceWeather,
  WeatherAvailability,
  WeatherDayData,
  WeatherDayState,
  WeatherSamplePoint,
  WaypointWeather,
} from '../weather/types.ts'

const decimalFormatter = new Intl.NumberFormat('fr-FR', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
})
const integerFormatter = new Intl.NumberFormat('fr-FR', {
  maximumFractionDigits: 0,
})
const fetchedAtFormatter = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  dateStyle: 'short',
  timeStyle: 'short',
})
const dateFormatter = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'UTC',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
})
const longDateFormatter = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

const availabilityLabels: Record<WeatherAvailability, string> = {
  loading: 'Chargement',
  available: 'Disponible',
  partial: 'Partielle',
  'outside-horizon': 'Hors horizon',
  'stale-cache': 'Cache à actualiser',
  unavailable: 'Indisponible',
  error: 'Erreur',
}

const displayModeLabels: Record<WeatherDisplayMode, string> = {
  'today-reference': 'Hors horizon',
  trend: 'Tendance',
  planning: 'Planification',
  operational: 'Opérationnel',
  live: 'En cours',
  past: 'Terminée',
}

const pointTypeLabels: Record<WeatherSamplePoint['type'], string> = {
  start: 'Départ',
  end: 'Arrivée',
  col: 'Col',
  summit: 'Sommet',
  village: 'Village',
  passage: 'Passage',
  resupply: 'Ravitaillement',
  pause: 'Pause',
  shelter: 'Abri',
  lodging: 'Hébergement',
  poi: 'Point clé',
  'off-location': 'Lieu de repos',
}

const ESSENTIAL_POINT_TYPES: ReadonlySet<WeatherSamplePoint['type']> = new Set([
  'start',
  'end',
  'col',
  'summit',
])

const riskLevelLabels: Record<WeatherRiskLevel, string> = {
  green: 'Vert',
  orange: 'Orange',
  red: 'Rouge',
  unknown: 'Indéterminé',
}

function getRiskLevelTagClass(level: WeatherRiskLevel): string {
  switch (level) {
    case 'red':
      return 'tag--risk-red'
    case 'orange':
      return 'tag--risk-orange'
    case 'unknown':
      return 'tag--risk-unknown'
    case 'green':
      return 'tag--risk-green'
  }
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

function renderRiskLevelTag(level: WeatherRiskLevel): string {
  return `<span class="tag ${getRiskLevelTagClass(level)}" data-weather-risk-level="${level}">${riskLevelLabels[level]}</span>`
}

function getAlertsForPoint(
  alerts: readonly WeatherAlert[],
  pointId: string,
): readonly WeatherAlert[] {
  return alerts.filter(
    (alert) => alert.pointId === pointId || alert.memberPointIds?.includes(pointId) === true,
  )
}

function renderAlertBadge(alert: WeatherAlert): string {
  return `
    <span
      class="tag ${getRiskLevelTagClass(alert.level)} tag--alert"
      data-weather-alert-risk="${escapeHtml(alert.riskType)}"
      title="${escapeHtml(alert.summary)}"
    >${escapeHtml(alert.title)}</span>`
}

function renderAlertBadges(alerts: readonly WeatherAlert[]): string {
  if (alerts.length === 0) {
    return ''
  }

  return `<div class="weather-waypoint__alerts">${alerts.map(renderAlertBadge).join('')}</div>`
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function renderRouteClock(value: RouteClockTime, dateTime: string): string {
  return `<time datetime="${escapeHtml(dateTime)}" aria-label="${escapeHtml(describeRouteClockTime(value))}">${escapeHtml(formatRouteClockTime(value))}</time>`
}

function formatTripDate(value: string): string {
  const date = new Date(`${value}T12:00:00Z`)
  return Number.isNaN(date.getTime()) ? value : dateFormatter.format(date)
}

function formatLongTripDate(value: string): string {
  const date = new Date(`${value}T12:00:00Z`)
  return Number.isNaN(date.getTime()) ? value : longDateFormatter.format(date)
}

function formatLocalTime(value: string | null): string {
  if (value === null) {
    return '—'
  }

  const match = /T(?<time>\d{2}:\d{2})/.exec(value)
  return match?.groups?.time ?? value
}

function formatFetchedAt(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : fetchedAtFormatter.format(date)
}

function formatTemperature(value: number | null): string {
  return value === null ? '—' : `${decimalFormatter.format(value)} °C`
}

function formatTemperatureRange(
  minimumC: number | null,
  maximumC: number | null,
): string {
  if (minimumC === null && maximumC === null) {
    return '—'
  }

  if (minimumC === null) {
    return `${decimalFormatter.format(maximumC ?? 0)} °C max`
  }

  if (maximumC === null) {
    return `${decimalFormatter.format(minimumC)} °C min`
  }

  return `${decimalFormatter.format(minimumC)}–${decimalFormatter.format(maximumC)} °C`
}

function formatPercentage(value: number | null): string {
  return value === null ? '—' : `${integerFormatter.format(value)} %`
}

function formatPrecipitation(value: number | null): string {
  return value === null ? '—' : `${decimalFormatter.format(value)} mm`
}

function formatWind(value: number | null): string {
  return value === null ? '—' : `${integerFormatter.format(value)} km/h`
}

function formatVisibility(value: number | null): string {
  if (value === null) {
    return '—'
  }

  return value < 1000
    ? `${integerFormatter.format(value)} m`
    : `${decimalFormatter.format(value / 1000)} km`
}

function formatElevation(value: number | null): string {
  return value === null ? '—' : `${integerFormatter.format(value)} m`
}

function renderMetric(label: string, value: string, className = ''): string {
  const classAttribute = className.length === 0 ? '' : ` class="${className}"`
  return `
    <div${classAttribute}>
      <dt>${escapeHtml(label)}</dt>
      <dd>${escapeHtml(value)}</dd>
    </div>`
}

function renderModeTag(mode: WeatherDisplayMode): string {
  return `<span class="tag tag--mode tag--mode-${mode}" data-weather-mode-tag="${mode}">${escapeHtml(displayModeLabels[mode])}</span>`
}

function renderRideMetrics(summary: RideWeatherSummary): string {
  return `
    <dl class="weather-detail__metrics">
      ${renderMetric(
        'Température',
        formatTemperatureRange(summary.temperatureMinC, summary.temperatureMaxC),
      )}
      ${renderMetric(
        'Ressenti',
        formatTemperatureRange(
          summary.apparentTemperatureMinC,
          summary.apparentTemperatureMaxC,
        ),
      )}
      ${renderMetric(
        'Risque de pluie',
        formatPercentage(summary.precipitationProbabilityMaxPct),
      )}
      ${renderMetric(
        'Précipitations horaires',
        formatPrecipitation(summary.hourlyPrecipitationMaxMm),
      )}
      ${renderMetric('Vent maximum', formatWind(summary.windSpeedMaxKph))}
      ${renderMetric('Rafales maximum', formatWind(summary.windGustsMaxKph))}
      ${renderMetric(
        'Visibilité minimum',
        formatVisibility(summary.visibilityMinM),
      )}
      ${renderMetric(
        'Isotherme zéro minimum',
        formatElevation(summary.freezingLevelMinM),
      )}
      ${renderMetric(
        'Conditions les plus défavorables',
        getWeatherCodeLabel(summary.worstWeatherCode),
        'weather-detail__metric--full',
      )}
    </dl>`
}

function formatForecastOffset(value: number | null): string {
  if (value === null) {
    return 'écart indisponible'
  }

  const sign = value > 0 ? '+' : value < 0 ? '−' : ''
  return `écart ${sign}${integerFormatter.format(Math.abs(value))} min`
}

function renderWaypointEta(
  point: WeatherSamplePoint,
  etaLocal: string,
): string {
  return point.eta === undefined
    ? '<span>indisponible</span>'
    : renderRouteClock(point.eta, etaLocal)
}

function renderWaypointWeather(
  item: WaypointWeather,
  variantClass = '',
  alerts: readonly WeatherAlert[] = [],
): string {
  const point = item.samplePoint
  const forecastTime =
    item.forecastTimeLocal === null
      ? '<span>Heure météo indisponible</span>'
      : `<time datetime="${escapeHtml(item.forecastTimeLocal)}">${escapeHtml(formatLocalTime(item.forecastTimeLocal))}</time>`
  const commonAttributes = `
    data-weather-waypoint
    data-weather-waypoint-id="${escapeHtml(point.id)}"
    data-weather-state="${item.state}"
    data-weather-eta="${escapeHtml(item.etaLocal)}"
    data-weather-sample-time="${escapeHtml(item.forecastTimeLocal ?? '')}"
    data-weather-offset-minutes="${item.forecastOffsetMinutes ?? ''}"`

  if (item.state === 'unavailable' || item.weather === null) {
    return `
      <li class="weather-waypoint weather-waypoint--unavailable ${variantClass}" ${commonAttributes}>
        <div class="weather-waypoint__heading">
          <div>
            <span>${pointTypeLabels[point.type]}</span>
            <strong>${escapeHtml(point.name)}</strong>
          </div>
          <span class="tag tag--error">Indisponible</span>
        </div>
        <div class="weather-waypoint__times">
          <span>ETA ${renderWaypointEta(point, item.etaLocal)}</span>
          <span>${forecastTime}</span>
        </div>
        <p>${escapeHtml(item.reason ?? 'Aucune prévision horaire exploitable pour ce point.')}</p>
      </li>`
  }

  const weather = item.weather
  return `
    <li class="weather-waypoint ${variantClass}" ${commonAttributes}>
      <div class="weather-waypoint__heading">
        <div>
          <span>${pointTypeLabels[point.type]}</span>
          <strong>${escapeHtml(point.name)}</strong>
        </div>
        <strong>${formatTemperature(weather.temperatureC)}</strong>
      </div>
      ${renderAlertBadges(alerts)}
      <div class="weather-waypoint__times">
        <span>ETA ${renderWaypointEta(point, item.etaLocal)}</span>
        <span>
          Prévision ${forecastTime} · ${formatForecastOffset(item.forecastOffsetMinutes)}
        </span>
      </div>
      <p class="weather-waypoint__condition">
        ${escapeHtml(getWeatherCodeLabel(weather.weatherCode))}
      </p>
      <dl class="weather-waypoint__metrics">
        ${renderMetric('Altitude', formatElevation(point.elevationM))}
        ${renderMetric(
          'Ressenti',
          formatTemperature(weather.apparentTemperatureC),
        )}
        ${renderMetric(
          'Pluie',
          `${formatPercentage(weather.precipitationProbabilityPct)} · ${formatPrecipitation(weather.precipitationMm)}`,
        )}
        ${renderMetric('Vent', formatWind(weather.windSpeedKph))}
        ${renderMetric('Rafales', formatWind(weather.windGustsKph))}
        ${renderMetric('Visibilité', formatVisibility(weather.visibilityM))}
        ${renderMetric('Isotherme 0 °C', formatElevation(weather.freezingLevelM))}
      </dl>
    </li>`
}

function splitEssentialWaypoints(
  waypoints: readonly WaypointWeather[],
): { readonly essential: readonly WaypointWeather[]; readonly other: readonly WaypointWeather[]; readonly references: readonly WaypointWeather[] } {
  const essential: WaypointWeather[] = []
  const other: WaypointWeather[] = []
  const references: WaypointWeather[] = []

  for (const item of waypoints) {
    if (item.samplePoint.role === 'weather-reference') references.push(item)
    else (ESSENTIAL_POINT_TYPES.has(item.samplePoint.type) ? essential : other).push(item)
  }

  return { essential, other, references }
}

function renderWeatherReferences(waypoints: readonly WaypointWeather[]): string {
  if (waypoints.length === 0) return ''
  return `<details class="weather-detail__disclosure" data-weather-references><summary>Météo des lieux proches et arrêts possibles (${waypoints.length})</summary><p class="weather-detail__notice">Hors parcours : météo aux coordonnées réelles, heure du point GPX le plus proche. Sans effet sur la distance, les ETA ou le risque global tant que l’arrêt n’est pas planifié.</p><ol class="weather-waypoint-list">${waypoints.map((item) => renderWaypointWeather(item)).join('')}</ol></details>`
}

function renderOtherPassagesDisclosure(
  waypoints: readonly WaypointWeather[],
  alerts: readonly WeatherAlert[] = [],
): string {
  if (waypoints.length === 0) {
    return ''
  }

  return `
    <details class="weather-detail__disclosure" data-weather-other-passages>
      <summary>Autres passages (${waypoints.length})</summary>
      <ol class="weather-waypoint-list">
        ${waypoints
          .map((item) =>
            renderWaypointWeather(item, '', getAlertsForPoint(alerts, item.samplePoint.id)),
          )
          .join('')}
      </ol>
    </details>`
}

function renderRideDayHeading(
  data: RideDayWeather,
  mode: WeatherDisplayMode,
  title: string,
): string {
  return `
    <header class="weather-detail__day-heading">
      <div>
        <span class="tag tag--ride">${data.dayId} · Roulé</span>
        ${renderModeTag(mode)}
        <h3>${escapeHtml(title)}</h3>
      </div>
      <time datetime="${data.tripDate}">${escapeHtml(formatTripDate(data.tripDate))}</time>
    </header>`
}

function renderRiskSummaryAlertLine(alert: WeatherAlert): string {
  return `
    <li class="weather-risk-summary__alert" data-weather-alert-level="${alert.level}">
      <span class="tag ${getRiskLevelTagClass(alert.level)}">${escapeHtml(alert.title)}</span>
      <span>${escapeHtml(alert.summary)}</span>
    </li>`
}

/**
 * The synthetic risk block shown above a day's timeline: global level, the
 * two or three most severe alerts, and — only when it's not 1 — the coverage
 * ratio behind that level (Phase D, sections F and L).
 */
function renderRiskSummary(risk: DayWeatherRiskSummary): string {
  const priorityAlerts = [...risk.alerts]
    .filter((alert) => alert.isOperational !== false)
    .sort((left, right) => riskLevelOrder(right.level) - riskLevelOrder(left.level))
    .slice(0, 3)
  const totalPointCount = risk.coveredPointCount + risk.missingPointCount
  const coverageNote =
    totalPointCount === 0 || risk.coveredPointCount === totalPointCount
      ? ''
      : `<p class="weather-risk-summary__coverage">${integerFormatter.format(risk.coveredPointCount)}/${integerFormatter.format(totalPointCount)} points couverts.</p>`

  return `
    <section class="weather-risk-summary" data-weather-risk-summary data-weather-risk-level="${risk.level}">
      <div class="weather-risk-summary__heading">
        ${renderRiskLevelTag(risk.level)}
        <span>${risk.redCount} alerte(s) rouge · ${risk.orangeCount} orange</span>
      </div>
      ${
        priorityAlerts.length === 0
          ? '<p class="weather-detail__empty">Aucun risque notable détecté.</p>'
          : `<ul class="weather-risk-summary__alerts">${priorityAlerts.map(renderRiskSummaryAlertLine).join('')}</ul>`
      }
      ${coverageNote}
    </section>`
}

function formatOffsetLabel(offsetMinutes: number): string {
  if (offsetMinutes === 0) {
    return 'Horaire actuel'
  }

  const sign = offsetMinutes > 0 ? '+' : '−'
  return `${sign}${decimalFormatter.format(Math.abs(offsetMinutes) / 60)} h`
}

function renderScenarioRow(
  scenario: DepartureWeatherScenario,
  recommendation: DepartureRecommendation,
): string {
  const isRecommended = recommendation.recommendedScenario?.offsetMinutes === scenario.offsetMinutes
  const classes = [
    'weather-scenario',
    scenario.isCurrent ? 'weather-scenario--current' : '',
    isRecommended ? 'weather-scenario--recommended' : '',
    scenario.isCoherent ? '' : 'weather-scenario--incoherent',
  ]
    .filter((value) => value !== '')
    .join(' ')

  return `
    <li class="${classes}" data-weather-scenario-offset="${scenario.offsetMinutes}">
      <div class="weather-scenario__heading">
        <strong>${escapeHtml(formatOffsetLabel(scenario.offsetMinutes))}</strong>
        ${scenario.isCurrent ? '<span class="tag tag--data">Actuel</span>' : ''}
        ${isRecommended ? '<span class="tag tag--risk-green">Suggéré</span>' : ''}
        ${renderRiskLevelTag(scenario.risk.level)}
      </div>
      <p class="weather-scenario__times">
        Départ ${escapeHtml(formatLocalTime(scenario.departureTimeLocal))} ·
        Arrivée ${escapeHtml(formatLocalTime(scenario.arrivalTimeLocal))}
      </p>
      ${
        scenario.isCoherent
          ? `
            <dl class="weather-scenario__metrics">
              ${renderMetric('Alertes', `${scenario.risk.redCount} rouge · ${scenario.risk.orangeCount} orange`)}
              ${renderMetric('Pluie maximale', formatPrecipitation(scenario.maximumRainMm))}
              ${renderMetric('Rafales maximales', formatWind(scenario.maximumGustKph))}
              ${renderMetric('Ressenti minimal', formatTemperature(scenario.minimumApparentTemperatureC))}
            </dl>`
          : `<p class="weather-detail__empty">${escapeHtml(scenario.incoherenceReason ?? 'Scénario incohérent.')}</p>`
      }
    </li>`
}

/**
 * The five-scenario comparison, always in a collapsible section (Phase D,
 * section M: "afficher les cinq scénarios uniquement dans une section
 * repliable"). In `planning` mode it is computed exactly the same way but
 * labelled preliminary, since no firm recommendation is made yet at that
 * range.
 */
function renderScenarioComparison(
  scenarios: readonly DepartureWeatherScenario[],
  recommendation: DepartureRecommendation,
  options: { readonly preliminary?: boolean } = {},
): string {
  if (scenarios.length === 0) {
    return ''
  }

  const label = options.preliminary === true
    ? `Comparaison des départs (aperçu préliminaire, ${scenarios.length})`
    : `Comparaison des départs (${scenarios.length})`

  return `
    <details class="weather-detail__disclosure" data-weather-scenario-comparison>
      <summary>${escapeHtml(label)}</summary>
      <ul class="weather-scenario-list">
        ${scenarios.map((scenario) => renderScenarioRow(scenario, recommendation)).join('')}
      </ul>
    </details>`
}

/**
 * The one-sentence conclusion shown in the main (non-collapsible) area —
 * never the full scenario table there (Phase D, section M).
 */
function renderRecommendationConclusion(recommendation: DepartureRecommendation): string {
  if (recommendation.status === 'not-applicable') {
    return ''
  }

  const emphasisClass =
    recommendation.status === 'recommended-change' ? 'weather-recommendation--change' : ''

  return `
    <p
      class="weather-recommendation ${emphasisClass}"
      data-weather-recommendation-status="${recommendation.status}"
    >
      ${escapeHtml(recommendation.title)}
    </p>`
}

const trendRiskTypeDescriptors: Partial<Record<WeatherAlert['riskType'], string>> = {
  wind: 'venteuse',
  gust: 'venteuse sur les hauts cols',
  precipitation: 'pluvieuse',
  thunderstorm: 'orageuse',
  snow: 'avec de la neige possible en altitude',
  cold: 'froide en altitude',
  heat: 'chaude',
  visibility: 'brumeuse',
  'freezing-level': 'avec un isotherme bas',
}

/**
 * Trend mode never shows per-waypoint alerts or a decisive time — only a
 * cautious, worded-down sentence about the worst risk type still standing
 * out from the fully computed (but otherwise hidden) day risk.
 */
function describeTrendAdvisory(risk: DayWeatherRiskSummary): string {
  const operational = risk.alerts.filter((alert) => alert.isOperational !== false)

  if (operational.length === 0) {
    return 'Tendance calme sur les prévisions disponibles à cette échéance, à confirmer plus près de la date.'
  }

  const [worst] = [...operational].sort(
    (left, right) => riskLevelOrder(right.level) - riskLevelOrder(left.level),
  )
  const descriptor = worst === undefined ? undefined : trendRiskTypeDescriptors[worst.riskType]

  return descriptor === undefined
    ? 'Tendance encore incertaine à cette échéance, à confirmer plus près de la date.'
    : `Tendance ${descriptor} possible, à confirmer plus près de la date.`
}

function renderTrendRide(
  data: RideDayWeather,
  mode: WeatherDisplayMode,
  risk: DayWeatherRiskSummary,
): string {
  return `
    <section
      class="weather-detail__day weather-detail__day--trend"
      data-weather-ride-summary
    >
      ${renderRideDayHeading(data, mode, 'Tendance — susceptible d’évoluer')}
      ${renderRideMetrics(data.routeSummary)}
      <p class="weather-detail__notice" role="status">${escapeHtml(describeTrendAdvisory(risk))}</p>
    </section>`
}

function getEtaHour(etaLocal: string): number {
  const match = /T(?<hour>\d{2}):/.exec(etaLocal)
  const hour = Number(match?.groups?.hour)
  return Number.isSafeInteger(hour) ? hour : 12
}

interface TimeOfDayBuckets {
  readonly morning: readonly WaypointWeather[]
  readonly midday: readonly WaypointWeather[]
  readonly afternoon: readonly WaypointWeather[]
  readonly evening: readonly WaypointWeather[]
}

function bucketByTimeOfDay(waypoints: readonly WaypointWeather[]): TimeOfDayBuckets {
  const morning: WaypointWeather[] = []
  const midday: WaypointWeather[] = []
  const afternoon: WaypointWeather[] = []
  const evening: WaypointWeather[] = []

  for (const item of waypoints) {
    const hour = getEtaHour(item.etaLocal)
    const bucket = hour < 12 ? morning : hour < 15 ? midday : hour < 19 ? afternoon : evening
    bucket.push(item)
  }

  return { morning, midday, afternoon, evening }
}

function renderTimeOfDayGroup(
  title: string,
  waypoints: readonly WaypointWeather[],
  alerts: readonly WeatherAlert[],
): string {
  if (waypoints.length === 0) {
    return ''
  }

  return `
    <div class="weather-detail__time-group">
      <h5>${escapeHtml(title)}</h5>
      <ol class="weather-waypoint-list weather-waypoint-list--compact">
        ${waypoints
          .map((item) => renderWaypointWeather(item, '', getAlertsForPoint(alerts, item.samplePoint.id)))
          .join('')}
      </ol>
    </div>`
}

function renderPlanningRide(
  data: RideDayWeather,
  mode: WeatherDisplayMode,
  risk: DayWeatherRiskSummary,
  scenarios: readonly DepartureWeatherScenario[],
  recommendation: DepartureRecommendation,
): string {
  const start = data.waypoints.find(({ samplePoint }) => samplePoint.type === 'start')
  const end = data.waypoints.find(({ samplePoint }) => samplePoint.type === 'end')
  const middle = data.waypoints.filter((item) => item !== start && item !== end)
  const buckets = bucketByTimeOfDay(middle)

  return `
    <section
      class="weather-detail__day weather-detail__day--planning"
      data-weather-ride-summary
    >
      ${renderRideDayHeading(data, mode, 'Prévision de planification')}
      ${renderRiskSummary(risk)}
      ${renderRideMetrics(data.routeSummary)}
      <section class="weather-detail__timeline" aria-label="Planification de la journée">
        ${start === undefined ? '' : `<ol class="weather-waypoint-list weather-waypoint-list--compact">${renderWaypointWeather(start, '', getAlertsForPoint(risk.alerts, start.samplePoint.id))}</ol>`}
        ${renderTimeOfDayGroup('Matin', buckets.morning, risk.alerts)}
        ${renderTimeOfDayGroup('Milieu de journée', buckets.midday, risk.alerts)}
        ${renderTimeOfDayGroup('Après-midi', buckets.afternoon, risk.alerts)}
        ${renderTimeOfDayGroup('Soirée', buckets.evening, risk.alerts)}
        ${end === undefined ? '' : `<ol class="weather-waypoint-list weather-waypoint-list--compact">${renderWaypointWeather(end, '', getAlertsForPoint(risk.alerts, end.samplePoint.id))}</ol>`}
      </section>
      ${renderScenarioComparison(scenarios, recommendation, { preliminary: true })}
    </section>`
}

function renderOperationalRide(
  data: RideDayWeather,
  mode: WeatherDisplayMode,
  risk: DayWeatherRiskSummary,
  scenarios: readonly DepartureWeatherScenario[],
  recommendation: DepartureRecommendation,
): string {
  const { essential, other, references } = splitEssentialWaypoints(data.waypoints)
  const summary = data.routeSummary
  const totalPointCount = summary.coveredPointCount + summary.missingPointCount

  return `
    <section
      class="weather-detail__day weather-detail__day--operational"
      data-weather-ride-summary
    >
      ${renderRideDayHeading(data, mode, 'Prévision opérationnelle')}
      ${renderRiskSummary(risk)}
      ${renderRecommendationConclusion(recommendation)}
      <p class="weather-detail__coverage">
        ${summary.coveredPointCount}/${totalPointCount} points couverts par une prévision horaire.
      </p>
      ${renderRideMetrics(summary)}
      <section class="weather-detail__timeline" aria-labelledby="weather-timeline-title">
        <div class="weather-detail__subheading">
          <h4 id="weather-timeline-title">Départ, cols et arrivée</h4>
          <span>Heure retenue et décalage par rapport à l’ETA</span>
        </div>
        ${
          essential.length === 0
            ? '<p class="weather-detail__empty">Aucun point météo disponible pour cette journée.</p>'
            : `<ol class="weather-waypoint-list">${essential.map((item) => renderWaypointWeather(item, '', getAlertsForPoint(risk.alerts, item.samplePoint.id))).join('')}</ol>`
        }
        ${renderOtherPassagesDisclosure(other, risk.alerts)}
        ${renderWeatherReferences(references)}
      </section>
      ${renderScenarioComparison(scenarios, recommendation)}
    </section>`
}

function renderLiveRide(
  data: RideDayWeather,
  mode: WeatherDisplayMode,
  progress: LiveProgress,
  hasDeparted: boolean,
  risk: DayWeatherRiskSummary,
  scenarios: readonly DepartureWeatherScenario[],
  recommendation: DepartureRecommendation,
): string {
  const { essential: upcomingEssential, other: upcomingOther, references: upcomingReferences } = splitEssentialWaypoints(
    progress.upcoming,
  )
  const nextAlerts =
    progress.next === null ? [] : getAlertsForPoint(risk.alerts, progress.next.samplePoint.id)

  return `
    <section
      class="weather-detail__day weather-detail__day--live"
      data-weather-ride-summary
    >
      ${renderRideDayHeading(data, mode, 'En cours — journée du jour')}
      <p class="weather-detail__notice" role="status">
        Position estimée selon les réglages, sans suivi GPS.
      </p>
      ${hasDeparted ? renderRiskSummary(risk) : renderRecommendationConclusion(recommendation)}
      <section class="weather-detail__timeline" aria-label="Point théorique actuel">
        <div class="weather-detail__subheading">
          <h4>Prochain point théorique</h4>
        </div>
        ${
          progress.next === null
            ? '<p class="weather-detail__empty">Journée théoriquement terminée : tous les points sont déjà passés.</p>'
            : `<ol class="weather-waypoint-list">${renderWaypointWeather(progress.next, 'weather-waypoint--next', nextAlerts)}</ol>`
        }
      </section>
      ${
        progress.past.length === 0
          ? ''
          : `
            <details class="weather-detail__disclosure" data-weather-past-waypoints>
              <summary>Repères déjà passés (${progress.past.length})</summary>
              <ol class="weather-waypoint-list weather-waypoint-list--past">
                ${progress.past.map((item) => renderWaypointWeather(item, 'weather-waypoint--past', getAlertsForPoint(risk.alerts, item.samplePoint.id))).join('')}
              </ol>
            </details>`
      }
      <section class="weather-detail__timeline" aria-labelledby="weather-upcoming-title">
        <div class="weather-detail__subheading">
          <h4 id="weather-upcoming-title">Prévisions à venir</h4>
        </div>
        ${
          upcomingEssential.length === 0
            ? '<p class="weather-detail__empty">Aucun point suivant.</p>'
            : `<ol class="weather-waypoint-list">${upcomingEssential.map((item) => renderWaypointWeather(item, '', getAlertsForPoint(risk.alerts, item.samplePoint.id))).join('')}</ol>`
        }
        ${renderOtherPassagesDisclosure(upcomingOther, risk.alerts)}
        ${renderWeatherReferences(upcomingReferences)}
      </section>
      ${hasDeparted ? '' : renderScenarioComparison(scenarios, recommendation)}
    </section>`
}

function renderRideDay(
  data: RideDayWeather,
  mode: WeatherDisplayMode,
  risk: DayWeatherRiskSummary,
  scenarios: readonly DepartureWeatherScenario[],
  recommendation: DepartureRecommendation,
  liveProgress: LiveProgress | null,
): string {
  switch (mode) {
    case 'trend':
      return renderTrendRide(data, mode, risk)
    case 'planning':
      return renderPlanningRide(data, mode, risk, scenarios, recommendation)
    case 'live': {
      const progress = liveProgress ?? { past: [], next: null, upcoming: [] }
      const hasDeparted =
        progress.next === null ||
        progress.past.some(({ samplePoint }) => samplePoint.type === 'start')
      return renderLiveRide(data, mode, progress, hasDeparted, risk, scenarios, recommendation)
    }
    case 'operational':
    default:
      return renderOperationalRide(data, mode, risk, scenarios, recommendation)
  }
}

function getOffHourlySamples(data: OffDayWeather): readonly NormalizedHourlyWeather[] {
  const dayHours = data.hourly.filter(({ time }) =>
    time.startsWith(`${data.tripDate}T`),
  )
  const threeHourly = dayHours.filter(({ time }) => {
    const hour = Number(/T(?<hour>\d{2}):/.exec(time)?.groups?.hour)
    return Number.isSafeInteger(hour) && hour % 3 === 0
  })

  return threeHourly.length > 0 ? threeHourly : dayHours.slice(0, 8)
}

function renderOffDailyMetrics(
  daily: NormalizedDailyWeather | null,
  summary: RideWeatherSummary,
): string {
  return `
    <dl class="weather-detail__metrics">
      ${renderMetric(
        'Température',
        formatTemperatureRange(
          daily?.temperatureMinC ?? summary.temperatureMinC,
          daily?.temperatureMaxC ?? summary.temperatureMaxC,
        ),
      )}
      ${renderMetric(
        'Ressenti',
        formatTemperatureRange(
          daily?.apparentTemperatureMinC ?? summary.apparentTemperatureMinC,
          daily?.apparentTemperatureMaxC ?? summary.apparentTemperatureMaxC,
        ),
      )}
      ${renderMetric(
        'Risque de pluie',
        formatPercentage(
          daily?.precipitationProbabilityMaxPct ??
            summary.precipitationProbabilityMaxPct,
        ),
      )}
      ${renderMetric(
        'Précipitations',
        formatPrecipitation(
          daily?.precipitationSumMm ?? summary.hourlyPrecipitationMaxMm,
        ),
      )}
      ${renderMetric(
        'Vent maximum',
        formatWind(daily?.windSpeedMaxKph ?? summary.windSpeedMaxKph),
      )}
      ${renderMetric(
        'Rafales maximum',
        formatWind(daily?.windGustsMaxKph ?? summary.windGustsMaxKph),
      )}
      ${renderMetric('Lever du soleil', formatLocalTime(daily?.sunrise ?? null))}
      ${renderMetric(
        'Coucher du soleil',
        formatLocalTime(daily?.sunset ?? null),
      )}
    </dl>`
}

function renderOffHourlyWeather(item: NormalizedHourlyWeather): string {
  return `
    <li data-weather-off-hour data-weather-time="${escapeHtml(item.time)}">
      <time datetime="${escapeHtml(item.time)}">${escapeHtml(formatLocalTime(item.time))}</time>
      <strong>${formatTemperature(item.temperatureC)}</strong>
      <span>${escapeHtml(getWeatherCodeLabel(item.weatherCode))}</span>
      <small>
        Pluie ${formatPercentage(item.precipitationProbabilityPct)} ·
        Vent ${formatWind(item.windSpeedKph)}
      </small>
    </li>`
}

const offModeTitles: Record<WeatherDisplayMode, string> = {
  'today-reference': 'Aujourd’hui sur le parcours',
  trend: 'Tendance — susceptible d’évoluer',
  planning: 'Prévision de planification',
  operational: 'Prévision opérationnelle',
  live: 'Météo du jour',
  past: 'Journée terminée',
}

function renderOffDay(
  data: OffDayWeather,
  mode: WeatherDisplayMode,
  risk: DayWeatherRiskSummary,
): string {
  const showHourly = mode !== 'trend'
  const hourlySamples = showHourly ? getOffHourlySamples(data) : []

  return `
    <section
      class="weather-detail__day weather-detail__day--off"
      data-weather-off-summary
    >
      <header class="weather-detail__day-heading">
        <div>
          <span class="tag tag--off">${data.dayId} · OFF</span>
          ${renderModeTag(mode)}
          <h3>${escapeHtml(data.samplePoint.name)} — ${escapeHtml(offModeTitles[mode])}</h3>
        </div>
        <time datetime="${data.tripDate}">${escapeHtml(formatTripDate(data.tripDate))}</time>
      </header>
      <p class="weather-detail__condition">
        ${escapeHtml(getWeatherCodeLabel(data.daily?.weatherCode ?? data.localSummary.worstWeatherCode))}
      </p>
      ${renderRiskSummary(risk)}
      ${renderOffDailyMetrics(data.daily, data.localSummary)}
      ${
        !showHourly
          ? ''
          : `
            <section class="weather-detail__timeline" aria-labelledby="weather-off-hourly-title">
              <div class="weather-detail__subheading">
                <h4 id="weather-off-hourly-title">Aperçu horaire local</h4>
                <span>Pas de trois heures</span>
              </div>
              ${
                hourlySamples.length === 0
                  ? '<p class="weather-detail__empty">Aucune donnée horaire locale disponible.</p>'
                  : `
                    <ol class="weather-off-hourly">
                      ${hourlySamples.map(renderOffHourlyWeather).join('')}
                    </ol>`
              }
            </section>`
      }
    </section>`
}

function renderTodayReferenceBlock(
  dayId: string,
  tripDate: string,
  reference: TodayReferenceWeather | null,
  fetchedAt: string | null,
): string {
  const metrics =
    reference === null
      ? '<p class="weather-detail__empty">Aucune donnée du jour disponible pour le moment.</p>'
      : `
        <dl class="weather-detail__metrics">
          ${renderMetric(
            'Température du jour',
            formatTemperatureRange(reference.temperatureMinC, reference.temperatureMaxC),
          )}
          ${renderMetric('Précipitations du jour', formatPrecipitation(reference.precipitationSumMm))}
          ${renderMetric('Probabilité maximale', formatPercentage(reference.precipitationProbabilityMaxPct))}
          ${renderMetric('Vent maximal', formatWind(reference.windSpeedMaxKph))}
          ${renderMetric('Rafales maximales', formatWind(reference.windGustsMaxKph))}
          ${renderMetric('Condition générale', getWeatherCodeLabel(reference.weatherCode))}
        </dl>`

  return `
    <section
      class="weather-detail__day weather-detail__day--today-reference"
      data-weather-today-reference
    >
      <header class="weather-detail__day-heading">
        <div>
          <span class="tag tag--variant">${escapeHtml(dayId)} · Hors horizon</span>
          <h3>Aujourd’hui sur le parcours</h3>
        </div>
        <time datetime="${escapeHtml(tripDate)}">${escapeHtml(formatTripDate(tripDate))}</time>
      </header>
      <p class="weather-detail__notice" role="status">
        Information du jour, sans valeur prévisionnelle pour le ${escapeHtml(formatLongTripDate(tripDate))}.
      </p>
      ${metrics}
      <p class="weather-detail__metadata">
        <span>${fetchedAt === null ? 'Aucune mise à jour' : `Dernière actualisation ${escapeHtml(formatFetchedAt(fetchedAt))}`}</span>
      </p>
    </section>`
}

function renderPastBlock(dayId: string, tripDate: string, data: WeatherDayData | null): string {
  const lastSummary =
    data === null
      ? '<p class="weather-detail__empty">Aucun résumé conservé pour cette journée.</p>'
      : data.type === 'ride'
        ? renderRideMetrics(data.routeSummary)
        : renderOffDailyMetrics(data.daily, data.localSummary)

  return `
    <section class="weather-detail__day weather-detail__day--past" data-weather-past-day>
      <header class="weather-detail__day-heading">
        <div>
          <span class="tag tag--data">${escapeHtml(dayId)} · Terminée</span>
          <h3>Journée passée</h3>
        </div>
        <time datetime="${tripDate}">${escapeHtml(formatTripDate(tripDate))}</time>
      </header>
      <p class="weather-detail__notice" role="status">
        Journée déjà passée : dernier résumé conservé, aucune actualisation automatique.
      </p>
      ${lastSummary}
    </section>`
}

function getStateMessage(state: WeatherDayState, mode: WeatherDisplayMode): string | null {
  if (mode === 'past') {
    return null
  }

  if (state.isRefreshing) {
    return 'Actualisation en cours ; les dernières données valides restent affichées.'
  }

  if (state.message !== undefined && state.message.trim() !== '') {
    return state.message
  }

  switch (state.availability) {
    case 'loading':
      return 'Chargement de la météo en cours.'
    case 'available':
      return null
    case 'partial':
      return 'Certaines données météo sont indisponibles.'
    case 'outside-horizon':
      return 'Prévision non disponible à cette échéance.'
    case 'stale-cache':
      return 'Le dernier résultat valide est conservé, mais doit être actualisé.'
    case 'unavailable':
      return 'Aucune donnée météo n’est disponible pour cette journée.'
    case 'error':
      return 'La météo n’a pas pu être actualisée.'
  }
}

function renderStateNotice(state: WeatherDayState, mode: WeatherDisplayMode): string {
  const message = getStateMessage(state, mode)

  if (message === null) {
    return ''
  }

  const role =
    state.availability === 'error' && state.data === null ? 'alert' : 'status'
  return `
    <p
      class="weather-detail__notice"
      data-weather-notice
      role="${role}"
      aria-live="polite"
    >
      ${escapeHtml(message)}
    </p>`
}

function getAvailabilityTagClass(
  availability: WeatherAvailability,
): string {
  switch (availability) {
    case 'partial':
    case 'outside-horizon':
    case 'stale-cache':
      return 'tag--variant'
    case 'unavailable':
    case 'error':
      return 'tag--error'
    case 'loading':
    case 'available':
      return 'tag--data'
  }
}

function renderUpdateMetadata(state: WeatherDayState): string {
  const sourceLabel =
    state.source === 'network'
      ? 'Réseau'
      : state.source === 'cache'
        ? 'Cache local'
        : 'Aucune source'
  const fetchedAt =
    state.fetchedAt === null
      ? 'Aucune mise à jour'
      : `Mise à jour ${formatFetchedAt(state.fetchedAt)}`
  const cacheLabel =
    state.cacheState === 'fresh'
      ? 'Cache frais'
      : state.cacheState === 'stale'
        ? 'Cache périmé'
        : 'Cache absent'
  const firstReceivedDate = state.receivedDates[0]
  const lastReceivedDate = state.receivedDates.at(-1)
  const receivedHorizon =
    firstReceivedDate === undefined || lastReceivedDate === undefined
      ? 'Horizon reçu indisponible'
      : firstReceivedDate === lastReceivedDate
        ? `Horizon reçu : ${formatTripDate(firstReceivedDate)}`
        : `Horizon reçu : ${formatTripDate(firstReceivedDate)} – ${formatTripDate(lastReceivedDate)}`

  return `
    <p class="weather-detail__metadata">
      <span>${sourceLabel}</span>
      <span>${cacheLabel}</span>
      <span>${escapeHtml(fetchedAt)}</span>
      <span>${escapeHtml(receivedHorizon)}</span>
    </p>`
}

function clearWeatherDetailData(container: HTMLElement): void {
  delete container.dataset.weatherDayId
  delete container.dataset.weatherDayType
  delete container.dataset.weatherSource
  delete container.dataset.weatherCacheState
  delete container.dataset.weatherRefreshing
  delete container.dataset.weatherHasData
  delete container.dataset.weatherStale
  delete container.dataset.weatherFetchedAt
  delete container.dataset.weatherMode
}

export function renderWeatherDetailLoading(
  container: HTMLElement,
  previousState: WeatherDayState | null = null,
  now: Date = new Date(),
): void {
  if (previousState !== null && previousState.data !== null) {
    renderWeatherDetail(
      container,
      { ...previousState, availability: 'loading', isRefreshing: true },
      now,
    )
    return
  }

  clearWeatherDetailData(container)
  container.dataset.weatherState = 'loading'
  container.dataset.weatherSource = 'none'
  container.dataset.weatherRefreshing = 'true'
  container.dataset.weatherHasData = 'false'
  container.setAttribute('aria-busy', 'true')
  container.innerHTML = `
    <p class="weather-detail__message" role="status" aria-live="polite">
      Chargement de la météo de la journée…
    </p>`
}

export function renderWeatherDetail(
  container: HTMLElement,
  state: WeatherDayState,
  now: Date = new Date(),
): void {
  clearWeatherDetailData(container)

  const today = getDateInTimezone(now, weatherConfig.timezone)
  const coverage = getCoverageFromDates(state.receivedDates)
  const mode = selectWeatherDisplayMode({
    today,
    tripDate: state.tripDate,
    coverage,
  })

  container.dataset.weatherState = state.availability
  container.dataset.weatherMode = mode
  container.dataset.weatherDayId = state.dayId
  container.dataset.weatherDayType = state.dayType
  container.dataset.weatherSource = state.source
  container.dataset.weatherCacheState = state.cacheState
  container.dataset.weatherRefreshing = String(state.isRefreshing)
  container.dataset.weatherHasData = String(state.data !== null)
  container.dataset.weatherStale = String(
    state.availability === 'stale-cache' || state.cacheState === 'stale',
  )

  if (state.fetchedAt !== null) {
    container.dataset.weatherFetchedAt = state.fetchedAt
  }

  container.setAttribute(
    'aria-busy',
    String(state.availability === 'loading' || state.isRefreshing),
  )

  if (
    state.data !== null &&
    (state.data.dayId !== state.dayId || state.data.type !== state.dayType)
  ) {
    container.dataset.weatherState = 'error'
    container.setAttribute('aria-busy', 'false')
    container.innerHTML = `
      <div class="weather-detail__message weather-detail__message--error" role="alert">
        Données météo incohérentes pour ${state.dayId}.
      </div>`
    return
  }

  if (mode === 'past') {
    container.innerHTML = renderPastBlock(state.dayId, state.tripDate, state.data)
    return
  }

  if (mode === 'today-reference') {
    container.innerHTML = renderTodayReferenceBlock(
      state.dayId,
      state.tripDate,
      state.data?.todayReference ?? null,
      state.fetchedAt,
    )
    return
  }

  const notice = renderStateNotice(state, mode)

  if (state.data === null) {
    container.innerHTML = `
      <div
        class="weather-detail__empty-state"
        data-weather-empty-state="${state.availability}"
      >
        <span class="tag ${getAvailabilityTagClass(state.availability)}">
          ${availabilityLabels[state.availability]}
        </span>
        ${renderModeTag(mode)}
        <time datetime="${state.tripDate}">${escapeHtml(formatTripDate(state.tripDate))}</time>
        ${notice}
        ${renderUpdateMetadata(state)}
      </div>`
    return
  }

  const nowLocal = getNowLocalDateTime(now, weatherConfig.timezone)
  const liveProgress =
    mode === 'live' && state.data.type === 'ride'
      ? computeLiveProgress(state.data.waypoints, nowLocal)
      : null
  const upcomingPointIds =
    liveProgress === null
      ? null
      : new Set(
          [...(liveProgress.next === null ? [] : [liveProgress.next]), ...liveProgress.upcoming].map(
            ({ samplePoint }) => samplePoint.id,
          ),
        )
  const riskContext: DayRiskContext = { fetchedAt: state.fetchedAt, now, upcomingPointIds }
  const risk = evaluateDayRisk(state.dayId, state.data, riskContext)
  const cacheAgeMs = state.fetchedAt === null ? null : now.getTime() - Date.parse(state.fetchedAt)
  const hasDeparted =
    liveProgress !== null &&
    (liveProgress.next === null ||
      liveProgress.past.some(({ samplePoint }) => samplePoint.type === 'start'))
  const scenarios =
    state.data.type === 'ride' && Array.isArray(state.departureScenarios)
      ? attachRiskToScenarios(state.dayId, state.tripDate, state.departureScenarios, riskContext)
      : []
  const recommendation = buildDepartureRecommendation(scenarios, {
    mode,
    hasDeparted,
    cacheAgeMs,
  })

  container.innerHTML = `
    <div class="weather-detail__state">
      <span class="tag ${getAvailabilityTagClass(state.availability)}">${availabilityLabels[state.availability]}</span>
      ${notice}
    </div>
    ${
      state.data.type === 'ride'
        ? renderRideDay(state.data, mode, risk, scenarios, recommendation, liveProgress)
        : renderOffDay(state.data, mode, risk)
    }
    ${renderUpdateMetadata(state)}`
}

export function renderWeatherDetailError(
  container: HTMLElement,
  error: unknown,
  previousState: WeatherDayState | null = null,
  now: Date = new Date(),
): void {
  const message =
    error instanceof Error ? error.message : 'Erreur météo inconnue.'

  if (previousState !== null && previousState.data !== null) {
    renderWeatherDetail(
      container,
      { ...previousState, availability: 'error', isRefreshing: false, message },
      now,
    )
    return
  }

  clearWeatherDetailData(container)
  container.dataset.weatherState = 'error'
  container.dataset.weatherSource = 'none'
  container.dataset.weatherRefreshing = 'false'
  container.dataset.weatherHasData = 'false'
  container.setAttribute('aria-busy', 'false')
  container.innerHTML = `
    <div class="weather-detail__message weather-detail__message--error" role="alert">
      <strong>Météo indisponible</strong>
      <p>${escapeHtml(message)}</p>
    </div>`
}
