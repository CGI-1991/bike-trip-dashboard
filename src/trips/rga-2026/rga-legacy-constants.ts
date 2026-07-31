/**
 * Constants specific to the legacy Route des Grandes Alpes 2026 adapter.
 *
 * Unlike `src/trip-core/`, this module is explicitly allowed — and expected
 * — to hardcode RGA-specific values: it exists solely to migrate that one
 * historical trip into a `TripBundle`.
 */

export const RGA_TRIP_ID = 'rga-2026'
export const RGA_SLUG = 'rga-2026'
export const RGA_NAME = 'Route des Grandes Alpes 2026'
export const RGA_LANGUAGE = 'fr'
export const RGA_TIMEZONE = 'Europe/Paris'

/** The historical trip's first calendar day (`src/trip/calendar.ts`'s `TRIP_CALENDAR.startDate`). */
export const RGA_CALENDAR_START_DATE = '2026-08-12'

export const RGA_DAY_COUNT = 12

/**
 * Fixed migration timestamp — deliberately not `new Date()`/`Date.now()`.
 * Documents when this canonical package and adapter were authored from the
 * legacy pipeline; it must never be regenerated to "now" on a later run.
 */
export const RGA_MIGRATION_TIMESTAMP = '2026-07-31T00:00:00.000Z'

export const RGA_ADAPTER_ENGINE_VERSION = 'rga-legacy-adapter@1'

/**
 * Ride day (legacy id) -> GPX file number, mirroring the private
 * `expectedGpxByRideDay` table in `src/trip/plan.ts`. Numbers skip after J4
 * because J5 and J8 are OFF days with no GPX of their own.
 */
export const RGA_RIDE_DAY_GPX_NUMBER: Readonly<Record<string, number>> = {
  J1: 1,
  J2: 2,
  J3: 3,
  J4: 4,
  J6: 5,
  J7: 6,
  J9: 7,
  J10: 8,
  J11: 9,
  J12: 10,
}

export const RGA_OFF_DAY_LEGACY_IDS: readonly string[] = ['J5', 'J8']

function twoDigits(value: number): string {
  return String(value).padStart(2, '0')
}

/** dayNumber 1 -> `rga-2026-day-01`, ..., 12 -> `rga-2026-day-12`. */
export function genericDayIdValue(dayNumber: number): string {
  return `${RGA_TRIP_ID}-day-${twoDigits(dayNumber)}`
}

/** `J1` -> `rga-2026-stage-j01` (only ever called for a ride day). */
export function genericStageIdValue(legacyDayId: string): string {
  return `${RGA_TRIP_ID}-stage-${legacyDayId.toLowerCase()}`
}

/** GPX file number 1 -> `rga-2026-source-01`. */
export function genericSourceFileIdValue(gpxNumber: number): string {
  return `${RGA_TRIP_ID}-source-${twoDigits(gpxNumber)}`
}

/** GPX file number 1 -> `rga-2026-route-01`. */
export function genericRouteIdValue(gpxNumber: number): string {
  return `${RGA_TRIP_ID}-route-${twoDigits(gpxNumber)}`
}
