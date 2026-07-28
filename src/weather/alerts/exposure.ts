import type { WeatherSamplePoint } from '../types.ts'
import { WEATHER_ALERT_THRESHOLDS } from './thresholds.ts'
import type { WeatherAlertThresholds } from './thresholds.ts'
import type { WeatherExposureContext } from './types.ts'

/**
 * Points that must always be individually evaluated for risk, per Phase D
 * section D: start, finish, every col/summit, and every active resupply
 * passage ("arrêts principaux"). `poi` is included because the only active
 * (`resolution: 'matched'`) roadbook points of that type are options such as
 * Menton — every informational/excluded option is filtered out long before a
 * `WeatherSamplePoint` exists, so this is a generic rule, not a name lookup.
 */
const ALWAYS_EVALUATED_POINT_TYPES: ReadonlySet<WeatherSamplePoint['type']> = new Set([
  'start',
  'end',
  'col',
  'summit',
  'passage',
  'poi',
])

/**
 * The "points essentiels" used for the minimum-coverage gate (Phase D, section
 * O): départ, arrivée, cols, sommets, arrêts principaux. Narrower than
 * `ALWAYS_EVALUATED_POINT_TYPES` — options such as Menton do not gate coverage.
 */
const ESSENTIAL_COVERAGE_POINT_TYPES: ReadonlySet<WeatherSamplePoint['type']> = new Set([
  'start',
  'end',
  'col',
  'summit',
  'passage',
])

export function isAlwaysEvaluatedPoint(point: WeatherSamplePoint): boolean {
  return ALWAYS_EVALUATED_POINT_TYPES.has(point.type)
}

export function isEssentialCoveragePoint(point: WeatherSamplePoint): boolean {
  return ESSENTIAL_COVERAGE_POINT_TYPES.has(point.type)
}

function hasStrategicPassageReference(point: WeatherSamplePoint): boolean {
  return point.references.some(({ subtype }) => subtype === 'strategic-passage')
}

export function getWeatherExposureContext(
  point: WeatherSamplePoint,
  thresholds: WeatherAlertThresholds = WEATHER_ALERT_THRESHOLDS,
): WeatherExposureContext {
  const isSummit = point.type === 'col' || point.type === 'summit'
  const isHighAltitude = point.elevationM >= thresholds.highAltitudeM
  const isStart = point.type === 'start'
  const isFinish = point.type === 'end'
  const isResupply = point.type === 'passage'

  return {
    isSummit,
    isHighAltitude,
    isExposed: isSummit || isHighAltitude || hasStrategicPassageReference(point),
    isResupply,
    isStart,
    isFinish,
  }
}
