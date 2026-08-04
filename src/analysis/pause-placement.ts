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

import type { Route } from '../trip-core/index.ts'
import { distributeAutomaticPauses } from './pauses.ts'
import { pointAtDistance, routeGeometryWithDistances } from './canonical-waypoints.ts'
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
  /** The canonical waypoint this pause is anchored to, or `null` for a synthetic fallback point on the route (no suitable anchor nearby). */
  readonly waypointId: string | null
}

function isAnchorCandidate(waypoint: CanonicalWaypoint): boolean {
  return ANCHOR_KIND_PRIORITY[waypoint.kind] !== undefined
}

/**
 * Places the automatic pause budget on the best available canonical
 * waypoints. Deterministic: same inputs always produce the same output, no
 * `Date.now()`/`Math.random()` involved. Falls back to
 * `distributeAutomaticPauses`'s own fixed-fraction position (clamped inside
 * the start/end buffer) when no suitable anchor exists nearby.
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
    if (best !== undefined) {
      placed.push({ id: ideal.id, name: best.name, distanceKm: best.trackDistanceKm, durationMinutes: ideal.durationMinutes, waypointId: best.id })
    } else {
      const fallbackDistanceKm = Math.min(Math.max(ideal.distanceKm, minEdgeKm), totalDistanceKm - minEdgeKm)
      placed.push({ id: ideal.id, name: ideal.name, distanceKm: fallbackDistanceKm, durationMinutes: ideal.durationMinutes, waypointId: null })
    }
  }

  return placed.slice().sort((left, right) => left.distanceKm - right.distanceKm)
}

/**
 * Merges placed pauses back into the canonical waypoint list: an
 * anchored pause fills `pauseDurationMinutes` on its existing waypoint; a
 * synthetic (unanchored) pause becomes its own new `kind: 'pause'` waypoint,
 * positioned by interpolating the route geometry at its distance.
 */
export function applyPausesToWaypoints(waypoints: readonly CanonicalWaypoint[], pauses: readonly PlacedPause[], route: Route): readonly CanonicalWaypoint[] {
  const byWaypointId = new Map(pauses.filter((pause) => pause.waypointId !== null).map((pause) => [pause.waypointId as string, pause]))
  const updated = waypoints.map((waypoint) => {
    const pause = byWaypointId.get(waypoint.id)
    return pause === undefined ? waypoint : { ...waypoint, pauseDurationMinutes: pause.durationMinutes }
  })

  const geometryWithDistances = routeGeometryWithDistances(route)
  const synthetic: CanonicalWaypoint[] = pauses
    .filter((pause) => pause.waypointId === null)
    .map((pause) => {
      const position = geometryWithDistances === null ? null : pointAtDistance(geometryWithDistances.geometry, geometryWithDistances.distances, pause.distanceKm)
      return {
        id: `pause:${pause.id}`, kind: 'pause', importance: 'minor', visibleByDefault: true, name: pause.name,
        trackDistanceKm: pause.distanceKm, latitude: position?.latitude ?? 0, longitude: position?.longitude ?? 0,
        elevationM: position?.altitudeM ?? null, climbId: null, pauseDurationMinutes: pause.durationMinutes,
        elapsedMinutes: null, clockTime: null,
      }
    })

  return [...updated, ...synthetic].sort((left, right) => left.trackDistanceKm - right.trackDistanceKm)
}
