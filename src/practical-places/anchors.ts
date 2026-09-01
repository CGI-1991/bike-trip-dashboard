/**
 * Commerce-search anchors for one stage (CDC C2 section 10.B) — départ,
 * arrivée, and any waypoint the stage actually stops at (a paused locality,
 * col, or any other paused point). Deliberately reuses `computeStageWaypoints`
 * (the exact same pause-anchored pipeline `day-detail-view.ts`'s Parcours
 * list and `weather/generic/sample-points.ts` already build from) rather
 * than a second, divergent "which points matter" rule — this module only
 * adds the anchor-selection filter on top.
 */

import { computeStageWaypoints, resolveStagePauseSettings } from '../analysis/waypoint-timeline.ts'
import type { CanonicalWaypoint } from '../analysis/canonical-waypoints.ts'
import { resolveEffectiveMountainMode } from '../analysis/terrain-context.ts'
import type { RideStage, Route, TripBundle } from '../trip-core/index.ts'
import type { PracticalPlaceAnchor } from './types.ts'

/**
 * A bare col/saddle/village/town/city with no pause is never an anchor
 * (CDC: "un col seul ne crée pas une zone commerciale de recherche" — test
 * V) — start/end always are; any other waypoint only becomes one once the
 * stage actually stops there (`pauseDurationMinutes !== null`), a climb
 * itself excluded even then (pauses are never placed mid-climb in practice,
 * but the exclusion stays explicit rather than assumed).
 */
function isPracticalPlaceAnchorWaypoint(waypoint: CanonicalWaypoint): boolean {
  if (waypoint.kind === 'start' || waypoint.kind === 'end') return true
  return waypoint.pauseDurationMinutes !== null && waypoint.kind !== 'climb'
}

export function computeStagePracticalPlaceAnchors(bundle: TripBundle, stage: RideStage, route: Route): readonly PracticalPlaceAnchor[] {
  const day = bundle.days.find((candidate) => candidate.stageId === stage.id)
  const daySettings = day === undefined ? undefined : bundle.settings.days.find((candidate) => candidate.dayId === day.id)
  const settings = { referenceSpeedKph: bundle.settings.global.referenceSpeedKph, departureTime: daySettings?.departureTime ?? '08:00' }
  const stageSettings = bundle.settings.stages.find((candidate) => candidate.stageId === stage.id)
  const pauseResolution = resolveStagePauseSettings(bundle.settings.global.pausePlanMode, stageSettings)
  const waypoints = computeStageWaypoints({
    stage, route, routePoints: bundle.routePoints, climbs: bundle.climbs, settings,
    manualPauses: pauseResolution.mode === 'custom' ? pauseResolution.manualPauses : undefined,
    mountainMode: resolveEffectiveMountainMode(bundle),
  })
  return waypoints.filter(isPracticalPlaceAnchorWaypoint).map((waypoint) => ({ latitude: waypoint.latitude, longitude: waypoint.longitude }))
}
