import type { WeatherDisplayMode } from '../display-policy.ts'
import { SCENARIO_IMPROVEMENT_THRESHOLDS, WEATHER_ALERT_THRESHOLDS } from './thresholds.ts'
import type { WeatherAlertThresholds } from './thresholds.ts'
import type { DepartureRecommendation, DepartureWeatherScenario } from './types.ts'

const decimalFormatter = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 })
const integerFormatter = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 })

const MANDATORY_DISCLAIMER =
  'Aide à la décision fondée sur les prévisions disponibles, sans garantie de conditions réelles.'

function compareNullableAscending(left: number | null, right: number | null): number {
  if (left === null && right === null) {
    return 0
  }

  if (left === null) {
    return 1
  }

  if (right === null) {
    return -1
  }

  return left - right
}

function compareNullableDescending(left: number | null, right: number | null): number {
  return compareNullableAscending(right, left)
}

function partitionByCoherence(
  scenarios: readonly DepartureWeatherScenario[],
): readonly [readonly DepartureWeatherScenario[], readonly DepartureWeatherScenario[]] {
  const coherent: DepartureWeatherScenario[] = []
  const incoherent: DepartureWeatherScenario[] = []

  for (const scenario of scenarios) {
    ;(scenario.isCoherent ? coherent : incoherent).push(scenario)
  }

  return [coherent, incoherent]
}

/**
 * Ranks scenarios best-first (Phase D, section I): fewer red alerts, then
 * fewer orange, then better coverage, less rain, weaker gusts, a warmer
 * minimum apparent temperature, better visibility, and — as the final
 * tie-break — the smallest shift from the configured departure time.
 * Incoherent scenarios (the shift would depart before the day even starts)
 * always sort last and are filtered out before recommendation.
 */
export function rankDepartureScenarios(
  scenarios: readonly DepartureWeatherScenario[],
): readonly DepartureWeatherScenario[] {
  const [coherent, incoherent] = partitionByCoherence(scenarios)
  const ranked = [...coherent].sort(
    (left, right) =>
      left.risk.redCount - right.risk.redCount ||
      left.risk.orangeCount - right.risk.orangeCount ||
      right.coveredPointCount - left.coveredPointCount ||
      compareNullableAscending(left.maximumRainMm, right.maximumRainMm) ||
      compareNullableAscending(left.maximumGustKph, right.maximumGustKph) ||
      compareNullableDescending(
        left.minimumApparentTemperatureC,
        right.minimumApparentTemperatureC,
      ) ||
      compareNullableDescending(left.minimumVisibilityM, right.minimumVisibilityM) ||
      Math.abs(left.offsetMinutes) - Math.abs(right.offsetMinutes),
  )

  return [...ranked, ...incoherent]
}

/**
 * A candidate must clear at least one centralized margin (never a plain
 * average) before it is allowed to outrank the currently configured
 * departure time — see `SCENARIO_IMPROVEMENT_THRESHOLDS`.
 */
export function isSignificantImprovement(
  current: DepartureWeatherScenario,
  candidate: DepartureWeatherScenario,
  thresholds = SCENARIO_IMPROVEMENT_THRESHOLDS,
): boolean {
  if (current.risk.redCount - candidate.risk.redCount >= thresholds.minimumRedAlertReduction) {
    return true
  }

  if (
    current.risk.orangeCount - candidate.risk.orangeCount >=
    thresholds.minimumOrangeAlertReduction
  ) {
    return true
  }

  if (
    current.maximumRainMm !== null &&
    candidate.maximumRainMm !== null &&
    current.maximumRainMm - candidate.maximumRainMm >= thresholds.minimumRainReductionMm
  ) {
    return true
  }

  if (
    current.maximumGustKph !== null &&
    candidate.maximumGustKph !== null &&
    current.maximumGustKph - candidate.maximumGustKph >= thresholds.minimumGustReductionKph
  ) {
    return true
  }

  if (
    current.minimumExposedApparentTemperatureC !== null &&
    candidate.minimumExposedApparentTemperatureC !== null &&
    candidate.minimumExposedApparentTemperatureC - current.minimumExposedApparentTemperatureC >=
      thresholds.minimumExposedApparentTemperatureGainC
  ) {
    return true
  }

  return false
}

function formatEtaClock(value: string | null): string {
  if (value === null) {
    return 'heure indisponible'
  }

  const match = /T(?<time>\d{2}:\d{2})/.exec(value)
  return match?.groups?.time ?? value
}

