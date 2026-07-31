/**
 * Ordered migration registry. Every migration only ever runs inside the
 * `versionchange` transaction IndexedDB itself provides during
 * `onupgradeneeded` (see `open-database.ts`) — nothing here opens its own
 * transaction or calls `db.transaction(...)`.
 */

import { OBJECT_STORE_NAMES } from './constants.ts'
import type { ObjectStoreDescriptor } from './schema.ts'
import { SCHEMA_V1 } from './schema.ts'

/** One row of the `schemaMigrations` store (CDC section 13). */
export interface SchemaMigrationRecord {
  readonly version: number
  /** Provided by the caller of `openBikeTripDatabase` — never computed here. */
  readonly appliedAt: string
  readonly engineVersion: string
  readonly description: string
}

export interface Migration {
  readonly version: number
  readonly description: string
  /** Runs synchronously inside the upgrade transaction — no awaited work. */
  readonly apply: (database: IDBDatabase, transaction: IDBTransaction) => void
}

function createStore(database: IDBDatabase, descriptor: ObjectStoreDescriptor): void {
  const store = database.createObjectStore(descriptor.name, { keyPath: descriptor.keyPath as string | string[] })
  for (const index of descriptor.indexes) {
    store.createIndex(index.name, index.keyPath as string | string[], { unique: index.unique })
  }
}

/**
 * Ordered, contiguous from 1. No business migration is ever faked here — v1
 * has exactly one entry, creating the schema from nothing (there is no prior
 * production database to migrate data out of).
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    description: 'Create the V1 object stores and indexes (trip root, tripSettings, every trip-scoped normalized store, importJobs, providerCache, schemaMigrations).',
    apply: (database) => {
      for (const descriptor of SCHEMA_V1) {
        createStore(database, descriptor)
      }
    },
  },
]

export const ENGINE_VERSION = 'bike-trip-dashboard-indexeddb@1'

/**
 * Validates the registry is well-formed: versions strictly ascending,
 * contiguous from 1, no duplicates. Called once by `openBikeTripDatabase`
 * before applying anything — a malformed registry is a programming error,
 * not a runtime condition to silently tolerate.
 */
export function assertMigrationRegistryIsWellFormed(migrations: readonly Migration[]): void {
  migrations.forEach((migration, index) => {
    const expectedVersion = index + 1
    if (migration.version !== expectedVersion) {
      throw new Error(
        `Registre de migrations incohérent : version ${migration.version} trouvée à la position ${index} (attendu ${expectedVersion}).`,
      )
    }
  })
}

/**
 * Applies every migration with `oldVersion < version <= newVersion`, in
 * ascending order, then records each one applied in `schemaMigrations`.
 * Refuses (throws) a `newVersion` with no corresponding registered
 * migration — an unhandled future version is a bug, never silently ignored.
 */
export function runMigrations(
  database: IDBDatabase,
  transaction: IDBTransaction,
  oldVersion: number,
  newVersion: number,
  appliedAt: string,
): void {
  assertMigrationRegistryIsWellFormed(MIGRATIONS)

  const highestKnownVersion = MIGRATIONS.length
  if (newVersion > highestKnownVersion) {
    throw new Error(
      `Version de base de données ${newVersion} non gérée : la version connue la plus élevée est ${highestKnownVersion}.`,
    )
  }

  const pending = MIGRATIONS.filter((migration) => migration.version > oldVersion && migration.version <= newVersion)

  for (const migration of pending) {
    migration.apply(database, transaction)
    // `schemaMigrations` itself is created by migration 1's `apply` above —
    // fetch the store handle only after applying, never before.
    const migrationsStore = transaction.objectStore(OBJECT_STORE_NAMES.schemaMigrations)
    const record: SchemaMigrationRecord = {
      version: migration.version,
      appliedAt,
      engineVersion: ENGINE_VERSION,
      description: migration.description,
    }
    migrationsStore.put(record)
  }
}
