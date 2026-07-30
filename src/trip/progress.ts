import { getDateInTimezone } from './calendar.ts'
import type { TripDayId, TripDayTimeline, TripPlan, TripTimeline } from './types.ts'
import { getTripPeriod } from '../ui/app-state.ts'
import type { TripPeriod } from '../ui/app-state.ts'
import type { TerrainTimingPoint } from '../route/types.ts'

const EPSILON = 1e-9

export interface TheoreticalPosition {
  readonly latitude: number
  readonly longitude: number
  readonly altitudeM: number | null
  readonly distanceKm: number
  readonly elevationGainM: number
  readonly elevationLossM: number
  readonly dayProgress: number
  readonly isPaused: boolean
}

export interface TripProgressSummary {
  readonly period: TripPeriod['kind']
  readonly currentDayId: TripDayId
  readonly currentDayState: 'upcoming' | 'in-progress' | 'completed' | 'off'
  readonly totalDistanceKm: number
  readonly completedDistanceKm: number
  readonly remainingDistanceKm: number
  readonly totalElevationGainM: number
  readonly completedElevationGainM: number
  readonly remainingElevationGainM: number
  readonly totalElevationLossM: number
  readonly completedElevationLossM: number
  readonly remainingElevationLossM: number
  readonly completedRideDays: number
  readonly remainingRideDays: number
  readonly offDays: number
  readonly progressPercent: number
  readonly position: TheoreticalPosition | null
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function minutesInTimezone(now: Date, timezone: TripPlan['timezone']): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const values = new Map(parts.map(({ type, value }) => [type, value]))
  return Number(values.get('hour') ?? 0) * 60 + Number(values.get('minute') ?? 0)
}

function readyRide(day: TripDayTimeline): day is Extract<TripDayTimeline, { type: 'ride'; status: 'ready' }> {
  return day.type === 'ride' && day.status === 'ready'
}

interface TerrainMetricsPoint extends TerrainTimingPoint {
  readonly elevationGainM: number
  readonly elevationLossM: number
}

function terrainMetrics(day: Extract<TripDayTimeline, { type: 'ride'; status: 'ready' }>): readonly TerrainMetricsPoint[] {
  const source = day.route.terrainTiming ?? []
  let gain = 0
  let loss = 0
  const raw = source.map((point, index) => {
    const previous = source[index - 1]
    const delta = previous === undefined ? 0 : point.elevationM - previous.elevationM
    if (delta > 0) gain += delta
    else loss += Math.abs(delta)
    return { ...point, elevationGainM: gain, elevationLossM: loss }
  })
  const gainScale = gain > EPSILON ? day.route.summary.elevationGainM / gain : 0
  const lossScale = loss > EPSILON ? day.route.summary.elevationLossM / loss : 0
  return raw.map((point) => ({
    ...point,
    elevationGainM: point.elevationGainM * gainScale,
    elevationLossM: point.elevationLossM * lossScale,
  }))
}

function interpolateTerrain(points: readonly TerrainMetricsPoint[], movingElapsedMinutes: number): TerrainMetricsPoint | null {
  if (points.length === 0) return null
  const afterIndex = points.findIndex((point) => point.movingElapsedMinutes >= movingElapsedMinutes)
  const after = points[afterIndex < 0 ? points.length - 1 : afterIndex] as TerrainMetricsPoint
  const before = points[Math.max(0, (afterIndex < 0 ? points.length - 1 : afterIndex) - 1)] as TerrainMetricsPoint
  const delta = after.movingElapsedMinutes - before.movingElapsedMinutes
  const ratio = delta <= EPSILON ? 0 : clamp((movingElapsedMinutes - before.movingElapsedMinutes) / delta, 0, 1)
  const interpolate = (from: number, to: number): number => from + (to - from) * ratio
  return {
    ...before,
    latitude: interpolate(before.latitude, after.latitude),
    longitude: interpolate(before.longitude, after.longitude),
    elevationM: interpolate(before.elevationM, after.elevationM),
    distanceKm: interpolate(before.distanceKm, after.distanceKm),
    smoothedGradePercent: interpolate(before.smoothedGradePercent, after.smoothedGradePercent),
    localSpeedKph: interpolate(before.localSpeedKph, after.localSpeedKph),
    movingElapsedMinutes,
    elevationGainM: interpolate(before.elevationGainM, after.elevationGainM),
    elevationLossM: interpolate(before.elevationLossM, after.elevationLossM),
  }
}

