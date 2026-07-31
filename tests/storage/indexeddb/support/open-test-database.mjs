import { IDBFactory } from 'fake-indexeddb'

import { openBikeTripDatabase } from '../../../../src/storage/indexeddb/open-database.ts'

/**
 * A brand-new, fully isolated bike-trip-dashboard database for one test —
 * its own `IDBFactory` instance, never shared with any other test. Callers
 * are responsible for `db.close()` when done: every `IDBDatabase` handle
 * this module hands out must be closed, or the connection keeps the
 * process alive past the test run (see the schema tests' history for why).
 */
export async function openTestDatabase(now = () => '2027-01-01T00:00:00.000Z') {
  const factory = new IDBFactory()
  return openBikeTripDatabase(factory, { now })
}
