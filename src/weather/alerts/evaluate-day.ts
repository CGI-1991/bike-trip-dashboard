import type {
  NormalizedHourlyWeather,
  OffDayWeather,
  RideDayWeather,
  WeatherDayData,
  WeatherDayKey,
  WeatherSamplePoint,
} from '../types.ts'
import { evaluateHourlyRisk, evaluateWaypointAlerts } from './evaluate-point.ts'
import { getWeatherExposureContext, isEssentialCoveragePoint } from './exposure.ts'
import { WEATHER_ALERT_THRESHOLDS } from './thresholds.ts'
import type { WeatherAlertThresholds } from './thresholds.ts'
import type { DayWeatherRiskSummary, WeatherAlert, WeatherRiskType } from './types.ts'

export interface DayRiskContext {
  readonly fetchedAt: string | null
  readonly now: Date
  readonly upcomingPointIds?: ReadonlySet<string> | null
}

const decimalFormatter = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 })
const integerFormatter = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 })

const OFF_DAY_RISK_TYPES: ReadonlySet<WeatherRiskType> = new Set([
  'precipitation',
  'thunderstorm',
  'wind',
  'gust',
  'heat',
  'cold',
])

function extractHourMinute(value: string | undefined): string | null {
  if (value === undefined) {
    return null
  }

  const match = /T(?<time>\d{2}:\d{2})/.exec(value)
  return match?.groups?.time ?? null
}

function formatTimeSpan(startLocal: string | undefined, endLocal: string | undefined): string | null {
  const start = extractHourMinute(startLocal)
  const end = extractHourMinute(endLocal)

  if (start === null) {
    return null
  }

  return end === null || end === start ? start : `${start}–${end}`
}

function formatGroupedValue(value: number | undefined, unit: string | undefined): string | null {
  if (value === undefined) {
    return null
  }

  const rounded = Number.isInteger(value) ? String(value) : decimalFormatter.format(value)
  return unit === undefined ? rounded : `${rounded} ${unit}`
}

function canMergeAlerts(left: WeatherAlert, right: WeatherAlert): boolean {
  return left.dayId === right.dayId && left.riskType === right.riskType && left.level === right.level
}

function mergeAlertPair(left: WeatherAlert, right: WeatherAlert): WeatherAlert {
  const memberPointIds = [
    ...new Set([...(left.memberPointIds ?? []), ...(right.memberPointIds ?? [])]),
  ]
  const firstPointId = left.firstPointId ?? left.pointId
  const lastPointId = right.lastPointId ?? right.pointId
  const firstPointName = left.firstPointName ?? left.pointName
  const lastPointName = right.lastPointName ?? right.pointName
  const baseTitle = left.baseTitle ?? left.title
  const maxValue =
    left.value === undefined
      ? right.value
      : right.value === undefined
        ? left.value
        : Math.max(left.value, right.value)
  // Spans multiple points only when the group's first and last named points
  // actually differ — recomputed from `firstPointName`/`lastPointName` (never
  // from `pointName`, which a prior merge step may already have dropped) so a
  // chain of more than two merges keeps extending the same span correctly.
  const spansMultiplePoints =
    firstPointName !== undefined && lastPointName !== undefined && firstPointName !== lastPointName
  const timeSpan = formatTimeSpan(left.etaLocal, right.etaLocalEnd ?? right.etaLocal)
  const valueText = formatGroupedValue(maxValue, left.unit ?? right.unit)
  const detailParts = [timeSpan, valueText === null ? null : `jusqu'à ${valueText}`].filter(
    (part): part is string => part !== null,
  )

  return {
    id: `${left.id}__${right.id}`,
    dayId: left.dayId,
    ...(spansMultiplePoints
      ? {}
      : {
          ...(left.pointId === undefined ? {} : { pointId: left.pointId }),
          ...(left.pointName === undefined ? {} : { pointName: left.pointName }),
          ...(left.pointType === undefined ? {} : { pointType: left.pointType }),
        }),
    riskType: left.riskType,
    level: left.level,
    title: spansMultiplePoints ? `${baseTitle} entre ${firstPointName} et ${lastPointName}` : baseTitle,
    baseTitle,
    summary: detailParts.length === 0 ? left.summary : detailParts.join(' — '),
    ...(left.etaLocal === undefined ? {} : { etaLocal: left.etaLocal }),
    ...((right.etaLocalEnd ?? right.etaLocal) === undefined
      ? {}
      : { etaLocalEnd: right.etaLocalEnd ?? right.etaLocal }),
    ...(left.unit === undefined ? {} : { unit: left.unit }),
    ...(maxValue === undefined ? {} : { value: maxValue }),
    ...(left.threshold === undefined ? {} : { threshold: left.threshold }),
    isUpcoming: (left.isUpcoming ?? true) || (right.isUpcoming ?? true),
    isOperational: left.isOperational,
    ...(firstPointId === undefined ? {} : { firstPointId }),
    ...(lastPointId === undefined ? {} : { lastPointId }),
    ...(firstPointName === undefined ? {} : { firstPointName }),
    ...(lastPointName === undefined ? {} : { lastPointName }),
    memberPointIds,
  }
}

