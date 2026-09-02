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
import type { EnrichmentProviderStatus, TripBundle, TripDayId } from '../trip-core/index.ts'

export type StagePreparationStatus = 'pending' | 'running' | 'ready' | 'stale' | 'partial' | 'error'

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
export function deriveStagePreparationStatus(bundle: TripBundle, dayId: TripDayId, context: StagePreparationContext = NO_STAGE_PREPARATION_CONTEXT): StagePreparationStatus | null {
  const day = bundle.days.find((candidate) => candidate.id === dayId)
  if (day === undefined || day.type !== 'ride' || day.stageId === null) return null
  if (context.runningDayId === dayId) return 'running'
  if (context.staleDayIds.has(dayId)) return 'stale'

  const relevant: EnrichmentProviderStatus[] = []
  if (context.routeEnrichmentConfigured) {
    relevant.push(bundle.enrichmentMetadata.providers.find((state) => state.provider === 'postpass-route-enrichment')?.status ?? 'not-configured')
  }
  if (context.practicalPlacesConfigured) {
    relevant.push(bundle.enrichmentMetadata.providers.find((state) => state.provider === 'postpass-practical-places')?.status ?? 'not-configured')
  }
  // Nothing is even configured for this deployment/test — never a
  // permanently pending ride with no way to ever become ready.
  if (relevant.length === 0) return 'ready'
  if (relevant.some((status) => status === 'pending')) return 'running'
  if (relevant.some((status) => status === 'not-configured')) return 'pending'
  if (relevant.every((status) => status === 'success')) return 'ready'
  if (relevant.some((status) => status === 'success' || status === 'partial')) return 'partial'
  return 'error'
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
