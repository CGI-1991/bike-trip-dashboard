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

/**
 * DER-DES-DER section 23: when fewer real places exist than the pause budget
 * suggested slots for, the orphaned minutes are spread over the pauses that
 * DID find a home rather than silently dropped — "faire 2 pauses" with a
 * sensible split, never a third artificial one to balance the books.
 *
 * Proportional to each kept slot's own share (so the lunch slot stays the
 * long one), then normalized back to the 5-minute step — which is exactly
 * the "légère différence par rapport au budget total théorique" the CDC
 * sanctions. A no-op when nothing was dropped (`kept >= budget`), so the
 * ordinary full-placement path keeps `distributeAutomaticPauses`'s own
 * already-tested durations byte-for-byte.
 */
export function redistributePauseDurations(keptDurations: readonly number[], totalBudgetMinutes: number): readonly number[] {
  const kept = keptDurations.reduce((total, duration) => total + duration, 0)
  if (keptDurations.length === 0 || !(totalBudgetMinutes > 0) || !(kept > 0) || kept >= totalBudgetMinutes) {
    return keptDurations.map(normalizePauseDurationMinutes)
  }
  const scale = totalBudgetMinutes / kept
  return keptDurations.map((duration) => normalizePauseDurationMinutes(duration * scale))
}
