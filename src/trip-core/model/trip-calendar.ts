import type { IanaTimezone, IsoDate } from './common.ts'

/**
 * The trip's calendar. Both dates and the timezone may be null: a trip can
 * exist purely as a sequence of days with no calendar attached yet (CDC
 * section 16.1 — express mode, no date). When `startDate`/`endDate` are both
 * set, `endDate` must not be before `startDate` (enforced by the validator,
 * not by this type).
 */
export interface TripCalendar {
  readonly startDate: IsoDate | null
  readonly endDate: IsoDate | null
  readonly timezone: IanaTimezone | null
}
