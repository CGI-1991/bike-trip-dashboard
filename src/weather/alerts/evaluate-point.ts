import type { TripDayId } from '../../trip/types.ts'
import type { NormalizedHourlyWeather, WaypointWeather } from '../types.ts'
import { getWeatherCodeLabel } from '../weather-code.ts'
import { getWeatherExposureContext } from './exposure.ts'
import { WEATHER_ALERT_THRESHOLDS } from './thresholds.ts'
import type { WeatherAlertThresholds } from './thresholds.ts'
import type { RiskFinding, WeatherAlert, WeatherExposureContext } from './types.ts'

const decimalFormatter = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 })
const integerFormatter = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 })

function evaluatePrecipitationRisk(
  hourly: NormalizedHourlyWeather,
  thresholds: WeatherAlertThresholds,
): RiskFinding | null {
  const { precipitationMm, precipitationProbabilityPct } = hourly
  if (precipitationMm === null) {
    return null
  }

  const t = thresholds.precipitation
  const probability = precipitationProbabilityPct
  const unit = 'mm/h'

  if (
    precipitationMm >= t.redAmountMm ||
    (probability !== null &&
      probability >= t.redProbabilityPct &&
      precipitationMm >= t.redProbabilityAmountMm)
  ) {
    return {
      riskType: 'precipitation',
      level: 'red',
      title: 'Pluie forte probable',
      summary: `${decimalFormatter.format(precipitationMm)} mm/h attendus${probability === null ? '' : `, probabilité ${integerFormatter.format(probability)} %`}.`,
      value: precipitationMm,
      unit,
      threshold: t.redAmountMm,
    }
  }

  if (
    precipitationMm >= t.orangeAmountMm ||
    (probability !== null &&
      probability >= t.orangeProbabilityPct &&
      precipitationMm >= t.orangeProbabilityAmountMm)
  ) {
    return {
      riskType: 'precipitation',
      level: 'orange',
      title: 'Pluie probable',
      summary: `${decimalFormatter.format(precipitationMm)} mm/h attendus${probability === null ? '' : `, probabilité ${integerFormatter.format(probability)} %`}.`,
      value: precipitationMm,
      unit,
      threshold: t.orangeAmountMm,
    }
  }

  return null
}

function evaluateThunderstormRisk(
  hourly: NormalizedHourlyWeather,
  thresholds: WeatherAlertThresholds,
): RiskFinding | null {
  const { weatherCode } = hourly
  if (weatherCode === null) {
    return null
  }

  const t = thresholds.thunderstormCodes
  const label = getWeatherCodeLabel(weatherCode)

  if (t.red.includes(weatherCode)) {
    return {
      riskType: 'thunderstorm',
      level: 'red',
      title: 'Orage fort probable',
      summary: `${label}${weatherCode === 96 || weatherCode === 99 ? ' (grêle possible)' : ''}.`,
    }
  }

  if (t.orange.includes(weatherCode)) {
    return {
      riskType: 'thunderstorm',
      level: 'orange',
      title: 'Orage probable',
      summary: `${label}.`,
    }
  }

  return null
}

function evaluateWindRisk(
  hourly: NormalizedHourlyWeather,
  thresholds: WeatherAlertThresholds,
): RiskFinding | null {
  const { windSpeedKph } = hourly
  if (windSpeedKph === null) {
    return null
  }

  const t = thresholds.wind

  if (windSpeedKph >= t.redSustainedKph) {
    return {
      riskType: 'wind',
      level: 'red',
      title: 'Vent soutenu fort',
      summary: `Vent soutenu attendu autour de ${integerFormatter.format(windSpeedKph)} km/h.`,
      value: windSpeedKph,
      unit: 'km/h',
      threshold: t.redSustainedKph,
    }
  }

  if (windSpeedKph >= t.orangeSustainedKph) {
    return {
      riskType: 'wind',
      level: 'orange',
      title: 'Vent soutenu notable',
      summary: `Vent soutenu attendu autour de ${integerFormatter.format(windSpeedKph)} km/h.`,
      value: windSpeedKph,
      unit: 'km/h',
      threshold: t.orangeSustainedKph,
    }
  }

  return null
}

function evaluateGustRisk(
  hourly: NormalizedHourlyWeather,
  exposure: WeatherExposureContext,
  thresholds: WeatherAlertThresholds,
): RiskFinding | null {
  const { windGustsKph } = hourly
  if (windGustsKph === null) {
    return null
  }

  const t = exposure.isExposed ? thresholds.summitWind : thresholds.wind
  const contextLabel = exposure.isExposed ? ' en altitude' : ''

  if (windGustsKph >= t.redGustKph) {
    return {
      riskType: 'gust',
      level: 'red',
      title: `Rafales fortes${contextLabel}`,
      summary: `Rafales attendues jusqu'à ${integerFormatter.format(windGustsKph)} km/h.`,
      value: windGustsKph,
      unit: 'km/h',
      threshold: t.redGustKph,
    }
  }

  if (windGustsKph >= t.orangeGustKph) {
    return {
      riskType: 'gust',
      level: 'orange',
      title: `Rafales notables${contextLabel}`,
      summary: `Rafales attendues jusqu'à ${integerFormatter.format(windGustsKph)} km/h.`,
      value: windGustsKph,
      unit: 'km/h',
      threshold: t.orangeGustKph,
    }
  }

  return null
}

