/**
 * Integrity-hardening — the automatic pause plan becomes a stable, PERSISTED
 * result instead of something recomputed live on every render.
 *
 * Before this, `computeStageWaypoints`/`buildAutomaticPauseEnrichment` fed
 * the C3 scoring engine (`analysis/pause-recommendation.ts`) live weather and
 * departure-time inputs on EVERY call — by design, so the engine can use the
 * best information available (CDC C3 sections 25/30) — but with nothing
 * caching the OUTCOME, the exact same structural/POI data could pick a
 * DIFFERENT anchor for the same slot the moment a weather refresh or a
 * departure-time edit shifted those two inputs, even though nothing about
 * the stage's own geography changed. A displayed pause anchor moving under
 * the traveller's feet for reasons that have nothing to do with the route
 * itself is the core bug this fixes.
 *
 * Once a stage is fully enriched (`isStageFullyEnriched` — the same hard
 * gate `stageAutomaticPausesAllowed` already applies), its automatic plan is
 * computed ONCE and persisted here, keyed by the stage's own
 * `routeFingerprint` exactly like `StageEnrichmentJobs` — so it is
 * invalidated by precisely the same events: the stage's GPX genuinely
 * changing (a new fingerprint, or the stage id itself being replaced
 * outright by a structural edit), or "Recalculer les données du parcours"
 * dropping the whole `enrichmentMetadata` bookkeeping back to just
 * `providers`. A later weather refresh or departure-time edit only ever
 * changes the ETA/opening-hours/display computed FROM the persisted anchors
 * (`computeStageWaypoints`'s existing `manualPauses` pipeline, completely
 * unchanged) — it never re-selects them.
 *
 * `pausePlanMode: 'custom'` never reaches this module at all — a persisted
 * automatic plan and a saved manual pause list are structurally two
 * different things and are never mixed (CDC C3 section 3/32).
 */

import { normalizePauseDurationMinutes } from '../analysis/pause-duration.ts'
import { resolveEffectiveMountainMode } from '../analysis/terrain-context.ts'
import { buildAutomaticPauseEnrichment, computeStagePauseRecommendations } from '../analysis/waypoint-timeline.ts'
import type { ManualPauseSetting, WaypointTimelineSettings } from '../analysis/waypoint-timeline.ts'
import type { RideStageId, RoutePointId, StageAutomaticPausePlan, StagePauseSetting, TripBundle } from '../trip-core/index.ts'
import { isStageFullyEnriched, stageFingerprintFor } from './enrichment-jobs.ts'

function resolveStageContext(bundle: TripBundle, stageId: RideStageId) {
  const stage = bundle.stages.find((candidate) => candidate.id === stageId)
  if (stage === undefined) return null
  const route = bundle.routes.find((candidate) => candidate.id === stage.sourceRouteId)
  if (route === undefined) return null
  const day = bundle.days.find((candidate) => candidate.id === stage.dayId)
  if (day === undefined) return null
  return { stage, route, day }
}

function effectivePausePlanMode(bundle: TripBundle, stageId: RideStageId): 'automatic' | 'custom' {
  const stageSettings = bundle.settings.stages.find((candidate) => candidate.stageId === stageId)
  return stageSettings?.pausePlanMode ?? bundle.settings.global.pausePlanMode
}

function storedPlanFor(bundle: TripBundle, stageId: RideStageId): StageAutomaticPausePlan | undefined {
  return bundle.enrichmentMetadata.automaticPausePlans?.find((candidate) => candidate.stageId === stageId)
}

/** Whether a persisted plan exists for this stage AND is still trustworthy — the stage's own GPX has not changed since it was computed. */
export function isAutomaticPausePlanValid(bundle: TripBundle, stageId: RideStageId): boolean {
  const stored = storedPlanFor(bundle, stageId)
  if (stored === undefined) return false
  return stored.routeFingerprint === stageFingerprintFor(bundle, stageId)
}

/**
 * The persisted plan, ready to feed `computeStageWaypoints`'s
 * `manualPauses` — the exact same fixed-anchor pipeline `pausePlanMode:
 * 'custom'` already uses, so a persisted automatic plan is, by construction,
 * immune to the live weather/departure-time inputs that only ever affect a
 * FRESH C3 scoring pass. `undefined` when the stage isn't in automatic mode,
 * or nothing valid is persisted yet (never computed, or invalidated) —
 * callers fall back to their own live computation exactly like before this
 * feature existed.
 */
