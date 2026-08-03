/**
 * File-level validation (CDC section 6/11.2) and `SourceFile` construction —
 * before any XML parsing happens. A file rejected here never reaches
 * `analyze-gpx.ts`.
 */

import type { ParsingStatus } from '../../trip-core/index.ts'
import { sourceFileId } from '../../trip-core/index.ts'
import type { SourceFile, SourceFileId } from '../../trip-core/index.ts'
import type { GpxImportFile, ImportIssue } from './types.ts'
import { importIssue } from './types.ts'

/** GPX has no registered MIME type; browsers and OSes report any of these (or none) for a `.gpx` file. */
const ACCEPTED_MIME_TYPES = new Set(['application/gpx+xml', 'application/xml', 'text/xml', 'application/octet-stream'])

/** Used on `SourceFile.mimeType` (a required, non-nullable string in the model) whenever the input file carried none. */
export const FALLBACK_GPX_MIME_TYPE = 'application/gpx+xml'

function hasGpxExtension(name: string): boolean {
  return name.toLocaleLowerCase('en-US').endsWith('.gpx')
}

/**
 * Every deterministic, pre-parse reason a file cannot be imported at all —
 * never text scraped from a browser exception. Returns only blocking
 * (`severity: 'error'`) issues; duplicate-file detection across the whole
 * batch happens in `import-gpx-trip.ts`, once every file's hash is known.
 */
export function validateGpxImportFile(file: GpxImportFile): readonly ImportIssue[] {
  const issues: ImportIssue[] = []

  if (file.name.trim().length === 0) {
    issues.push(importIssue('invalid-file', 'error', 'Nom de fichier manquant.', { fileName: file.name }))
  } else if (!hasGpxExtension(file.name)) {
    issues.push(importIssue('invalid-file', 'error', `${file.name} : extension attendue .gpx.`, { fileName: file.name }))
  }

  if (file.mimeType !== null && file.mimeType.trim().length > 0 && !ACCEPTED_MIME_TYPES.has(file.mimeType)) {
    issues.push(importIssue('invalid-file', 'error', `${file.name} : type MIME inattendu (${file.mimeType}).`, { fileName: file.name }))
  }

  if (file.bytes.byteLength === 0) {
    issues.push(importIssue('invalid-file', 'error', `${file.name} : fichier vide.`, { fileName: file.name }))
  }

  if (file.sizeBytes !== file.bytes.byteLength) {
    issues.push(
      importIssue('invalid-file', 'error', `${file.name} : taille annoncée (${file.sizeBytes}) incohérente avec le contenu (${file.bytes.byteLength}).`, {
        fileName: file.name,
      }),
    )
  }

  return issues
}

export function buildSourceFile(
  file: GpxImportFile,
  id: string,
  sha256: string,
  importedAt: string,
  parsingStatus: ParsingStatus,
  parsingErrors: readonly string[],
): SourceFile {
  return {
    id: sourceFileId(id),
    originalName: file.name,
    mimeType: file.mimeType !== null && file.mimeType.trim().length > 0 ? file.mimeType : FALLBACK_GPX_MIME_TYPE,
    sizeBytes: file.bytes.byteLength,
    lastModifiedAt: file.lastModifiedAt,
    sha256,
    importedAt,
    parsingStatus,
    parsingErrors,
  }
}

export type { SourceFileId }
