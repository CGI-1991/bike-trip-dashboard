import type { RouteProfilePosition, TerrainProfilePoint, TerrainTimingPoint } from './types.ts'

const EPSILON = 1e-9

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function interpolateNumber(from: number, to: number, ratio: number): number {
  return from + (to - from) * ratio
}

function interpolateSource(points: readonly RouteProfilePosition[], distanceKm: number): RouteProfilePosition {
  const afterIndex = points.findIndex((point) => point.distanceKm >= distanceKm)
  const after = points[afterIndex < 0 ? points.length - 1 : afterIndex] as RouteProfilePosition
  const before = points[Math.max(0, (afterIndex < 0 ? points.length - 1 : afterIndex) - 1)] as RouteProfilePosition
  const delta = after.distanceKm - before.distanceKm
  const ratio = delta <= EPSILON ? 0 : clamp((distanceKm - before.distanceKm) / delta, 0, 1)
  const beforeElevation = before.altitudeM ?? after.altitudeM ?? 0
  const afterElevation = after.altitudeM ?? before.altitudeM ?? 0
  return {
    ...before,
    distanceKm,
    latitude: interpolateNumber(before.latitude, after.latitude, ratio),
    longitude: interpolateNumber(before.longitude, after.longitude, ratio),
    altitudeM: interpolateNumber(beforeElevation, afterElevation, ratio),
  }
}

function interpolateElevation(points: readonly { readonly distanceKm: number; readonly elevationM: number }[], distanceKm: number): number {
  const afterIndex = points.findIndex((point) => point.distanceKm >= distanceKm)
  const after = points[afterIndex < 0 ? points.length - 1 : afterIndex]
  const before = points[Math.max(0, (afterIndex < 0 ? points.length - 1 : afterIndex) - 1)]
  if (after === undefined || before === undefined) return 0
  const delta = after.distanceKm - before.distanceKm
  return delta <= EPSILON ? after.elevationM : interpolateNumber(before.elevationM, after.elevationM, clamp((distanceKm - before.distanceKm) / delta, 0, 1))
}

export function buildTerrainProfileSeries(
  source: readonly RouteProfilePosition[],
  intervalKm = 0.075,
  smoothingWindowKm = 0.15,
  gradeWindowKm = 0.5,
): readonly TerrainProfilePoint[] {
  const points = [...source].filter((point) => Number.isFinite(point.distanceKm)).sort((a, b) => a.distanceKm - b.distanceKm)
  const totalDistanceKm = points.at(-1)?.distanceKm ?? 0
  if (points.length < 2 || totalDistanceKm <= EPSILON) return []
  const distances: number[] = []
  for (let distance = 0; distance < totalDistanceKm; distance += intervalKm) distances.push(distance)
  distances.push(totalDistanceKm)
  const regular = distances.map((distanceKm) => interpolateSource(points, distanceKm))
  const smoothed = regular.map((point) => {
    const neighbours = regular.filter((candidate) => Math.abs(candidate.distanceKm - point.distanceKm) <= smoothingWindowKm / 2)
    const elevationM = neighbours.reduce((sum, candidate) => sum + (candidate.altitudeM ?? 0), 0) / Math.max(neighbours.length, 1)
    return { ...point, elevationM }
  })
  const elevations = smoothed.map(({ distanceKm, elevationM }) => ({ distanceKm, elevationM }))
  return smoothed.map((point) => {
    const left = Math.max(0, point.distanceKm - gradeWindowKm / 2)
    const right = Math.min(totalDistanceKm, point.distanceKm + gradeWindowKm / 2)
    const deltaKm = right - left
    const grade = deltaKm <= EPSILON ? 0 : ((interpolateElevation(elevations, right) - interpolateElevation(elevations, left)) / (deltaKm * 1000)) * 100
    return {
      distanceKm: point.distanceKm,
      elevationM: point.elevationM,
      smoothedGradePercent: Number.isFinite(grade) ? clamp(grade, -20, 20) : 0,
      latitude: point.latitude,
      longitude: point.longitude,
    }
  })
}

