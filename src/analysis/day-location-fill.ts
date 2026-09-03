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
 * OFF day location (CDC section 13, generalised by DER-DES-DER sections
 * 68-73/79-81/91-92): manual override wins outright; absent one, the place
 * the trip is already at — the previous day's own END, else (for an OFF at
 * the very start of the trip, section 72) the next day's own START. Never
 * fabricated when genuinely unknown.
 *
 * "The previous day's end" now means a TRANSFER's destination just as much
 * as a ride's arrival. Skipping transfers, as the old "nearest ride day"
 * scan did, put an OFF in `Ride A → Transfer → OFF → Ride B` back at
 * `RideA.end` — before the transfer that had just moved the trip somewhere
 * else. An OFF never moves the trip (section 92); it inherits wherever the
 * trip already is.
 */
export function resolveOffLocation(bundle: TripBundle, day: TripDay): ResolvedOffLocation {
  if (day.startLocationName !== null) return { name: day.startLocationName, autoFilled: false }
  const previous = transferAnchorDay(bundle, day.index, -1)
  const fromPrevious = previous === null
    ? null
    : previous.type === 'transfer'
      ? resolveTransferDestinationEndpoint(bundle, previous).name
      : rideStageForDay(bundle, previous)?.endLocationName ?? null
  if (fromPrevious !== null) return { name: fromPrevious, autoFilled: true }
  const next = transferAnchorDay(bundle, day.index, 1)
  const fromNext = next === null
    ? null
    : next.type === 'transfer'
      ? resolveTransferOriginEndpoint(bundle, next).name
      : rideStageForDay(bundle, next)?.startLocationName ?? null
  if (fromNext !== null) return { name: fromNext, autoFilled: true }
  return { name: null, autoFilled: false }
}

export interface ResolvedTransferLocations {
  readonly origin: string | null
  readonly destination: string | null
  readonly originAutoFilled: boolean
  readonly destinationAutoFilled: boolean
  /**
   * DER-DES-DER sections 74-75/89 — `true` when this side is DERIVED from
   * another day of the trip (a ride day's own GPX endpoint, or the previous
   * transfer's destination in a chain) rather than something the traveller
   * has to supply. A linked side is displayed read-only: it has exactly one
   * source of truth elsewhere, and editing it here would fork that truth.
   *
   * Deliberately independent of `transferTiming`
   * (`before_next`/`after_previous`/`independent`, section 89): that field
   * says who OWNS THE LODGING; the trip's chronology decides the geography
   * regardless of it.
   */
  readonly originLinked: boolean
  readonly destinationLinked: boolean
  /** Short, non-technical hint for a linked side (section 75) — `null` when the side is manual. */
  readonly originLinkHint: string | null
  readonly destinationLinkHint: string | null
}

/**
 * The day that geographically anchors one side of a transfer, walking the
 * trip's own chronology (DER-DES-DER sections 76-88).
 *
 * The walk skips OFF days — an OFF day never moves the trip (section 92), so
 * a transfer separated from a ride only by rest days is still anchored to
 * that ride (sections 79-81). It STOPS at another transfer, which is the
 * whole point of the handoff rule (sections 82-87): in `T1 → T2 → Ride1`,
 * T2's origin is T1's destination and T1's destination is the intermediate
 * place only the traveller knows — not, as a naive "nearest ride day" scan
 * would have it, both of them jumping straight to `Ride1.start`.
 */
function transferAnchorDay(bundle: TripBundle, fromIndex: number, direction: -1 | 1): TripDay | null {
  const ordered = bundle.days
    .filter((candidate) => (direction === -1 ? candidate.index < fromIndex : candidate.index > fromIndex))
    .sort((left, right) => (direction === -1 ? right.index - left.index : left.index - right.index))
  for (const candidate of ordered) {
    if (candidate.type === 'off') continue
    return candidate
  }
  return null
}

interface ResolvedEndpoint {
  readonly name: string | null
  readonly linked: boolean
  readonly hint: string | null
}

const UNRESOLVED_ENDPOINT: ResolvedEndpoint = { name: null, linked: false, hint: null }

function resolveTransferOriginEndpoint(bundle: TripBundle, day: TripDay): ResolvedEndpoint {
  if (day.startLocationName !== null) return { name: day.startLocationName, linked: false, hint: null }
  const anchor = transferAnchorDay(bundle, day.index, -1)
  if (anchor === null) return UNRESOLVED_ENDPOINT
  if (anchor.type === 'transfer') {
    // Section 85: the shared point between two consecutive transfers has ONE
    // source of truth — the earlier transfer's destination. This side is a
    // read-only view of it.
    const upstream = resolveTransferDestinationEndpoint(bundle, anchor)
    return upstream.name === null ? UNRESOLVED_ENDPOINT : { name: upstream.name, linked: true, hint: 'Lié au trajet précédent' }
  }
  const stage = rideStageForDay(bundle, anchor)
  const name = stage?.endLocationName ?? null
  return name === null ? UNRESOLVED_ENDPOINT : { name, linked: true, hint: 'Lié à l’étape précédente' }
}

