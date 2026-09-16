/**
 * "Étapes liées" — several consecutive GPX stages ridden on one and the
 * same calendar day (Course/Tour mode).
 *
 * Everything here is pure: a bundle in, a bundle out, no storage, no DOM,
 * no clock. The structural truth lives in exactly one field
 * (`TripDay.sameCalendarDayAsPrevious`), and the calendar consequences fall
 * out of `trip-core/calendar/day-offsets.ts` — this module owns only the
 * three things that field alone cannot express:
 *
 *  - which days form a group, and which of them is its head;
 *  - the group's single lodging (merge, split, and the explicit choice a
 *    genuine conflict requires — never a silent overwrite);
 *  - the group's schedule (initial departure times when a link is created,
 *    then conflict resolution when an ETA later moves).
 *
 * Timing NEVER gets a second engine: every ETA below comes from
 * `computeRideArrivalEta`, the same `computeStageWaypoints` pipeline the
 * Voyage cards and the Détail screen already display.
 */

import { computeRideArrivalEta } from './trip-day-temporal-state.ts'
import { parseClockToMinutes } from '../analysis/timing.ts'
import type { Accommodation, AccommodationId, TripBundle, TripDay, TripDayId } from '../trip-core/index.ts'

/** Default departure time used when a day carries no explicit one — the same value every other consumer falls back to. */
export const DEFAULT_DEPARTURE_TIME = '08:00'

/** Minutes of slack proposed between one stage's ETA and the next stage's departure WHEN A LINK IS CREATED. Never a minimum enforced afterwards (CDC section 4.A). */
export const LINKED_STAGE_INITIAL_GAP_MINUTES = 60

const QUARTER_HOUR_MINUTES = 15
const MINUTES_PER_DAY = 24 * 60

/** Smallest quarter-hour at or after `minutes`. A value already on a quarter is returned unchanged (CDC: "Une heure déjà sur un quart d'heure reste inchangée"). */
export function ceilToQuarterHour(minutes: number): number {
  return Math.ceil(minutes / QUARTER_HOUR_MINUTES) * QUARTER_HOUR_MINUTES
}

/** `HH:MM` for a minutes-from-midnight value. Returns `null` past midnight rather than silently wrapping back to 00:00 (CDC section 4.B). */
export function formatDayMinutes(minutes: number): string | null {
  if (!Number.isFinite(minutes) || minutes < 0 || minutes >= MINUTES_PER_DAY) return null
  const rounded = Math.round(minutes)
  return `${String(Math.floor(rounded / 60)).padStart(2, '0')}:${String(rounded % 60).padStart(2, '0')}`
}

/**
 * The departure time proposed for a stage the moment it BECOMES linked
 * (CDC section 4.A): the previous stage's ETA plus one hour, rounded up to
 * the next quarter-hour — ETA 12:07 → 13:15, and an ETA already landing on
 * a quarter keeps its exact +1 h. `null` past midnight.
 *
 * Pure and exported on its own so the rule can be checked directly, and so
 * it is stated once rather than inlined at its single call site.
 */
export function initialDepartureAfter(previousArrivalMinutes: number): string | null {
  return formatDayMinutes(ceilToQuarterHour(previousArrivalMinutes + LINKED_STAGE_INITIAL_GAP_MINUTES))
}

/**
 * The one conflict rule (CDC section 4.B). A conflict exists ONLY when the
 * departure is strictly earlier than the previous stage's ETA:
 *
 * - equal is accepted;
 * - less than an hour of slack is accepted — the initial hour was a
 *   proposal, never a minimum to maintain;
 * - an ETA that merely moved earlier never drags the next departure with
 *   it, because a larger gap is not a conflict.
 *
 * The repair is the first quarter-hour at or after that ETA — never a
 * restored hour of slack. Returns `null` when there is nothing to change,
 * and `'overflow'` when the previous stage only arrives after midnight, so
 * no same-day departure can work at all.
 */
