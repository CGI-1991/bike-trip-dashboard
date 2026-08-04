/**
 * Full per-waypoint result for one stage (CDC Jalon B, section 7): builds
 * the canonical waypoints (`canonical-waypoints.ts`), anchors the automatic
 * pause budget onto them (`pause-placement.ts`), then fills in elapsed
 * time / clock time for every waypoint by reusing the historical engine's
 * own grade-aware timing core (`createTerrainTiming`/`interpolateTerrainTiming`,
 * `route/terrain-profile.ts`) and the generic engine's elapsed/clock-time
 * composition (`timing.ts::buildTimeline`) — never a new timing model.
 *
 * The terrain profile is rebuilt from `Route.geometry` here because
 * `timing.ts` deliberately never persists the full per-point timeline (see
 * its own doc comment) — this is the same, cheap recomputation
 * `route-analysis.ts` already does at import time, not a new cost.
 */

import { createTerrainTiming, interpolateTerrainTiming, buildTerrainProfileSeries } from '../route/terrain-profile.ts'
import { formatRouteClockTime } from '../route/time.ts'
import type { RouteProfilePosition } from '../route/types.ts'
import type { Climb, RideStage, Route, RoutePoint } from '../trip-core/index.ts'
import { routeGeometryWithDistances } from './canonical-waypoints.ts'
import type { CanonicalWaypoint } from './canonical-waypoints.ts'
import { buildCanonicalWaypoints } from './canonical-waypoints.ts'
import { applyPausesToWaypoints, placeAutomaticPauses } from './pause-placement.ts'
import type { PauseAnchor } from './pauses.ts'
import { buildTimeline, parseClockToMinutes } from './timing.ts'

export interface WaypointTimelineSettings {
  readonly referenceSpeedKph: number
  /** "HH:MM", the day's actual departure time (`TripDaySettings.departureTime`). */
  readonly departureTime: string
}

export interface ComputeStageWaypointsInput {
  readonly stage: RideStage
  readonly route: Route
  readonly routePoints: readonly RoutePoint[]
  readonly climbs: readonly Climb[]
  readonly settings: WaypointTimelineSettings
}

function movingElapsedMinutesAt(source: RouteProfilePosition[], totalDistanceKm: number, referenceSpeedKph: number): (distanceKm: number) => number {
  const terrainSeries = buildTerrainProfileSeries(source)
  if (terrainSeries.length < 2) {
    // No usable altitude data — same flat-terrain fallback philosophy as
    // `timing.ts::computeFlatTiming`: distance / reference speed, no invented precision.
    return (distanceKm: number) => (Math.max(0, distanceKm) / referenceSpeedKph) * 60
  }
  const timing = createTerrainTiming(terrainSeries, totalDistanceKm, referenceSpeedKph)
  return (distanceKm: number) => interpolateTerrainTiming(timing, distanceKm).movingElapsedMinutes
}

/**
 * Full pipeline entry point for one stage: canonical waypoints, anchored
 * pauses, and per-waypoint ETA. Returns `[]` when the route has no usable
 * geometry (same degenerate case as `buildCanonicalWaypoints`).
 */
export function computeStageWaypoints(input: ComputeStageWaypointsInput): readonly CanonicalWaypoint[] {
  const { stage, route, routePoints, climbs, settings } = input
  const baseWaypoints = buildCanonicalWaypoints({ stage, route, routePoints, climbs })
  if (baseWaypoints.length === 0) return []

  const geometryWithDistances = routeGeometryWithDistances(route)
  if (geometryWithDistances === null) return baseWaypoints
  const { geometry, distances } = geometryWithDistances
  const totalDistanceKm = distances.at(-1) ?? 0
  const totalBreakMinutes = (stage.pauseDurationSeconds ?? 0) / 60

  const placedPauses = placeAutomaticPauses(totalBreakMinutes, totalDistanceKm, baseWaypoints)
  const withPauses = applyPausesToWaypoints(baseWaypoints, placedPauses, route)

  if (!(settings.referenceSpeedKph > 0) || !(totalDistanceKm > 0)) return withPauses

  const source: RouteProfilePosition[] = geometry.map((point, index) => ({
    latitude: point.latitude,
    longitude: point.longitude,
    sourceFileNumber: 1,
    sourceFileName: 'route.gpx',
    distanceKm: distances[index] ?? 0,
    elevationGainM: 0,
    elevationLossM: 0,
    altitudeM: point.altitudeM,
    localSlopePercent: 0,
    speedMultiplier: 1,
    weightedDistanceKm: distances[index] ?? 0,
  }))
  const movingElapsedAt = movingElapsedMinutesAt(source, totalDistanceKm, settings.referenceSpeedKph)
  const departureMinutes = parseClockToMinutes(settings.departureTime)
  const pauseAnchors: readonly PauseAnchor[] = placedPauses.map((pause) => ({ id: pause.id, name: pause.name, distanceKm: pause.distanceKm, durationMinutes: pause.durationMinutes }))

  const timelinePoints = buildTimeline(
    withPauses.map((waypoint) => ({ distanceKm: waypoint.trackDistanceKm, elevationM: waypoint.elevationM, movingElapsedMinutes: movingElapsedAt(waypoint.trackDistanceKm) })),
    pauseAnchors,
    departureMinutes,
  )

  return withPauses.map((waypoint, index) => {
    const timelinePoint = timelinePoints[index]
    if (timelinePoint === undefined) return waypoint
    return { ...waypoint, elapsedMinutes: timelinePoint.elapsedMinutes, clockTime: formatRouteClockTime(timelinePoint.clockTime) }
  })
}
