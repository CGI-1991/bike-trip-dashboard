import type { KilometersPerHour, Seconds } from './common.ts'
import type { RideStageId, RoutePointId, TripDayId } from './ids.ts'

export type PausePlanMode = 'automatic' | 'custom'

/**
 * Climb-detection sensitivity (one trip-wide setting, 5 steps). Ordered
 * from the most selective to the most sensitive, which is exactly the
 * order the UI slider presents ("Montagne" → "Pays plat").
 *
 * `'standard'` is the historical behaviour, byte for byte — it is what an
 * absent value means, so every already-saved trip keeps detecting exactly
 * the climbs it detects today. The concrete thresholds each step applies
 * live in `analysis/climb-detection.ts::CLIMB_SENSITIVITY_TUNINGS`, the one
 * place they are defined and documented.
 */
export const CLIMB_DETECTION_SENSITIVITIES = ['mountain', 'hilly', 'standard', 'rolling', 'flat'] as const
export type ClimbDetectionSensitivity = (typeof CLIMB_DETECTION_SENSITIVITIES)[number]
export const DEFAULT_CLIMB_DETECTION_SENSITIVITY: ClimbDetectionSensitivity = 'standard'

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
  /**
   * Mode "Course / Tour": in-stage pauses/arrêts are disabled outright —
   * never proposed for configuration, never folded into an ETA. OFF days,
   * transfers and POI (which are places, not planned stops) are completely
   * unaffected. Optional/absent on historical records — treat as `false`,
   * so an existing trip stays in its current mode by default.
   */
  readonly raceMode?: boolean
  /**
   * Climb-detection sensitivity for the whole trip (see
   * `ClimbDetectionSensitivity`). Absent means `'standard'` — the
   * historical calibration, unchanged.
   */
  readonly climbDetectionSensitivity?: ClimbDetectionSensitivity
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
