/**
 * Declarative description of every object store and index this database
 * ever creates. This file has no side effects and touches no IndexedDB API
 * itself — `migrations.ts` is the only place that actually calls
 * `db.createObjectStore`/`store.createIndex`, driven by this data.
 *
 * Keeping the shape declarative (rather than imperative store-creation code)
 * makes the schema independently readable and testable: `tests/storage/
 * indexeddb/schema.test.mjs` walks this list to assert every expected store
 * and index exists on a freshly opened database, without duplicating the
 * literal store/index names a second time.
 */

import { BY_TRIP_ID_INDEX_NAME, OBJECT_STORE_NAMES, TRIP_SCOPED_STORE_NAMES } from './constants.ts'

export interface IndexDescriptor {
  readonly name: string
  readonly keyPath: string | readonly string[]
  readonly unique: boolean
}

export interface ObjectStoreDescriptor {
  readonly name: string
  readonly keyPath: string | readonly string[]
  readonly indexes: readonly IndexDescriptor[]
}

/**
 * Every store in `TRIP_SCOPED_STORE_NAMES` shares the same compound primary
 * key `['tripId', 'id']` (CDC section 6): it can never collide across two
 * trips whose entities happen to reuse the same `id`, and a non-unique
 * `byTripId` index gives an isolated, non-scanning per-trip read. `id` means
 * whatever this store's natural entity identifier is — a `SourceFileId` for
 * `sourceFilePayloads`, a `RouteId` for `routeGeometries` (one geometry
 * record per route, when produced), an actual entity id everywhere else —
 * the record types in `records.ts` narrow it per store.
 */
const tripScopedStoreDescriptor = (name: string): ObjectStoreDescriptor => ({
  name,
  keyPath: ['tripId', 'id'],
  indexes: [{ name: BY_TRIP_ID_INDEX_NAME, keyPath: 'tripId', unique: false }],
})

/**
 * The full V1 schema. Order is insignificant (all stores are created in the
 * same `onupgradeneeded` transaction) but kept grouped for readability.
 */
export const SCHEMA_V1: readonly ObjectStoreDescriptor[] = [
  // Trip root: metadata/calendar/enrichment/generated-metadata only — never
  // the normalized collections (CDC section 5 / 9.2).
  { name: OBJECT_STORE_NAMES.trips, keyPath: 'id', indexes: [] },

  // One singleton settings record per trip — keyed directly by tripId, so a
  // primary-key `get` is already the isolated, non-scanning read; no
  // `byTripId` index needed (see constants.ts).
  { name: OBJECT_STORE_NAMES.tripSettings, keyPath: 'tripId', indexes: [] },

  ...TRIP_SCOPED_STORE_NAMES.map(tripScopedStoreDescriptor),

  // Import jobs are not strictly per-trip (tripId may be null while an
  // import is still being parsed/validated) — plain `id` primary key, with a
  // non-unique index for the ones that do have one.
  {
    name: OBJECT_STORE_NAMES.importJobs,
    keyPath: 'id',
    indexes: [{ name: BY_TRIP_ID_INDEX_NAME, keyPath: 'tripId', unique: false }],
  },

  // Generic external-provider response cache (CDC section 9.2). Created for
  // schema completeness; no repository writes to it yet in phase 5 — no
  // enrichment provider is called by this phase (see the report's scope
  // notes).
  { name: OBJECT_STORE_NAMES.providerCache, keyPath: 'cacheKey', indexes: [] },

  // Documents which migrations have run (version/appliedAt/engineVersion/
  // description) — see migrations.ts.
  { name: OBJECT_STORE_NAMES.schemaMigrations, keyPath: 'version', indexes: [] },
]
