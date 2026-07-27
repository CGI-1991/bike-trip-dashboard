import { getDateInTimezone } from '../trip/calendar.ts'
import {
  computeLiveProgress,
  getCoverageFromDates,
  getNowLocalDateTime,
  selectWeatherDisplayMode,
} from '../weather/display-policy.ts'
import type { WeatherDisplayMode } from '../weather/display-policy.ts'
import {
  describeRouteClockTime,
  formatRouteClockTime,
} from '../route/time.ts'
import type { RouteClockTime } from '../route/types.ts'
import { weatherConfig } from '../weather/config.ts'
import { getWeatherCodeLabel } from '../weather/weather-code.ts'
import type {
  LocalIsoDateTime,
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

function renderMetric(label: string, value: string): string {
  return `
    <div>
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
): { readonly essential: readonly WaypointWeather[]; readonly other: readonly WaypointWeather[] } {
  const essential: WaypointWeather[] = []
  const other: WaypointWeather[] = []

  for (const item of waypoints) {
    ;(ESSENTIAL_POINT_TYPES.has(item.samplePoint.type) ? essential : other).push(item)
  }

  return { essential, other }
}

function renderOtherPassagesDisclosure(waypoints: readonly WaypointWeather[]): string {
  if (waypoints.length === 0) {
    return ''
  }

  return `
    <details class="weather-detail__disclosure" data-weather-other-passages>
      <summary>Autres passages (${waypoints.length})</summary>
      <ol class="weather-waypoint-list">
        ${waypoints.map((item) => renderWaypointWeather(item)).join('')}
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

function renderTrendRide(data: RideDayWeather, mode: WeatherDisplayMode): string {
  return `
    <section
      class="weather-detail__day weather-detail__day--trend"
      data-weather-ride-summary
    >
      ${renderRideDayHeading(data, mode, 'Tendance — susceptible d’évoluer')}
      ${renderRideMetrics(data.routeSummary)}
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

function renderTimeOfDayGroup(title: string, waypoints: readonly WaypointWeather[]): string {
  if (waypoints.length === 0) {
    return ''
  }

  return `
    <div class="weather-detail__time-group">
      <h5>${escapeHtml(title)}</h5>
      <ol class="weather-waypoint-list weather-waypoint-list--compact">
        ${waypoints.map((item) => renderWaypointWeather(item)).join('')}
      </ol>
    </div>`
}

function renderPlanningRide(data: RideDayWeather, mode: WeatherDisplayMode): string {
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
      ${renderRideMetrics(data.routeSummary)}
      <section class="weather-detail__timeline" aria-label="Planification de la journée">
        ${start === undefined ? '' : `<ol class="weather-waypoint-list weather-waypoint-list--compact">${renderWaypointWeather(start)}</ol>`}
        ${renderTimeOfDayGroup('Matin', buckets.morning)}
        ${renderTimeOfDayGroup('Milieu de journée', buckets.midday)}
        ${renderTimeOfDayGroup('Après-midi', buckets.afternoon)}
        ${renderTimeOfDayGroup('Soirée', buckets.evening)}
        ${end === undefined ? '' : `<ol class="weather-waypoint-list weather-waypoint-list--compact">${renderWaypointWeather(end)}</ol>`}
      </section>
    </section>`
}

function renderOperationalRide(data: RideDayWeather, mode: WeatherDisplayMode): string {
  const { essential, other } = splitEssentialWaypoints(data.waypoints)
  const summary = data.routeSummary
  const totalPointCount = summary.coveredPointCount + summary.missingPointCount

  return `
    <section
      class="weather-detail__day weather-detail__day--operational"
      data-weather-ride-summary
    >
      ${renderRideDayHeading(data, mode, 'Prévision opérationnelle')}
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
            : `<ol class="weather-waypoint-list">${essential.map((item) => renderWaypointWeather(item)).join('')}</ol>`
        }
        ${renderOtherPassagesDisclosure(other)}
      </section>
    </section>`
}

function renderLiveRide(
  data: RideDayWeather,
  mode: WeatherDisplayMode,
  nowLocal: LocalIsoDateTime,
): string {
  const progress = computeLiveProgress(data.waypoints, nowLocal)
  const { essential: upcomingEssential, other: upcomingOther } = splitEssentialWaypoints(
    progress.upcoming,
  )

  return `
    <section
      class="weather-detail__day weather-detail__day--live"
      data-weather-ride-summary
    >
      ${renderRideDayHeading(data, mode, 'En cours — journée du jour')}
      <p class="weather-detail__notice" role="status">
        Position estimée selon les réglages, sans suivi GPS.
      </p>
      <section class="weather-detail__timeline" aria-label="Point théorique actuel">
        <div class="weather-detail__subheading">
          <h4>Prochain point théorique</h4>
        </div>
        ${
          progress.next === null
            ? '<p class="weather-detail__empty">Journée théoriquement terminée : tous les points sont déjà passés.</p>'
            : `<ol class="weather-waypoint-list">${renderWaypointWeather(progress.next, 'weather-waypoint--next')}</ol>`
        }
      </section>
      ${
        progress.past.length === 0
          ? ''
          : `
            <details class="weather-detail__disclosure" data-weather-past-waypoints>
              <summary>Repères déjà passés (${progress.past.length})</summary>
              <ol class="weather-waypoint-list weather-waypoint-list--past">
                ${progress.past.map((item) => renderWaypointWeather(item, 'weather-waypoint--past')).join('')}
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
            : `<ol class="weather-waypoint-list">${upcomingEssential.map((item) => renderWaypointWeather(item)).join('')}</ol>`
        }
        ${renderOtherPassagesDisclosure(upcomingOther)}
      </section>
    </section>`
}

function renderRideDay(
  data: RideDayWeather,
  mode: WeatherDisplayMode,
  nowLocal: LocalIsoDateTime,
): string {
  switch (mode) {
    case 'trend':
      return renderTrendRide(data, mode)
    case 'planning':
      return renderPlanningRide(data, mode)
    case 'live':
      return renderLiveRide(data, mode, nowLocal)
    case 'operational':
    default:
      return renderOperationalRide(data, mode)
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

function renderOffDay(data: OffDayWeather, mode: WeatherDisplayMode): string {
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

  container.innerHTML = `
    <div class="weather-detail__state">
      <span class="tag ${getAvailabilityTagClass(state.availability)}">${availabilityLabels[state.availability]}</span>
      ${notice}
    </div>
    ${
      state.data.type === 'ride'
        ? renderRideDay(state.data, mode, nowLocal)
        : renderOffDay(state.data, mode)
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