export function resolveDepartureConflict(previousArrivalMinutes: number, departureMinutes: number): { readonly repairedTime: string } | 'overflow' | null {
  if (departureMinutes >= previousArrivalMinutes) return null
  const repairedTime = formatDayMinutes(ceilToQuarterHour(previousArrivalMinutes))
  return repairedTime === null ? 'overflow' : { repairedTime }
}

// --- groups -----------------------------------------------------------------

export interface LinkedDayGroup {
  readonly headDayId: TripDayId
  /** Always at least 2 entries — a lone day is not a group. In ascending `index` order. */
  readonly dayIds: readonly TripDayId[]
}

function orderedDays(bundle: TripBundle): readonly TripDay[] {
  return [...bundle.days].sort((left, right) => left.index - right.index)
}

/** `true` when this day is genuinely linked to the one before it (the flag alone is not enough — only two consecutive ride days may form a group). */
function isLinkedToPrevious(days: readonly TripDay[], position: number): boolean {
  const day = days[position]
  const previous = position === 0 ? undefined : days[position - 1]
  return day !== undefined && previous !== undefined && day.sameCalendarDayAsPrevious === true && day.type === 'ride' && previous.type === 'ride'
}

/** Every day's group, as runs of consecutive days, singletons included — the internal shape the public helpers below narrow down. */
function allRuns(days: readonly TripDay[]): readonly (readonly TripDay[])[] {
  const runs: TripDay[][] = []
  days.forEach((day, position) => {
    if (position > 0 && isLinkedToPrevious(days, position)) (runs[runs.length - 1] as TripDay[]).push(day)
    else runs.push([day])
  })
  return runs
}

/** Only the real groups (2+ stages sharing one calendar day), in trip order. */
export function linkedDayGroups(bundle: TripBundle): readonly LinkedDayGroup[] {
  return allRuns(orderedDays(bundle))
    .filter((run) => run.length > 1)
    .map((run) => ({ headDayId: (run[0] as TripDay).id, dayIds: run.map((day) => day.id) }))
}

/** The whole group `dayId` belongs to — a single-entry list when it is not linked to anything. `[]` for an unknown day. */
export function groupDayIdsFor(bundle: TripBundle, dayId: TripDayId): readonly TripDayId[] {
  const run = allRuns(orderedDays(bundle)).find((candidate) => candidate.some((day) => day.id === dayId))
  return run === undefined ? [] : run.map((day) => day.id)
}

/** The day that owns the group's shared date and lodging — `dayId` itself when it is not linked. */
export function groupHeadDayId(bundle: TripBundle, dayId: TripDayId): TripDayId {
  return groupDayIdsFor(bundle, dayId)[0] ?? dayId
}

// --- departure-time helpers -------------------------------------------------

/**
 * How a stage is named in a message about a GROUP: its own départ →
 * arrivée, or the traveller's own stage name when there is one. A J number
 * would not do — every stage of a group shares it.
 */
function stageLabelFor(bundle: TripBundle, dayId: TripDayId): string {
  const day = bundle.days.find((candidate) => candidate.id === dayId)
  const stage = day?.stageId === null || day?.stageId === undefined ? undefined : bundle.stages.find((candidate) => candidate.id === day.stageId)
  const customName = stage?.customName?.trim()
  if (customName !== undefined && customName !== '') return customName
  if (stage === undefined) return 'Étape'
  return `${stage.startLocationName ?? '—'} → ${stage.endLocationName ?? '—'}`
}

export function dayDepartureTime(bundle: TripBundle, dayId: TripDayId): string {
  return bundle.settings.days.find((entry) => entry.dayId === dayId)?.departureTime ?? DEFAULT_DEPARTURE_TIME
}

/** Replaces exactly one day's departure time, preserving its own `totalBreakSeconds` and every other day's entry — the same idiom `trips-manager.ts::saveDayDepartureTime` uses. */
export function withDayDepartureTime(bundle: TripBundle, dayId: TripDayId, departureTime: string): TripBundle {
  const existing = bundle.settings.days.find((entry) => entry.dayId === dayId)
  const days = bundle.settings.days.filter((entry) => entry.dayId !== dayId)
  days.push({ dayId, departureTime, totalBreakSeconds: existing?.totalBreakSeconds ?? null })
  return { ...bundle, settings: { ...bundle.settings, days } }
}