/**
 * Merges consecutive alerts (already in point/time order) that share the same
 * risk type and level into a single grouped alert spanning them, so a run of
 * near-identical warnings on adjacent points/hours renders as one line instead
 * of many. Alerts of a different risk type or level are never merged.
 */
export function groupConsecutiveAlerts(alerts: readonly WeatherAlert[]): readonly WeatherAlert[] {
  const grouped: WeatherAlert[] = []

  for (const alert of alerts) {
    const previous = grouped.at(-1)

    if (previous !== undefined && canMergeAlerts(previous, alert)) {
      grouped[grouped.length - 1] = mergeAlertPair(previous, alert)
    } else {
      grouped.push(alert)
    }
  }

  return grouped
}

function buildCoverageAlert(
  dayId: WeatherDayKey,
  essentialCoverageRatio: number | null,
  thresholds: WeatherAlertThresholds,
): WeatherAlert | null {
  if (
    essentialCoverageRatio === null ||
    essentialCoverageRatio >= thresholds.coverage.minimumEssentialCoverageRatio
  ) {
    return null
  }

  return {
    id: `${dayId}-forecast-coverage`,
    dayId,
    riskType: 'forecast-coverage',
    level: 'unknown',
    title: 'Couverture météo incomplète',
    summary: `${integerFormatter.format(essentialCoverageRatio * 100)} % des points essentiels sont couverts par une prévision horaire.`,
    isOperational: false,
    isUpcoming: true,
  }
}

function buildStaleDataAlert(
  dayId: WeatherDayKey,
  fetchedAt: string | null,
  now: Date,
  thresholds: WeatherAlertThresholds,
): WeatherAlert | null {
  if (fetchedAt === null) {
    return null
  }

  const ageMs = now.getTime() - Date.parse(fetchedAt)

  if (!Number.isFinite(ageMs) || ageMs <= thresholds.staleData.maxTrustedAgeMs) {
    return null
  }

  return {
    id: `${dayId}-stale-data`,
    dayId,
    riskType: 'stale-data',
    level: 'unknown',
    title: 'Données météo trop anciennes',
    summary: `Dernière actualisation il y a plus de ${Math.round(thresholds.staleData.maxTrustedAgeMs / 3_600_000)} h : le niveau de risque n'est plus garanti.`,
    isOperational: false,
    isUpcoming: true,
  }
}

function computeLevel(alerts: readonly WeatherAlert[]): DayWeatherRiskSummary['level'] {
  if (alerts.some((alert) => alert.isOperational !== false && alert.level === 'red')) {
    return 'red'
  }

  if (alerts.some((alert) => alert.isOperational !== false && alert.level === 'orange')) {
    return 'orange'
  }

  if (alerts.some((alert) => alert.level === 'unknown')) {
    return 'unknown'
  }

  return 'green'
}

function finalizeSummary(
  dayId: WeatherDayKey,
  hazardAlerts: readonly WeatherAlert[],
  coveredPointCount: number,
  missingPointCount: number,
  essentialCoverageRatio: number | null,
  context: DayRiskContext,
  thresholds: WeatherAlertThresholds,
): DayWeatherRiskSummary {
  const grouped = groupConsecutiveAlerts(hazardAlerts)
  const metaAlerts = [
    buildCoverageAlert(dayId, essentialCoverageRatio, thresholds),
    buildStaleDataAlert(dayId, context.fetchedAt, context.now, thresholds),
  ].filter((alert): alert is WeatherAlert => alert !== null)
  const alerts = [...grouped, ...metaAlerts]
  const redAlerts = alerts.filter((alert) => alert.level === 'red')
  const orangeAlerts = alerts.filter((alert) => alert.level === 'orange')

  return {
    level: computeLevel(alerts),
    redCount: redAlerts.length,
    orangeCount: orangeAlerts.length,
    upcomingRedCount: redAlerts.filter((alert) => alert.isUpcoming ?? true).length,
    upcomingOrangeCount: orangeAlerts.filter((alert) => alert.isUpcoming ?? true).length,
    coveredPointCount,
    missingPointCount,
    essentialCoverageRatio,
    alerts,
  }
}

