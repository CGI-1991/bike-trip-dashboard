import type { ValidationIssue } from './types.ts'

export function issue(path: string, code: string, message: string): ValidationIssue {
  return { path, code, message }
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

export function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean'
}

export function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

/** Like `isStringArray`, but also rejects an empty-string entry (e.g. a blank parsing error). */
export function isNonEmptyStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => isNonEmptyString(item))
}

export function isOneOf<T extends string>(value: unknown, options: readonly T[]): value is T {
  return typeof value === 'string' && (options as readonly string[]).includes(value)
}

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = ISO_DATE_PATTERN.exec(value)
  if (match === null) return false
  const year = Number(match[1])
  const monthIndex = Number(match[2]) - 1
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, monthIndex, day))
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === monthIndex &&
    date.getUTCDate() === day
  )
}

export function isIsoDateTime(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && Number.isFinite(Date.parse(value))
}

export function isLatitude(value: unknown): value is number {
  return isFiniteNumber(value) && value >= -90 && value <= 90
}

export function isLongitude(value: unknown): value is number {
  return isFiniteNumber(value) && value >= -180 && value <= 180
}

export function isNonNegativeNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0
}

export function isPositiveNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0
}

export function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0
}

export function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0
}

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function isSlug(value: unknown): value is string {
  return typeof value === 'string' && SLUG_PATTERN.test(value)
}

const TIME_OF_DAY_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/

export function isTimeOfDay(value: unknown): value is string {
  return typeof value === 'string' && TIME_OF_DAY_PATTERN.test(value)
}

const SHA256_HEX_PATTERN = /^[0-9a-fA-F]{64}$/

/** Exactly 64 hexadecimal characters (either case) — never an arbitrary non-empty string. */
export function isSha256Hex(value: unknown): value is string {
  return typeof value === 'string' && SHA256_HEX_PATTERN.test(value)
}

/**
 * Adds `dayOffset` civil days to an ISO date (`YYYY-MM-DD`), anchored in UTC
 * so the arithmetic never depends on the host machine's timezone or on DST
 * transitions. `isoDate` must already be a validated ISO date (see
 * `isIsoDate`) — this throws otherwise, since it is only ever called after
 * that guard in `validateTripBundle`.
 */
export function addCivilDays(isoDate: string, dayOffset: number): string {
  const match = ISO_DATE_PATTERN.exec(isoDate)
  if (match === null) {
    throw new Error(`addCivilDays: not a valid ISO date: ${isoDate}`)
  }
  const year = Number(match[1])
  const monthIndex = Number(match[2]) - 1
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, monthIndex, day))
  date.setUTCDate(date.getUTCDate() + dayOffset)
  return date.toISOString().slice(0, 10)
}

/** Best-effort IANA timezone check — skipped (never fails) where the runtime lacks the data. */
export function isKnownIanaTimezone(value: string): boolean {
  try {
    if (typeof Intl.supportedValuesOf === 'function') {
      return Intl.supportedValuesOf('timeZone').includes(value)
    }
  } catch {
    // Environment does not support the timezone registry query — fall through to the
    // permissive formatter-based check below rather than rejecting a possibly-valid value.
  }
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: value })
    return true
  } catch {
    return false
  }
}
