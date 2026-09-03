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

import type { RideStage, TripBundle, TripDay, TripDayId } from '../trip-core/index.ts'
import { routeGeometry } from '../route-enrichment/route-fingerprint.ts'

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

export interface ResolvedCoordinates {
  readonly latitude: number
  readonly longitude: number
  /** `true` when derived from a neighbouring ride stage's own route geometry rather than a manual "Choisir sur la carte" override. */
  readonly autoFilled: boolean
}

/** A ride stage's own départ/arrivée coordinates, read straight from its route geometry (CDC R2.1 section 38) — never a second geocoding, never the stage's plain text name. `null` when the route has no usable geometry at all. */
function stageEndpointCoordinates(bundle: TripBundle, stage: RideStage, endpoint: 'start' | 'end'): { readonly latitude: number; readonly longitude: number } | null {
  const route = bundle.routes.find((candidate) => candidate.id === stage.sourceRouteId)
  if (route === undefined) return null
  const geometry = routeGeometry(route)
  if (geometry === null) return null
  const point = endpoint === 'start' ? geometry[0] : geometry[geometry.length - 1]
  return point === undefined ? null : { latitude: point.latitude, longitude: point.longitude }
}

/**
 * R2.1 sections 38/40-41: an OFF day's own coordinates, for "Choisir sur la
 * carte" and the (markers-only, never a routed line) map fallback — manual
 * override wins outright, exactly like `resolveOffLocation`'s own name
 * resolution; otherwise the previous ride day's arrival, else the next
 * ride day's departure, else genuinely unknown (`null`, never fabricated).
 */
export function resolveOffCoordinates(bundle: TripBundle, day: TripDay): ResolvedCoordinates | null {
  if (day.overrideStartLatitude !== undefined && day.overrideStartLongitude !== undefined) {
    return { latitude: day.overrideStartLatitude, longitude: day.overrideStartLongitude, autoFilled: false }
  }
  const previous = nearestPreviousRideStage(bundle, day.index)
  const fromPrevious = previous === null ? null : stageEndpointCoordinates(bundle, previous, 'end')
  if (fromPrevious !== null) return { ...fromPrevious, autoFilled: true }
  const next = nearestNextRideStage(bundle, day.index)
  const fromNext = next === null ? null : stageEndpointCoordinates(bundle, next, 'start')
  return fromNext === null ? null : { ...fromNext, autoFilled: true }
}

export interface ResolvedTransferCoordinates {
  readonly origin: ResolvedCoordinates | null
  readonly destination: ResolvedCoordinates | null
}

/** R2.1 sections 38/40-41 — the transfer counterpart of `resolveOffCoordinates`, one resolution per side, each independently overridable. */
export function resolveTransferCoordinates(bundle: TripBundle, day: TripDay): ResolvedTransferCoordinates {
  const origin = day.overrideStartLatitude !== undefined && day.overrideStartLongitude !== undefined
    ? { latitude: day.overrideStartLatitude, longitude: day.overrideStartLongitude, autoFilled: false }
    : (() => {
        const previous = nearestPreviousRideStage(bundle, day.index)
        const coords = previous === null ? null : stageEndpointCoordinates(bundle, previous, 'end')
        return coords === null ? null : { ...coords, autoFilled: true }
      })()
  const destination = day.overrideEndLatitude !== undefined && day.overrideEndLongitude !== undefined
    ? { latitude: day.overrideEndLatitude, longitude: day.overrideEndLongitude, autoFilled: false }
    : (() => {
        const next = nearestNextRideStage(bundle, day.index)
        const coords = next === null ? null : stageEndpointCoordinates(bundle, next, 'start')
        return coords === null ? null : { ...coords, autoFilled: true }
      })()
  return { origin, destination }
}

/**
 * R2.1 sections 33-34 / RC2 final-closeout sections 32-35: séjour
 * information (hébergement/notes/liens) belongs to the SAME logical place
 * as the immediately preceding day whenever THIS day has no reason of its
 * own to be somewhere different — a single source of truth, resolved here
 * rather than copied on save (CDC: "préférer une résolution... plutôt
 * qu'une copie synchronisée par effets secondaires"). Two cases share a
 * previous day's Infos, both walked transitively (so a whole run of
 * consecutive OFF days — RC2 section 34's "Ride → OFF → OFF" — all resolve
 * to the same ultimate owner, never a chain of separate copies):
 *
 * - a transfer whose `transferTiming` is `'after_previous'` (unconditional —
 *   this kind of transfer never carries its own lodging fields at all, R2.1
 *   section 33);
 * - an OFF day that has no manual location override of its own
 *   (`startLocationName === null`, RC2 section 32 — the exact same signal
 *   `resolveOffLocation` already uses to mean "this day is wherever the
 *   trip's own chronology already puts it," never a second, divergent
 *   definition). An OFF day WITH an override is a genuinely different place
 *   (e.g. a transfer to a rest day elsewhere) and stays its own Infos owner
 *   — sections 32/34 only ever apply to a day that IS the same place as its
 *   neighbour, never invented for one that visibly isn't.
 *
 * Every other case (a `'dedicated'`/`'before_next'` transfer, an overridden
 * OFF day, a ride day) resolves to the day itself — its own Infos stay
 * exactly as they already are. A `'before_next'` transfer is never used as
 * a previous-day anchor either (it carries no lodging of its own to share,
 * R2.1 section 32) — an OFF day right after one simply keeps its own Infos
 * rather than resolving to a day that structurally has none.
 *
 * `index - 1` (not "nearest ride day") on purpose: this only ever means
 * "the calendar-adjacent day this one shares its place with" — a genuine
 * gap means this day isn't really sharing anything; falls back to the
 * day's own id if that neighbour is somehow missing.
 */
export function resolveSharedInfoDayId(bundle: TripBundle, day: TripDay): TripDayId {
  const sharesWithPrevious = (day.type === 'transfer' && (day.transferTiming ?? 'dedicated') === 'after_previous')
    || (day.type === 'off' && day.startLocationName === null)
  if (!sharesWithPrevious) return day.id
  const previous = bundle.days.find((candidate) => candidate.index === day.index - 1)
  if (previous === undefined) return day.id
  if (previous.type === 'transfer' && (previous.transferTiming ?? 'dedicated') === 'before_next') return day.id
  return resolveSharedInfoDayId(bundle, previous)
}
