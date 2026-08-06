import type { KilometersPerHour, Seconds } from './common.ts'
import type { RideStageId, RoutePointId, TripDayId } from './ids.ts'

export type PausePlanMode = 'automatic' | 'custom'

/**
 * Trip-wide reference speed and pause strategy — preserves the
 * "reference speed × terrain factor" model (CDC section 17.1) as a concept,
 * without hardcoding any trip-specific value.
 */
export interface GlobalTripSettings {
  readonly referenceSpeedKph: KilometersPerHour
  readonly pausePlanMode: PausePlanMode
  /**
   * Jalon B4.2 section 15: adapts the importance threshold used to classify
   * detected climbs as "principale"/"secondaire" (`analysis/canonical-
   * waypoints.ts::classifyClimbImportance`) — never re-runs GPX detection
   * itself. `true` for an alpine/mountain trip (stricter threshold, only
   * genuinely major ascents stay principale by default); `false` for a
   * rolling/local trip (permissive threshold, a modest climb can already be
   * principale). Optional/absent on historical records — treat as `false`.
   */
  readonly mountainMode?: boolean
}

/** Per-day override: departure time and total break budget for that day. */
export interface TripDaySettings {
  readonly dayId: TripDayId
  /** `HH:MM` local time, or `null` to inherit no specific departure time. */
  readonly departureTime: string | null
  readonly totalBreakSeconds: Seconds | null
}

export interface StagePauseSetting {
  readonly id: string
  readonly active: boolean
  readonly routePointId: RoutePointId | null
  readonly durationSeconds: Seconds
  readonly order: number
  readonly origin: 'automatic' | 'custom'
}

/** Per-stage pause plan, mirroring `src/trip/pause-plan.ts`'s day-level plan. */
export interface RideStageSettings {
  readonly stageId: RideStageId
  /** `null` means "inherit `GlobalTripSettings.pausePlanMode`". */
  readonly pausePlanMode: PausePlanMode | null
  readonly pauses: readonly StagePauseSetting[]
}

/**
 * All settings for the trip, normalized: one `global` record plus one entry
 * per day/stage that actually customizes something (an unlisted day or stage
 * simply falls back to `global`).
 */
export interface TripSettings {
  readonly global: GlobalTripSettings
  readonly days: readonly TripDaySettings[]
  readonly stages: readonly RideStageSettings[]
}