function positionAtElapsed(day: Extract<TripDayTimeline, { type: 'ride'; status: 'ready' }>, elapsedMinutes: number): TheoreticalPosition | null {
  const metrics = terrainMetrics(day)
  if (metrics.length === 0) return null
  const totalElapsed = day.route.summary.totalDurationMinutes
  const elapsed = clamp(elapsedMinutes, 0, totalElapsed)
  const activePause = day.route.pauses.find((pause) => elapsed >= pause.startElapsedMinutes && elapsed <= pause.endElapsedMinutes)
  let movingElapsed = elapsed
  let isPaused = false
  if (activePause !== undefined) {
    movingElapsed = activePause.startElapsedMinutes - day.route.pauses
      .filter((pause) => pause.endElapsedMinutes <= activePause.startElapsedMinutes)
      .reduce((sum, pause) => sum + pause.durationMinutes, 0)
    isPaused = true
  } else {
    movingElapsed -= day.route.pauses
      .filter((pause) => pause.endElapsedMinutes <= elapsed)
      .reduce((sum, pause) => sum + pause.durationMinutes, 0)
  }
  const point = interpolateTerrain(metrics, movingElapsed)
  if (point === null) return null
  const totalDistance = day.route.summary.distanceKm
  return {
    latitude: point.latitude,
    longitude: point.longitude,
    altitudeM: point.elevationM,
    distanceKm: point.distanceKm,
    elevationGainM: point.elevationGainM,
    elevationLossM: point.elevationLossM,
    dayProgress: totalDistance <= EPSILON ? 0 : clamp(point.distanceKm / totalDistance, 0, 1),
    isPaused,
  }
}

function endPosition(day: Extract<TripDayTimeline, { type: 'ride'; status: 'ready' }>): TheoreticalPosition | null {
  return positionAtElapsed(day, day.route.summary.totalDurationMinutes)
}

export function calculateTripProgress(now: Date, plan: TripPlan, timeline: TripTimeline | null): TripProgressSummary {
  const period = getTripPeriod(now)
  const currentDay = plan.days.find(({ id }) => id === period.dayId) ?? plan.days[0]
  const timelineDays = timeline?.days ?? []
  const rides = timelineDays.filter(readyRide)
  const totals = rides.reduce((sum, day) => ({
    distance: sum.distance + day.route.summary.distanceKm,
    gain: sum.gain + day.route.summary.elevationGainM,
    loss: sum.loss + day.route.summary.elevationLossM,
  }), { distance: 0, gain: 0, loss: 0 })
  let completedDistance = 0
  let completedGain = 0
  let completedLoss = 0
  let completedRideDays = 0
  let position: TheoreticalPosition | null = null
  let currentDayState: TripProgressSummary['currentDayState'] = currentDay.type === 'off' ? 'off' : 'upcoming'
  const currentDayNumber = currentDay.dayNumber

  for (const day of rides) {
    const isPastDay = period.kind === 'after' || (period.kind === 'during' && day.day.dayNumber < currentDayNumber)
    if (isPastDay) {
      completedDistance += day.route.summary.distanceKm
      completedGain += day.route.summary.elevationGainM
      completedLoss += day.route.summary.elevationLossM
      completedRideDays++
      position = endPosition(day) ?? position
    }
  }

  if (period.kind === 'during' && currentDay.type === 'ride') {
    const day = rides.find(({ day: candidate }) => candidate.id === currentDay.id)
    if (day !== undefined) {
      const localMinutes = minutesInTimezone(now, plan.timezone)
      const elapsed = localMinutes - day.route.summary.departureTimeMinutes
      const partial = positionAtElapsed(day, elapsed)
      if (partial !== null) {
        position = partial
        completedDistance += partial.distanceKm
        completedGain += partial.elevationGainM
        completedLoss += partial.elevationLossM
      }
      if (elapsed < 0) currentDayState = 'upcoming'
      else if (elapsed >= day.route.summary.totalDurationMinutes) {
        currentDayState = 'completed'
        completedRideDays++
      } else currentDayState = 'in-progress'
    }
  } else if (period.kind === 'after') {
    currentDayState = 'completed'
    position = rides.length === 0 ? null : endPosition(rides[rides.length - 1] as Extract<TripDayTimeline, { type: 'ride'; status: 'ready' }>)
  } else if (period.kind === 'before') {
    position = null
  }

  const progressPercent = totals.distance <= EPSILON ? 0 : clamp((completedDistance / totals.distance) * 100, 0, 100)
  return {
    period: period.kind,
    currentDayId: currentDay.id,
    currentDayState,
    totalDistanceKm: totals.distance,
    completedDistanceKm: clamp(completedDistance, 0, totals.distance),
    remainingDistanceKm: Math.max(0, totals.distance - completedDistance),
    totalElevationGainM: totals.gain,
    completedElevationGainM: clamp(completedGain, 0, totals.gain),
    remainingElevationGainM: Math.max(0, totals.gain - completedGain),
    totalElevationLossM: totals.loss,
    completedElevationLossM: clamp(completedLoss, 0, totals.loss),
    remainingElevationLossM: Math.max(0, totals.loss - completedLoss),
    completedRideDays,
    remainingRideDays: Math.max(0, plan.rideDays - completedRideDays),
    offDays: plan.offDays,
    progressPercent,
    position,
  }
}

export function getProgressLocalDate(now: Date, plan: TripPlan): string {
  return getDateInTimezone(now, plan.timezone)
}
