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
import type { Climb, PausePlanMode, RideStage, RideStageSettings, Route, RouteGeometryPoint, RoutePoint } from '../trip-core/index.ts'
import { pointAtDistance, routeGeometryWithDistances } from './canonical-waypoints.ts'
import type { CanonicalWaypoint } from './canonical-waypoints.ts'
import { buildCanonicalWaypoints } from './canonical-waypoints.ts'
import { applyPausesToWaypoints, placeAutomaticPauses } from './pause-placement.ts'
import type { PlacedPause } from './pause-placement.ts'
import type { PauseAnchor } from './pauses.ts'
import { recommendAutomaticPauses } from './pause-recommendation.ts'
import type { PauseCandidatePlace, PauseRecommendation, PauseWeatherContext } from './pause-recommendation.ts'
import { buildTimeline, parseClockToMinutes } from './timing.ts'
import type { TimelinePoint } from './timing.ts'

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
  /**
   * C3 (CDC C3 section 26): when supplied, AUTOMATIC-mode placement uses
   * `pause-recommendation.ts`'s explainable scoring (terrain + timing +
   * POI/opening-hours + weather) instead of `pause-placement.ts`'s plain
   * kind-priority search. Omitted — every caller that hasn't opted in —
   * keeps the original `placeAutomaticPauses` behaviour byte-for-byte (CDC
   * section 27: "comportement au moins aussi bon qu'avant C3", never a
   * silent behaviour change for a caller that never asked for it).
   * Ignored entirely in custom/manual mode (`manualPauses` set) — C3 never
   * touches a saved manual pause (CDC section 3/32).
   */
  readonly automaticPauseEnrichment?: AutomaticPauseEnrichmentInput
}