/**
 * Minutes-from-that-day's-midnight at which this stage is expected to
 * arrive — the existing ETA pipeline's own value, which legitimately
 * exceeds 24 h when the ride spills past midnight (that is exactly what
 * makes the "same day" incompatibility below detectable instead of silently
 * wrapping). `null` when no ETA can be computed at all.
 */
function arrivalMinutes(bundle: TripBundle, dayId: TripDayId): number | null {
  const day = bundle.days.find((candidate) => candidate.id === dayId)
  if (day === undefined) return null
  return computeRideArrivalEta(bundle, day)?.minutesFromDayStart ?? null
}

// --- A. initialisation when a link is created -------------------------------

/**
 * CDC section 4.A. For every stage that has JUST become linked to its
 * predecessor (it carries the flag in `next` but did not in `previous`),
 * proposes a coherent starting point: the previous stage's ETA plus one
 * hour, rounded up to the next quarter-hour (ETA 12:07 → 13:15). Applied
 * sequentially, so a group of three cascades correctly.
 *
 * Deliberately restricted to NEWLY linked stages: adding a third stage to
 * an existing pair must not silently overwrite the departure time the
 * traveller already adjusted on the second one. The group's first stage is
 * never touched — it keeps its own time, or the usual default.
 *
 * The extra hour is a starting proposal only, never a minimum kept
 * afterwards (that is section 4.B's job, and it enforces nothing but
 * "not before the previous ETA").
 */
export function initializeLinkedGroupDepartures(previous: TripBundle | null, next: TripBundle): TripBundle {
  const previousOrdered = previous === null ? [] : orderedDays(previous)
  const wasLinked = new Set(
    previousOrdered.filter((_day, position) => isLinkedToPrevious(previousOrdered, position)).map((day) => day.id),
  )

  let bundle = next
  for (const group of linkedDayGroups(next)) {
    for (let position = 1; position < group.dayIds.length; position++) {
      const dayId = group.dayIds[position] as TripDayId
      if (wasLinked.has(dayId)) continue
      const previousArrival = arrivalMinutes(bundle, group.dayIds[position - 1] as TripDayId)
      if (previousArrival === null) continue
      const proposed = initialDepartureAfter(previousArrival)
      // Past midnight there is no same-day time to propose — left untouched
      // and reported by `resolveLinkedScheduleConflicts` instead of wrapped.
      if (proposed === null) continue
      bundle = withDayDepartureTime(bundle, dayId, proposed)
    }
  }
  return bundle
}

// --- B. conflict resolution -------------------------------------------------

export interface LinkedScheduleAdjustment {
  readonly dayId: TripDayId
  /** The stage's own départ → arrivée — every stage of a group shares one J number, so only this identifies which one moved. */
  readonly stageLabel: string
  readonly from: string
  readonly to: string
}

export interface LinkedScheduleOverflow {
  readonly dayId: TripDayId
  readonly stageLabel: string
}

export interface LinkedScheduleResult {
  readonly bundle: TripBundle
  readonly adjustments: readonly LinkedScheduleAdjustment[]
  /** Stages of a group whose ETA lands past midnight — the group cannot hold them all on one day (CDC section 4.B). */
  readonly overflows: readonly LinkedScheduleOverflow[]
}

/**
 * CDC section 4.B. Walks every group in order and only ever touches a
 * departure time that is in STRICT conflict — i.e. earlier than the
 * previous stage's ETA. Equal is accepted, less than an hour of slack is
 * accepted, and an ETA that merely moved earlier never drags the next
 * departure with it.
 *
 * A conflicting departure is pushed to the first quarter-hour at or after
 * the previous ETA — never back to a full hour of slack — then that stage's
 * own ETA is recomputed (same engine, no second model) and the rest of the
 * group re-checked, so a change only propagates as far as it genuinely has
 * to.
 */
