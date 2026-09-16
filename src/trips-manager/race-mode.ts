/**
 * Mode "Course / Tour" — in-stage pauses/arrêts are disabled for the whole
 * trip.
 *
 * What it turns off is deliberately narrow: only the planned stops WITHIN a
 * ride. OFF days, transfers, lodging and POI are untouched. A POI is a place
 * that happens to be on the route, not a stop the plan reserves time for —
 * conflating the two is exactly the mistake this module must not make, so
 * `practicalPlaces` is never read here at all.
 *
 * The mechanism is the existing one, not a parallel path: every pause in
 * this app is either an automatic budget (`RideStage.pauseDurationSeconds`,
 * distributed by `analysis/pauses.ts`) or a saved manual list
 * (`TripSettings.stages[].pauses`). Setting the budget to zero makes
 * `distributeAutomaticPauses` return `[]` on its own, and clearing the
 * manual lists leaves nothing for `resolveStagePauseSettings` to place — so
 * every ETA, timeline, map and weather sample stops counting pause time
 * through the engine they already share, with no `if (raceMode)` sprinkled
 * across them.
 *
 * Pure: bundle in, bundle out. No storage, no DOM, no clock.
 */

import { recomputeStageTiming } from './stage-timing.ts'
import { selectRaceMode } from '../trip-core/index.ts'
import type { TripBundle } from '../trip-core/index.ts'

export { selectRaceMode as isRaceModeEnabled }

/**
 * Whether switching Course/Tour ON would actually remove something —
 * a saved manual stop, or an automatic budget currently folded into an ETA.
 * The UI asks for confirmation only when this is `true` (CDC: "Si des
 * arrêts sont déjà configurés, demander confirmation avant leur retrait").
 */
export function hasConfiguredStagePauses(bundle: TripBundle): boolean {
  const hasManualPauses = bundle.settings.stages.some((entry) => entry.pauses.some((pause) => pause.active))
  const hasAutomaticBudget = bundle.stages.some((stage) => (stage.pauseDurationSeconds ?? 0) > 0)
  return hasManualPauses || hasAutomaticBudget
}

/**
 * Applies (or lifts) Course/Tour mode and recomputes everything that
 * genuinely depends on it — never more.
 *
 * ON: every stage is re-timed with a zero pause budget, the manual pause
 * plans and the persisted automatic plans are dropped, and each day's
 * mirrored `totalBreakSeconds` follows. OFF days, transfers, POI, lodging,
 * notes, departure times and GPX are all structurally out of reach.
 *
 * OFF: the per-stage adaptive budget is re-estimated by the same engine
 * that computed it at import time, so a trip leaving Course/Tour mode gets
 * a coherent pause plan back rather than staying silently at zero. Pause
 * plans removed while the mode was on are gone for good — which is exactly
 * what the confirmation before enabling it announces.
 *
 * A no-op (same reference back) when the mode already has the requested
 * value, so callers can skip a pointless save.
 */
export function applyRaceMode(bundle: TripBundle, enabled: boolean): TripBundle {
  if (selectRaceMode(bundle) === enabled) return bundle

  const withMode: TripBundle = {
    ...bundle,
    settings: {
      ...bundle.settings,
      global: { ...bundle.settings.global, raceMode: enabled },
      // Course/Tour removes the per-stage pause plans outright: with pauses
      // disabled, a stored plan would be invisible, un-editable data waiting
      // to silently reappear. Leaving the mode re-derives an automatic
      // budget instead of resurrecting anything.
      stages: enabled ? [] : bundle.settings.stages,
    },
  }

  const stages = withMode.stages.map((stage) => recomputeStageTiming(withMode, stage, withMode.settings.global.referenceSpeedKph, enabled ? 0 : 'adaptive'))
  const pauseSecondsByDayId = new Map(stages.map((stage) => [stage.dayId, stage.pauseDurationSeconds]))

  return {
    ...withMode,
    stages,
    settings: {
      ...withMode.settings,
      // `TripDaySettings.totalBreakSeconds` mirrors the stage's own budget
      // (see `trip-preferences.ts::applyReferenceSpeed`) — kept in sync here
      // for the same reason.
      days: withMode.settings.days.map((entry) => (pauseSecondsByDayId.has(entry.dayId) ? { ...entry, totalBreakSeconds: pauseSecondsByDayId.get(entry.dayId) ?? null } : entry)),
    },
    enrichmentMetadata: {
      ...withMode.enrichmentMetadata,
      // A persisted automatic plan is a pause plan too — it must not survive
      // the mode that forbids pauses, and must not come back stale when the
      // mode is lifted (the engine recomputes one on its own).
      automaticPausePlans: enabled ? [] : withMode.enrichmentMetadata.automaticPausePlans,
    },
  }
}
