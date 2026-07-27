import type { TripDayId, TripDayNumber, TripPlan } from './types.ts'

export type IsoDate = `${number}-${number}-${number}`

export const TRIP_CALENDAR = {
  startDate: '2026-08-12',
  timezone: 'Europe/Paris',
  status: 'confirmed',
} as const satisfies {
  readonly startDate: IsoDate
  readonly timezone: TripPlan['timezone']
  readonly status: 'confirmed'
}

export interface TripCalendarDay {
  readonly dayId: TripDayId
  readonly dayNumber: TripDayNumber
  readonly date: IsoDate
}

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

function parseIsoDate(value: IsoDate): Date {
  const match = ISO_DATE_PATTERN.exec(value)

  if (match === null) {
    throw new Error(`Date ISO invalide : ${value}`)
  }

  const year = Number(match[1])
  const monthIndex = Number(match[2]) - 1
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, monthIndex, day))

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== monthIndex ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`Date ISO invalide : ${value}`)
  }

  return date
}

export function addIsoDays(value: IsoDate, dayOffset: number): IsoDate {
  if (!Number.isInteger(dayOffset)) {
    throw new Error(`Décalage calendaire invalide : ${dayOffset}`)
  }

  const date = parseIsoDate(value)
  date.setUTCDate(date.getUTCDate() + dayOffset)
  return date.toISOString().slice(0, 10) as IsoDate
}

export function differenceInIsoDays(left: IsoDate, right: IsoDate): number {
  return Math.round(
    (parseIsoDate(left).getTime() - parseIsoDate(right).getTime()) / 86_400_000,
  )
}

export function getTripDate(dayNumber: TripDayNumber): IsoDate {
  return addIsoDays(TRIP_CALENDAR.startDate, dayNumber - 1)
}

export function buildTripCalendar(plan: TripPlan): readonly TripCalendarDay[] {
  return plan.days.map((day) => ({
    dayId: day.id,
    dayNumber: day.dayNumber,
    date: getTripDate(day.dayNumber),
  }))
}

export function getDateInTimezone(
  instant: Date,
  timezone: TripPlan['timezone'] = TRIP_CALENDAR.timezone,
): IsoDate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant)
  const values = new Map(parts.map(({ type, value }) => [type, value]))
  const year = values.get('year')
  const month = values.get('month')
  const day = values.get('day')

  if (year === undefined || month === undefined || day === undefined) {
    throw new Error(`Date impossible à calculer dans le fuseau ${timezone}.`)
  }

  return `${year}-${month}-${day}` as IsoDate
}
