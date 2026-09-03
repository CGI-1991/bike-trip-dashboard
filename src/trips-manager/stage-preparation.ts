/**
 * C2.5 FINAL sections 5-10: a per-ride-day preparation status, derived
 * (never persisted as its own field — section 21, "éviter une grosse
 * migration") from whatever the trip already carries. `enrichmentMetadata.
 * providers` (`trip-core/model/generated-metadata.ts`) is trip-wide, not
 * per-stage, so during an active session the caller (`trips-manager.ts`)
 * supplies the extra in-memory precision this module can't get from the
 * bundle alone: which stage is currently `running` (from the enrichment
 * engine's own per-stage progress index) and which stages were marked
 * `stale` by a local mutation (a pause anchor change, section 27). After a
 * reload, both of those are empty — the derived status naturally falls back
 * to whatever the trip-wide provider state says (never a phantom
 * `'running'`, section 20).
 *
 * OFF/transfer days have no Postpass status at all (section 5) —
 * `deriveStagePreparationStatus` returns `null` for them.
 *
 * R3 sections 41-42: this status is display-only — it no longer gates
 * whether a ride day can be opened at all (the removed `isDayDetailOpenable`
 * used to block `'pending'`/`'running'` from `trips-manager.ts`'s
 * `open-day-detail` handler). A ride's route/profil/timing/timeline come
 * straight from its already-imported GPX, entirely independent of Postpass
 * — gating the whole screen on a trip-wide enrichment pass that processes
 * every stage strictly sequentially meant EVERY ride day stayed blocked for
 * the whole pass's duration, not just the one stage actually being
 * enriched (the real root cause behind "reste bloqué En cours"). The one
 * legitimate reason a ride stays unopenable is `buildDayDetail` itself
 * returning `null` — its stage/route genuinely can't be resolved at all.
 */

import { deriveTripTemporalState } from './trip-day-temporal-state.ts'
import { stageJobsFor } from '../route-enrichment/enrichment-jobs.ts'
import type { EnrichmentJobPhase } from '../route-enrichment/enrichment-jobs.ts'
import type { TripBundle, TripDayId } from '../trip-core/index.ts'

/**
 * `error` is retained only so existing callers keep type-checking; the
 * engine no longer produces it. A stretch of route that could not be
 * answered is outstanding work (`partial`/`pending`), not a terminal
 * failure — that distinction is the whole point of the micro-job model.
 */
export type StagePreparationStatus = 'pending' | 'running' | 'ready' | 'stale' | 'partial' | 'error' | 'waiting-for-network'

export interface StagePreparationContext {
  /** The ride day whose enrichment the engine is actively working on right now, if any (derived from the engine's own per-stage progress index) — `null` when no automatic-enrichment pass is currently running for this trip. */
  readonly runningDayId: TripDayId | null
  /** Days a local mutation (e.g. a pause anchor change) has marked stale, pending a targeted re-enrichment (section 24/27) — cleared once that re-enrichment settles. */
  readonly staleDayIds: ReadonlySet<TripDayId>
  /** Whether each provider is even configured in this deployment/test — without this, a bundle whose `enrichmentMetadata` was seeded with `'not-configured'` (the case for every environment that never injects a provider) would be indistinguishable from "not attempted yet" and would gate the detail forever. */
  readonly routeEnrichmentConfigured: boolean
  readonly practicalPlacesConfigured: boolean
}

export const NO_STAGE_PREPARATION_CONTEXT: StagePreparationContext = {
  runningDayId: null,
  staleDayIds: new Set(),
  routeEnrichmentConfigured: false,
  practicalPlacesConfigured: false,
}

/**
 * `null` for OFF/transfer, or when `dayId` doesn't resolve to a ride day at
 * all — every other case yields exactly one of the six terminal/in-progress
 * statuses (section 5). `runningDayId`/`staleDayIds` take priority over the
 * persisted trip-wide provider state, since they reflect what's actually
 * happening in *this* session right now.
 */
/**
 * RC2 final-closeout section 18 — the practical-places (POI) dimension's
 * contribution to `relevant` below, refined to THIS one ride day when
 * precise per-stage data is available (`enrichmentMetadata.
 * practicalPlacesStageErrors`, populated by the progressive per-stage
 * `practical-places/enrichment.ts` pass): when the trip-wide aggregate is
 * `success`/`not-configured`/`pending`, every stage shares it exactly like
 * before (nothing to refine — either everything's fine, or nothing's been
 * attempted). Only when the aggregate says `partial`/`error` — today, EVERY
 * ride day inherits that single trip-wide verdict alike, the literal cause
 * of "toutes les vignettes semblent En cours/À compléter" — do we consult
 * the per-stage list: this exact day errored → `error`, any other day →
 * `success` (its own POI are fine; the trip-wide flag is about a sibling
 * stage). A bundle enriched before this field existed (`undefined`, never
 * an empty array) has no per-stage detail yet — falls back to the coarse
 * trip-wide value for every stage, exactly like before, and self-heals the
 * next time automatic enrichment runs for this trip (always cache-first,
 * always triggered again on next open since the aggregate isn't `success`).
 */
