import type { ParsingStatus, IsoDateTime } from './common.ts'
import type { SourceFileId } from './ids.ts'

/**
 * Metadata for one imported source file (typically a GPX). This is the
 * serializable half only.
 *
 * Decision on the binary payload (CDC section 11 / 8.4): a `Blob` is
 * structured-clone-compatible (so a future IndexedDB store can hold it fine)
 * but is not JSON-serializable, and TripBundle v1 must stay a plain,
 * JSON-friendly value so `validateTripBundle` can operate on `unknown` parsed
 * from JSON. `SourceFile` therefore carries only serializable metadata; the
 * eventual raw file content (Blob or ArrayBuffer) is out of scope for this
 * phase and would live in a separate, non-schema store keyed by
 * `SourceFileId` — never as a field of this type. Phase 2 does not implement
 * that store.
 */
export interface SourceFile {
  readonly id: SourceFileId
  readonly originalName: string
  readonly mimeType: string
  readonly sizeBytes: number
  readonly lastModifiedAt: IsoDateTime | null
  readonly sha256: string | null
  readonly importedAt: IsoDateTime
  readonly parsingStatus: ParsingStatus
  readonly parsingErrors: readonly string[]
}
