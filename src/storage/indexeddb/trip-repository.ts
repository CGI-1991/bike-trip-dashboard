/**
 * The primary read/write surface for a `TripBundle`: atomic save, isolated
 * load-and-reconstruct, listing, existence and deletion. See
 * `atomic-import.ts` for the composite write that also includes an
 * `importJob` in the same transaction.
 */

import type { TripBundle, TripId, TripMetadata } from '../../trip-core/index.ts'
import { validateTripBundle } from '../../trip-core/index.ts'
import type { ValidationIssue } from '../../trip-core/validation/types.ts'
import { OBJECT_STORE_NAMES, TRIP_SCOPED_STORE_NAMES } from './constants.ts'
import type { TripRecordSet, TripRootRecord } from './records.ts'
import { fromTripRecordSet, toTripRecordSet } from './records.ts'
import type { SourceFilePayloadInput } from './source-file-repository.ts'
import { toPayloadRecord, validateSourcePayloadInputs } from './source-file-repository.ts'
import { promisifyRequest } from './request.ts'
import { deleteAllByTripId, getAllByTripId, runInTransaction } from './transaction.ts'

export class TripValidationError extends Error {
  readonly issues: readonly ValidationIssue[]

  constructor(issues: readonly ValidationIssue[]) {
    const [first] = issues
    const suffix = issues.length > 1 ? ` (+${issues.length - 1} autre(s))` : ''
    super(`TripBundle invalide : ${first?.path ?? ''} ${first?.message ?? 'erreur inconnue'}${suffix}`)
    this.name = 'TripValidationError'
    this.issues = issues
  }
}

export interface SaveTripBundleOptions {
  /**
   * New or replacement payloads to write alongside the bundle. Any existing
   * payload NOT listed here is preserved as long as its `SourceFileId` still
   * exists in `bundle.sourceFiles`; any existing payload whose
   * `SourceFileId` no longer exists in the new bundle is deleted (CDC
   * section 10's decision).
   */
  readonly sourcePayloads?: readonly SourceFilePayloadInput[]
}

export interface TripRepository {
  saveTripBundle(bundle: TripBundle, options?: SaveTripBundleOptions): Promise<void>
  loadTripBundle(tripId: TripId): Promise<TripBundle | null>
  listTrips(): Promise<readonly TripMetadata[]>
  deleteTrip(tripId: TripId): Promise<boolean>
  hasTrip(tripId: TripId): Promise<boolean>
}

/** Every store a full trip write/delete/read may touch, in a stable order. Reused by `atomic-import.ts` to add `importJobs` to the same transaction. */
export const ALL_TRIP_STORE_NAMES = [OBJECT_STORE_NAMES.trips, OBJECT_STORE_NAMES.tripSettings, ...TRIP_SCOPED_STORE_NAMES]

/**
 * The store names that hold one of `TripRecordSet`'s plain collections,
 * mapped generically: delete-then-insert. `sourceFilePayloads` is
 * deliberately excluded — it follows the preserve/replace/remove contract
 * instead (see `writeSourcePayloads` below), never a blanket replace.
 */
function collectionStoreEntries(records: TripRecordSet): ReadonlyArray<readonly [string, readonly unknown[]]> {
  return [
    [OBJECT_STORE_NAMES.sourceFiles, records.sourceFiles],
    [OBJECT_STORE_NAMES.tripDays, records.tripDays],
    [OBJECT_STORE_NAMES.stages, records.stages],
    [OBJECT_STORE_NAMES.routes, records.routes],
    [OBJECT_STORE_NAMES.routeGeometries, records.routeGeometries],
    [OBJECT_STORE_NAMES.climbs, records.climbs],
    [OBJECT_STORE_NAMES.routePoints, records.routePoints],
    [OBJECT_STORE_NAMES.practicalPlaces, records.practicalPlaces],
    [OBJECT_STORE_NAMES.accommodations, records.accommodations],
    [OBJECT_STORE_NAMES.weatherCache, records.weather],
    [OBJECT_STORE_NAMES.overrides, records.overrides],
  ]
}

async function writeSourcePayloads(
  tx: IDBTransaction,
  tripId: TripId,
  bundle: TripBundle,
  sourcePayloads: readonly SourceFilePayloadInput[],
): Promise<void> {
  const store = tx.objectStore(OBJECT_STORE_NAMES.sourceFilePayloads)
  const existing = await getAllByTripId<{ readonly id: string }>(store, tripId)
  const knownSourceFileIds = new Set(bundle.sourceFiles.map((file) => file.id as string))

  for (const existingPayload of existing) {
    if (!knownSourceFileIds.has(existingPayload.id)) {
      store.delete([tripId, existingPayload.id])
    }
  }
  for (const input of sourcePayloads) {
    store.put(toPayloadRecord(tripId, input))
  }
}

/**
 * Deletes then rewrites every trip-scoped collection store (except
 * `sourceFilePayloads`), and upserts the `trips`/`tripSettings` singletons.
 * Assumes the caller already validated `bundle` and the transaction already
 * spans every store this touches. Exported so `atomic-import.ts` can reuse
 * it inside its own, wider transaction (which also writes `importJobs`).
 */
