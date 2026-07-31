/**
 * Pure conversions between `TripBundle` and the normalized records this
 * module stores in IndexedDB. Nothing here touches IndexedDB, the DOM, or
 * any global — `toTripRecordSet`/`fromTripRecordSet` are deterministic pure
 * functions over plain data, independently unit-tested in
 * `tests/storage/indexeddb/records.test.mjs` with no database involved.
 *
 * Every record type is a structured-clone-safe plain object: no functions,
 * no class instances, no Map/Set, no DOM references. Each per-collection
 * record carries the owning `tripId` (CDC section 6/7) plus, where the
 * business entity itself has no inherent ordering field, a `sequence`
 * ordinal capturing its exact position in the original `TripBundle` array —
 * IndexedDB gives no ordering guarantee across rows sharing the same
 * indexed `tripId`, so `sequence` is what lets `fromTripRecordSet`
 * reconstruct the original array order deterministically and exactly
 * (needed for the "reload deepEquals the original bundle" contract, not
 * merely for `validateTripBundle` to accept the result). `TripDay` already
 * has such a field (`index`, contiguous from 0 and validator-enforced), so
 * its record adds only `tripId` — no redundant second ordinal.
 */

import type {
  Accommodation,
  Climb,
  PracticalPlace,
  RideStage,
  Route,
  RouteGeometry,
  RoutePoint,
  SourceFile,
  TripBundle,
  TripCalendar,
  TripDay,
  TripEnrichmentMetadata,
  TripGeneratedMetadata,
  TripId,
  TripMetadata,
  TripOverride,
  TripSettings,
  WeatherRecord,
} from '../../trip-core/index.ts'

/** The `trips` store's record — the non-collectional root only (CDC section 5). */
export interface TripRootRecord {
  readonly id: TripId
  readonly schemaVersion: TripBundle['schemaVersion']
  readonly metadata: TripMetadata
  readonly calendar: TripCalendar
  readonly enrichmentMetadata: TripEnrichmentMetadata
  readonly generatedMetadata: TripGeneratedMetadata
}

/** The `tripSettings` store's record — one singleton per trip. */
export interface TripSettingsRecord extends TripSettings {
  readonly tripId: TripId
}

export interface SourceFileRecord extends SourceFile {
  readonly tripId: TripId
  readonly sequence: number
}

/** The `tripDays` store's record. Ordered on read by its own `index`, not a separate `sequence`. */
export interface TripDayRecord extends TripDay {
  readonly tripId: TripId
}

export interface RideStageRecord extends RideStage {
  readonly tripId: TripId
  readonly sequence: number
}

/** The `routes` store's record — a `Route` minus its (potentially large) `geometry`, stored separately. */
export interface RouteRecord extends Omit<Route, 'geometry'> {
  readonly tripId: TripId
  readonly sequence: number
}

/** The `routeGeometries` store's record — one per route that actually has a geometry (never a null placeholder row). */
export interface RouteGeometryRecord {
  readonly tripId: TripId
  readonly id: Route['id']
  readonly full: RouteGeometry['full']
  readonly simplified: RouteGeometry['simplified']
}

export interface ClimbRecord extends Climb {
  readonly tripId: TripId
  readonly sequence: number
}

export interface RoutePointRecord extends RoutePoint {
  readonly tripId: TripId
  readonly sequence: number
}

export interface PracticalPlaceRecord extends PracticalPlace {
  readonly tripId: TripId
  readonly sequence: number
}

export interface AccommodationRecord extends Accommodation {
  readonly tripId: TripId
  readonly sequence: number
}

export interface WeatherRecordRecord extends WeatherRecord {
  readonly tripId: TripId
  readonly sequence: number
}

export interface OverrideRecord extends TripOverride {
  readonly tripId: TripId
  readonly sequence: number
}

/** Every record derived from one `TripBundle`, ready to be written one store at a time inside a single transaction. */
export interface TripRecordSet {
  readonly trip: TripRootRecord
  readonly tripSettings: TripSettingsRecord
  readonly sourceFiles: readonly SourceFileRecord[]
  readonly tripDays: readonly TripDayRecord[]
  readonly stages: readonly RideStageRecord[]
  readonly routes: readonly RouteRecord[]
  readonly routeGeometries: readonly RouteGeometryRecord[]
  readonly climbs: readonly ClimbRecord[]
  readonly routePoints: readonly RoutePointRecord[]
  readonly practicalPlaces: readonly PracticalPlaceRecord[]
  readonly accommodations: readonly AccommodationRecord[]
  readonly weather: readonly WeatherRecordRecord[]
  readonly overrides: readonly OverrideRecord[]
}

/**
 * Returns a shallow copy of `value` without `keys`. Implemented via
 * entries/fromEntries rather than `delete` — `delete` on a required,
 * non-optional property is a TypeScript error (by design: every record
 * field here is required), so this is the straightforward alternative. The
 * single cast at the return is contained to this one generic, thoroughly
 * exercised (via every conversion below) utility.
 */