function evaluateColdRisk(
  hourly: NormalizedHourlyWeather,
  exposure: WeatherExposureContext,
  thresholds: WeatherAlertThresholds,
): RiskFinding | null {
  const { apparentTemperatureC } = hourly
  if (apparentTemperatureC === null) {
    return null
  }

  const t = exposure.isExposed ? thresholds.summitCold : thresholds.cold

  if (apparentTemperatureC <= t.redApparentC) {
    return {
      riskType: 'cold',
      level: 'red',
      title: 'Froid ressenti marqué',
      summary: `Ressenti proche de ${decimalFormatter.format(apparentTemperatureC)} °C.`,
      value: apparentTemperatureC,
      unit: '°C',
      threshold: t.redApparentC,
    }
  }

  if (apparentTemperatureC <= t.orangeApparentC) {
    return {
      riskType: 'cold',
      level: 'orange',
      title: 'Froid ressenti notable',
      summary: `Ressenti proche de ${decimalFormatter.format(apparentTemperatureC)} °C.`,
      value: apparentTemperatureC,
      unit: '°C',
      threshold: t.orangeApparentC,
    }
  }

  return null
}

function evaluateHeatRisk(
  hourly: NormalizedHourlyWeather,
  thresholds: WeatherAlertThresholds,
): RiskFinding | null {
  const { apparentTemperatureC } = hourly
  if (apparentTemperatureC === null) {
    return null
  }

  const t = thresholds.heat

  if (apparentTemperatureC >= t.redApparentC) {
    return {
      riskType: 'heat',
      level: 'red',
      title: 'Chaleur ressentie forte',
      summary: `Ressenti proche de ${decimalFormatter.format(apparentTemperatureC)} °C.`,
      value: apparentTemperatureC,
      unit: '°C',
      threshold: t.redApparentC,
    }
  }

  if (apparentTemperatureC >= t.orangeApparentC) {
    return {
      riskType: 'heat',
      level: 'orange',
      title: 'Chaleur ressentie notable',
      summary: `Ressenti proche de ${decimalFormatter.format(apparentTemperatureC)} °C.`,
      value: apparentTemperatureC,
      unit: '°C',
      threshold: t.orangeApparentC,
    }
  }

  return null
}

function evaluateVisibilityRisk(
  hourly: NormalizedHourlyWeather,
  thresholds: WeatherAlertThresholds,
): RiskFinding | null {
  const { visibilityM } = hourly
  if (visibilityM === null) {
    return null
  }

  const t = thresholds.visibility

  if (visibilityM < t.redM) {
    return {
      riskType: 'visibility',
      level: 'red',
      title: 'Visibilité très réduite',
      summary: `Visibilité attendue autour de ${integerFormatter.format(visibilityM)} m.`,
      value: visibilityM,
      unit: 'm',
      threshold: t.redM,
    }
  }

  if (visibilityM < t.orangeM) {
    return {
      riskType: 'visibility',
      level: 'orange',
      title: 'Visibilité réduite',
      summary: `Visibilité attendue autour de ${integerFormatter.format(visibilityM)} m.`,
      value: visibilityM,
      unit: 'm',
      threshold: t.orangeM,
    }
  }

  return null
}

function evaluateSnowRisk(
  hourly: NormalizedHourlyWeather,
  exposure: WeatherExposureContext,
  thresholds: WeatherAlertThresholds,
  windFinding: RiskFinding | null,
  gustFinding: RiskFinding | null,
  coldFinding: RiskFinding | null,
): RiskFinding | null {
  const { snowfallCm } = hourly
  if (snowfallCm === null || snowfallCm <= thresholds.snow.orangeAnyCm) {
    return null
  }

  const hasWindRisk = windFinding !== null || gustFinding !== null
  const hasColdRisk = coldFinding !== null
  const isSignificant = snowfallCm >= thresholds.snow.redSignificantCm
  const isCombo = exposure.isExposed && hasWindRisk && hasColdRisk

  if (isSignificant || isCombo) {
    return {
      riskType: 'snow',
      level: 'red',
      title: 'Neige en août',
      summary: isCombo
        ? `${decimalFormatter.format(snowfallCm)} cm attendus, combinés à du vent et du froid en altitude.`
        : `${decimalFormatter.format(snowfallCm)} cm attendus.`,
      value: snowfallCm,
      unit: 'cm',
      threshold: thresholds.snow.redSignificantCm,
    }
  }

  return {
    riskType: 'snow',
    level: 'orange',
    title: 'Neige en août',
    summary: `${decimalFormatter.format(snowfallCm)} cm attendus, inhabituel à cette saison.`,
    value: snowfallCm,
    unit: 'cm',
    threshold: thresholds.snow.orangeAnyCm,
  }
}

