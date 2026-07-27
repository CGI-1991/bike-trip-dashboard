import { differenceInIsoDays } from '../trip/calendar.ts'
import type { IsoDate } from '../trip/calendar.ts'
import type { LocalIsoDateTime, WaypointWeather } from './types.ts'

export type WeatherDisplayMode =
  | 'today-reference'
  | 'trend'
  | 'planning'
  | 'operational'
  | 'live'
  | 'past'

export const WEATHER_DISPLAY_THRESHOLDS = {
  planningStartDaysBefore: 7,
  operationalStartDaysBefore: 2,
} as const

export interface WeatherCoverage {
  readonly startDate: IsoDate
  readonly endDate: IsoDate
}

export interface WeatherDisplayModeInput {
  readonly today: IsoDate
  readonly tripDate: IsoDate
  readonly coverage: WeatherCoverage | null
}

/**
 * Builds the actually-received coverage window from whatever dates a provider
 * response (or cache entry) reported. Never assumes a fixed 16-day horizon —
 * only what was genuinely returned counts as "covered".
 */
export function getCoverageFromDates(
  dates: readonly IsoDate[],
): WeatherCoverage | null {
  if (dates.length === 0) {
    return null
  }

  const sorted = [...dates].sort()
  const startDate = sorted[0]
  const endDate = sorted.at(-1)

  if (startDate === undefined || endDate === undefined) {
    return null
  }

  return { startDate, endDate }
}

export function isDateWithinCoverage(
  date: IsoDate,
  coverage: WeatherCoverage,
): boolean {
  return (
    differenceInIsoDays(date, coverage.startDate) >= 0 &&
    differenceInIsoDays(coverage.endDate, date) >= 0
  )
}

export function isTripDateInPast(tripDate: IsoDate, today: IsoDate): boolean {
  return differenceInIsoDays(tripDate, today) < 0
}

export function getNowLocalDateTime(now: Date, timezone: string): LocalIsoDateTime {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const values = new Map(parts.map(({ type, value }) => [type, value]))
  const year = values.get('year')
  const month = values.get('month')
  const day = values.get('day')
  const hour = values.get('hour')
  const minute = values.get('minute')

  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined
  ) {
    throw new Error(`Heure locale impossible à calculer dans le fuseau ${timezone}.`)
  }

  return `${year}-${month}-${day}T${hour}:${minute}` as LocalIsoDateTime
}

/**
 * Decision order matters: coverage is checked before the day-offset bands so a
 * date that day-counting alone would call "operational"/"planning" still falls
 * back to `today-reference` whenever the provider did not actually return data
 * for it (short response, rate limiting, etc.).
 */
export function selectWeatherDisplayMode(
  input: WeatherDisplayModeInput,
): WeatherDisplayMode {
  const dayOffset = differenceInIsoDays(input.tripDate, input.today)

  if (dayOffset < 0) {
    return 'past'
  }

  if (dayOffset === 0) {
    return 'live'
  }

  if (input.coverage === null || !isDateWithinCoverage(input.tripDate, input.coverage)) {
    return 'today-reference'
  }

  if (dayOffset <= WEATHER_DISPLAY_THRESHOLDS.operationalStartDaysBefore) {
    return 'operational'
  }

  if (dayOffset <= WEATHER_DISPLAY_THRESHOLDS.planningStartDaysBefore) {
    return 'planning'
  }

  return 'trend'
}

export interface LiveProgress {
  readonly past: readonly WaypointWeather[]
  readonly next: WaypointWeather | null
  readonly upcoming: readonly WaypointWeather[]
}

/**
 * Purely a theoretical position from configured speed/departure/pauses — there
 * is no GPS tracking, so this only compares each waypoint's ETA against the
 * current local time.
 */
export function computeLiveProgress(
  waypoints: readonly WaypointWeather[],
  nowLocal: LocalIsoDateTime,
): LiveProgress {
  const sorted = [...waypoints].sort((left, right) =>
    left.etaLocal.localeCompare(right.etaLocal),
  )
  const nextIndex = sorted.findIndex((waypoint) => waypoint.etaLocal > nowLocal)

  if (nextIndex === -1) {
    return { past: sorted, next: null, upcoming: [] }
  }

  return {
    past: sorted.slice(0, nextIndex),
    next: sorted[nextIndex] ?? null,
    upcoming: sorted.slice(nextIndex + 1),
  }
}