export function resolveLinkedScheduleConflicts(bundle: TripBundle): LinkedScheduleResult {
  const adjustments: LinkedScheduleAdjustment[] = []
  const overflows: LinkedScheduleOverflow[] = []
  let next = bundle

  for (const group of linkedDayGroups(bundle)) {
    let previousArrival: number | null = null
    for (const dayId of group.dayIds) {
      const day = next.days.find((candidate) => candidate.id === dayId)
      if (day === undefined) continue
      const currentTime = dayDepartureTime(next, dayId)
      const conflict = previousArrival === null ? null : resolveDepartureConflict(previousArrival, parseClockToMinutes(currentTime))
      if (conflict === 'overflow') {
        // The previous stage already finishes after midnight: there is no
        // compatible same-day departure to offer. Reported, never guessed.
        overflows.push({ dayId, stageLabel: stageLabelFor(next, dayId) })
      } else if (conflict !== null) {
        next = withDayDepartureTime(next, dayId, conflict.repairedTime)
        adjustments.push({ dayId, stageLabel: stageLabelFor(next, dayId), from: currentTime, to: conflict.repairedTime })
      }
      const arrival = arrivalMinutes(next, dayId)
      if (arrival !== null && arrival >= MINUTES_PER_DAY && !overflows.some((entry) => entry.dayId === dayId)) {
        overflows.push({ dayId, stageLabel: stageLabelFor(next, dayId) })
      }
      previousArrival = arrival
    }
  }

  return { bundle: next, adjustments, overflows }
}

/**
 * The first departure time that would NOT conflict for `dayId` — `null`
 * when the day has no linked predecessor (anything goes), or when the
 * predecessor's ETA is past midnight (nothing same-day can work). Used by
 * the departure-time dialog to explain a rejected entry and offer a
 * compatible one instead of silently saving something else.
 */
export function earliestCompatibleDeparture(bundle: TripBundle, dayId: TripDayId): string | null {
  const group = groupDayIdsFor(bundle, dayId)
  const position = group.indexOf(dayId)
  if (position <= 0) return null
  const previousArrival = arrivalMinutes(bundle, group[position - 1] as TripDayId)
  if (previousArrival === null) return null
  return formatDayMinutes(ceilToQuarterHour(previousArrival))
}

/** The previous stage's ETA in minutes from that day's midnight — `null` when this day has no linked predecessor or no computable ETA. Exposed for the departure dialog's own conflict message. */
export function previousLinkedArrivalMinutes(bundle: TripBundle, dayId: TripDayId): number | null {
  const group = groupDayIdsFor(bundle, dayId)
  const position = group.indexOf(dayId)
  if (position <= 0) return null
  return arrivalMinutes(bundle, group[position - 1] as TripDayId)
}

// --- lodging ----------------------------------------------------------------

export interface LinkedLodgingOption {
  readonly dayId: TripDayId
  readonly stageLabel: string
  readonly accommodationId: AccommodationId
  readonly accommodationName: string
}

export interface LinkedLodgingConflict {
  readonly headDayId: TripDayId
  /** Two or more genuinely different lodgings competing for one group — the user must pick, nothing is overwritten silently. */
  readonly options: readonly LinkedLodgingOption[]
}

function lodgingOptionsFor(bundle: TripBundle, dayIds: readonly TripDayId[]): readonly LinkedLodgingOption[] {
  const options: LinkedLodgingOption[] = []
  for (const dayId of dayIds) {
    const day = bundle.days.find((candidate) => candidate.id === dayId)
    if (day === undefined || day.accommodationId === null) continue
    if (options.some((option) => option.accommodationId === day.accommodationId)) continue
    const accommodation = bundle.accommodations.find((candidate) => candidate.id === day.accommodationId)
    options.push({
      dayId,
      stageLabel: stageLabelFor(bundle, dayId),
      accommodationId: day.accommodationId,
      accommodationName: accommodation?.name ?? 'Hébergement',
    })
  }
  return options
}

/**
 * Groups whose members carry two or more DIFFERENT lodgings. Computed
 * against a hypothetical grouping (the editor calls it on a draft), so the
 * question can be asked at the moment the link is created rather than
 * discovered after a save.
 */