function omit<T extends object, K extends keyof T>(value: T, ...keys: readonly K[]): Omit<T, K> {
  const keySet = new Set<keyof T>(keys)
  const entries = (Object.entries(value) as unknown as ReadonlyArray<[keyof T, unknown]>).filter(([key]) => !keySet.has(key))
  return Object.fromEntries(entries) as Omit<T, K>
}

function withTripIdAndSequence<T extends { readonly id: string }>(
  items: readonly T[],
  tripId: TripId,
): readonly (T & { readonly tripId: TripId; readonly sequence: number })[] {
  return items.map((item, sequence) => ({ ...item, tripId, sequence }))
}

function bySequence<T extends { readonly sequence: number }>(records: readonly T[]): readonly T[] {
  return [...records].sort((left, right) => left.sequence - right.sequence)
}

/** Pure, deterministic, non-mutating: never repairs or drops anything from `bundle`. */
export function toTripRecordSet(bundle: TripBundle): TripRecordSet {
  const tripId = bundle.metadata.id

  const trip: TripRootRecord = {
    id: tripId,
    schemaVersion: bundle.schemaVersion,
    metadata: bundle.metadata,
    calendar: bundle.calendar,
    enrichmentMetadata: bundle.enrichmentMetadata,
    generatedMetadata: bundle.generatedMetadata,
  }

  const tripSettings: TripSettingsRecord = {
    tripId,
    global: bundle.settings.global,
    days: bundle.settings.days,
    stages: bundle.settings.stages,
  }

  const tripDays: readonly TripDayRecord[] = bundle.days.map((day) => ({ ...day, tripId }))

  const routes: readonly RouteRecord[] = bundle.routes.map((route, sequence) => ({
    id: route.id,
    sourceFileId: route.sourceFileId,
    segments: route.segments,
    profile: route.profile,
    parsingStatus: route.parsingStatus,
    parsingErrors: route.parsingErrors,
    provenance: route.provenance,
    tripId,
    sequence,
  }))

  const routeGeometries: readonly RouteGeometryRecord[] = bundle.routes
    .filter((route): route is Route & { geometry: RouteGeometry } => route.geometry !== null)
    .map((route) => ({
      tripId,
      id: route.id,
      full: route.geometry.full,
      simplified: route.geometry.simplified,
    }))

  return {
    trip,
    tripSettings,
    sourceFiles: withTripIdAndSequence(bundle.sourceFiles, tripId),
    tripDays,
    stages: withTripIdAndSequence(bundle.stages, tripId),
    routes,
    routeGeometries,
    climbs: withTripIdAndSequence(bundle.climbs, tripId),
    routePoints: withTripIdAndSequence(bundle.routePoints, tripId),
    practicalPlaces: withTripIdAndSequence(bundle.practicalPlaces, tripId),
    accommodations: withTripIdAndSequence(bundle.accommodations, tripId),
    weather: withTripIdAndSequence(bundle.weather, tripId),
    overrides: withTripIdAndSequence(bundle.overrides, tripId),
  }
}

/**
 * Pure, deterministic, non-mutating: reconstructs exactly what
 * `toTripRecordSet` was given, in the original order, never repairing or
 * inventing a value. Does not validate the result — callers (the
 * repository) run `validateTripBundle` on it and refuse an inconsistent
 * reconstruction rather than let this function silently paper over one.
 */
export function fromTripRecordSet(records: TripRecordSet): TripBundle {
  const geometryByRouteId = new Map(records.routeGeometries.map((record) => [record.id, { full: record.full, simplified: record.simplified }]))

  const routes: readonly Route[] = bySequence(records.routes).map((record) => ({
    id: record.id,
    sourceFileId: record.sourceFileId,
    segments: record.segments,
    profile: record.profile,
    parsingStatus: record.parsingStatus,
    parsingErrors: record.parsingErrors,
    provenance: record.provenance,
    geometry: geometryByRouteId.get(record.id) ?? null,
  }))

  const days: readonly TripDay[] = [...records.tripDays]
    .sort((left, right) => left.index - right.index)
    .map((record) => omit(record, 'tripId'))

  return {
    schemaVersion: records.trip.schemaVersion,
    metadata: records.trip.metadata,
    calendar: records.trip.calendar,
    days,
    stages: bySequence(records.stages).map((record) => omit(record, 'tripId', 'sequence')),
    sourceFiles: bySequence(records.sourceFiles).map((record) => omit(record, 'tripId', 'sequence')),
    routes,
    climbs: bySequence(records.climbs).map((record) => omit(record, 'tripId', 'sequence')),
    routePoints: bySequence(records.routePoints).map((record) => omit(record, 'tripId', 'sequence')),
    practicalPlaces: bySequence(records.practicalPlaces).map((record) => omit(record, 'tripId', 'sequence')),
    accommodations: bySequence(records.accommodations).map((record) => omit(record, 'tripId', 'sequence')),
    weather: bySequence(records.weather).map((record) => omit(record, 'tripId', 'sequence')),
    settings: omit(records.tripSettings, 'tripId'),
    overrides: bySequence(records.overrides).map((record) => omit(record, 'tripId', 'sequence')),
    enrichmentMetadata: records.trip.enrichmentMetadata,
    generatedMetadata: records.trip.generatedMetadata,
  }
}