export async function writeTripBundleRecords(
  tx: IDBTransaction,
  bundle: TripBundle,
  sourcePayloads: readonly SourceFilePayloadInput[] = [],
): Promise<void> {
  const tripId = bundle.metadata.id
  const records = toTripRecordSet(bundle)

  tx.objectStore(OBJECT_STORE_NAMES.trips).put(records.trip)
  tx.objectStore(OBJECT_STORE_NAMES.tripSettings).put(records.tripSettings)

  for (const [storeName, items] of collectionStoreEntries(records)) {
    const store = tx.objectStore(storeName)
    await deleteAllByTripId(store, tripId)
    for (const item of items) {
      store.put(item)
    }
  }

  await writeSourcePayloads(tx, tripId, bundle, sourcePayloads)
}

async function readTripRecordSet(tx: IDBTransaction, tripId: TripId): Promise<TripRecordSet | null> {
  const tripRoot = (await promisifyRequest(tx.objectStore(OBJECT_STORE_NAMES.trips).get(tripId))) as TripRootRecord | undefined
  if (tripRoot === undefined) return null

  const tripSettings = await promisifyRequest(tx.objectStore(OBJECT_STORE_NAMES.tripSettings).get(tripId))

  const [sourceFiles, tripDays, stages, routes, routeGeometries, climbs, routePoints, practicalPlaces, accommodations, weather, overrides] =
    await Promise.all([
      getAllByTripId(tx.objectStore(OBJECT_STORE_NAMES.sourceFiles), tripId),
      getAllByTripId(tx.objectStore(OBJECT_STORE_NAMES.tripDays), tripId),
      getAllByTripId(tx.objectStore(OBJECT_STORE_NAMES.stages), tripId),
      getAllByTripId(tx.objectStore(OBJECT_STORE_NAMES.routes), tripId),
      getAllByTripId(tx.objectStore(OBJECT_STORE_NAMES.routeGeometries), tripId),
      getAllByTripId(tx.objectStore(OBJECT_STORE_NAMES.climbs), tripId),
      getAllByTripId(tx.objectStore(OBJECT_STORE_NAMES.routePoints), tripId),
      getAllByTripId(tx.objectStore(OBJECT_STORE_NAMES.practicalPlaces), tripId),
      getAllByTripId(tx.objectStore(OBJECT_STORE_NAMES.accommodations), tripId),
      getAllByTripId(tx.objectStore(OBJECT_STORE_NAMES.weatherCache), tripId),
      getAllByTripId(tx.objectStore(OBJECT_STORE_NAMES.overrides), tripId),
    ])

  return {
    trip: tripRoot,
    // A missing settings row for an existing trip root is inconsistent
    // storage, not a value to default: `undefined` fails `validateTripBundle`
    // (`settings` must be a plain object), which is exactly the "refuse
    // rather than repair" behavior section 9 requires.
    tripSettings,
    sourceFiles,
    tripDays,
    stages,
    routes,
    routeGeometries,
    climbs,
    routePoints,
    practicalPlaces,
    accommodations,
    weather,
    overrides,
  } as TripRecordSet
}

export function createTripRepository(db: IDBDatabase): TripRepository {
  return {
    async saveTripBundle(bundle, options = {}) {
      const validation = validateTripBundle(bundle)
      if (!validation.ok) {
        throw new TripValidationError(validation.issues)
      }
      const sourcePayloads = options.sourcePayloads ?? []
      const knownSourceFileIds = new Set(bundle.sourceFiles.map((file) => file.id))
      validateSourcePayloadInputs(sourcePayloads, knownSourceFileIds)

      await runInTransaction(db, ALL_TRIP_STORE_NAMES, 'readwrite', async (tx) => {
        await writeTripBundleRecords(tx, bundle, sourcePayloads)
      })
    },

    async loadTripBundle(tripId) {
      const recordSet = await runInTransaction(db, ALL_TRIP_STORE_NAMES, 'readonly', (tx) => readTripRecordSet(tx, tripId))
      if (recordSet === null) return null

      const candidate = fromTripRecordSet(recordSet)
      const validation = validateTripBundle(candidate)
      if (!validation.ok) {
        throw new TripValidationError(validation.issues)
      }
      return validation.value
    },

    async listTrips() {
      const roots = await runInTransaction(db, [OBJECT_STORE_NAMES.trips], 'readonly', (tx) =>
        promisifyRequest(tx.objectStore(OBJECT_STORE_NAMES.trips).getAll()),
      )
      return (roots as readonly TripRootRecord[])
        .map((root) => root.metadata)
        .slice()
        .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
    },

    async hasTrip(tripId) {
      const count = await runInTransaction(db, [OBJECT_STORE_NAMES.trips], 'readonly', (tx) =>
        promisifyRequest(tx.objectStore(OBJECT_STORE_NAMES.trips).count(tripId)),
      )
      return count > 0
    },

    async deleteTrip(tripId) {
      return runInTransaction(db, ALL_TRIP_STORE_NAMES, 'readwrite', async (tx) => {
        const tripsStore = tx.objectStore(OBJECT_STORE_NAMES.trips)
        const existed = (await promisifyRequest(tripsStore.count(tripId))) > 0
        if (!existed) return false

        tripsStore.delete(tripId)
        tx.objectStore(OBJECT_STORE_NAMES.tripSettings).delete(tripId)
        for (const storeName of TRIP_SCOPED_STORE_NAMES) {
          await deleteAllByTripId(tx.objectStore(storeName), tripId)
        }
        return true
      })
    },
  }
}
