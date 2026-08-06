/**
 * Auto-fill for OFF/transfer day locations (CDC Jalon B4.3 sections 13-14).
 * A pure, on-demand view-model computation — never persisted onto `TripDay`
 * itself, exactly like `canonical-waypoints.ts`/`waypoint-timeline.ts`:
 * `TripDay.startLocationName`/`endLocationName` stay the manual-override-only
 * fields (non-null means the user typed something and it always wins);
 * `null` means "compute the default from the nearest neighbouring ride day",
 * so a later edit to a neighbouring stage is reflected immediately, without
 * ever overwriting a value the user entered themselves.
 */

import type { RideStage, TripBundle, TripDay } from '../trip-core/index.ts'

/**
 * How many real calendar days a trip spans (CDC Jalon B4.3 section 12): a
 * transfer attached to a neighbouring ride day (`after_previous`/
 * `before_next`) shares that day's calendar date and must never inflate the
 * count — only a `'dedicated'` transfer (or the historical absence of the
 * field, treated the same way) occupies its own calendar day.
 */
export function countCalendarDays(days: readonly TripDay[]): number {
  return days.filter((day) => day.type !== 'transfer' || (day.transferTiming ?? 'dedicated') === 'dedicated').length
}

function rideStageForDay(bundle: TripBundle, day: TripDay): RideStage | null {
  if (day.stageId === null) return null
  return bundle.stages.find((candidate) => candidate.id === day.stageId) ?? null
}

/** Nearest ride day strictly before `dayIndex`, scanning past any number of intervening OFF/transfer days — CDC section 13: "si une journée roulée précédente existe". */
export function nearestPreviousRideStage(bundle: TripBundle, dayIndex: number): RideStage | null {
  const sorted = bundle.days.filter((day) => day.index < dayIndex).sort((left, right) => right.index - left.index)
  for (const day of sorted) {
    const stage = rideStageForDay(bundle, day)
    if (stage !== null) return stage
  }
  return null
}

/** Nearest ride day strictly after `dayIndex` — CDC section 13: "sinon, si un départ suivant est connu". */
export function nearestNextRideStage(bundle: TripBundle, dayIndex: number): RideStage | null {
  const sorted = bundle.days.filter((day) => day.index > dayIndex).sort((left, right) => left.index - right.index)
  for (const day of sorted) {
    const stage = rideStageForDay(bundle, day)
    if (stage !== null) return stage
  }
  return null
}

export interface ResolvedOffLocation {
  readonly name: string | null
  /** `true` when `name` came from a neighbouring stage rather than a manual override — callers use this only to decide whether to show an "auto" hint, never to change the value itself. */
  readonly autoFilled: boolean
}

/**
 * OFF day location (CDC section 13): manual override wins outright; absent
 * one, the previous ride day's arrival, else the next ride day's departure,
 * else genuinely unknown (`null` — never fabricated).
 */
export function resolveOffLocation(bundle: TripBundle, day: TripDay): ResolvedOffLocation {
  if (day.startLocationName !== null) return { name: day.startLocationName, autoFilled: false }
  const previous = nearestPreviousRideStage(bundle, day.index)
  if (previous?.endLocationName !== undefined && previous?.endLocationName !== null) return { name: previous.endLocationName, autoFilled: true }
  const next = nearestNextRideStage(bundle, day.index)
  if (next?.startLocationName !== undefined && next?.startLocationName !== null) return { name: next.startLocationName, autoFilled: true }
  return { name: null, autoFilled: false }
}

export interface ResolvedTransferLocations {
  readonly origin: string | null
  readonly destination: string | null
  readonly originAutoFilled: boolean
  readonly destinationAutoFilled: boolean
}

/**
 * Transfer origin/destination (CDC section 14): origin defaults to the
 * previous ride day's arrival, destination to the next ride day's
 * departure — each independently overridable, each never fabricated when
 * genuinely unknown.
 */
export function resolveTransferLocations(bundle: TripBundle, day: TripDay): ResolvedTransferLocations {
  const previous = nearestPreviousRideStage(bundle, day.index)
  const next = nearestNextRideStage(bundle, day.index)
  const origin = day.startLocationName ?? previous?.endLocationName ?? null
  const destination = day.endLocationName ?? next?.startLocationName ?? null
  return {
    origin,
    destination,
    originAutoFilled: day.startLocationName === null && origin !== null,
    destinationAutoFilled: day.endLocationName === null && destination !== null,
  }
}