function resolveTransferDestinationEndpoint(bundle: TripBundle, day: TripDay): ResolvedEndpoint {
  if (day.endLocationName !== null) return { name: day.endLocationName, linked: false, hint: null }
  const anchor = transferAnchorDay(bundle, day.index, 1)
  // Sections 83/86: the next day is another transfer, so this destination IS
  // the intermediate handoff point — nothing in the trip can infer it, and
  // the traveller supplies it here, once, for both transfers.
  if (anchor === null || anchor.type === 'transfer') return UNRESOLVED_ENDPOINT
  const stage = rideStageForDay(bundle, anchor)
  const name = stage?.startLocationName ?? null
  return name === null ? UNRESOLVED_ENDPOINT : { name, linked: true, hint: 'Lié à l’étape suivante' }
}

/**
 * Transfer origin/destination (CDC section 14, generalised by DER-DES-DER
 * sections 74-89): each side is either LINKED to another day of the trip
 * (read-only, resolved here) or MANUAL (the traveller's own input), and
 * never fabricated when genuinely unknown.
 */
export function resolveTransferLocations(bundle: TripBundle, day: TripDay): ResolvedTransferLocations {
  const origin = resolveTransferOriginEndpoint(bundle, day)
  const destination = resolveTransferDestinationEndpoint(bundle, day)
  return {
    origin: origin.name,
    destination: destination.name,
    originAutoFilled: day.startLocationName === null && origin.name !== null,
    destinationAutoFilled: day.endLocationName === null && destination.name !== null,
    originLinked: origin.linked,
    destinationLinked: destination.linked,
    originLinkHint: origin.hint,
    destinationLinkHint: destination.hint,
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
  // Sections 79-81/91: the same chronology `resolveOffLocation` walks, so an
  // OFF day's map marker and its displayed name always agree — a transfer
  // that moved the trip is honoured on both.
  const previous = transferAnchorDay(bundle, day.index, -1)
  const fromPrevious = previous === null
    ? null
    : previous.type === 'transfer'
      ? resolveTransferDestinationCoordinates(bundle, previous)
      : (() => {
          const stage = rideStageForDay(bundle, previous)
          return stage === null ? null : stageEndpointCoordinates(bundle, stage, 'end')
        })()
  if (fromPrevious !== null) return { ...fromPrevious, autoFilled: true }
  const next = transferAnchorDay(bundle, day.index, 1)
  const fromNext = next === null
    ? null
    : next.type === 'transfer'
      ? resolveTransferOriginCoordinates(bundle, next)
      : (() => {
          const stage = rideStageForDay(bundle, next)
          return stage === null ? null : stageEndpointCoordinates(bundle, stage, 'start')
        })()
  return fromNext === null ? null : { ...fromNext, autoFilled: true }
}

export interface ResolvedTransferCoordinates {
  readonly origin: ResolvedCoordinates | null
  readonly destination: ResolvedCoordinates | null
}

/**
 * R2.1 sections 38/40-41 — the transfer counterpart of
 * `resolveOffCoordinates`, one resolution per side, each independently
 * overridable.
 *
 * DER-DES-DER sections 76-88/98: walks the exact same chronology
 * `resolveTransferLocations` does, so a side's coordinates and its NAME
 * always describe the same place — including through a chain of transfers,
 * where an intermediate point's coordinates come from the earlier transfer's
 * own destination override rather than from a ride day two hops away. This
 * is what lets the "Itinéraire" button use real coordinates on both ends
 * (section 98) instead of a text name.
 */
export function resolveTransferCoordinates(bundle: TripBundle, day: TripDay): ResolvedTransferCoordinates {
  return { origin: resolveTransferOriginCoordinates(bundle, day), destination: resolveTransferDestinationCoordinates(bundle, day) }
}

function resolveTransferOriginCoordinates(bundle: TripBundle, day: TripDay): ResolvedCoordinates | null {
  if (day.overrideStartLatitude !== undefined && day.overrideStartLongitude !== undefined) {
    return { latitude: day.overrideStartLatitude, longitude: day.overrideStartLongitude, autoFilled: false }
  }
  const anchor = transferAnchorDay(bundle, day.index, -1)
  if (anchor === null) return null
  if (anchor.type === 'transfer') {
    const upstream = resolveTransferDestinationCoordinates(bundle, anchor)
    return upstream === null ? null : { ...upstream, autoFilled: true }
  }
  const stage = rideStageForDay(bundle, anchor)
  const coordinates = stage === null ? null : stageEndpointCoordinates(bundle, stage, 'end')
  return coordinates === null ? null : { ...coordinates, autoFilled: true }
}

function resolveTransferDestinationCoordinates(bundle: TripBundle, day: TripDay): ResolvedCoordinates | null {
  if (day.overrideEndLatitude !== undefined && day.overrideEndLongitude !== undefined) {
    return { latitude: day.overrideEndLatitude, longitude: day.overrideEndLongitude, autoFilled: false }
  }
  const anchor = transferAnchorDay(bundle, day.index, 1)
  if (anchor === null || anchor.type === 'transfer') return null
  const stage = rideStageForDay(bundle, anchor)
  const coordinates = stage === null ? null : stageEndpointCoordinates(bundle, stage, 'start')
  return coordinates === null ? null : { ...coordinates, autoFilled: true }
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