function markUpcoming(
  alerts: readonly WeatherAlert[],
  upcomingPointIds: ReadonlySet<string> | null | undefined,
): readonly WeatherAlert[] {
  if (upcomingPointIds === null || upcomingPointIds === undefined) {
    return alerts
  }

  return alerts.map((alert) => ({
    ...alert,
    isUpcoming: alert.pointId === undefined ? true : upcomingPointIds.has(alert.pointId),
  }))
}

export function evaluateRideDayRisk(
  dayId: WeatherDayKey,
  data: RideDayWeather,
  context: DayRiskContext,
  thresholds: WeatherAlertThresholds = WEATHER_ALERT_THRESHOLDS,
): DayWeatherRiskSummary {
  const riskWaypoints = data.waypoints.filter(
    ({ samplePoint }) => samplePoint.contributesToDayRisk !== false,
  )
  const hazardAlerts = markUpcoming(
    riskWaypoints.flatMap((waypoint) => evaluateWaypointAlerts(dayId, waypoint, thresholds)),
    context.upcomingPointIds,
  )
  const essentialPoints = riskWaypoints.filter(({ samplePoint }) => isEssentialCoveragePoint(samplePoint))
  const essentialCoverageRatio =
    essentialPoints.length === 0
      ? null
      : essentialPoints.filter(({ state }) => state === 'available').length / essentialPoints.length

  return finalizeSummary(
    dayId,
    hazardAlerts,
    data.routeSummary.coveredPointCount,
    data.routeSummary.missingPointCount,
    essentialCoverageRatio,
    context,
    thresholds,
  )
}

function evaluateOffHourAlerts(
  dayId: WeatherDayKey,
  samplePoint: WeatherSamplePoint,
  hour: NormalizedHourlyWeather,
  thresholds: WeatherAlertThresholds,
): readonly WeatherAlert[] {
  const exposure = getWeatherExposureContext(samplePoint, thresholds)
  const findings = evaluateHourlyRisk(hour, samplePoint.elevationM, exposure, thresholds).filter(
    (finding) => OFF_DAY_RISK_TYPES.has(finding.riskType),
  )

  return findings.map((finding) => ({
    id: `${dayId}-${finding.riskType}-${hour.time}`,
    dayId,
    pointId: samplePoint.id,
    pointName: samplePoint.name,
    pointType: samplePoint.type,
    riskType: finding.riskType,
    level: finding.level,
    title: finding.title,
    baseTitle: finding.title,
    summary: finding.summary,
    ...(finding.details === undefined ? {} : { details: finding.details }),
    etaLocal: hour.time,
    forecastTimeLocal: hour.time,
    ...(finding.value === undefined ? {} : { value: finding.value }),
    ...(finding.unit === undefined ? {} : { unit: finding.unit }),
    ...(finding.threshold === undefined ? {} : { threshold: finding.threshold }),
    isUpcoming: true,
    isOperational: true,
    firstPointId: samplePoint.id,
    lastPointId: samplePoint.id,
    firstPointName: samplePoint.name,
    lastPointName: samplePoint.name,
    memberPointIds: [samplePoint.id],
  }))
}

export function evaluateOffDayRisk(
  dayId: WeatherDayKey,
  data: OffDayWeather,
  context: DayRiskContext,
  thresholds: WeatherAlertThresholds = WEATHER_ALERT_THRESHOLDS,
): DayWeatherRiskSummary {
  const sortedHours = [...data.hourly].sort((left, right) => left.time.localeCompare(right.time))
  const hazardAlerts = markUpcoming(
    sortedHours.flatMap((hour) => evaluateOffHourAlerts(dayId, data.samplePoint, hour, thresholds)),
    context.upcomingPointIds,
  )
  const { coveredPointCount, missingPointCount } = data.localSummary
  const totalPointCount = coveredPointCount + missingPointCount
  const essentialCoverageRatio = totalPointCount === 0 ? null : coveredPointCount / totalPointCount

  return finalizeSummary(
    dayId,
    hazardAlerts,
    coveredPointCount,
    missingPointCount,
    essentialCoverageRatio,
    context,
    thresholds,
  )
}

export function evaluateDayRisk(
  dayId: WeatherDayKey,
  data: WeatherDayData,
  context: DayRiskContext,
  thresholds: WeatherAlertThresholds = WEATHER_ALERT_THRESHOLDS,
): DayWeatherRiskSummary {
  return data.type === 'ride'
    ? evaluateRideDayRisk(dayId, data, context, thresholds)
    : evaluateOffDayRisk(dayId, data, context, thresholds)
}