export function resolvePersistedAutomaticPausePlan(bundle: TripBundle, stageId: RideStageId): readonly ManualPauseSetting[] | undefined {
  if (effectivePausePlanMode(bundle, stageId) !== 'automatic') return undefined
  if (!isAutomaticPausePlanValid(bundle, stageId)) return undefined
  const stored = storedPlanFor(bundle, stageId)
  if (stored === undefined) return undefined
  return stored.pauses
    .filter((pause) => pause.active && pause.routePointId !== null)
    .slice()
    .sort((left, right) => left.order - right.order)
    .map((pause) => ({ id: pause.id, routePointId: pause.routePointId as string, durationMinutes: Math.round(pause.durationSeconds / 60), order: pause.order }))
}

/**
 * Computes one stage's automatic pause plan exactly once, from whatever
 * structural/POI/weather/departure-time data is available RIGHT NOW — the
 * same C3 engine every live render already uses
 * (`computeStagePauseRecommendations`). Returns `null` when the stage isn't
 * resolvable at all (no day/route — the plan has nothing to attach to), `[]`
 * when the engine genuinely found no real place to recommend (a valid, EMPTY
 * plan — never retried just because it came back empty, exactly like a
 * `success`/`empty` structural job).
 */
export function computeAutomaticPausePlanForStage(bundle: TripBundle, stageId: RideStageId, idFactory: () => string): readonly StagePauseSetting[] | null {
  const context = resolveStageContext(bundle, stageId)
  if (context === null) return null
  const { stage, route, day } = context
  const daySettings = bundle.settings.days.find((candidate) => candidate.dayId === day.id)
  const settings: WaypointTimelineSettings = { referenceSpeedKph: bundle.settings.global.referenceSpeedKph, departureTime: daySettings?.departureTime ?? '08:00' }
  const recommendations = computeStagePauseRecommendations({
    stage, route, routePoints: bundle.routePoints, climbs: bundle.climbs, settings,
    mountainMode: resolveEffectiveMountainMode(bundle),
    automaticPauseEnrichment: buildAutomaticPauseEnrichment(bundle, stage, day),
  })
  return recommendations
    // CDC C3 sections 26/30: C3 never fabricates an anchor any more — but
    // the type still allows `waypointId: null` defensively, so a plan is
    // never persisted with a synthetic/anchor-less entry.
    .filter((recommendation) => recommendation.waypointId !== null)
    .map((recommendation, index): StagePauseSetting => ({
      id: idFactory(),
      active: true,
      routePointId: recommendation.waypointId as RoutePointId,
      durationSeconds: normalizePauseDurationMinutes(recommendation.durationMinutes) * 60,
      order: index,
      origin: 'automatic',
    }))
}

/** Replaces (or adds) one stage's persisted plan. */
export function withAutomaticPausePlan(bundle: TripBundle, stageId: RideStageId, pauses: readonly StagePauseSetting[]): TripBundle {
  const fingerprint = stageFingerprintFor(bundle, stageId)
  if (fingerprint === null) return bundle
  const others = (bundle.enrichmentMetadata.automaticPausePlans ?? []).filter((candidate) => candidate.stageId !== stageId)
  const plan: StageAutomaticPausePlan = { stageId, routeFingerprint: fingerprint, pauses }
  return { ...bundle, enrichmentMetadata: { ...bundle.enrichmentMetadata, automaticPausePlans: [...others, plan] } }
}

/**
 * Whether any stage in this trip is ready for its plan to be computed and
 * persisted but doesn't have a valid one yet — `automatic-enrichment.ts`'s
 * `tripNeedsAutomaticEnrichment` ORs this in, so a trip whose
 * structural/practical work was ALREADY complete before this feature
 * existed still gets its plans backfilled on its next open, not only a trip
 * enriched from scratch afterwards.
 */
export function tripNeedsAutomaticPausePlans(bundle: TripBundle): boolean {
  return bundle.stages.some((stage) =>
    effectivePausePlanMode(bundle, stage.id) === 'automatic'
    && isStageFullyEnriched(bundle, stage.id)
    && !isAutomaticPausePlanValid(bundle, stage.id))
}

/**
 * Computes and persists a plan for every stage that qualifies
 * (`tripNeedsAutomaticPausePlans`'s own per-stage condition) — a pure,
 * local, no-network pass. Returns `bundle` unchanged (by reference) when
 * nothing needed doing, so callers can skip a pointless save.
 */
export function ensureAutomaticPausePlans(bundle: TripBundle, idFactory: () => string): TripBundle {
  let result = bundle
  for (const stage of bundle.stages) {
    if (effectivePausePlanMode(result, stage.id) !== 'automatic') continue
    if (!isStageFullyEnriched(result, stage.id)) continue
    if (isAutomaticPausePlanValid(result, stage.id)) continue
    const pauses = computeAutomaticPausePlanForStage(result, stage.id, idFactory)
    if (pauses === null) continue
    result = withAutomaticPausePlan(result, stage.id, pauses)
  }
  return result
}
