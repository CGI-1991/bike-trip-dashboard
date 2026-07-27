import type { RouteClockTime } from './types.ts'

const minutesPerDay = 24 * 60

function validateRouteClockTime(value: RouteClockTime): void {
  if (
    !Number.isFinite(value.totalMinutesFromDeparture) ||
    value.totalMinutesFromDeparture < 0 ||
    !Number.isSafeInteger(value.clockMinutes) ||
    value.clockMinutes < 0 ||
    value.clockMinutes >= minutesPerDay ||
    !Number.isSafeInteger(value.dayOffset) ||
    value.dayOffset < 0
  ) {
    throw new Error('Heure relative à la journée invalide.')
  }
}

export function createRouteClockTime(
  departureClockMinutes: number,
  totalMinutesFromDeparture: number,
): RouteClockTime {
  if (
    !Number.isSafeInteger(departureClockMinutes) ||
    departureClockMinutes < 0 ||
    departureClockMinutes >= minutesPerDay
  ) {
    throw new Error('Heure de départ numérique invalide.')
  }

  if (
    !Number.isFinite(totalMinutesFromDeparture) ||
    totalMinutesFromDeparture < 0
  ) {
    throw new Error('Durée écoulée invalide.')
  }

  const roundedAbsoluteMinutes = Math.round(
    departureClockMinutes + totalMinutesFromDeparture,
  )

  if (!Number.isSafeInteger(roundedAbsoluteMinutes)) {
    throw new Error('Heure absolue de la journée invalide.')
  }

  return {
    totalMinutesFromDeparture,
    clockMinutes: roundedAbsoluteMinutes % minutesPerDay,
    dayOffset: Math.floor(roundedAbsoluteMinutes / minutesPerDay),
  }
}

function formatClockMinutes(clockMinutes: number): string {
  const hours = Math.floor(clockMinutes / 60)
  const minutes = clockMinutes % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

export function formatRouteClockTime(value: RouteClockTime): string {
  validateRouteClockTime(value)
  const clock = formatClockMinutes(value.clockMinutes)
  return value.dayOffset === 0 ? clock : `${clock} (+${value.dayOffset} j)`
}

export function describeRouteClockTime(value: RouteClockTime): string {
  validateRouteClockTime(value)
  const clock = formatClockMinutes(value.clockMinutes)

  if (value.dayOffset === 0) {
    return clock
  }

  return value.dayOffset === 1
    ? `${clock}, le lendemain`
    : `${clock}, ${value.dayOffset} jours plus tard`
}
