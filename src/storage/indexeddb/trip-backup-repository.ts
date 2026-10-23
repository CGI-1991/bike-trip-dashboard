import type { TripBundle, TripId } from '../../trip-core/index.ts'
import { tripId, validateTripBundle } from '../../trip-core/index.ts'
import { OBJECT_STORE_NAMES } from './constants.ts'
import { fromTripRecordSet } from './records.ts'
import type { TripRootRecord } from './records.ts'
import { ALL_TRIP_STORE_NAMES, readTripRecordSet, TripValidationError, writeTripBundleRecords } from './trip-repository.ts'
import { promisifyRequest } from './request.ts'
import { getAllByTripId, runInTransaction } from './transaction.ts'
import { toPayload, validateSourcePayloadInputs } from './source-file-repository.ts'
import type { SourceFilePayload, SourceFilePayloadInput, SourceFilePayloadRecord } from './source-file-repository.ts'

export interface TripBackupSnapshot {
  readonly bundle: TripBundle
  readonly sourcePayloads: readonly SourceFilePayload[]
}

/** One read transaction freezes the library and originals together while
 * background enrichment or another tab may be updating the same trip. */
export async function snapshotTrips(database: IDBDatabase, selectedTripId?: TripId, limits?: { readonly maximumBytes: number; readonly maximumTrips: number }): Promise<readonly TripBackupSnapshot[]> {
  return runInTransaction(database, ALL_TRIP_STORE_NAMES, 'readonly', async tx => {
    const roots = selectedTripId === undefined
      ? await promisifyRequest(tx.objectStore(OBJECT_STORE_NAMES.trips).getAll()) as TripRootRecord[]
      : [await promisifyRequest(tx.objectStore(OBJECT_STORE_NAMES.trips).get(selectedTripId)) as TripRootRecord | undefined].filter(root => root !== undefined)
    const snapshots: TripBackupSnapshot[] = []
    if (limits !== undefined && roots.length > limits.maximumTrips) throw new Error('Trop de voyages pour une seule sauvegarde. Sauvegardez-les individuellement.')
    let totalBytes = 0
    for (const root of roots) {
      const records = await readTripRecordSet(tx, root.id)
      if (records === null) throw new Error('Le voyage à sauvegarder est introuvable.')
      const validated = validateTripBundle(fromTripRecordSet(records))
      if (!validated.ok) throw new TripValidationError(validated.issues)
      const payloads = await getAllByTripId<SourceFilePayloadRecord>(tx.objectStore(OBJECT_STORE_NAMES.sourceFilePayloads), root.id)
      if (limits !== undefined) {
        totalBytes += new TextEncoder().encode(JSON.stringify(validated.value)).byteLength
          + payloads.reduce((sum, item) => sum + (item.payload instanceof Blob ? item.payload.size : item.payload.byteLength), 0)
        if (totalBytes > limits.maximumBytes) throw new Error('La sauvegarde dépasse 64 Mio. Sauvegardez les voyages individuellement.')
      }
      snapshots.push({ bundle: validated.value, sourcePayloads: payloads.map(toPayload) })
    }
    return snapshots
  })
}

export interface RestorableTrip {
  readonly bundle: TripBundle
  readonly sourcePayloads: readonly SourceFilePayloadInput[]
}

/** Always add copies. A collision, quota error or failed write rolls back
 * the entire selection. No active-trip preference or provider cache changes. */
export async function restoreTripsAsCopies(database: IDBDatabase, trips: readonly RestorableTrip[], idFactory: () => string, now: string): Promise<readonly TripId[]> {
  const ids = new Set<TripId>()
  const copies = trips.map(trip => {
    const id = tripId(`restored-${idFactory()}`)
    if (ids.has(id)) throw new Error('Identifiants de restauration en double. Aucun voyage ajouté.')
    ids.add(id)
    const bundle: TripBundle = { ...trip.bundle, metadata: { ...trip.bundle.metadata, id,
      name: `${trip.bundle.metadata.name} (restauré)`,
      updatedAt: new Date(Math.max(Date.parse(now), Date.parse(trip.bundle.metadata.updatedAt))).toISOString() } }
    const validated = validateTripBundle(bundle)
    if (!validated.ok) throw new TripValidationError(validated.issues)
    validateSourcePayloadInputs(trip.sourcePayloads, new Set(bundle.sourceFiles.map(file => file.id)))
    return { bundle, sourcePayloads: trip.sourcePayloads }
  })
  await runInTransaction(database, ALL_TRIP_STORE_NAMES, 'readwrite', async tx => {
    for (const copy of copies) {
      if (await promisifyRequest(tx.objectStore(OBJECT_STORE_NAMES.trips).count(copy.bundle.metadata.id)) > 0) {
        throw new Error('Un identifiant de restauration existe déjà. Aucun voyage ajouté ; relancez la restauration.')
      }
    }
    for (const copy of copies) await writeTripBundleRecords(tx, copy.bundle, copy.sourcePayloads)
  })
  return [...ids]
}
