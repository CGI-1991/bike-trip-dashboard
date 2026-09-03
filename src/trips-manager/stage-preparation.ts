/**
 * A per-ride-day preparation status, derived from the trip's own micro-job
 * record (`route-enrichment/enrichment-jobs.ts`) plus whatever the caller
 * knows about THIS session: which stage the engine is working on right now,
 * and which stages a local mutation marked stale. After a reload both of
 * those are empty and the status falls back to the persisted record alone —
 * never a phantom "running".
 *
 * OFF/transfer days have no enrichment status at all; they return `null`.
 *
 * This status is display-only. It has never gated whether a ride day can be
 * opened: a ride's route, profile, timing and timeline come straight from its
 * imported GPX and do not depend on enrichment at all.
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
  /** Days a local mutation (e.g. a pause anchor change) has marked stale, pending a targeted re-enrichment — cleared once that settles. */
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
 * The "Mes voyages" card's own discreet, jargon-free indicator: a ready/total
 * count while a trip is being prepared, and nothing at all otherwise.
 */
export interface TripPreparationSummary {
  readonly ready: number
  readonly total: number
}

export function computeTripPreparationSummary(bundle: TripBundle, context: StagePreparationContext = NO_STAGE_PREPARATION_CONTEXT): TripPreparationSummary | null {
  // Only the trip whose preparation is ACTUALLY running right now shows
  // this; every other trip's card stays silent. A trip that is merely
  // incomplete is not "in progress", and a permanent "3/8" on its card would
  // be noise about something nothing is currently doing.
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