/**
 * A ride day's own preparation status, read from the micro-job record.
 *
 * The record is the only honest source: it says, per phase and per stretch
 * of route, what has really been answered. Deriving from the trip-wide
 * provider status instead — as this used to — made every stage of a trip
 * share one verdict, so a single incomplete stage marked them all.
 *
 * `waiting-for-network` is surfaced as its own status because it is the one
 * case the app cannot resolve by itself, and therefore the one the user
 * benefits from seeing.
 */
export function deriveStagePreparationStatus(bundle: TripBundle, dayId: TripDayId, context: StagePreparationContext = NO_STAGE_PREPARATION_CONTEXT): StagePreparationStatus | null {
  const day = bundle.days.find((candidate) => candidate.id === dayId)
  if (day === undefined || day.type !== 'ride' || day.stageId === null) return null
  if (context.runningDayId === dayId) return 'running'
  if (context.staleDayIds.has(dayId)) return 'stale'
  // Nothing is even configured for this deployment/test — never a
  // permanently pending ride with no way to ever become ready.
  if (!context.routeEnrichmentConfigured && !context.practicalPlacesConfigured) return 'ready'

  const record = stageJobsFor(bundle, day.stageId)
  if (record === undefined) {
    // No job record at all: either a bundle that predates it (migrated on the
    // next pass) or a trip whose enrichment has not started. Both read as
    // "not yet", never as ready.
    return 'pending'
  }
  const phases: EnrichmentJobPhase[] = [
    ...(context.routeEnrichmentConfigured ? (['structural'] as const) : []),
    ...(context.practicalPlacesConfigured ? (['practical'] as const) : []),
  ]
  const jobs = record.jobs.filter((job) => phases.includes(job.kind))
  if (jobs.length === 0) return 'pending'
  if (jobs.some((job) => job.status === 'waiting-for-network')) return 'waiting-for-network'
  if (jobs.every((job) => job.status === 'success' || job.status === 'empty')) return 'ready'
  if (jobs.some((job) => job.status === 'success' || job.status === 'empty')) return 'partial'
  return 'pending'
}

/**
 * RC2 final-closeout sections 19-20 — the "Mes voyages" card's own discreet,
 * jargon-free indicator: `null` once every ride day is `ready` (or the trip
 * has none at all) — nothing to show, silence when healthy, exactly like
 * every other status surface in this app. Otherwise the same ready/total
 * count `patchStagePreparationSummary` already shows on the Voyage screen,
 * reused here rather than a second, divergent computation.
 */
export interface TripPreparationSummary {
  readonly ready: number
  readonly total: number
}

export function computeTripPreparationSummary(bundle: TripBundle, context: StagePreparationContext = NO_STAGE_PREPARATION_CONTEXT): TripPreparationSummary | null {
  // DER-DES-DER section 54: only the trip whose preparation is ACTUALLY
  // running right now may show this indicator; every other trip stays
  // silent. Before the pipeline became one-shot, "not fully ready" and
  // "still working on it" were effectively the same thing; now a trip can
  // sit settled-but-incomplete indefinitely, and showing "3/8" on its card
  // forever would be permanent noise for something no longer in progress.
  // That state belongs to the stage's own card in the Voyage screen
  // ("À compléter / Réessayer", sections 52-53), not to "Mes voyages".
  if (context.runningDayId === null) return null
  const rideDayIds = bundle.days.filter((day) => day.type === 'ride' && day.stageId !== null).map((day) => day.id)
  const total = rideDayIds.length
  if (total === 0) return null
  const ready = rideDayIds.filter((id) => deriveStagePreparationStatus(bundle, id, context) === 'ready').length
  return ready >= total ? null : { ready, total }
}

/**
 * Section 8: priority day first (the same D1 `priorityDayId` used
 * everywhere else in the app — never a second, divergent definition of
 * "which day matters right now"), then the remaining ride days in
 * chronological order (future days next), then whatever ride days come
 * chronologically BEFORE the priority day (past, still-incomplete rides)
 * last. OFF/transfer days are never included — section 8: "OFF/transfert :
 * ignorés." Returns every ride day in this order regardless of its current
 * preparation status; the caller skips whichever ones are already `ready`.
 */
export function computeStagePreparationOrder(bundle: TripBundle, now: Date | string | null): readonly TripDayId[] {
  const temporal = deriveTripTemporalState(bundle, now)
  const rideDayIds = bundle.days
    .slice()
    .sort((left, right) => left.index - right.index)
    .filter((day) => day.type === 'ride' && day.stageId !== null)
    .map((day) => day.id)
  const priorityIndex = temporal.priorityDayId === null ? -1 : rideDayIds.indexOf(temporal.priorityDayId)
  if (priorityIndex === -1) return rideDayIds
  return [
    ...rideDayIds.slice(priorityIndex),
    ...rideDayIds.slice(0, priorityIndex),
  ]
}
