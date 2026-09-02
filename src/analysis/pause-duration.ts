/**
 * R3 sections 9-13 — a single, pure, central place for the "every pause
 * duration is a multiple of 5 minutes" product rule: automatic pauses
 * (`pauses.ts::distributeAutomaticPauses`), C3 candidates (which reuse the
 * same anchors), manual editing (`day-pause-editor__row-duration`'s own
 * `step="5"`, and this — its save-time normalization), and legacy display
 * (an old bundle's `39`/`77` reads back as `40`/`75`, never migrated
 * destructively — the next save simply persists the normalized value).
 * Never dispersed as ad-hoc `Math.round(x / 5) * 5` in several views.
 */

export const PAUSE_DURATION_STEP_MINUTES = 5

/**
 * Rounds to the nearest 5-minute step. `0` (or anything ≤ 0, non-finite)
 * always stays `0` — a genuine "no pause" is never rounded up to a
 * fabricated 5-minute one. Every real pause rounds to the nearest multiple
 * of 5 minutes; for a whole-minute input this never lands exactly on a
 * `.5` boundary, so there is no tie to break.
 */
export function normalizePauseDurationMinutes(minutes: number): number {
  if (!Number.isFinite(minutes) || minutes <= 0) return 0
  return Math.round(minutes / PAUSE_DURATION_STEP_MINUTES) * PAUSE_DURATION_STEP_MINUTES
}