/** CDC C3 section 4/8/20 — the extra, entirely optional signals `recommendAutomaticPauses` can use beyond terrain/timing. */
export interface AutomaticPauseEnrichmentInput {
  readonly practicalPlaces?: readonly PauseCandidatePlace[]
  readonly weather?: PauseWeatherContext | null
  /** 0 (Sunday) – 6 (Saturday), the day's own weekday at departure — only needed for opening-hours scoring; omit to skip that one signal, everything else still runs. */
  readonly weekdayAtDeparture?: number
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
 * The one place `placeAutomaticPauses` vs `recommendAutomaticPauses` is
 * decided (CDC C3 section 26-27) — shared by `computeStageWaypoints` and
 * `computeStageTimingCurve` so both always agree on exactly the same
 * automatic placement, never two divergent pause sets for the same stage.
 * `movingElapsedAt`/`departureMinutes` being `undefined` (no valid
 * reference speed/geometry) simply skips the engine's own opening-hours
 * signal — everything else (terrain, spacing, edge buffer) still applies.
 */
function resolveAutomaticPlacedPauses(
  totalBreakMinutes: number,
  totalDistanceKm: number,
  baseWaypoints: readonly CanonicalWaypoint[],
  climbs: readonly Climb[],
  geometry: readonly RouteGeometryPoint[],
  distances: readonly number[],
  enrichment: AutomaticPauseEnrichmentInput | undefined,
  movingElapsedAt: ((distanceKm: number) => number) | undefined,
  departureMinutes: number | undefined,
): readonly PlacedPause[] {
  if (enrichment === undefined) return placeAutomaticPauses(totalBreakMinutes, totalDistanceKm, baseWaypoints)
  const recommendations = recommendAutomaticPauses(
    {
      totalBreakMinutes,
      totalDistanceKm,
      waypoints: baseWaypoints,
      climbs,
      places: enrichment.practicalPlaces,
      weather: enrichment.weather,
      movingElapsedMinutesAt: movingElapsedAt,
      departureMinutes,
      weekdayAtDeparture: enrichment.weekdayAtDeparture,
    },
    (distanceKm) => pointAtDistance(geometry, distances, distanceKm).altitudeM,
  )
  return recommendations.map((recommendation) => ({
    id: recommendation.slotId, name: recommendation.name, distanceKm: recommendation.distanceKm,
    durationMinutes: recommendation.durationMinutes, waypointId: recommendation.waypointId,
  }))
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

  // CDC C3 section 28: this "base timing" (moving time only, no pause yet
  // placed) is computed BEFORE pause selection precisely so scoring can use
  // an approximate ETA without depending on its own not-yet-decided output.
  const hasValidTiming = settings.referenceSpeedKph > 0 && totalDistanceKm > 0
  const source: RouteProfilePosition[] = !hasValidTiming ? [] : geometry.map((point, index) => ({
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
  const movingElapsedAt = hasValidTiming ? movingElapsedMinutesAt(source, totalDistanceKm, settings.referenceSpeedKph) : undefined
  const departureMinutes = hasValidTiming ? parseClockToMinutes(settings.departureTime) : undefined

  const placedPauses: readonly PlacedPause[] = input.manualPauses !== undefined
    ? input.manualPauses
        .map((pause): PlacedPause | null => {
          const anchor = baseWaypoints.find((waypoint) => waypoint.id === pause.routePointId)
          if (anchor === undefined) return null
          return { id: pause.id, name: anchor.name, distanceKm: anchor.trackDistanceKm, durationMinutes: pause.durationMinutes, waypointId: anchor.id }
        })
        .filter((pause): pause is PlacedPause => pause !== null)
    : resolveAutomaticPlacedPauses(totalBreakMinutes, totalDistanceKm, baseWaypoints, climbs, geometry, distances, input.automaticPauseEnrichment, movingElapsedAt, departureMinutes)
  const withPauses = applyPausesToWaypoints(baseWaypoints, placedPauses, route)

  if (!hasValidTiming || movingElapsedAt === undefined || departureMinutes === undefined) return withPauses

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

/**
 * CDC C3 section 29-30: the explainable side of the exact same placement
 * `computeStageWaypoints` performs (never a second, divergent selection) —
 * `[]` for manual mode or when the caller never opted into
 * `automaticPauseEnrichment` (nothing to explain: the plain
 * `placeAutomaticPauses` fallback is running instead). Re-derives its own
 * cheap setup like `computeStageTimingCurve` does, for the same reason.
 */
export function computeStagePauseRecommendations(input: ComputeStageWaypointsInput): readonly PauseRecommendation[] {
  if (input.manualPauses !== undefined || input.automaticPauseEnrichment === undefined) return []
  const { stage, route, routePoints, climbs, settings, mountainMode } = input
  const baseWaypoints = buildCanonicalWaypoints({ stage, route, routePoints, climbs, mountainMode })
  if (baseWaypoints.length === 0) return []

  const geometryWithDistances = routeGeometryWithDistances(route)
  if (geometryWithDistances === null) return []
  const { geometry, distances } = geometryWithDistances
  const totalDistanceKm = distances.at(-1) ?? 0
  const totalBreakMinutes = (stage.pauseDurationSeconds ?? 0) / 60

  const hasValidTiming = settings.referenceSpeedKph > 0 && totalDistanceKm > 0
  const source: RouteProfilePosition[] = !hasValidTiming ? [] : geometry.map((point, index) => ({
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
  const movingElapsedAt = hasValidTiming ? movingElapsedMinutesAt(source, totalDistanceKm, settings.referenceSpeedKph) : undefined
  const departureMinutes = hasValidTiming ? parseClockToMinutes(settings.departureTime) : undefined
  const enrichment = input.automaticPauseEnrichment

  return recommendAutomaticPauses(
    {
      totalBreakMinutes, totalDistanceKm, waypoints: baseWaypoints, climbs,
      places: enrichment.practicalPlaces, weather: enrichment.weather,
      movingElapsedMinutesAt: movingElapsedAt, departureMinutes, weekdayAtDeparture: enrichment.weekdayAtDeparture,
    },
    (distanceKm) => pointAtDistance(geometry, distances, distanceKm).altitudeM,
  )
}

export interface StageTimingCurve {
  /** Elapsed minutes since departure at an arbitrary distance along the stage — moving time plus any pause already completed before it, the exact composition every waypoint's own `elapsedMinutes` uses. */
  elapsedMinutesAt(distanceKm: number): number
  clockTimeAt(distanceKm: number): string
}

/**
 * The stage's own continuous distance→time mapping (CDC D1.1 section 17) —
 * for the elevation profile's interactive cursor, never a naive `distance /
 * average speed`. Reuses the exact same grade-aware pacing
 * (`movingElapsedMinutesAt`/`createTerrainTiming`) and pause composition
 * (`timing.ts::buildTimeline`) `computeStageWaypoints` itself uses, evaluated
 * at one arbitrary point at a time instead of only at waypoint breakpoints —
 * so the curve agrees with every waypoint's own `clockTime` and the stage's
 * final arrival by construction (`clockTimeAt(waypoint.trackDistanceKm) ===
 * waypoint.clockTime` for every waypoint `computeStageWaypoints` timed).
 *
 * Deliberately re-derives its own setup (canonical waypoints, placed pauses,
 * the pacing function) rather than being threaded through
 * `computeStageWaypoints` itself — that function's early-return shape (untimed
 * waypoints when there is no geometry, or no valid reference speed/distance)
 * doesn't have a single matching "give me the curve instead" branch to hook
 * into safely; recomputing the same cheap setup here keeps that already-
 * tested function completely untouched. `null` under the same degenerate
 * conditions `computeStageWaypoints` itself treats as "untimed".
 */
export function computeStageTimingCurve(input: ComputeStageWaypointsInput): StageTimingCurve | null {
  const { stage, route, routePoints, climbs, settings, mountainMode } = input
  const baseWaypoints = buildCanonicalWaypoints({ stage, route, routePoints, climbs, mountainMode })
  if (baseWaypoints.length === 0) return null

  const geometryWithDistances = routeGeometryWithDistances(route)
  if (geometryWithDistances === null) return null
  const { geometry, distances } = geometryWithDistances
  const totalDistanceKm = distances.at(-1) ?? 0
  if (!(settings.referenceSpeedKph > 0) || !(totalDistanceKm > 0)) return null

  const totalBreakMinutes = (stage.pauseDurationSeconds ?? 0) / 60

  // CDC C3 section 28: same "base timing before pause selection" ordering
  // as `computeStageWaypoints` — never derived from the pauses-included
  // timeline this function itself is about to produce.
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

  const placedPauses: readonly PlacedPause[] = input.manualPauses !== undefined
    ? input.manualPauses
        .map((pause): PlacedPause | null => {
          const anchor = baseWaypoints.find((waypoint) => waypoint.id === pause.routePointId)
          if (anchor === undefined) return null
          return { id: pause.id, name: anchor.name, distanceKm: anchor.trackDistanceKm, durationMinutes: pause.durationMinutes, waypointId: anchor.id }
        })
        .filter((pause): pause is PlacedPause => pause !== null)
    : resolveAutomaticPlacedPauses(totalBreakMinutes, totalDistanceKm, baseWaypoints, climbs, geometry, distances, input.automaticPauseEnrichment, movingElapsedAt, departureMinutes)
  const pauseAnchors: readonly PauseAnchor[] = placedPauses.map((pause) => ({ id: pause.id, name: pause.name, distanceKm: pause.distanceKm, durationMinutes: pause.durationMinutes }))

  const clamp = (distanceKm: number) => Math.min(totalDistanceKm, Math.max(0, distanceKm))
  const pointAt = (distanceKm: number): TimelinePoint => {
    const clamped = clamp(distanceKm)
    const [point] = buildTimeline([{ distanceKm: clamped, elevationM: null, movingElapsedMinutes: movingElapsedAt(clamped) }], pauseAnchors, departureMinutes)
    return point as TimelinePoint
  }

  return {
    elapsedMinutesAt: (distanceKm) => pointAt(distanceKm).elapsedMinutes,
    clockTimeAt: (distanceKm) => formatRouteClockTime(pointAt(distanceKm).clockTime),
  }
}
