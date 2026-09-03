/**
 * Anchors the automatic pause budget to nearby canonical waypoints (CDC
 * Jalon B, section 6). The total minutes to place NEVER come from this
 * module — they are read from `RideStage.pauseDurationSeconds`, already
 * computed and persisted at import time by `estimateAutomaticBreakBudget`/
 * `computeStageTiming`. This module only decides WHERE, reusing
 * `pauses.ts`'s already-tested `distributeAutomaticPauses` to get the
 * idealized target positions and per-pause duration split (unchanged), then
 * looks for the best nearby structural waypoint for each target instead of
 * leaving it at that raw fraction of the route.
 */

import { distributeAutomaticPauses } from './pauses.ts'
import { redistributePauseDurations } from './pause-duration.ts'
import type { CanonicalWaypoint, CanonicalWaypointKind } from './canonical-waypoints.ts'

/** No pause anchor within this fraction of the total distance from start/end (CDC: "pas de pause trop proche du départ/arrivée"). */
export const PAUSE_MIN_EDGE_BUFFER_FRACTION = 0.08
/** Search window (± this fraction of total distance) around each idealized pause position for a real anchor. */
export const PAUSE_SEARCH_WINDOW_FRACTION = 0.12
/** Minimum spacing between two placed pauses (CDC: "éviter plusieurs pauses rapprochées"). */
export const PAUSE_MIN_SPACING_FRACTION = 0.08

/** Anchor priority (CDC section 6): city > town > village > mountain-pass/saddle. Kinds absent from this map are never used as pause anchors (start/end/climb/pause) — `hamlet`/`peak` were dropped from the generic pipeline entirely (V1 final scope). */
const ANCHOR_KIND_PRIORITY: Readonly<Partial<Record<CanonicalWaypointKind, number>>> = {
  city: 0,
  town: 1,
  village: 2,
  'mountain-pass': 3,
  saddle: 3,
}

export interface PlacedPause {
  readonly id: string
  readonly name: string
  readonly distanceKm: number
  readonly durationMinutes: number
  /**
   * The canonical waypoint this pause is anchored to. NEVER `null` for an
   * automatic pause (DER-DES-DER sections 21-23): a pause is a real place
   * the ride actually stops at, so a slot with no suitable anchor nearby
   * simply produces no pause at all rather than a synthetic point named
   * after the slot ("Pause du matin"/etc.). The field stays nullable only
   * because manual/custom placement shares this shape.
   */
  readonly waypointId: string | null
}

/** C3 reuses this exact anchor-kind gate (`pause-recommendation.ts`) rather than a second, divergent "what counts as a pause anchor" rule. */
export function isAnchorCandidate(waypoint: CanonicalWaypoint): boolean {
  return ANCHOR_KIND_PRIORITY[waypoint.kind] !== undefined
}

/**
 * Places the automatic pause budget on the best available canonical
 * waypoints. Deterministic: same inputs always produce the same output, no
 * `Date.now()`/`Math.random()` involved.
 *
 * DER-DES-DER sections 21-23: a slot with no suitable anchor nearby yields
 * NO pause. The 25/50/75 % ideal positions stay an internal scoring device
 * ("un slot idéal ne devient jamais un lieu") — they are never promoted to a
 * visible place of their own. A stage whose structural enrichment has not
 * landed yet therefore has no city/town/village/col waypoint to anchor on
 * and simply gets no automatic pause (section 12), which is exactly the
 * intent: prefer no pause over a fabricated one. When fewer real places
 * exist than the budget suggests, the remaining minutes are redistributed
 * over the pauses that DID find a home (section 23) rather than dropped.
 */
export function placeAutomaticPauses(totalBreakMinutes: number, totalDistanceKm: number, waypoints: readonly CanonicalWaypoint[]): readonly PlacedPause[] {
  const idealAnchors = distributeAutomaticPauses(totalDistanceKm, totalBreakMinutes)
  if (idealAnchors.length === 0 || !(totalDistanceKm > 0)) return []

  const minEdgeKm = totalDistanceKm * PAUSE_MIN_EDGE_BUFFER_FRACTION
  const windowKm = totalDistanceKm * PAUSE_SEARCH_WINDOW_FRACTION
  const minSpacingKm = totalDistanceKm * PAUSE_MIN_SPACING_FRACTION
  const candidates = waypoints.filter(isAnchorCandidate)
  const placed: PlacedPause[] = []

  for (const ideal of idealAnchors) {
    const usable = candidates
      .filter((waypoint) => waypoint.trackDistanceKm >= minEdgeKm && waypoint.trackDistanceKm <= totalDistanceKm - minEdgeKm)
      .filter((waypoint) => Math.abs(waypoint.trackDistanceKm - ideal.distanceKm) <= windowKm)
      .filter((waypoint) => placed.every((existing) => Math.abs(existing.distanceKm - waypoint.trackDistanceKm) >= minSpacingKm))
      .filter((waypoint) => !placed.some((existing) => existing.waypointId === waypoint.id))
      .sort((left, right) => (ANCHOR_KIND_PRIORITY[left.kind] as number) - (ANCHOR_KIND_PRIORITY[right.kind] as number)
        || Math.abs(left.trackDistanceKm - ideal.distanceKm) - Math.abs(right.trackDistanceKm - ideal.distanceKm)
        || left.id.localeCompare(right.id))
    const best = usable[0]
    // No real place near this slot → no pause for it at all (sections 21-23).
    if (best === undefined) continue
    placed.push({ id: ideal.id, name: best.name, distanceKm: best.trackDistanceKm, durationMinutes: ideal.durationMinutes, waypointId: best.id })
  }

  const redistributed = redistributePauseDurations(placed.map((pause) => pause.durationMinutes), totalBreakMinutes)
  return placed
    .map((pause, index) => ({ ...pause, durationMinutes: redistributed[index] ?? pause.durationMinutes }))
    .filter((pause) => pause.durationMinutes > 0)
    .sort((left, right) => left.distanceKm - right.distanceKm)
}

/**
 * Merges placed pauses back into the canonical waypoint list: each pause
 * simply fills `pauseDurationMinutes` on the real waypoint it is anchored to.
 *
 * DER-DES-DER section 22: this used to also materialize an unanchored pause
 * as its own synthetic `kind: 'pause'` waypoint (named after the slot —
 * "Pause du matin"/etc.). Neither `placeAutomaticPauses` nor
 * `selectPauseRecommendations` can produce one any more, and a manual pause
 * is resolved from an existing waypoint by construction, so a pause never
 * invents a place: it only ever marks one the route already passes through.
 * An unanchored pause reaching here is therefore simply ignored rather than
 * silently reintroducing a fabricated point.
 */
export function applyPausesToWaypoints(waypoints: readonly CanonicalWaypoint[], pauses: readonly PlacedPause[]): readonly CanonicalWaypoint[] {
  const byWaypointId = new Map(pauses.filter((pause) => pause.waypointId !== null).map((pause) => [pause.waypointId as string, pause]))
  return waypoints
    .map((waypoint) => {
      const pause = byWaypointId.get(waypoint.id)
      return pause === undefined ? waypoint : { ...waypoint, pauseDurationMinutes: pause.durationMinutes }
    })
    .slice()
    .sort((left, right) => left.trackDistanceKm - right.trackDistanceKm)
}
