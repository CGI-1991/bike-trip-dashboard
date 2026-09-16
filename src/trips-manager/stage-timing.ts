/**
 * Re-timing one already-imported stage, in place, without touching its GPX.
 *
 * Extracted from `trip-preferences.ts` (where it was private) because two
 * settings now need exactly the same operation: changing the reference
 * speed, and switching the trip in or out of Course/Tour mode (which sets
 * the pause budget to zero and back). Keeping one implementation is what
 * guarantees they cannot drift into two timing models — everything here
 * still runs through `computeStageTiming`/`estimateAutomaticBreakBudget`,
 * the exact engine `import/gpx/route-analysis.ts` uses at import time.
 *
 * Pure: bundle + stage in, a new `RideStage` out. No storage, no clock.
 */

import { computeStageTiming } from '../analysis/timing.ts'
import { estimateAutomaticBreakBudget } from '../analysis/pause-budget.ts'
import { routeGeometryWithDistances } from '../analysis/canonical-waypoints.ts'
import { buildTerrainProfileSeries } from '../route/terrain-profile.ts'
import type { RouteProfilePosition, TerrainProfilePoint } from '../route/types.ts'
import type { RideStage, Route, TripBundle } from '../trip-core/index.ts'

/**
 * How much pause time to fold into the recomputed durations:
 * - a number — that many minutes, exactly (`0` is Course/Tour mode);
 * - `'adaptive'` — `estimateAutomaticBreakBudget`'s own per-stage estimate,
 *   re-derived at the new pace (the budget itself depends on moving time);
 * - `'preserve'` — keep the stage's existing `pauseDurationSeconds`
 *   untouched (a custom plan is the traveller's own total, never rewritten).
 */
export type StageBreakBudget = number | 'adaptive' | 'preserve'

/** `null` when the route has no usable geometry OR too few points to build a real profile — `computeStageTiming` itself already falls back to the flat-terrain model in that case, exactly like at import time. */
export function buildTerrainProfileForRoute(route: Route): readonly TerrainProfilePoint[] | null {
  const geometryWithDistances = routeGeometryWithDistances(route)
  if (geometryWithDistances === null) return null
  const { geometry, distances } = geometryWithDistances
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
  const series = buildTerrainProfileSeries(source)
  return series.length < 2 ? null : series
}

/**
 * Recomputes exactly the four aggregate `RideStage` timing fields
 * (`movingDurationSeconds`/`pauseDurationSeconds`/`totalDurationSeconds`/
 * `estimatedAverageSpeedKph`). Returns the stage untouched when it has no
 * usable route or distance to time against.
 */
export function recomputeStageTiming(bundle: TripBundle, stage: RideStage, referenceSpeedKph: number, budget: StageBreakBudget): RideStage {
  const route = bundle.routes.find((candidate) => candidate.id === stage.sourceRouteId)
  const distanceKm = stage.distanceKm
  if (route === undefined || distanceKm === null || !(distanceKm > 0)) return stage

  const terrainProfile = buildTerrainProfileForRoute(route)
  const departureTime = bundle.settings.days.find((candidate) => candidate.dayId === stage.dayId)?.departureTime ?? '08:00'
  const base = { referenceSpeedKph, departureTime }

  if (budget === 'preserve') {
    const totalBreakMinutes = (stage.pauseDurationSeconds ?? 0) / 60
    const timing = computeStageTiming(terrainProfile, distanceKm, { ...base, totalBreakMinutes })
    return {
      ...stage,
      movingDurationSeconds: timing.movingDurationSeconds,
      totalDurationSeconds: timing.movingDurationSeconds + (stage.pauseDurationSeconds ?? 0),
      estimatedAverageSpeedKph: timing.estimatedAverageSpeedKph,
    }
  }

  const totalBreakMinutes = budget === 'adaptive'
    ? estimateAutomaticBreakBudget(
        distanceKm,
        computeStageTiming(terrainProfile, distanceKm, { ...base, totalBreakMinutes: 0 }).movingDurationSeconds / 60,
        stage.elevationGainM,
      )
    : budget
  const timing = computeStageTiming(terrainProfile, distanceKm, { ...base, totalBreakMinutes })
  return {
    ...stage,
    movingDurationSeconds: timing.movingDurationSeconds,
    pauseDurationSeconds: timing.pauseDurationSeconds,
    totalDurationSeconds: timing.totalDurationSeconds,
    estimatedAverageSpeedKph: timing.estimatedAverageSpeedKph,
  }
}
