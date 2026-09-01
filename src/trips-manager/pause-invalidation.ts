/**
 * C2.5 sections 25-28: what a manual-pause edit should invalidate. Timing/
 * ETA/weather-timing/POI-ETA/opening-status are already recomputed fresh,
 * cheaply, in memory on every render (`computeStageWaypoints`/
 * `computeStageTimingCurve`, `buildPracticalPlaceViewModels`,
 * `evaluateOpeningAtPassage`) — nothing to invalidate there. The only
 * expensive, network-backed thing that can go stale is the practical-places
 * search, and only when the ANCHOR SET (which waypoints are paused) itself
 * changes — a duration-only edit never touches it.
 */

import type { RoutePointId, StagePauseSetting } from '../trip-core/index.ts'

export interface StageInvalidation {
  /** `true` only when the set of active pause anchors (by `routePointId`) actually changed — never for a duration-only edit. */
  readonly anchorsChanged: boolean
}

function activeAnchorIds(pauses: readonly StagePauseSetting[]): ReadonlySet<RoutePointId> {
  return new Set(
    pauses.filter((pause) => pause.active && pause.routePointId !== null).map((pause) => pause.routePointId as RoutePointId),
  )
}

/** Order-independent (a pause list re-sorted with the exact same anchors is not a change) and duration-blind by construction (only `routePointId` is compared). */
export function deriveStageInvalidation(previousPauses: readonly StagePauseSetting[], nextPauses: readonly StagePauseSetting[]): StageInvalidation {
  const previous = activeAnchorIds(previousPauses)
  const next = activeAnchorIds(nextPauses)
  if (previous.size !== next.size) return { anchorsChanged: true }
  for (const id of previous) {
    if (!next.has(id)) return { anchorsChanged: true }
  }
  return { anchorsChanged: false }
}
