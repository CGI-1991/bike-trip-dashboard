/**
 * The composite write from CDC section 10/9.4: a `TripBundle`, its optional
 * source payloads, and an optional `importJob` transition, committed
 * together in one transaction. This is what lets an import pipeline (a
 * later phase) flip an `importJob` to `ready` in the very same commit as the
 * bundle it describes — never a `ready` status with no matching bundle on
 * disk, and never a bundle write with no matching status update (CDC
 * section 12's "importJob non marqué ready en cas d'échec").
 *
 * A separate file rather than folding this into `trip-repository.ts`: it
 * composes three repositories' concerns (trip, source payloads, import job)
 * behind one call, and belongs to none of them individually.
 */

import type { TripBundle } from '../../trip-core/index.ts'
import { validateTripBundle } from '../../trip-core/index.ts'
import { OBJECT_STORE_NAMES } from './constants.ts'
import type { ImportJob } from './import-job-repository.ts'
import type { SourceFilePayloadInput } from './source-file-repository.ts'
import { validateSourcePayloadInputs } from './source-file-repository.ts'
import { ALL_TRIP_STORE_NAMES, TripValidationError, writeTripBundleRecords } from './trip-repository.ts'
import { runInTransaction } from './transaction.ts'

export interface SaveTripImportAtomicallyInput {
  readonly bundle: TripBundle
  readonly sourcePayloads?: readonly SourceFilePayloadInput[]
  readonly importJob?: ImportJob
}

export async function saveTripImportAtomically(db: IDBDatabase, input: SaveTripImportAtomicallyInput): Promise<void> {
  const validation = validateTripBundle(input.bundle)
  if (!validation.ok) {
    throw new TripValidationError(validation.issues)
  }
  const sourcePayloads = input.sourcePayloads ?? []
  const knownSourceFileIds = new Set(input.bundle.sourceFiles.map((file) => file.id))
  validateSourcePayloadInputs(sourcePayloads, knownSourceFileIds)

  const storeNames = input.importJob === undefined ? ALL_TRIP_STORE_NAMES : [...ALL_TRIP_STORE_NAMES, OBJECT_STORE_NAMES.importJobs]

  await runInTransaction(db, storeNames, 'readwrite', async (tx) => {
    await writeTripBundleRecords(tx, input.bundle, sourcePayloads)
    if (input.importJob !== undefined) {
      tx.objectStore(OBJECT_STORE_NAMES.importJobs).put(input.importJob)
    }
  })
}
