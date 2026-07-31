/**
 * Generic entity identifiers for TripBundle v1.
 *
 * These stay plain strings at runtime (per the CDC's phase 2 guidance: avoid a
 * branded-type system heavy enough to burden fixtures and migrations). The
 * brand only exists at the type level, so TypeScript still rejects passing a
 * `RouteId` where a `ClimbId` is expected, but the cast back to `string` (or
 * from a raw string via the `*Id` helper functions below) is free and
 * unconditional.
 */

declare const idBrand: unique symbol

type Id<Name extends string> = string & { readonly [idBrand]: Name }

export type TripId = Id<'TripId'>
export type TripDayId = Id<'TripDayId'>
export type RideStageId = Id<'RideStageId'>
export type SourceFileId = Id<'SourceFileId'>
export type RouteId = Id<'RouteId'>
export type ClimbId = Id<'ClimbId'>
export type RoutePointId = Id<'RoutePointId'>
export type PracticalPlaceId = Id<'PracticalPlaceId'>
export type AccommodationId = Id<'AccommodationId'>
export type WeatherRecordId = Id<'WeatherRecordId'>
export type OverrideId = Id<'OverrideId'>

function castId<T extends string>(value: string): Id<T> {
  return value as Id<T>
}

export const tripId = (value: string): TripId => castId(value)
export const tripDayId = (value: string): TripDayId => castId(value)
export const rideStageId = (value: string): RideStageId => castId(value)
export const sourceFileId = (value: string): SourceFileId => castId(value)
export const routeId = (value: string): RouteId => castId(value)
export const climbId = (value: string): ClimbId => castId(value)
export const routePointId = (value: string): RoutePointId => castId(value)
export const practicalPlaceId = (value: string): PracticalPlaceId => castId(value)
export const accommodationId = (value: string): AccommodationId => castId(value)
export const weatherRecordId = (value: string): WeatherRecordId => castId(value)
export const overrideId = (value: string): OverrideId => castId(value)