export function getTerrainSpeedFactor(gradePercent: number): number {
  const grade = Number.isFinite(gradePercent) ? clamp(gradePercent, -15, 15) : 0
  const controls = [
    [-15, 2.2], [-8, 1.8], [-4, 1.35], [0, 1], [3, 0.78], [6, 0.56], [9, 0.42], [15, 0.32],
  ] as const
  const upperIndex = controls.findIndex(([threshold]) => grade <= threshold)
  const upper = controls[upperIndex < 0 ? controls.length - 1 : upperIndex] as readonly [number, number]
  const lower = controls[Math.max(0, (upperIndex < 0 ? controls.length - 1 : upperIndex) - 1)] as readonly [number, number]
  const span = upper[0] - lower[0]
  return span <= EPSILON ? upper[1] : interpolateNumber(lower[1], upper[1], clamp((grade - lower[0]) / span, 0, 1))
}

export interface NormalizedTerrainTiming {
  readonly points: readonly TerrainTimingPoint[]
  readonly totalMovingMinutes: number
}

export function createNormalizedTerrainTiming(series: readonly TerrainProfilePoint[], totalDistanceKm: number, averageSpeedKph: number): NormalizedTerrainTiming {
  if (!(averageSpeedKph > 0) || !(totalDistanceKm > 0) || series.length < 2) throw new Error('Profil temporel invalide.')
  const rawMinutes: number[] = [0]
  let rawTotal = 0
  for (let index = 1; index < series.length; index++) {
    const previous = series[index - 1] as TerrainProfilePoint
    const point = series[index] as TerrainProfilePoint
    const distance = Math.max(0, point.distanceKm - previous.distanceKm)
    const factor = Math.max(0.1, (getTerrainSpeedFactor(previous.smoothedGradePercent) + getTerrainSpeedFactor(point.smoothedGradePercent)) / 2)
    rawTotal += distance / factor
    rawMinutes.push(rawTotal)
  }
  const targetMinutes = (totalDistanceKm / averageSpeedKph) * 60
  if (!(rawTotal > EPSILON) || !Number.isFinite(rawTotal)) throw new Error('Pondération temporelle invalide.')
  const scale = targetMinutes / rawTotal
  const points = series.map((point, index): TerrainTimingPoint => {
    const previous = series[Math.max(0, index - 1)] as TerrainProfilePoint
    const distance = Math.max(EPSILON, point.distanceKm - previous.distanceKm)
    const elapsedDelta = index === 0 ? 0 : ((rawMinutes[index] as number) - (rawMinutes[index - 1] as number)) * scale
    const localSpeedKph = index === 0 ? averageSpeedKph : distance / Math.max(elapsedDelta / 60, EPSILON)
    return { ...point, movingElapsedMinutes: (rawMinutes[index] as number) * scale, localSpeedKph: Number.isFinite(localSpeedKph) ? localSpeedKph : averageSpeedKph }
  })
  return { points, totalMovingMinutes: targetMinutes }
}

export function interpolateTerrainTiming(timing: NormalizedTerrainTiming, distanceKm: number): TerrainTimingPoint {
  const points = timing.points
  const afterIndex = points.findIndex((point) => point.distanceKm >= distanceKm)
  const after = points[afterIndex < 0 ? points.length - 1 : afterIndex] as TerrainTimingPoint
  const before = points[Math.max(0, (afterIndex < 0 ? points.length - 1 : afterIndex) - 1)] as TerrainTimingPoint
  const delta = after.distanceKm - before.distanceKm
  const ratio = delta <= EPSILON ? 0 : clamp((distanceKm - before.distanceKm) / delta, 0, 1)
  return {
    distanceKm,
    elevationM: interpolateNumber(before.elevationM, after.elevationM, ratio),
    smoothedGradePercent: interpolateNumber(before.smoothedGradePercent, after.smoothedGradePercent, ratio),
    latitude: interpolateNumber(before.latitude, after.latitude, ratio),
    longitude: interpolateNumber(before.longitude, after.longitude, ratio),
    movingElapsedMinutes: interpolateNumber(before.movingElapsedMinutes, after.movingElapsedMinutes, ratio),
    localSpeedKph: interpolateNumber(before.localSpeedKph, after.localSpeedKph, ratio),
  }
}