function describeImprovement(
  current: DepartureWeatherScenario,
  best: DepartureWeatherScenario,
): readonly string[] {
  const reasons: string[] = []

  if (best.risk.redCount < current.risk.redCount) {
    reasons.push(`Alertes rouges : ${best.risk.redCount} au lieu de ${current.risk.redCount}.`)
  }

  if (best.risk.orangeCount < current.risk.orangeCount) {
    reasons.push(`Alertes orange : ${best.risk.orangeCount} au lieu de ${current.risk.orangeCount}.`)
  }

  if (
    current.maximumRainMm !== null &&
    best.maximumRainMm !== null &&
    best.maximumRainMm < current.maximumRainMm
  ) {
    reasons.push(`Pluie maximale ramenée à ${decimalFormatter.format(best.maximumRainMm)} mm/h.`)
  }

  if (
    current.maximumGustKph !== null &&
    best.maximumGustKph !== null &&
    best.maximumGustKph < current.maximumGustKph
  ) {
    reasons.push(`Rafales maximales ramenées à ${integerFormatter.format(best.maximumGustKph)} km/h.`)
  }

  if (
    current.minimumExposedApparentTemperatureC !== null &&
    best.minimumExposedApparentTemperatureC !== null &&
    best.minimumExposedApparentTemperatureC > current.minimumExposedApparentTemperatureC
  ) {
    reasons.push(
      `Ressenti minimal en altitude amélioré à ${decimalFormatter.format(best.minimumExposedApparentTemperatureC)} °C.`,
    )
  }

  return reasons.length === 0 ? ['Comparaison globale plus favorable sur les critères combinés.'] : reasons
}

export interface DepartureRecommendationContext {
  readonly mode: WeatherDisplayMode
  readonly hasDeparted: boolean
  readonly cacheAgeMs: number | null
  readonly thresholds?: WeatherAlertThresholds
}

/**
 * Gates and builds the departure recommendation (Phase D, section J).
 * A change is only ever proposed in `operational`/`live` mode before the
 * theoretical departure, with sufficient coverage, a cache that is not overly
 * stale, and a significant, coherent improvement over the configured time.
 */
export function buildDepartureRecommendation(
  scenarios: readonly DepartureWeatherScenario[],
  context: DepartureRecommendationContext,
): DepartureRecommendation {
  const thresholds = context.thresholds ?? WEATHER_ALERT_THRESHOLDS
  const current = scenarios.find((scenario) => scenario.isCurrent) ?? null

  if (context.mode !== 'operational' && context.mode !== 'live') {
    return {
      status: 'not-applicable',
      currentScenario: current,
      recommendedScenario: null,
      title: 'Comparaison des horaires non disponible à cette échéance.',
      explanation: [],
    }
  }

  if (context.mode === 'live' && context.hasDeparted) {
    return {
      status: 'not-applicable',
      currentScenario: current,
      recommendedScenario: null,
      title: 'Départ théorique déjà effectué.',
      explanation: [
        'Le départ théorique est déjà passé : seul un résumé des risques restants est proposé, sans revenir sur l’horaire.',
      ],
    }
  }

  if (current === null) {
    return {
      status: 'not-applicable',
      currentScenario: null,
      recommendedScenario: null,
      title: 'Scénario actuel indisponible.',
      explanation: [],
    }
  }

  const insufficientReasons: string[] = []

  if (
    current.risk.essentialCoverageRatio !== null &&
    current.risk.essentialCoverageRatio < thresholds.coverage.minimumEssentialCoverageRatio
  ) {
    insufficientReasons.push(
      `Seuls ${integerFormatter.format(current.risk.essentialCoverageRatio * 100)} % des points essentiels sont couverts par une prévision.`,
    )
  }

  if (context.cacheAgeMs !== null && context.cacheAgeMs > thresholds.staleData.maxTrustedAgeMs) {
    insufficientReasons.push(
      'Les dernières données sont trop anciennes pour comparer les horaires de façon fiable.',
    )
  }

  if (insufficientReasons.length > 0) {
    return {
      status: 'insufficient-data',
      currentScenario: current,
      recommendedScenario: null,
      title: 'Données insuffisantes pour comparer les horaires de façon fiable.',
      explanation: [...insufficientReasons, MANDATORY_DISCLAIMER],
    }
  }

  const best = rankDepartureScenarios(scenarios).find((scenario) => scenario.isCoherent) ?? current

  if (best.offsetMinutes === current.offsetMinutes || !isSignificantImprovement(current, best)) {
    return {
      status: 'keep-current',
      currentScenario: current,
      recommendedScenario: null,
      title: 'Le départ actuel reste le meilleur compromis parmi les horaires comparés.',
      explanation: [MANDATORY_DISCLAIMER],
    }
  }

  return {
    status: 'recommended-change',
    currentScenario: current,
    recommendedScenario: best,
    title: `Un départ vers ${formatEtaClock(best.departureTimeLocal)} semble plus favorable que ${formatEtaClock(current.departureTimeLocal)}.`,
    explanation: [...describeImprovement(current, best), MANDATORY_DISCLAIMER],
  }
}
