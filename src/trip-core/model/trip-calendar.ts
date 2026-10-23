import type { IanaTimezone, IsoDate } from './common.ts'

/**
 * The trip's calendar — the single operational source of truth for the
 * trip's dates and timezone. `TripMetadata.startDate`/`endDate`/`timezone`
 * (see `trip-metadata.ts`) are a required, always-consistent projection of
 * these same three fields, not a second independent source: the validator
 * rejects any bundle where they disagree.
 *
 * v1 supports exactly two calendar states, with no ambiguous partial state
 * in between:
 * - **undated**: `startDate`, `endDate` and `timezone` are all `null`, and
 *   every `TripDay.date` is `null` too (CDC section 16.1 — express mode, no
 *   date yet);
 * - **dated**: all three fields are set, `endDate` is not before `startDate`,
 *   Voyage/Tour dates follow their civil-day offsets (linked stages can
 *   share a date). League dates are explicit and independent, sorted by
 *   date/departure; start/end are their envelope, without invented OFF days.
 *
 * A trip with only some of these fields set (e.g. `startDate` without
 * `endDate`/`timezone`, or a day date while the calendar itself is still
 * undated) is rejected by the validator rather than treated as a supported
 * "partially dated" mode.
 */
export interface TripCalendar {
  readonly startDate: IsoDate | null
  readonly endDate: IsoDate | null
  readonly timezone: IanaTimezone | null
}
