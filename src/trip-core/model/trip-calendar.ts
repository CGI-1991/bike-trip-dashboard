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
 *   every `TripDay.date` equals `startDate` plus that day's `index` in civil
 *   days (timezone-independent arithmetic — see `addCivilDays` in
 *   `validation/primitives.ts`), and the last day's date equals `endDate`.
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
