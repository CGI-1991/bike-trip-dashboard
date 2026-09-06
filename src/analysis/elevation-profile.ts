/**
 * Phase 6B — noise-reduced altitude series, kept strictly separate from the
 * raw GPX altitude (CDC section 12.4: "créer une altitude lissée... distinct
 * de la donnée brute"). Nothing here ever mutates or overwrites the source
 * points; every function returns a brand-new array.
 *
 * Distance is derived with the same historical haversine algorithm already
 * reused by `src/import/gpx/analyze-gpx.ts` — no second distance formula.
 */

import { calculateHaversineDistanceKm } from '../gpx/parser.ts'
import type { GpxTrackPoint } from '../gpx/types.ts'

/** One point of the distance-indexed series — altitude still exactly as read from the GPX (or `null`), only distance is derived. */
export interface DistanceIndexedPoint {
  readonly distanceKm: number
  readonly latitude: number
  readonly longitude: number
  readonly elevationM: number | null
}

/** Below this share of points carrying a real altitude, grade-derived analysis (climbs, terrain timing) is not attempted (CDC section 12.2's "points sans altitude" quality signal). */
export const MINIMUM_ALTITUDE_COVERAGE_RATIO = 0.5

export interface AltitudeQuality {
  readonly totalPoints: number
  readonly pointsWithAltitude: number
  readonly coverageRatio: number
  readonly isSufficient: boolean
}

/** Attaches cumulative distance to a point sequence — never touches `elevationM`. */
export function buildDistanceIndexedSeries(points: readonly GpxTrackPoint[]): readonly DistanceIndexedPoint[] {
  const series: DistanceIndexedPoint[] = []
  let cumulativeDistanceKm = 0
  let previousPoint: GpxTrackPoint | null = null

  for (const point of points) {
    if (previousPoint !== null) {
      cumulativeDistanceKm += calculateHaversineDistanceKm(previousPoint, point)
    }
    series.push({ distanceKm: cumulativeDistanceKm, latitude: point.latitude, longitude: point.longitude, elevationM: point.elevationM })
    previousPoint = point
  }

  return series
}

export function assessAltitudeQuality(series: readonly DistanceIndexedPoint[]): AltitudeQuality {
  const totalPoints = series.length
  const pointsWithAltitude = series.filter((point) => point.elevationM !== null).length
  const coverageRatio = totalPoints === 0 ? 0 : pointsWithAltitude / totalPoints

  return {
    totalPoints,
    pointsWithAltitude,
    coverageRatio,
    isSufficient: pointsWithAltitude >= 2 && coverageRatio >= MINIMUM_ALTITUDE_COVERAGE_RATIO,
  }
}

/**
 * Moving average over a fixed distance window, centered on each point.
 * Deterministic and stable against single-point GPS/barometric noise (CDC
 * section 12.2's "bruit", 12.4's "lissage"): a lone spike a few meters off
 * gets diluted by its neighbors rather than propagating into the slope
 * computed downstream. A point with no altitude data anywhere in its window
 * stays `null` here — this function never invents an altitude.
 *
 * `distanceKm` is monotonically non-decreasing, so two moving boundaries are
 * enough to maintain the active window. This preserves the exact centred
 * window semantics while avoiding an O(n²) full-series scan for every GPX
 * point — important now that the same smoothing is used for both D+/D- and
 * terrain analysis, especially on dense mobile imports.
 */
export function smoothElevation(
  series: readonly DistanceIndexedPoint[],
  windowMeters = 150,
): readonly DistanceIndexedPoint[] {
  const halfWindowKm = windowMeters / 1000 / 2
  const smoothed: DistanceIndexedPoint[] = []
  let leftIndex = 0
  let rightIndex = 0
  let elevationSum = 0
  let elevationCount = 0

  for (const point of series) {
    const minimumDistanceKm = point.distanceKm - halfWindowKm
    const maximumDistanceKm = point.distanceKm + halfWindowKm

    while (rightIndex < series.length && (series[rightIndex]?.distanceKm ?? Infinity) <= maximumDistanceKm) {
      const elevationM = series[rightIndex]?.elevationM ?? null
      if (elevationM !== null) {
        elevationSum += elevationM
        elevationCount++
      }
      rightIndex++
    }

    while (leftIndex < rightIndex && (series[leftIndex]?.distanceKm ?? Infinity) < minimumDistanceKm) {
      const elevationM = series[leftIndex]?.elevationM ?? null
      if (elevationM !== null) {
        elevationSum -= elevationM
        elevationCount--
      }
      leftIndex++
    }

    smoothed.push({
      distanceKm: point.distanceKm,
      latitude: point.latitude,
      longitude: point.longitude,
      elevationM: elevationCount === 0 ? null : elevationSum / elevationCount,
    })
  }

  return smoothed
}
