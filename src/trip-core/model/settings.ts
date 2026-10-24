import type { KilometersPerHour, Seconds } from './common.ts'
import type { RideStageId, RoutePointId, TripDayId } from './ids.ts'

export type PausePlanMode = 'automatic' | 'custom'

export const TRAVEL_MODES = ['cycling', 'walking'] as const
export type TravelMode = (typeof TRAVEL_MODES)[number]
export const DEFAULT_TRAVEL_MODE: TravelMode = 'cycling'

export const ORGANIZATION_MODES = ['voyage', 'league', 'tour'] as const
export type OrganizationMode = (typeof ORGANIZATION_MODES)[number]

export const ORGANIZATION_CAPABILITIES = {
  voyage: { tripTabLabel: 'Voyage', relativeWind: true, explicitRaceBounds: false, independentDates: false, plannedStops: true, linkedStages: false, automaticPoiSearch: true },
  league: { tripTabLabel: 'Calendrier', relativeWind: true, explicitRaceBounds: true, independentDates: true, plannedStops: false, linkedStages: false, automaticPoiSearch: false },
  tour: { tripTabLabel: 'Étapes', relativeWind: true, explicitRaceBounds: false, independentDates: false, plannedStops: false, linkedStages: true, automaticPoiSearch: true },
} as const

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
  /** Absent: derive Voyage/Tour from the historical raceMode flag. */
  readonly organizationMode?: OrganizationMode
  /** Explicit POI opt-in for a League calendar; existing places stay readable. */
  readonly leaguePoiSearchEnabled?: boolean
  /** Absent on existing trips: preserve the historical cycling model. */
  readonly travelMode?: TravelMode
  readonly referenceSpeedMode?: import('./reference-speed.ts').ReferenceSpeedMode
  readonly referenceSpeedKph: KilometersPerHour
  readonly pausePlanMode: PausePlanMode
  /*
   * NOTE — a record saved before this setting was removed may still carry a
   * `mountainMode` boolean. It is deliberately absent from this interface
   * and read by nothing: the Normal/Montagne selector it drove hid detected
   * climbs, and choosing which climbs exist is now
   * `climbDetectionSensitivity`'s job alone. The stored key is inert, so no
   * migration is needed and no saved preference can hide a climb any more.
   */
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
