/**
 * Single source of truth for every IndexedDB name/version literal used by
 * this module. Nothing outside this file may repeat one of these strings or
 * the version number — `schema.ts`/`migrations.ts` import from here, and
 * `trip-repository.ts`/`source-file-repository.ts`/`import-job-repository.ts`
 * import the store/index names, never a hand-typed string.
 */

export const DATABASE_NAME = 'bike-trip-dashboard'

/**
 * Current database version. Bump this — and add a matching entry to the
 * migration registry in `migrations.ts` — whenever the schema changes.
 * Never hardcode this number anywhere else.
 */
export const DATABASE_VERSION = 1

export const OBJECT_STORE_NAMES = {
  trips: 'trips',
  tripSettings: 'tripSettings',
  sourceFiles: 'sourceFiles',
  sourceFilePayloads: 'sourceFilePayloads',
  tripDays: 'tripDays',
  stages: 'stages',
  routes: 'routes',
  routeGeometries: 'routeGeometries',
  climbs: 'climbs',
  routePoints: 'routePoints',
  practicalPlaces: 'practicalPlaces',
  accommodations: 'accommodations',
  weatherCache: 'weatherCache',
  overrides: 'overrides',
  importJobs: 'importJobs',
  providerCache: 'providerCache',
  schemaMigrations: 'schemaMigrations',
} as const

export type ObjectStoreName = (typeof OBJECT_STORE_NAMES)[keyof typeof OBJECT_STORE_NAMES]

/**
 * Every per-trip normalized store keyed by the compound primary key
 * `[tripId, id]` (see `schema.ts`) — each carries a non-unique `byTripId`
 * index over the `tripId` field alone, used for isolated per-trip reads,
 * writes and cascade deletes without ever scanning the whole store.
 *
 * `tripSettings` is deliberately excluded: it is a one-record-per-trip
 * singleton keyed directly by `tripId` (see `schema.ts`), so it needs no
 * secondary index — a primary-key `get(tripId)` already is the isolated,
 * non-scanning read.
 */
export const TRIP_SCOPED_STORE_NAMES = [
  OBJECT_STORE_NAMES.sourceFiles,
  OBJECT_STORE_NAMES.sourceFilePayloads,
  OBJECT_STORE_NAMES.tripDays,
  OBJECT_STORE_NAMES.stages,
  OBJECT_STORE_NAMES.routes,
  OBJECT_STORE_NAMES.routeGeometries,
  OBJECT_STORE_NAMES.climbs,
  OBJECT_STORE_NAMES.routePoints,
  OBJECT_STORE_NAMES.practicalPlaces,
  OBJECT_STORE_NAMES.accommodations,
  OBJECT_STORE_NAMES.weatherCache,
  OBJECT_STORE_NAMES.overrides,
] as const

/**
 * Non-unique index name shared by every trip-scoped store (over `tripId`)
 * and by `importJobs` (over its nullable `tripId` field) — one name, reused,
 * never a second literal.
 */
export const BY_TRIP_ID_INDEX_NAME = 'byTripId'
