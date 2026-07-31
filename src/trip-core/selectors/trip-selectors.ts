import type { TripBundle } from '../schema/version.ts'
import type { Accommodation } from '../model/accommodation.ts'
import type { Climb } from '../model/climb.ts'
import type { AccommodationId, RideStageId, RouteId, TripDayId } from '../model/ids.ts'
import type { PracticalPlace } from '../model/practical-place.ts'
import type { RideStage } from '../model/ride-stage.ts'
import type { Route } from '../model/route.ts'
import type { RoutePoint } from '../model/route-point.ts'
import type { TripDay } from '../model/trip-day.ts'

/**
 * Pure, UI-independent read helpers over a validated `TripBundle`. No DOM
 * access, no storage access, no network, no recomputation of GPX/D+/ETA —
 * every value here already exists on the bundle. Nothing in this file
 * references a specific day, stage, or trip identifier.
 */

function byIndex(left: TripDay, right: TripDay): number {
  return left.index - right.index
}

export function selectOrderedDays(bundle: TripBundle): readonly TripDay[] {
  return [...bundle.days].sort(byIndex)
}

export function selectRideDays(bundle: TripBundle): readonly TripDay[] {
  return selectOrderedDays(bundle).filter((day) => day.type === 'ride')
}

export function selectOffDays(bundle: TripBundle): readonly TripDay[] {
  return selectOrderedDays(bundle).filter((day) => day.type === 'off')
}

export function selectTransferDays(bundle: TripBundle): readonly TripDay[] {
  return selectOrderedDays(bundle).filter((day) => day.type === 'transfer')
}

export function selectDayById(bundle: TripBundle, dayId: TripDayId): TripDay | null {
  return bundle.days.find((day) => day.id === dayId) ?? null
}

export function selectStageById(bundle: TripBundle, stageId: RideStageId): RideStage | null {
  return bundle.stages.find((stage) => stage.id === stageId) ?? null
}

export function selectStageForDay(bundle: TripBundle, dayId: TripDayId): RideStage | null {
  const day = selectDayById(bundle, dayId)
  if (day === null || day.stageId === null) return null
  return selectStageById(bundle, day.stageId)
}

export function selectRouteById(bundle: TripBundle, routeId: RouteId): Route | null {
  return bundle.routes.find((route) => route.id === routeId) ?? null
}

export function selectRouteForStage(bundle: TripBundle, stageId: RideStageId): Route | null {
  const stage = selectStageById(bundle, stageId)
  if (stage === null) return null
  return selectRouteById(bundle, stage.sourceRouteId)
}

export function selectAccommodationForDay(bundle: TripBundle, dayId: TripDayId): Accommodation | null {
  const day = selectDayById(bundle, dayId)
  if (day === null || day.accommodationId === null) return null
  return selectAccommodationById(bundle, day.accommodationId)
}

function selectAccommodationById(bundle: TripBundle, accommodationId: AccommodationId): Accommodation | null {
  return bundle.accommodations.find((accommodation) => accommodation.id === accommodationId) ?? null
}

export function selectPracticalPlacesForDay(bundle: TripBundle, dayId: TripDayId): readonly PracticalPlace[] {
  return bundle.practicalPlaces.filter((place) => place.dayIds.includes(dayId))
}

export function selectClimbsForStage(bundle: TripBundle, stageId: RideStageId): readonly Climb[] {
  const stage = selectStageById(bundle, stageId)
  if (stage === null) return []
  const climbsById = new Map(bundle.climbs.map((climb) => [climb.id, climb]))
  return stage.climbIds.flatMap((climbId) => {
    const climb = climbsById.get(climbId)
    return climb === undefined ? [] : [climb]
  })
}

export function selectRoutePointsForStage(bundle: TripBundle, stageId: RideStageId): readonly RoutePoint[] {
  const stage = selectStageById(bundle, stageId)
  if (stage === null) return []
  const routePointsById = new Map(bundle.routePoints.map((point) => [point.id, point]))
  return stage.routePointIds.flatMap((pointId) => {
    const point = routePointsById.get(pointId)
    return point === undefined ? [] : [point]
  })
}

export interface TripDayCounts {
  readonly totalDays: number
  readonly rideDays: number
  readonly offDays: number
  readonly transferDays: number
}

export function selectTripCounts(bundle: TripBundle): TripDayCounts {
  return {
    totalDays: bundle.days.length,
    rideDays: selectRideDays(bundle).length,
    offDays: selectOffDays(bundle).length,
    transferDays: selectTransferDays(bundle).length,
  }
}

export interface TripTotals {
  readonly distanceKm: number | null
  readonly elevationGainM: number | null
  readonly elevationLossM: number | null
  readonly movingDurationSeconds: number | null
  readonly totalDurationSeconds: number | null
}

/** Sums the non-null values, or `null` when none of the stages have this value yet. */
function sumOrNull(values: readonly (number | null)[]): number | null {
  const known = values.filter((value): value is number => value !== null)
  if (known.length === 0) return null
  return known.reduce((total, value) => total + value, 0)
}

export function selectTripTotals(bundle: TripBundle): TripTotals {
  const stages = bundle.stages
  return {
    distanceKm: sumOrNull(stages.map((stage) => stage.distanceKm)),
    elevationGainM: sumOrNull(stages.map((stage) => stage.elevationGainM)),
    elevationLossM: sumOrNull(stages.map((stage) => stage.elevationLossM)),
    movingDurationSeconds: sumOrNull(stages.map((stage) => stage.movingDurationSeconds)),
    totalDurationSeconds: sumOrNull(stages.map((stage) => stage.totalDurationSeconds)),
  }
}
