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
import type { Climb, PausePlanMode, RideStage, RideStageSettings, Route, RoutePoint } from '../trip-core/index.ts'
import { routeGeometryWithDistances } from './canonical-waypoints.ts'
import type { CanonicalWaypoint } from './canonical-waypoints.ts'
import { buildCanonicalWaypoints } from './canonical-waypoints.ts'
import { applyPausesToWaypoints, placeAutomaticPauses } from './pause-placement.ts'
import type { PlacedPause } from './pause-placement.ts'
import type { PauseAnchor } from './pauses.ts'
import { buildTimeline, parseClockToMinutes } from './timing.ts'

export interface WaypointTimelineSettings {
  readonly referenceSpeedKph: number
  /** "HH:MM", the day's actual departure time (`TripDaySettings.departureTime`). */
  readonly departureTime: string
}

/** One resolved manual pause, already reduced to what placement needs: a real, existing canonical waypoint (`routePointId`) and a duration. */
export interface ManualPauseSetting {
  readonly id: string
  readonly routePointId: string
  readonly durationMinutes: number
  readonly order: number
}

export interface StagePauseResolution {
  readonly mode: PausePlanMode
  /** Only meaningful when `mode === 'custom'` — always `[]` for `'automatic'`. */
  readonly manualPauses: readonly ManualPauseSetting[]
}

/**
 * Resolves one stage's effective pause plan (CDC Jalon B4 section 15): a
 * per-stage override (`RideStageSettings.pausePlanMode`) wins over the
 * trip-wide default (`GlobalTripSettings.pausePlanMode`); `null` on either
 * means "inherit". Only `active` pauses with a real `routePointId` become
 * `ManualPauseSetting`s — an inactive or dangling (deleted point) entry is
 * simply dropped rather than crashing placement.
 */
export function resolveStagePauseSettings(globalMode: PausePlanMode, stageSettings: RideStageSettings | undefined): StagePauseResolution {
  const mode = stageSettings?.pausePlanMode ?? globalMode
  if (mode !== 'custom') return { mode: 'automatic', manualPauses: [] }
  const manualPauses = (stageSettings?.pauses ?? [])
    .filter((pause) => pause.active && pause.routePointId !== null)
    .slice()
    .sort((left, right) => left.order - right.order)
    .map((pause) => ({ id: pause.id, routePointId: pause.routePointId as string, durationMinutes: Math.round(pause.durationSeconds / 60), order: pause.order }))
  return { mode: 'custom', manualPauses }
}

export interface ComputeStageWaypointsInput {
  readonly stage: RideStage
  readonly route: Route
  readonly routePoints: readonly RoutePoint[]
  readonly climbs: readonly Climb[]
  readonly settings: WaypointTimelineSettings
  /**
   * When provided, pauses are placed exactly on these existing canonical
   * waypoints instead of the automatic budget/anchor search (CDC Jalon B4
   * section 15: manual pause editing never invents a new engine — it only
   * feeds fixed anchors into the same `applyPausesToWaypoints`/timeline
   * pipeline the automatic mode already uses). Omit for automatic mode.
   */
  readonly manualPauses?: readonly ManualPauseSetting[]
  /** `GlobalTripSettings.mountainMode` (Jalon B4.2 section 15) — forwarded as-is to `buildCanonicalWaypoints`; `false` when omitted. */
  readonly mountainMode?: boolean
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
  const { stage, route, routePoints, climbs, settings, mountainMode } = input
  const baseWaypoints = buildCanonicalWaypoints({ stage, route, routePoints, climbs, mountainMode })
  if (baseWaypoints.length === 0) return []

  const geometryWithDistances = routeGeometryWithDistances(route)
  if (geometryWithDistances === null) return baseWaypoints
  const { geometry, distances } = geometryWithDistances
  const totalDistanceKm = distances.at(-1) ?? 0
  const totalBreakMinutes = (stage.pauseDurationSeconds ?? 0) / 60

  const placedPauses: readonly PlacedPause[] = input.manualPauses === undefined
    ? placeAutomaticPauses(totalBreakMinutes, totalDistanceKm, baseWaypoints)
    : input.manualPauses
        .map((pause): PlacedPause | null => {
          const anchor = baseWaypoints.find((waypoint) => waypoint.id === pause.routePointId)
          if (anchor === undefined) return null
          return { id: pause.id, name: anchor.name, distanceKm: anchor.trackDistanceKm, durationMinutes: pause.durationMinutes, waypointId: anchor.id }
        })
        .filter((pause): pause is PlacedPause => pause !== null)
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
