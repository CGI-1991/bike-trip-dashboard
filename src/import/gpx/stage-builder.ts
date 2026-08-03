/**
 * Builds one `RideStage` and its `TripDay` for one imported file/route — CDC
 * section 7.2's "one GPX = one stage" and section 15's naming fallbacks
 * ("Départ étape N" / "Arrivée étape N" when nothing more specific is known,
 * never a fabricated place name).
 */

import { addCivilDays } from '../../trip-core/validation/primitives.ts'
import type { DataProvenance, IsoDate, Route, RideStage, RideStageId, RoutePoint, TripDay, TripDayId } from '../../trip-core/index.ts'
import { rideStageId as toRideStageId, tripDayId as toTripDayId } from '../../trip-core/index.ts'

export interface StageBuildInput {
  readonly index: number
  readonly route: Route
  readonly routePoints: readonly RoutePoint[]
  readonly stageIdValue: string
  readonly dayIdValue: string
  readonly startDate: string | null
  readonly metricsProvenance: DataProvenance
}

export interface BuiltStageAndDay {
  readonly stage: RideStage
  readonly day: TripDay
}

function asIsoDate(value: string): IsoDate {
  return value as IsoDate
}

export function buildStageAndDay(input: StageBuildInput): BuiltStageAndDay {
  const displayNumber = input.index + 1
  const dayId: TripDayId = toTripDayId(input.dayIdValue)
  const stageId: RideStageId = toRideStageId(input.stageIdValue)
  const segment = input.route.segments[0]
  const startLocationName = `Départ étape ${displayNumber}`
  const endLocationName = `Arrivée étape ${displayNumber}`
  const date = input.startDate === null ? null : asIsoDate(addCivilDays(input.startDate, input.index))

  const stage: RideStage = {
    id: stageId,
    dayId,
    sourceRouteId: input.route.id,
    name: segment?.name ?? null,
    startLocationName,
    endLocationName,
    distanceKm: segment?.distanceKm ?? null,
    elevationGainM: segment?.elevationGainM ?? null,
    elevationLossM: segment?.elevationLossM ?? null,
    minAltitudeM: minAltitudeFromRoute(input.route),
    maxAltitudeM: maxAltitudeFromRoute(input.route),
    movingDurationSeconds: null,
    pauseDurationSeconds: null,
    totalDurationSeconds: null,
    estimatedAverageSpeedKph: null,
    validationStatus: input.route.parsingStatus === 'success' ? 'valid' : 'needs-review',
    metricsProvenance: input.metricsProvenance,
    climbIds: [],
    routePointIds: input.routePoints.map((point) => point.id),
    weatherRecordIds: [],
  }

  const day: TripDay = {
    id: dayId,
    index: input.index,
    displayNumber,
    date,
    type: 'ride',
    stageId,
    startLocationName,
    endLocationName,
    accommodationId: null,
    notes: null,
    enrichmentStatus: 'not-started',
  }

  return { stage, day }
}

function minAltitudeFromRoute(route: Route): number | null {
  const values = (route.geometry?.full ?? []).map((point) => point.altitudeM).filter((value): value is number => value !== null)
  return values.length === 0 ? null : Math.min(...values)
}

function maxAltitudeFromRoute(route: Route): number | null {
  const values = (route.geometry?.full ?? []).map((point) => point.altitudeM).filter((value): value is number => value !== null)
  return values.length === 0 ? null : Math.max(...values)
}
