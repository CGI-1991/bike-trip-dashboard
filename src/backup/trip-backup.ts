import { buildZipArchive } from '../archive/zip-writer.ts'
import type { ZipEntryInput } from '../archive/zip-writer.ts'
import { InvalidArchiveError, readStoredZipArchive } from '../archive/zip-reader.ts'
import { sha256Hex } from '../import/gpx/hash.ts'
import { migrateTripBundle } from '../trip-core/index.ts'
import type { SourceFileId, TripId } from '../trip-core/index.ts'
import { isIsoDateTime } from '../trip-core/validation/primitives.ts'
import { restoreTripsAsCopies, snapshotTrips } from '../storage/indexeddb/trip-backup-repository.ts'
import type { RestorableTrip } from '../storage/indexeddb/trip-backup-repository.ts'
import type { SourceFilePayloadInput } from '../storage/indexeddb/source-file-repository.ts'

export const BACKUP_FORMAT = 'trip-plus-backup'
export const BACKUP_VERSION = 1
export const MAX_BACKUP_BYTES = 64 * 1024 * 1024
export const MAX_MANIFEST_BYTES = 32 * 1024 * 1024
export const MAX_BACKUP_TRIPS = 200
const MAX_ENTRIES = 5000
const encoder = new TextEncoder()

export interface BackupSummary {
  readonly tripNames: readonly string[]
  readonly sourceFileCount: number
  readonly missingSourceFileCount: number
}

export interface PreparedTripBackup {
  readonly createdAt: string
  readonly trips: readonly RestorableTrip[]
  readonly summary: BackupSummary
}

interface PayloadDescriptor {
  readonly sourceFileId: SourceFileId
  readonly entry: string
  readonly contentType: 'blob' | 'arraybuffer'
  readonly mimeType: string
  readonly sizeBytes: number
  readonly sha256: string
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function summary(trips: readonly RestorableTrip[]): BackupSummary {
  return { tripNames: trips.map(trip => trip.bundle.metadata.name),
    sourceFileCount: trips.reduce((sum, trip) => sum + trip.sourcePayloads.length, 0),
    missingSourceFileCount: trips.reduce((sum, trip) => sum + trip.bundle.sourceFiles.length - trip.sourcePayloads.length, 0) }
}

/** No provider calls: bundles and available original binaries come from a
 * single IndexedDB snapshot, then hashing and ZIP assembly happen outside it. */
export async function createTripBackup(database: IDBDatabase, createdAt: string, selectedTripId?: TripId): Promise<{ readonly file: File; readonly summary: BackupSummary }> {
  if (!isIsoDateTime(createdAt)) throw new Error('Date de sauvegarde invalide.')
  const snapshots = await snapshotTrips(database, selectedTripId, { maximumBytes: MAX_BACKUP_BYTES, maximumTrips: MAX_BACKUP_TRIPS })
  if (snapshots.length === 0) throw new Error('Aucun voyage à sauvegarder.')
  const entries: ZipEntryInput[] = []
  const trips = []
  let totalBytes = 0
  for (const [tripIndex, snapshot] of snapshots.entries()) {
    const available = new Map(snapshot.sourcePayloads.map(payload => [payload.sourceFileId, payload]))
    const payloads: PayloadDescriptor[] = []
    const missingSourceFileIds: SourceFileId[] = []
    for (const [fileIndex, source] of snapshot.bundle.sourceFiles.entries()) {
      const payload = available.get(source.id)
      if (payload === undefined) { missingSourceFileIds.push(source.id); continue }
      const buffer = payload.content instanceof Blob ? await payload.content.arrayBuffer() : payload.content
      const entry = `sources/${tripIndex + 1}/${fileIndex + 1}.bin`
      totalBytes += buffer.byteLength
      if (entries.length + 2 > MAX_ENTRIES || totalBytes > MAX_BACKUP_BYTES) throw new Error('Sauvegarde trop volumineuse. Sauvegardez les voyages individuellement.')
      payloads.push({ sourceFileId: source.id, entry, contentType: payload.contentType,
        mimeType: payload.content instanceof Blob ? payload.content.type : '', sizeBytes: buffer.byteLength, sha256: await sha256Hex(buffer) })
      entries.push({ name: entry, data: new Uint8Array(buffer) })
    }
    trips.push({ bundle: snapshot.bundle, payloads, missingSourceFileIds })
  }
  const manifest = encoder.encode(JSON.stringify({ format: BACKUP_FORMAT, version: BACKUP_VERSION, createdAt, trips }))
  if (manifest.byteLength > MAX_MANIFEST_BYTES || totalBytes + manifest.byteLength > MAX_BACKUP_BYTES) throw new Error('La sauvegarde dépasse la taille prise en charge. Sauvegardez les voyages individuellement.')
  const archive = buildZipArchive([{ name: 'manifest.json', data: manifest }, ...entries], new Date(createdAt))
  if (archive.size > MAX_BACKUP_BYTES) throw new Error('La sauvegarde dépasse 64 Mio. Sauvegardez les voyages individuellement.')
  return { file: new File([archive], `tripplus_sauvegarde_${createdAt.slice(0, 10)}.zip`, { type: 'application/zip' }),
    summary: summary(snapshots) }
}

function decodeJson(bytes: Uint8Array): unknown {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }
  catch { throw new InvalidArchiveError('Le contenu de la sauvegarde est illisible ou endommagé.') }
}

