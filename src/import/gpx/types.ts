/**
 * Generic GPX import pipeline (CDC section 7/11/16, phase 6). Turns one or
 * more user-supplied GPX files into a TripBundle v1 and persists it via
 * `saveTripImportAtomically` (phase 5). Independent of the RGA, of the UI,
 * and of the DOM except for XML parsing (`DOMParser`, exactly like the
 * historical `src/gpx/parser.ts`) — nothing here reads `window`,
 * `document` or `localStorage`.
 *
 * Every timestamp and id is supplied by the caller (`now`/`idFactory`) —
 * nothing in this module calls `Date.now()`, `new Date()` or `Math.random()`.
 */

import type { TripId } from '../../trip-core/index.ts'

/** One user-supplied file, already read into memory — never a `File`/`Blob` handle. */
export interface GpxImportFile {
  readonly name: string
  readonly mimeType: string | null
  readonly sizeBytes: number
  readonly lastModifiedAt: string | null
  readonly bytes: ArrayBuffer
}

export interface GpxTripImportOptions {
  readonly tripId: TripId
  readonly slug: string
  readonly name: string
  readonly timezone?: string | null
  readonly language?: string
  readonly units?: 'metric'
  readonly startDate?: string | null
  readonly referenceSpeedKph?: number
  readonly departureTime?: string
  readonly totalBreakMinutes?: number
  readonly importedAt: string
  readonly engineVersion: string
}

/** `GpxTripImportOptions` with every optional field defaulted and validated (CDC section 16). */
export interface ResolvedGpxTripImportOptions {
  readonly tripId: TripId
  readonly slug: string
  readonly name: string
  readonly timezone: string | null
  readonly language: string
  readonly units: 'metric'
  readonly startDate: string | null
  readonly referenceSpeedKph: number
  readonly departureTime: string
  readonly totalBreakMinutes: number
  readonly importedAt: string
  readonly engineVersion: string
}

export type IdFactory = () => string
export type NowFn = () => string

export type ImportIssueSeverity = 'error' | 'warning'

export type ImportIssueCode =
  | 'invalid-file'
  | 'duplicate-file'
  | 'invalid-xml'
  | 'no-route-points'
  | 'invalid-coordinate'
  | 'unsupported-content'
  | 'gpx-discontinuity'
  | 'missing-altitude'
  | 'non-monotonic-timestamp'
  | 'storage-error'
  | 'validation-error'

/** One problem found anywhere in the pipeline — never inferred from a browser exception's text. */
export interface ImportIssue {
  readonly code: ImportIssueCode
  readonly severity: ImportIssueSeverity
  readonly message: string
  readonly fileName: string | null
  readonly sourceFileId: string | null
  readonly context: Readonly<Record<string, unknown>> | null
}

export type ImportErrorCode =
  | 'invalid-file'
  | 'duplicate-file'
  | 'invalid-xml'
  | 'no-route-points'
  | 'invalid-coordinate'
  | 'unsupported-content'
  | 'storage-error'
  | 'validation-error'

export interface ImportError {
  readonly code: ImportErrorCode
  readonly message: string
}

export type GpxTripImportResult =
  | {
      readonly ok: true
      readonly bundle: import('../../trip-core/index.ts').TripBundle
      readonly importJob: import('../../storage/indexeddb/import-job-repository.ts').ImportJob
      readonly issues: readonly ImportIssue[]
    }
  | {
      readonly ok: false
      readonly importJob: import('../../storage/indexeddb/import-job-repository.ts').ImportJob
      readonly issues: readonly ImportIssue[]
      readonly error: ImportError
    }

export function importIssue(
  code: ImportIssueCode,
  severity: ImportIssueSeverity,
  message: string,
  options: { readonly fileName?: string | null; readonly sourceFileId?: string | null; readonly context?: Record<string, unknown> } = {},
): ImportIssue {
  return {
    code,
    severity,
    message,
    fileName: options.fileName ?? null,
    sourceFileId: options.sourceFileId ?? null,
    context: options.context ?? null,
  }
}

export class GpxImportError extends Error {
  readonly code: ImportErrorCode
  readonly issues: readonly ImportIssue[]

  constructor(code: ImportErrorCode, message: string, issues: readonly ImportIssue[] = []) {
    super(message)
    this.name = 'GpxImportError'
    this.code = code
    this.issues = issues
  }
}
