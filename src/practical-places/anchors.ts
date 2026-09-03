/**
 * Commerce-search anchors for one stage (CDC C2 section 10.B, rewritten for
 * DER-DES-DER sections 16-18).
 *
 * The anchors used to be "départ, arrivée, and any waypoint the stage
 * actually PAUSES at" — which made the POI search depend on the automatic
 * pause plan. That is the circular dependency this milestone removes: pauses
 * are the RESULT of enrichment (POI included), so they cannot also be one of
 * its inputs. Under the new chronology (structural global → POI per stage →
 * pauses per stage) there is simply no pause plan yet when this runs.
 *
 * Anchors are now read straight off the stage's structural geography: its
 * départ, its arrivée, and the real localities/cols the route passes through
 * — exactly the same set `pause-placement.ts::isAnchorCandidate` treats as a
 * legitimate place to stop. No pause state is consulted at all, so the
 * anchors (and therefore the Postpass cache key derived from them) are now a
 * pure function of the GPX plus the structural enrichment that precedes this
 * phase — stable, and no longer invalidated by an unrelated pause edit.
 */

import { buildCanonicalWaypoints } from '../analysis/canonical-waypoints.ts'
import type { CanonicalWaypoint } from '../analysis/canonical-waypoints.ts'
import { isAnchorCandidate } from '../analysis/pause-placement.ts'
import { resolveEffectiveMountainMode } from '../analysis/terrain-context.ts'
import type { RideStage, Route, TripBundle } from '../trip-core/index.ts'
import type { PracticalPlaceAnchor } from './types.ts'

/**
 * Section 18: a real place the route passes through — départ/arrivée always,
 * plus every city/town/village/col the structural pass found
 * (`isAnchorCandidate`, the single shared "what counts as a real place"
 * rule). A bare `climb` is still excluded: a generic ascent is not a place
 * with shops, and a col that IS one is already covered by `mountain-pass`/
 * `saddle`.
 */
function isPracticalPlaceAnchorWaypoint(waypoint: CanonicalWaypoint): boolean {
  return waypoint.kind === 'start' || waypoint.kind === 'end' || isAnchorCandidate(waypoint)
}

export function computeStagePracticalPlaceAnchors(bundle: TripBundle, stage: RideStage, route: Route): readonly PracticalPlaceAnchor[] {
  // `buildCanonicalWaypoints` rather than `computeStageWaypoints`: the latter
  // runs the whole pause-placement/timeline pipeline, which is precisely what
  // must NOT influence this phase any more (section 16). The base waypoints
  // it builds on are the structural truth — départ, arrivée, localities,
  // cols, climbs — and are all this needs.
  const waypoints = buildCanonicalWaypoints({
    stage,
    route,
    routePoints: bundle.routePoints,
    climbs: bundle.climbs,
    mountainMode: resolveEffectiveMountainMode(bundle),
  })
  return waypoints.filter(isPracticalPlaceAnchorWaypoint).map((waypoint) => ({ latitude: waypoint.latitude, longitude: waypoint.longitude }))
}
