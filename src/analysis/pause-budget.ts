/**
 * Adaptive automatic break-budget estimate (annexe fonctionnelle section
 * 12.2, CDC phase 6C1 section 22). Replaces the flat 60-minute default the
 * phase 6B engine still falls back to — for *new* generic imports only;
 * `pauses.ts`'s `DEFAULT_TOTAL_BREAK_MINUTES`-style flat contract and the
 * RGA legacy pipeline/golden master are untouched.
 *
 * A continuous, capped function of moving duration and climbing
 * difficulty — never two rigid `if` thresholds. Rate of break-minutes per
 * moving hour grows with duration (a long day needs proportionally more
 * rest, not just more in total), then a difficulty factor scales it up
 * further for climbing-heavy stages. Calibrated against the annexe's own
 * example points (~50 km → ~20 min, ~100 km → ~60 min at the default
 * 18 km/h reference speed) — see `pause-budget.test.mjs`.
 */

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

/** Break-minutes per moving hour at a very short ride, and how fast that rate grows with duration — both capped. */
const BASE_RATE_PER_HOUR = 3.6
const RATE_GROWTH_PER_HOUR = 1.295
const MAX_RATE_PER_HOUR = 16

/** Elevation gain per km (m/km) below which terrain is treated as flat (no difficulty surcharge). */
const FLAT_ELEVATION_GAIN_PER_KM = 5
/** Elevation gain per km at which the difficulty factor reaches its cap. */
const STEEP_ELEVATION_GAIN_PER_KM = 65
const MAX_DIFFICULTY_FACTOR = 1.8

const MAX_BREAK_MINUTES = 240
const ROUND_TO_MINUTES = 5

/**
 * Estimates the automatic break budget for one stage. Returns `0` for a
 * non-positive distance or moving duration (nothing to pace breaks
 * against) — never negative, never `NaN`.
 */
export function estimateAutomaticBreakBudget(distanceKm: number, movingDurationMinutes: number, elevationGainM: number | null): number {
  if (!(distanceKm > 0) || !(movingDurationMinutes > 0)) return 0

  const movingDurationHours = movingDurationMinutes / 60
  const ratePerHour = clamp(BASE_RATE_PER_HOUR + RATE_GROWTH_PER_HOUR * movingDurationHours, BASE_RATE_PER_HOUR, MAX_RATE_PER_HOUR)

  const elevationGainPerKm = elevationGainM === null ? 0 : Math.max(0, elevationGainM) / distanceKm
  const difficultyProgress = clamp(elevationGainPerKm - FLAT_ELEVATION_GAIN_PER_KM, 0, STEEP_ELEVATION_GAIN_PER_KM - FLAT_ELEVATION_GAIN_PER_KM)
  const difficultyFactor = 1 + (difficultyProgress / (STEEP_ELEVATION_GAIN_PER_KM - FLAT_ELEVATION_GAIN_PER_KM)) * (MAX_DIFFICULTY_FACTOR - 1)

  const rawMinutes = movingDurationHours * ratePerHour * difficultyFactor
  const rounded = Math.round(rawMinutes / ROUND_TO_MINUTES) * ROUND_TO_MINUTES
  return clamp(rounded, 0, MAX_BREAK_MINUTES)
}
