/**
 * Storage and retrieval of a `SourceFile`'s raw binary content, kept
 * entirely separate from `TripBundle.sourceFiles` (metadata only — see
 * `src/trip-core/model/source-file.ts`) and from the reconstructed
 * `TripBundle` itself (CDC section 8/11). Nothing here ever encodes a GPX
 * (or any binary) as a JSON string, and nothing here ever touches
 * localStorage.
 */

import type { SourceFileId, TripId } from '../../trip-core/index.ts'
import { OBJECT_STORE_NAMES } from './constants.ts'
import { promisifyRequest } from './request.ts'
import { runInTransaction } from './transaction.ts'

/** Structured-clone-safe binary content — the only two shapes IndexedDB and every target browser handle natively. */
export type SourceFilePayloadContent = Blob | ArrayBuffer

export type SourceFilePayloadContentType = 'blob' | 'arraybuffer'

/** The `sourceFilePayloads` store's record. */
export interface SourceFilePayloadRecord {
  readonly tripId: TripId
  readonly id: SourceFileId
  readonly contentType: SourceFilePayloadContentType
  readonly payload: SourceFilePayloadContent
}

/** One payload as handed to/from the public API — `sourceFileId` rather than the storage-internal `id`/`payload` field names. */
export interface SourceFilePayload {
  readonly sourceFileId: SourceFileId
  readonly contentType: SourceFilePayloadContentType
  readonly content: SourceFilePayloadContent
}

/** What a caller supplies when writing a payload (via `saveTripBundle`'s options or `saveTripImportAtomically`). */
export interface SourceFilePayloadInput {
  readonly sourceFileId: SourceFileId
  readonly content: SourceFilePayloadContent
}

export function isClonableSourcePayloadContent(content: unknown): content is SourceFilePayloadContent {
  return content instanceof ArrayBuffer || content instanceof Blob
}

function contentTypeOf(content: SourceFilePayloadContent): SourceFilePayloadContentType {
  return content instanceof ArrayBuffer ? 'arraybuffer' : 'blob'
}

export function toPayloadRecord(tripId: TripId, input: SourceFilePayloadInput): SourceFilePayloadRecord {
  return { tripId, id: input.sourceFileId, contentType: contentTypeOf(input.content), payload: input.content }
}

export function toPayload(record: SourceFilePayloadRecord): SourceFilePayload {
  return { sourceFileId: record.id, contentType: record.contentType, content: record.payload }
}

export class SourcePayloadValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SourcePayloadValidationError'
  }
}

/**
 * Every check section 10 requires to run *before* any transaction opens:
 * unique ids, every id known to `knownSourceFileIds`, clonable content.
 * Throws `SourcePayloadValidationError` on the first violation found (all
 * violations are still enumerable from the message; callers needing every
 * issue at once are not a requirement here — unlike `validateTripBundle`,
 * this is a small, closed input shape).
 */
export function validateSourcePayloadInputs(
  sourcePayloads: readonly SourceFilePayloadInput[],
  knownSourceFileIds: ReadonlySet<SourceFileId>,
): void {
  const seen = new Set<SourceFileId>()
  for (const input of sourcePayloads) {
    if (seen.has(input.sourceFileId)) {
      throw new SourcePayloadValidationError(`Payload en double pour sourceFileId : ${input.sourceFileId}.`)
    }
    seen.add(input.sourceFileId)
    if (!knownSourceFileIds.has(input.sourceFileId)) {
      throw new SourcePayloadValidationError(`Payload orphelin : sourceFileId inconnu du bundle : ${input.sourceFileId}.`)
    }
    if (!isClonableSourcePayloadContent(input.content)) {
      throw new SourcePayloadValidationError(`Contenu non clonable pour sourceFileId : ${input.sourceFileId} (Blob ou ArrayBuffer attendu).`)
    }
  }
}

export interface SourceFileRepository {
  /** Retrieves one source file's binary content independently of the reconstructed `TripBundle`. `null` when no payload was ever stored for it. */
  getSourceFilePayload(tripId: TripId, sourceFileId: SourceFileId): Promise<SourceFilePayload | null>
}

export function createSourceFileRepository(db: IDBDatabase): SourceFileRepository {
  return {
    async getSourceFilePayload(tripId, sourceFileId) {
      return runInTransaction(db, [OBJECT_STORE_NAMES.sourceFilePayloads], 'readonly', async (tx) => {
        const store = tx.objectStore(OBJECT_STORE_NAMES.sourceFilePayloads)
        const record = (await promisifyRequest(store.get([tripId, sourceFileId]))) as SourceFilePayloadRecord | undefined
        return record === undefined ? null : toPayload(record)
      })
    },
  }
}
