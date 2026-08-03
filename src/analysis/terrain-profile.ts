/**
 * Turns the smoothed altitude series (`elevation-profile.ts`) into a
 * resampled, grade-bearing series shaped exactly like the historical
 * engine's `TerrainProfilePoint` (`src/route/types.ts`) — so `timing.ts` can
 * hand it straight to the historical `createTerrainTiming`/
 * `interpolateTerrainTiming` (`src/route/terrain-profile.ts`) instead of
 * reimplementing the speed-from-grade model. Only produced when
 * `assessAltitudeQuality` (`elevation-profile.ts`) found the file's altitude
 * sufficient — climb detection and grade-aware timing simply do not run
 * otherwise (CDC section 12: "si l'altitude est insuffisante... aucune
 * montée détectée").
 */

import { routeEngineConfig } from '../route/config.ts'
import type { TerrainProfilePoint } from '../route/types.ts'
import type { DistanceIndexedPoint } from './elevation-profile.ts'

const EPSILON = 1e-9

/** Same resampling step as `Route.profile` (CDC section 11.4 / 14.3's 500 m climb bucket is a coarser multiple of this). */
export const DEFAULT_TERRAIN_RESAMPLE_INTERVAL_METERS = 50

/** Window used for the centered-difference grade estimate — wider than the resample step so a single noisy sample cannot dominate it. */
export const DEFAULT_GRADE_WINDOW_METERS = 200

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

/**
 * Interpolates position + elevation at an arbitrary distance. Never returns
 * a `null` elevation: when one side of the interpolation has no altitude
 * (a small gap inside an overall-sufficient file), it falls back to the
 * other side's value — the same convention as the historical
 * `buildTerrainProfileSeries`'s `interpolateSource`.
 */
function interpolateAt(
  series: readonly DistanceIndexedPoint[],
  targetKm: number,
): { readonly distanceKm: number; readonly elevationM: number; readonly latitude: number; readonly longitude: number } {
  let afterIndex = series.findIndex((point) => point.distanceKm >= targetKm)
  if (afterIndex === -1) afterIndex = series.length - 1
  const beforeIndex = Math.max(0, afterIndex - 1)
  const after = series[afterIndex]
  const before = series[beforeIndex]

  if (before === undefined || after === undefined) {
    throw new Error('Série de distance vide : impossible d’interpoler un point de terrain.')
  }

  const spanKm = after.distanceKm - before.distanceKm
  const ratio = spanKm <= EPSILON ? 0 : clamp((targetKm - before.distanceKm) / spanKm, 0, 1)
  const beforeElevation = before.elevationM ?? after.elevationM ?? 0
  const afterElevation = after.elevationM ?? before.elevationM ?? 0

  return {
    distanceKm: targetKm,
    elevationM: beforeElevation + (afterElevation - beforeElevation) * ratio,
    latitude: before.latitude + (after.latitude - before.latitude) * ratio,
    longitude: before.longitude + (after.longitude - before.longitude) * ratio,
  }
}

/** First index whose `distanceKm` is `>= target` (clamped to the last index when none qualifies). */
function firstIndexAtOrAfter(resampled: readonly { readonly distanceKm: number }[], target: number): number {
  const index = resampled.findIndex((candidate) => candidate.distanceKm >= target)
  return index === -1 ? resampled.length - 1 : index
}

/** Last index whose `distanceKm` is `<= target` (clamped to the first index when none qualifies). */
function lastIndexAtOrBefore(resampled: readonly { readonly distanceKm: number }[], target: number): number {
  for (let index = resampled.length - 1; index >= 0; index--) {
    if ((resampled[index]?.distanceKm ?? Number.POSITIVE_INFINITY) <= target) return index
  }
  return 0
}

function computeGradePercent(
  resampled: readonly { readonly distanceKm: number; readonly elevationM: number }[],
  index: number,
  gradeWindowKm: number,
): number {
  const point = resampled[index]
  if (point === undefined) return 0

  const totalDistanceKm = resampled[resampled.length - 1]?.distanceKm ?? 0
  const leftTargetKm = Math.max(0, point.distanceKm - gradeWindowKm / 2)
  const rightTargetKm = Math.min(totalDistanceKm, point.distanceKm + gradeWindowKm / 2)

  const left = resampled[firstIndexAtOrAfter(resampled, leftTargetKm)]
  const right = resampled[lastIndexAtOrBefore(resampled, rightTargetKm)]
  if (left === undefined || right === undefined) return 0

  const distanceDeltaKm = right.distanceKm - left.distanceKm
  if (distanceDeltaKm < Math.min(0.02, gradeWindowKm / 4)) return 0

  const gradePercent = ((right.elevationM - left.elevationM) / (distanceDeltaKm * 1000)) * 100
  return Number.isFinite(gradePercent) ? clamp(gradePercent, -routeEngineConfig.slopeClampPercent, routeEngineConfig.slopeClampPercent) : 0
}

/**
 * Builds the resampled, grade-bearing terrain series. Returns `null` when
 * fewer than 2 points are available, or when the requested distance is not
 * strictly positive — callers are expected to have already checked altitude
 * sufficiency before calling this.
 */
export function buildTerrainSlopeProfile(
  smoothedSeries: readonly DistanceIndexedPoint[],
  intervalMeters = DEFAULT_TERRAIN_RESAMPLE_INTERVAL_METERS,
  gradeWindowMeters = DEFAULT_GRADE_WINDOW_METERS,
): readonly TerrainProfilePoint[] | null {
  if (smoothedSeries.length < 2) return null

  const totalDistanceKm = smoothedSeries[smoothedSeries.length - 1]?.distanceKm ?? 0
  if (totalDistanceKm <= EPSILON) return null

  const intervalKm = intervalMeters / 1000
  const resampled: { distanceKm: number; elevationM: number; latitude: number; longitude: number }[] = []

  for (let targetKm = 0; targetKm < totalDistanceKm; targetKm += intervalKm) {
    resampled.push(interpolateAt(smoothedSeries, targetKm))
  }
  const last = resampled[resampled.length - 1]
  if (last === undefined || last.distanceKm < totalDistanceKm) {
    resampled.push(interpolateAt(smoothedSeries, totalDistanceKm))
  }

  const gradeWindowKm = gradeWindowMeters / 1000

  return resampled.map((point, index) => ({
    distanceKm: point.distanceKm,
    elevationM: point.elevationM,
    smoothedGradePercent: computeGradePercent(resampled, index, gradeWindowKm),
    latitude: point.latitude,
    longitude: point.longitude,
  }))
}