export function detectLinkedLodgingConflicts(bundle: TripBundle): readonly LinkedLodgingConflict[] {
  return linkedDayGroups(bundle)
    .map((group) => ({ headDayId: group.headDayId, options: lodgingOptionsFor(bundle, group.dayIds) }))
    .filter((conflict) => conflict.options.length > 1)
}

function prunedAccommodations(bundle: TripBundle): TripBundle {
  const referenced = new Set(bundle.days.flatMap((day) => (day.accommodationId === null ? [] : [day.accommodationId])))
  if (bundle.accommodations.every((accommodation) => referenced.has(accommodation.id))) return bundle
  return { ...bundle, accommodations: bundle.accommodations.filter((accommodation) => referenced.has(accommodation.id)) }
}

function withDayAccommodation(bundle: TripBundle, dayId: TripDayId, accommodationId: AccommodationId | null): TripBundle {
  return { ...bundle, days: bundle.days.map((day) => (day.id === dayId ? { ...day, accommodationId } : day)) }
}

/**
 * Brings every group's lodging back to exactly one record, held by the
 * group's head (which is where `resolveSharedInfoDayId` makes the whole
 * group read and edit it).
 *
 * Three cases, in this order:
 *
 *  1. **A group was split.** A day that is a head in `next` but was a
 *     linked member in `previous` keeps the lodging it used to share: the
 *     old head's record is DUPLICATED onto it (a fresh id, same content),
 *     so both sub-groups start from the same booking and diverge freely
 *     afterwards. Never moved — the other sub-group would lose it.
 *  2. **A single lodging for the group.** It simply becomes the head's.
 *  3. **Several different lodgings.** `resolutions` says which one to
 *     keep, keyed by the group's head. With no resolution the head's own
 *     (else the first) is kept — but the editor always asks first, so this
 *     is a fallback, never the normal path.
 *
 * Records no day references any more are pruned, exactly like
 * `mergeEditedTripBundle` already does.
 */
export function consolidateLinkedLodging(
  previous: TripBundle,
  next: TripBundle,
  resolutions: ReadonlyMap<TripDayId, AccommodationId>,
  idFactory: () => string,
): TripBundle {
  let bundle = next
  const extraAccommodations: Accommodation[] = []

  // 1. split restoration
  const previousLodgingByDayId = new Map<TripDayId, AccommodationId>()
  allRuns(orderedDays(previous)).forEach((run) => {
    const head = run[0]
    if (head === undefined || head.accommodationId === null) return
    for (const day of run) previousLodgingByDayId.set(day.id, head.accommodationId as AccommodationId)
  })

  for (const run of allRuns(orderedDays(bundle))) {
    const head = run[0]
    if (head === undefined || head.accommodationId !== null) continue
    const previousHeadAccommodationId = previousLodgingByDayId.get(head.id)
    if (previousHeadAccommodationId === undefined) continue
    // Only a genuine detachment: the day used to inherit a lodging it did
    // not own, and does not own one now.
    const source = previous.accommodations.find((candidate) => candidate.id === previousHeadAccommodationId)
    if (source === undefined) continue
    const duplicated: Accommodation = { ...source, id: idFactory() as AccommodationId }
    extraAccommodations.push(duplicated)
    bundle = withDayAccommodation(bundle, head.id, duplicated.id)
  }
  if (extraAccommodations.length > 0) {
    bundle = { ...bundle, accommodations: [...bundle.accommodations, ...extraAccommodations] }
  }

  // 2/3. one lodging per group, held by its head
  for (const group of linkedDayGroups(bundle)) {
    const options = lodgingOptionsFor(bundle, group.dayIds)
    if (options.length === 0) continue
    const resolved = resolutions.get(group.headDayId)
    const kept = options.find((option) => option.accommodationId === resolved)
      ?? options.find((option) => option.dayId === group.headDayId)
      ?? (options[0] as LinkedLodgingOption)
    for (const dayId of group.dayIds) {
      bundle = withDayAccommodation(bundle, dayId, dayId === group.headDayId ? kept.accommodationId : null)
    }
  }

  return prunedAccommodations(bundle)
}
