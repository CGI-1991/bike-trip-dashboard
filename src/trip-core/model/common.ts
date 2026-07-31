/**
 * Shared canonical representations used across the TripBundle v1 model.
 *
 * Units are fixed and never mixed: kilometers, meters, seconds, km/h, degrees.
 * A UI layer may still offer an imperial *display* preference (see
 * `TripMetadata.units` in `trip-metadata.ts`); it converts at render time and
 * never changes what is stored here.
 */

/** Civil date, e.g. `2027-04-01`. No time, no timezone. */
export type IsoDate = `${number}-${number}-${number}`

/** Absolute instant, ISO 8601 with an explicit offset or `Z`. */
export type IsoDateTime = string

/** IANA timezone identifier, e.g. `Europe/Brussels`. */
export type IanaTimezone = string

/** Kilometers. */
export type Kilometers = number

/** Meters (altitude, elevation gain/loss). */
export type Meters = number

/** Seconds (durations). */
export type Seconds = number

/** Kilometers per hour. */
export type KilometersPerHour = number

/** Percentage as a plain number (12.5 means 12.5%, never 0.125). */
export type Percent = number

/** Degrees of latitude, in [-90, 90]. */
export type LatitudeDegrees = number

/** Degrees of longitude, in [-180, 180]. */
export type LongitudeDegrees = number

/**
 * Explicit absence, used wherever the CDC calls for a value that is part of
 * the business contract rather than merely not-yet-set (see the model's
 * null/undefined convention in the phase 2 report). Never `undefined` for
 * these fields, and never a missing property.
 */
export type Nullable<T> = T | null

/** Common lifecycle status for anything analyzed/parsed from a source file. */
export type ParsingStatus = 'pending' | 'success' | 'partial' | 'error'

/** Confidence level attached to an automatically detected or enriched value. */
export type ConfidenceLevel = 'high' | 'medium' | 'low'
