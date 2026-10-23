/** Terrain timing for a chosen travel mode. The historical cycling engine
 * stays untouched; walking uses a flat-normalized Tobler slope factor.
 * These estimates describe regular terrain, not technical trail difficulty. */

import { createTerrainTiming } from '../route/terrain-profile.ts'
import type { TerrainTiming } from '../route/terrain-profile.ts'
import type { TerrainProfilePoint, TerrainTimingPoint } from '../route/types.ts'
import type { RouteGeometryPoint, TravelMode } from '../trip-core/index.ts'
import { assessAltitudeQuality, buildDistanceIndexedSeries, smoothElevation } from './elevation-profile.ts'
import { buildTerrainSlopeProfile } from './terrain-profile.ts'

export const MIN_WALKING_LOCAL_SPEED_KPH = 0.5
export const MAX_WALKING_LOCAL_SPEED_KPH = 8
export const MAX_WALKING_GRADE_PERCENT = 60

/** Normalized at 0%, so the reference remains an actual flat-ground speed.
 * A mild downhill helps; a steep descent slows walking down again. */
export function walkingSpeedFactor(gradePercent: number): number {
  const maximumSlope = MAX_WALKING_GRADE_PERCENT / 100
  const slope = Number.isFinite(gradePercent) ? Math.max(-maximumSlope, Math.min(maximumSlope, gradePercent / 100)) : 0
  return Math.exp(-3.5 * (Math.abs(slope + 0.05) - 0.05))
}

function walkingSpeed(referenceSpeedKph: number, gradePercent: number): number {
  return Math.max(MIN_WALKING_LOCAL_SPEED_KPH, Math.min(MAX_WALKING_LOCAL_SPEED_KPH, referenceSpeedKph * walkingSpeedFactor(gradePercent)))
}

export function createTravelTerrainTiming(series: readonly TerrainProfilePoint[], totalDistanceKm: number, referenceSpeedKph: number, travelMode: TravelMode = 'cycling'): TerrainTiming {
  if (travelMode !== 'walking') return createTerrainTiming(series, totalDistanceKm, referenceSpeedKph)
  if (!Number.isFinite(referenceSpeedKph) || !(referenceSpeedKph > 0) || !(totalDistanceKm > 0) || series.length < 2) throw new Error('Profil temporel invalide.')
  let totalMovingMinutes = 0
  const points: TerrainTimingPoint[] = []
  for (const [index, point] of series.entries()) {
    const previous = series[index - 1]
    if (previous !== undefined) {
      const distance = Math.max(0, point.distanceKm - previous.distanceKm)
      // Integrate the local time cost, not the arithmetic mean of speeds.
      const intervalMinutes = distance * 30 * (1 / walkingSpeed(referenceSpeedKph, previous.smoothedGradePercent) + 1 / walkingSpeed(referenceSpeedKph, point.smoothedGradePercent))
      if (!Number.isFinite(intervalMinutes) || intervalMinutes < 0) throw new Error('Temps local de terrain invalide.')
      totalMovingMinutes += intervalMinutes
    }
    points.push({ ...point, movingElapsedMinutes: totalMovingMinutes, localSpeedKph: walkingSpeed(referenceSpeedKph, point.smoothedGradePercent) })
  }
  if (!(totalMovingMinutes > 1e-9) || !Number.isFinite(totalMovingMinutes)) throw new Error('Pondération temporelle invalide.')
  return { points, totalMovingMinutes }
}

interface WalkingTerrain {
  readonly profile: readonly TerrainProfilePoint[] | null
  readonly lengthKm: number
}
const walkingTerrains = new WeakMap<readonly RouteGeometryPoint[], WalkingTerrain>()

/** Match import's altitude-quality, smoothing and slope sampling exactly.
 * Missing/insufficient altitude retains a flat-speed fallback. Geometry is
 * immutable; sharing its result avoids rebuilding it for each weather point. */
export function walkingTerrainForGeometry(geometry: readonly RouteGeometryPoint[]): WalkingTerrain {
  const cached = walkingTerrains.get(geometry)
  if (cached !== undefined) return cached
  const series = buildDistanceIndexedSeries(geometry.map(point => ({ latitude: point.latitude, longitude: point.longitude, elevationM: point.altitudeM })))
  const result = {
    profile: assessAltitudeQuality(series).isSufficient ? buildTerrainSlopeProfile(smoothElevation(series), undefined, undefined, MAX_WALKING_GRADE_PERCENT) : null,
    lengthKm: series.at(-1)?.distanceKm ?? 0,
  }
  walkingTerrains.set(geometry, result)
  return result
}
