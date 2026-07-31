/**
 * Opens (creating/upgrading on first use) the bike-trip-dashboard IndexedDB
 * database. This is the only place in the module allowed to reference the
 * global `indexedDB` — and only as a default parameter value, never read
 * implicitly at module load or from inside a repository.
 */

import { DATABASE_NAME, DATABASE_VERSION } from './constants.ts'
import { runMigrations } from './migrations.ts'

export interface OpenDatabaseOptions {
  /**
   * Supplies the timestamp recorded in `schemaMigrations.appliedAt` when a
   * migration actually runs. Every test passes a fixed value, keeping the
   * whole suite deterministic. This is the one place in the entire
   * `storage/indexeddb` module that touches the real clock, and only as a
   * default used when a real (non-test) caller doesn't supply its own —
   * `open-database.test.mjs` never exercises this branch.
   */
  readonly now?: () => string
}

function defaultNow(): string {
  return new Date().toISOString()
}

export function openBikeTripDatabase(
  factory: IDBFactory = indexedDB,
  options: OpenDatabaseOptions = {},
): Promise<IDBDatabase> {
  const now = options.now ?? defaultNow

  return new Promise((resolve, reject) => {
    const request = factory.open(DATABASE_NAME, DATABASE_VERSION)

    request.onupgradeneeded = (event) => {
      const database = request.result
      const transaction = request.transaction
      if (transaction === null) {
        throw new Error('Transaction versionchange manquante pendant onupgradeneeded.')
      }
      runMigrations(database, transaction, event.oldVersion, event.newVersion ?? DATABASE_VERSION, now())
    }

    request.onsuccess = () => {
      const database = request.result
      // A version bump from another connection (another tab, another test)
      // must not leave this handle open and stale — close it so the other
      // side's upgrade can proceed instead of sitting `blocked`.
      database.onversionchange = () => {
        database.close()
      }
      resolve(database)
    }

    request.onerror = () => {
      reject(request.error ?? new Error("L'ouverture de la base IndexedDB a échoué."))
    }

    request.onblocked = () => {
      // Not terminal: another connection (typically one we forgot to close,
      // or a concurrent test) still holds an older version open. Every
      // connection this module hands out installs the `onversionchange`
      // handler above, so that connection closes itself shortly and the
      // browser resumes the upgrade — `onsuccess`/`onerror` above still
      // fires once that happens. Nothing to do here but wait.
    }
  })
}