/** Fully validate before showing the preview; no write, no network, and no
 * silent source omission. Future versions and unrelated ZIPs are refused. */
export async function prepareTripBackupRestore(file: Blob): Promise<PreparedTripBackup> {
  if (file.size > MAX_BACKUP_BYTES) throw new InvalidArchiveError('Cette sauvegarde dépasse la limite de 64 Mio.')
  const entries = readStoredZipArchive(await file.arrayBuffer(), MAX_ENTRIES)
  const manifest = entries.get('manifest.json')
  if (manifest === undefined || manifest.byteLength > MAX_MANIFEST_BYTES) throw new InvalidArchiveError('Cette archive n’est pas une sauvegarde Trip(+) compatible.')
  const value = decodeJson(manifest)
  if (!record(value) || value.format !== BACKUP_FORMAT) throw new InvalidArchiveError('Cette archive n’est pas une sauvegarde Trip(+) compatible.')
  if (value.version !== BACKUP_VERSION) throw new InvalidArchiveError('Version de sauvegarde non prise en charge. Mettez l’application à jour avant de réessayer.')
  if (!isIsoDateTime(value.createdAt) || !Array.isArray(value.trips) || value.trips.length === 0 || value.trips.length > MAX_BACKUP_TRIPS) throw new InvalidArchiveError()
  const trips: RestorableTrip[] = []
  const seenTrips = new Set<string>()
  const usedEntries = new Set(['manifest.json'])
  for (const item of value.trips) {
    if (!record(item) || !Array.isArray(item.payloads) || !Array.isArray(item.missingSourceFileIds)) throw new InvalidArchiveError()
    const migrated = migrateTripBundle(item.bundle)
    if (!migrated.ok) throw new InvalidArchiveError(`Voyage incompatible ou incomplet : ${migrated.issues[0]?.message ?? 'validation impossible'}`)
    const bundle = migrated.value
    if (seenTrips.has(bundle.metadata.id)) throw new InvalidArchiveError('Un voyage apparaît plusieurs fois dans la sauvegarde.')
    seenTrips.add(bundle.metadata.id)
    const knownIds = new Set(bundle.sourceFiles.map(source => source.id as string))
    const coveredIds = new Set<string>()
    const sourcePayloads: SourceFilePayloadInput[] = []
    for (const id of item.missingSourceFileIds) {
      if (typeof id !== 'string' || !knownIds.has(id) || coveredIds.has(id)) throw new InvalidArchiveError()
      coveredIds.add(id)
    }
    for (const payload of item.payloads) {
      if (!record(payload) || typeof payload.sourceFileId !== 'string' || !knownIds.has(payload.sourceFileId) || coveredIds.has(payload.sourceFileId)
        || typeof payload.entry !== 'string' || !/^sources\/[1-9]\d*\/[1-9]\d*\.bin$/.test(payload.entry) || usedEntries.has(payload.entry)
        || (payload.contentType !== 'blob' && payload.contentType !== 'arraybuffer') || typeof payload.mimeType !== 'string'
        || !Number.isSafeInteger(payload.sizeBytes) || typeof payload.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(payload.sha256)) throw new InvalidArchiveError()
      const data = entries.get(payload.entry)
      if (data === undefined || data.byteLength !== payload.sizeBytes) throw new InvalidArchiveError('Un GPX d’origine annoncé par la sauvegarde manque ou est incomplet.')
      const buffer = data.slice().buffer
      if (await sha256Hex(buffer) !== payload.sha256) throw new InvalidArchiveError('Un fichier d’origine est endommagé. Aucun voyage n’a été ajouté.')
      coveredIds.add(payload.sourceFileId)
      usedEntries.add(payload.entry)
      sourcePayloads.push({ sourceFileId: payload.sourceFileId as SourceFileId,
        content: payload.contentType === 'blob' ? new Blob([buffer], { type: payload.mimeType }) : buffer })
    }
    if (coveredIds.size !== knownIds.size) throw new InvalidArchiveError('La liste des fichiers d’origine de la sauvegarde est incomplète.')
    trips.push({ bundle, sourcePayloads })
  }
  if (usedEntries.size !== entries.size) throw new InvalidArchiveError('La sauvegarde contient des fichiers inattendus.')
  return { createdAt: value.createdAt, trips, summary: summary(trips) }
}

export async function restorePreparedTripBackup(database: IDBDatabase, prepared: PreparedTripBackup, idFactory: () => string, now: string): Promise<readonly TripId[]> {
  if (prepared.trips.length === 0 || prepared.trips.length > MAX_BACKUP_TRIPS) throw new InvalidArchiveError()
  return restoreTripsAsCopies(database, prepared.trips, idFactory, now)
}
