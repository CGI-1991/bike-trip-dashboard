/**
 * Automatic pause plan V1 (CDC section 9/18: "conserver pour cette phase le
 * contrat actuellement disponible dans TripSettings... ne dépendre encore
 * d'aucun POI externe"). The historical POI-aware contextual pause plan
 * (`src/trip/pause-plan.ts`'s `createContextualPauseAnchors`) needs
 * documented places, an enrichment this generic pipeline does not have yet —
 * out of scope by this phase's own instructions. What *is* generic and
 * reusable is the historical engine's own POI-free fallback: fixed anchors
 * at set fractions of the route, sharing `totalBreakMinutes` by a fixed
 * split (`src/route/config.ts`'s `routeEngineConfig.pauseRules` — reused
 * here directly, not duplicated). That mechanism is private to
 * `src/route/engine.ts` (`createPauseAnchors`/`allocatePauseDurations`), so
 * it is reimplemented here as a small, independently tested, exported
 * function against the same config.
 */

import { routeEngineConfig } from '../route/config.ts'
import type { PauseRule } from '../route/config.ts'

export interface PauseAnchor {
  readonly id: string
  readonly name: string
  readonly distanceKm: number
  readonly durationMinutes: number
}

/**
 * Splits `totalMinutes` across `shares` using the largest-remainder method
 * (floor first, then hand out the leftover minutes to the largest
 * fractional remainders) — deterministic, and the parts always sum to
 * exactly `totalMinutes`.
 */
function allocateByShare(totalMinutes: number, shares: readonly number[]): readonly number[] {
  if (shares.length === 0) return []

  const totalShare = shares.reduce((sum, share) => sum + share, 0)
  if (!(totalShare > 0)) return shares.map(() => 0)

  const exact = shares.map((share) => (totalMinutes * share) / totalShare)
  const durations = exact.map(Math.floor)
  let remaining = totalMinutes - durations.reduce((sum, value) => sum + value, 0)

  const order = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((left, right) => right.remainder - left.remainder || left.index - right.index)

  for (const { index } of order) {
    if (remaining <= 0) break
    durations[index] = (durations[index] ?? 0) + 1
    remaining--
  }

  return durations
}

/**
 * Distributes `totalBreakMinutes` across fixed fractions of the route
 * (CDC section 18's automatic mode, POI-free variant). Returns `[]` when
 * there is nothing to distribute (`totalBreakMinutes <= 0`) or no route
 * distance to anchor to.
 */
export function distributeAutomaticPauses(
  totalDistanceKm: number,
  totalBreakMinutes: number,
  rules: readonly PauseRule[] = routeEngineConfig.pauseRules,
): readonly PauseAnchor[] {
  if (!(totalDistanceKm > 0) || !(totalBreakMinutes > 0) || rules.length === 0) return []

  const durations = allocateByShare(totalBreakMinutes, rules.map((rule) => rule.durationShare))

  return rules
    .map((rule, index) => ({
      id: rule.id,
      name: rule.name,
      distanceKm: totalDistanceKm * rule.routeFraction,
      durationMinutes: durations[index] ?? 0,
    }))
    .filter((anchor) => anchor.durationMinutes > 0)
}
