/**
 * Locally generated climb profile data (CDC section 14) — the model needed
 * for a *future* SVG rendering, not the rendering itself (section 14.4/14.5
 * are explicitly out of scope here).
 *
 * Deliberately not persisted: `Climb` (`src/trip-core/model/climb.ts`) has
 * no `profile` field, and section 12 of this phase asks to verify — not
 * silently work around — the hypothesis that no schema change is needed.
 * A climb profile is cheap, deterministic and fully recomputable from
 * already-persisted data (`Route.geometry.full` + the `Climb`'s own
 * distance bounds), so it is built on demand by whatever later reads a
 * `TripBundle`, exactly like `src/analysis/timing.ts`'s per-point timeline.
 * Distance is recomputed with the same historical haversine algorithm
 * already reused elsewhere in this phase — no second formula.
 */

import { calculateHaversineDistanceKm } from '../gpx/parser.ts'
import type { Climb, ClimbId, RouteGeometryPoint } from '../trip-core/index.ts'

/** CDC section 14.3. */
export const DEFAULT_CLIMB_SEGMENT_LENGTH_METERS = 500

export type ClimbGradeClass = 'climb-0-1' | 'climb-1-4' | 'climb-4-8' | 'climb-8-12' | 'climb-12-plus' | 'descent-0-7' | 'descent-7-plus'

export interface ClimbProfileSegment {
  readonly index: number
  readonly startDistanceKm: number
  readonly endDistanceKm: number
  readonly startAltitudeM: number | null
  readonly endAltitudeM: number | null
  readonly averageGradientPercent: number | null
  readonly gradeClass: ClimbGradeClass | null
}

export interface ClimbProfile {
  readonly climbId: ClimbId
  readonly segmentLengthMeters: number
  readonly segments: readonly ClimbProfileSegment[]
}

/** CDC section 14.3's fixed classes — climb bands 0–1/1–4/4–8/8–12/≥12 %, descent bands 0 to -7/beyond -7 %. */
export function classifyClimbGrade(gradePercent: number): ClimbGradeClass {
  if (gradePercent < 0) return gradePercent >= -7 ? 'descent-0-7' : 'descent-7-plus'
  if (gradePercent < 1) return 'climb-0-1'
  if (gradePercent < 4) return 'climb-1-4'
  if (gradePercent < 8) return 'climb-4-8'
  if (gradePercent < 12) return 'climb-8-12'
  return 'climb-12-plus'
}

interface DistancedGeometryPoint {
  readonly distanceKm: number
  readonly altitudeM: number | null
}

function withCumulativeDistance(points: readonly RouteGeometryPoint[]): readonly DistancedGeometryPoint[] {
  const result: DistancedGeometryPoint[] = []
  let cumulativeDistanceKm = 0
  let previous: RouteGeometryPoint | null = null

  for (const point of points) {
    if (previous !== null) {
      cumulativeDistanceKm += calculateHaversineDistanceKm(
        { latitude: previous.latitude, longitude: previous.longitude, elevationM: null },
        { latitude: point.latitude, longitude: point.longitude, elevationM: null },
      )
    }
    result.push({ distanceKm: cumulativeDistanceKm, altitudeM: point.altitudeM })
    previous = point
  }

  return result
}

function interpolateAltitudeAt(points: readonly DistancedGeometryPoint[], targetKm: number): number | null {
  let afterIndex = points.findIndex((point) => point.distanceKm >= targetKm)
  if (afterIndex === -1) afterIndex = points.length - 1
  const beforeIndex = Math.max(0, afterIndex - 1)
  const after = points[afterIndex]
  const before = points[beforeIndex]
  if (before === undefined || after === undefined) return null

  const spanKm = after.distanceKm - before.distanceKm
  const beforeAltitude = before.altitudeM
  const afterAltitude = after.altitudeM
  if (beforeAltitude === null && afterAltitude === null) return null
  if (beforeAltitude === null) return afterAltitude
  if (afterAltitude === null) return beforeAltitude
  if (spanKm <= 1e-9) return afterAltitude

  const ratio = Math.min(1, Math.max(0, (targetKm - before.distanceKm) / spanKm))
  return beforeAltitude + (afterAltitude - beforeAltitude) * ratio
}

/**
 * Builds fixed-length segments (500 m by default) covering exactly
 * `[climb.startDistanceKm, climb.endDistanceKm]`. The last segment is
 * shorter whenever the climb's length is not an exact multiple of the
 * segment length — never padded or rounded away. Never mutates
 * `routeGeometryFull`.
 */
export function buildClimbProfile(
  routeGeometryFull: readonly RouteGeometryPoint[],
  climb: Climb,
  segmentLengthMeters = DEFAULT_CLIMB_SEGMENT_LENGTH_METERS,
): ClimbProfile {
  if (routeGeometryFull.length < 2 || climb.endDistanceKm <= climb.startDistanceKm) {
    return { climbId: climb.id, segmentLengthMeters, segments: [] }
  }

  const distancedPoints = withCumulativeDistance(routeGeometryFull)
  const segmentLengthKm = segmentLengthMeters / 1000
  const segments: ClimbProfileSegment[] = []
  let index = 0

  for (let startKm = climb.startDistanceKm; startKm < climb.endDistanceKm - 1e-9; startKm += segmentLengthKm) {
    const endKm = Math.min(climb.endDistanceKm, startKm + segmentLengthKm)
    const startAltitudeM = interpolateAltitudeAt(distancedPoints, startKm)
    const endAltitudeM = interpolateAltitudeAt(distancedPoints, endKm)
    const lengthKm = endKm - startKm
    const averageGradientPercent =
      startAltitudeM === null || endAltitudeM === null || lengthKm <= 1e-9 ? null : ((endAltitudeM - startAltitudeM) / (lengthKm * 1000)) * 100

    segments.push({
      index,
      startDistanceKm: startKm,
      endDistanceKm: endKm,
      startAltitudeM,
      endAltitudeM,
      averageGradientPercent,
      gradeClass: averageGradientPercent === null ? null : classifyClimbGrade(averageGradientPercent),
    })
    index++
  }

  return { climbId: climb.id, segmentLengthMeters, segments }
}