function evaluateFreezingLevelRisk(
  hourly: NormalizedHourlyWeather,
  elevationM: number,
  exposure: WeatherExposureContext,
  thresholds: WeatherAlertThresholds,
  precipitationFinding: RiskFinding | null,
  coldFinding: RiskFinding | null,
): RiskFinding | null {
  const { freezingLevelM } = hourly
  if (freezingLevelM === null) {
    return null
  }

  const t = thresholds.freezingLevel
  const marginM = freezingLevelM - elevationM

  if (marginM > t.orangeMarginM) {
    return null
  }

  const isReinforced = exposure.isExposed && precipitationFinding !== null && coldFinding !== null
  const isRed = marginM <= t.redMarginM || isReinforced

  return {
    riskType: 'freezing-level',
    level: isRed ? 'red' : 'orange',
    title: isRed ? "Isotherme 0 °C proche ou sous l'altitude" : "Isotherme 0 °C proche de l'altitude",
    summary: isReinforced
      ? `Isotherme à ${integerFormatter.format(freezingLevelM)} m, combiné à de la pluie et du froid : un simple point de froid isolé compterait moins.`
      : `Isotherme à ${integerFormatter.format(freezingLevelM)} m, point à ${integerFormatter.format(elevationM)} m.`,
    value: freezingLevelM,
    unit: 'm',
    threshold: elevationM + t.orangeMarginM,
  }
}

/**
 * Evaluates every risk type for a single hourly forecast sample. Pure and
 * network-free: the same function backs both ride waypoints (one ETA-matched
 * hour) and OFF-day hours (scanned across the whole day).
 */
export function evaluateHourlyRisk(
  hourly: NormalizedHourlyWeather,
  elevationM: number,
  exposure: WeatherExposureContext,
  thresholds: WeatherAlertThresholds = WEATHER_ALERT_THRESHOLDS,
): readonly RiskFinding[] {
  const precipitation = evaluatePrecipitationRisk(hourly, thresholds)
  const thunderstorm = evaluateThunderstormRisk(hourly, thresholds)
  const wind = evaluateWindRisk(hourly, thresholds)
  const gust = evaluateGustRisk(hourly, exposure, thresholds)
  const cold = evaluateColdRisk(hourly, exposure, thresholds)
  const heat = evaluateHeatRisk(hourly, thresholds)
  const visibility = evaluateVisibilityRisk(hourly, thresholds)
  const snow = evaluateSnowRisk(hourly, exposure, thresholds, wind, gust, cold)
  const freezingLevel = evaluateFreezingLevelRisk(
    hourly,
    elevationM,
    exposure,
    thresholds,
    precipitation,
    cold,
  )

  return [precipitation, thunderstorm, snow, cold, heat, wind, gust, visibility, freezingLevel].filter(
    (finding): finding is RiskFinding => finding !== null,
  )
}

function bindFindingToWaypoint(
  dayId: TripDayId,
  waypoint: WaypointWeather,
  finding: RiskFinding,
): WeatherAlert {
  const point = waypoint.samplePoint

  return {
    id: `${dayId}-${finding.riskType}-${point.id}`,
    dayId,
    pointId: point.id,
    pointName: point.name,
    pointType: point.type,
    riskType: finding.riskType,
    level: finding.level,
    title: finding.title,
    baseTitle: finding.title,
    summary: finding.summary,
    ...(finding.details === undefined ? {} : { details: finding.details }),
    etaLocal: waypoint.etaLocal,
    ...(waypoint.forecastTimeLocal === null ? {} : { forecastTimeLocal: waypoint.forecastTimeLocal }),
    ...(finding.value === undefined ? {} : { value: finding.value }),
    ...(finding.unit === undefined ? {} : { unit: finding.unit }),
    ...(finding.threshold === undefined ? {} : { threshold: finding.threshold }),
    isUpcoming: true,
    isOperational: true,
    firstPointId: point.id,
    lastPointId: point.id,
    firstPointName: point.name,
    lastPointName: point.name,
    memberPointIds: [point.id],
  }
}

/**
 * Evaluates every risk type for one ride waypoint at its ETA-matched hour.
 * Returns no alert at all when the point has no usable forecast — coverage
 * gaps are handled at the day level (`evaluate-day.ts`), not invented here.
 */
export function evaluateWaypointAlerts(
  dayId: TripDayId,
  waypoint: WaypointWeather,
  thresholds: WeatherAlertThresholds = WEATHER_ALERT_THRESHOLDS,
): readonly WeatherAlert[] {
  if (waypoint.state === 'unavailable' || waypoint.weather === null) {
    return []
  }

  const exposure = getWeatherExposureContext(waypoint.samplePoint, thresholds)
  const findings = evaluateHourlyRisk(
    waypoint.weather,
    waypoint.samplePoint.elevationM,
    exposure,
    thresholds,
  )

  return findings.map((finding) => bindFindingToWaypoint(dayId, waypoint, finding))
}
