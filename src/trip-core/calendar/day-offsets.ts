/**
 * The single source of truth for "how many civil days after
 * `calendar.startDate` does day N happen".
 *
 * Until linked stages existed, that answer was always `day.index` — one day
 * of the trip, one day of the calendar — and every date-assigning site
 * simply wrote `addCivilDays(startDate, index)` by hand. `TripDay.
 * sameCalendarDayAsPrevious` (two or more ride stages ridden on the SAME
 * date, Course/Tour mode) breaks that identity: the offset stops advancing
 * across a linked day, so index and calendar offset diverge from the first
 * link onwards.
 *
 * Rather than teach four call sites the same arithmetic, they all call this
 * module — the validator, the import/structural day-structure builder and
 * the start-date shift included — so a bundle can never be written with
 * dates the validator would then reject (or vice versa).
 *
 * Pure: no dates are parsed or formatted here, only offsets counted. A
 * trip with no link at all returns `[0, 1, 2, …]`, i.e. exactly the
 * historical `index` arithmetic, which is what makes this purely additive.
 */

/** Everything this module needs from a day — deliberately structural, so the validator can call it on not-yet-typed records. */
export interface CalendarOffsetDayLike {
  readonly sameCalendarDayAsPrevious?: unknown
}

/**
 * Civil-day offset from `calendar.startDate` for every day, in the array's
 * own order (which is always ascending `index` — `validateTripBundle`
 * enforces that separately).
 *
 * The flag is read verbatim, without checking whether it is legally placed
 * (only a `ride` day preceded by a `ride` day may carry it): an illegally
 * placed flag is reported once, by the validator's own dedicated check,
 * rather than a second time as a confusing date mismatch.
 */
export function calendarDayOffsets(days: readonly CalendarOffsetDayLike[]): readonly number[] {
  const offsets: number[] = []
  let offset = 0
  days.forEach((day, index) => {
    if (index > 0 && day.sameCalendarDayAsPrevious !== true) offset += 1
    offsets.push(offset)
  })
  return offsets
}

/** Offset of the trip's last day — i.e. `calendar.endDate = startDate + this`. `0` for an empty day list. */
export function lastCalendarDayOffset(days: readonly CalendarOffsetDayLike[]): number {
  const offsets = calendarDayOffsets(days)
  return offsets[offsets.length - 1] ?? 0
}

/** How many distinct calendar dates the trip actually spans (never fewer than the number of days once nothing is linked). */
export function calendarDaySpan(days: readonly CalendarOffsetDayLike[]): number {
  return days.length === 0 ? 0 : lastCalendarDayOffset(days) + 1
}
