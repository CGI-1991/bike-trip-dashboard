import '../../../storage/indexeddb/support/setup-fake-indexeddb.mjs'

import { IDBFactory } from 'fake-indexeddb'

import { openBikeTripDatabase } from '../../../../src/storage/indexeddb/open-database.ts'
import { importGpxTrip } from '../../../../src/import/gpx/import-gpx-trip.ts'

/** A brand-new, isolated database — mirrors `tests/storage/indexeddb/support/open-test-database.mjs`. */
export async function openImportTestDatabase() {
  const factory = new IDBFactory()
  return openBikeTripDatabase(factory, { now: () => '2027-01-01T00:00:00.000Z' })
}

/** A monotonic, fully deterministic id factory — never `Math.random()`, never a UUID library. */
export function createIdFactory(prefix = 'id') {
  let counter = 0
  return () => `${prefix}-${counter++}`
}

export function fixedNow(value = '2027-02-01T08:00:00.000Z') {
  return () => value
}

/** Runs the full pipeline (parsing through the atomic IndexedDB write) against a fresh database. Caller closes `database`. */
export async function runImport(files, optionsOverrides = {}, { idPrefix = 'entity' } = {}) {
  const database = await openImportTestDatabase()
  const result = await importGpxTrip({
    files,
    options: {
      tripId: 'trip-test-1',
      slug: 'trip-test-1',
      name: 'Test Trip',
      importedAt: '2027-02-01T08:00:00.000Z',
      engineVersion: 'gpx-import-test@1',
      ...optionsOverrides,
    },
    database,
    idFactory: createIdFactory(idPrefix),
    now: fixedNow(),
  })
  return { result, database }
}
