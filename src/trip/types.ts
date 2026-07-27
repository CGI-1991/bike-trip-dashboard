import type { RouteEngineConfig } from '../route/config.ts'
import type {
  RouteClockTime,
  RouteEngineSettings,
  RouteProfile,
  RouteTimeline,
} from '../route/types.ts'

export type TripDayNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12
export type RideDayNumber = Exclude<TripDayNumber, 5 | 8>
export type OffDayNumber = 5 | 8
export type TripDayId = `J${TripDayNumber}`
export type RideDayId = 'J1' | 'J2' | 'J3' | 'J4' | 'J6' | 'J7' | 'J9' | 'J10' | 'J11' | 'J12'
export type OffDayId = 'J5' | 'J8'
export type GpxNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10

export interface RideDay<
  Id extends RideDayId = RideDayId,
  DayNumber extends RideDayNumber = RideDayNumber,
  Gpx extends GpxNumber = GpxNumber,
> {
  readonly id: Id
  readonly dayNumber: DayNumber
  readonly type: 'ride'
  readonly name: string
  readonly startName: string
  readonly endName: string
  readonly gpxNumber: Gpx
  readonly gpxFile: string
  readonly variant?: string
}

export interface OffDay<
  Id extends OffDayId = OffDayId,
  DayNumber extends OffDayNumber = OffDayNumber,
  NextRideDay extends RideDayId = RideDayId,
> {
  readonly id: Id
  readonly dayNumber: DayNumber
  readonly type: 'off'
  readonly name: string
  readonly locationName: string
  readonly title: string
  readonly nextRideDayId: NextRideDay
  readonly gpxNumber?: never
  readonly gpxFile?: never
  readonly startName?: never
  readonly endName?: never
}

export type TripDays = readonly [
  RideDay<'J1', 1, 1>,
  RideDay<'J2', 2, 2>,
  RideDay<'J3', 3, 3>,
  RideDay<'J4', 4, 4>,
  OffDay<'J5', 5, 'J6'>,
  RideDay<'J6', 6, 5>,
  RideDay<'J7', 7, 6>,
  OffDay<'J8', 8, 'J9'>,
  RideDay<'J9', 9, 7>,
  RideDay<'J10', 10, 8>,
  RideDay<'J11', 11, 9>,
  RideDay<'J12', 12, 10>,
]

export type TripDay = TripDays[number]

export interface TripPlan {
  readonly id: 'rga-2026'
  readonly name: string
  readonly timezone: 'Europe/Paris'
  readonly totalDays: 12
  readonly rideDays: 10
  readonly offDays: 2
  readonly days: TripDays
}

export interface ReadyRideDayProfile {
  readonly type: 'ride'
  readonly status: 'ready'
  readonly day: RideDay
  readonly routeProfile: RouteProfile
}

export interface UnavailableRideDayProfile {
  readonly type: 'ride'
  readonly status: 'unavailable'
  readonly day: RideDay
  readonly message: string
}

export interface OffDayProfile {
  readonly type: 'off'
  readonly day: OffDay
}

export type TripDayProfile =
  | ReadyRideDayProfile
  | UnavailableRideDayProfile
  | OffDayProfile

export interface TripProfile {
  readonly tripId: TripPlan['id']
  readonly days: readonly TripDayProfile[]
  readonly routeConfig: RouteEngineConfig
}

export interface RideDayTimeline {
  readonly type: 'ride'
  readonly status: 'ready'
  readonly day: RideDay
  readonly startTime: string
  readonly arrivalTime: RouteClockTime
  readonly route: RouteTimeline
}

export interface UnavailableRideDayTimeline {
  readonly type: 'ride'
  readonly status: 'unavailable'
  readonly day: RideDay
  readonly message: string
}

export interface OffDayTimeline {
  readonly type: 'off'
  readonly day: OffDay
}

export type TripDayTimeline =
  | RideDayTimeline
  | UnavailableRideDayTimeline
  | OffDayTimeline

export interface TripTimelineSummary {
  readonly totalDays: 12
  readonly rideDays: 10
  readonly offDays: 2
  readonly availableRideDays: number
  readonly unavailableRideDays: number
  readonly totalDistanceKm: number
  readonly totalElevationGainM: number
}

export interface TripTimeline {
  readonly tripId: TripPlan['id']
  readonly settings: RouteEngineSettings
  readonly days: readonly TripDayTimeline[]
  readonly summary: TripTimelineSummary
}
