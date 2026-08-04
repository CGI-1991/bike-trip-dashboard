/**
 * Pure state model + mutations for the "Créer un voyage" wizard, split out
 * of `import-wizard.ts` so it can be unit-tested directly under plain Node
 * (`import-wizard.ts` itself does `instanceof HTMLInputElement`/`Element`
 * checks, which throw outside a real DOM — this module never touches the
 * DOM at all).
 *
 * File identity (stability hardening, 2026-08-04): every imported file gets
 * a stable `FileEntryId` (from an injected `idFactory`) the moment it enters
 * the wizard. `StructureItem`s reference that id, never a `state.files`
 * array index — an index is not a durable identity once files can be
 * removed or added incrementally. Removing a file only removes that file's
 * own structure reference; it never rebuilds the whole structure (which
 * used to silently discard the user's manual reordering and OFF/transfer
 * slots — the "plusieurs éléments disparaissent" bug).
 */

import type { DayStructureSlot } from '../../import/gpx/day-structure.ts'
import type { GpxImportFile } from '../../import/gpx/types.ts'
import {
  checkChainContinuity,
  detectSimilarTraces,
  detectStrictDuplicates,
  isLikelyLoop,
  proposeGpxOrder,
  rotateLoopOrder,
  validateWizardForm,
} from '../../trips-manager/index.ts'
import type { GpxPreAnalysis } from '../../trips-manager/index.ts'

/** Opaque, stable identity for one imported file — never a `state.files` array index. */
export type FileEntryId = string

export interface FileEntry {
  readonly id: FileEntryId
  readonly file: GpxImportFile
  /** `name:size:lastModified` — a fast, pre-SHA signature used only to catch the same browser File object being re-selected. The SHA-based `detectStrictDuplicates` remains the final, authoritative check. */
  readonly tempSignature: string
  readonly preAnalysis: GpxPreAnalysis | null
  readonly removed: boolean
}

export interface StructureItem {
  readonly key: string
  readonly kind: DayStructureSlot['kind']
  readonly fileId?: FileEntryId
  readonly notes?: string | null
}

export type WizardStage = 'editing' | 'submitting' | 'cancelled'

export interface WizardState {
  name: string
  startDate: string
  files: FileEntry[]
  structure: StructureItem[]
  stage: WizardStage
  progressReached: Set<string>
  errorMessage: string | null
  duplicateSelectionNotice: string | null
}

let structureKeyCounter = 0
export function nextStructureKey(): string {
  structureKeyCounter += 1
  return `slot-${structureKeyCounter}`
}

export function createEmptyWizardState(): WizardState {
  return {
    name: '',
    startDate: '',
    files: [],
    structure: [],
    stage: 'editing',
    progressReached: new Set(),
    errorMessage: null,
    duplicateSelectionNotice: null,
  }
}

export function activeFiles(state: WizardState): readonly FileEntry[] {
  return state.files.filter((entry) => !entry.removed)
}

export function rideFileEntries(state: WizardState): readonly { readonly item: StructureItem; readonly entry: FileEntry }[] {
  return state.structure.flatMap((item) => {
    if (item.kind !== 'ride' || item.fileId === undefined) return []
    const entry = state.files.find((candidate) => candidate.id === item.fileId && !candidate.removed)
    return entry === undefined ? [] : [{ item, entry }]
  })
}

export function strictDuplicateFileNames(state: WizardState): ReadonlySet<string> {
  const groups = detectStrictDuplicates(
    activeFiles(state).map((entry) => ({
      fileName: entry.file.name,
      sha256: entry.preAnalysis?.sha256 ?? null,
      startLatitude: 0,
      startLongitude: 0,
      endLatitude: 0,
      endLongitude: 0,
      distanceKm: 0,
      sampledPoints: [],
    })),
  )
  return new Set(groups.flatMap((group) => group.fileNames))
}

export function similarPairs(state: WizardState) {
  const active = activeFiles(state)
    .filter((entry) => entry.preAnalysis?.status === 'valid')
    .map((entry) => entry.preAnalysis as GpxPreAnalysis)
  return detectSimilarTraces(
    active.map((preAnalysis) => ({
      fileName: preAnalysis.fileName,
      sha256: preAnalysis.sha256,
      startLatitude: preAnalysis.startLatitude ?? 0,
      startLongitude: preAnalysis.startLongitude ?? 0,
      endLatitude: preAnalysis.endLatitude ?? 0,
      endLongitude: preAnalysis.endLongitude ?? 0,
      distanceKm: preAnalysis.distanceKm ?? 0,
      sampledPoints: preAnalysis.sampledPoints,
    })),
  )
}

export function continuityWarnings(state: WizardState) {
  const rideEntries = rideFileEntries(state)
    .map(({ entry }) => entry.preAnalysis)
    .filter((preAnalysis): preAnalysis is GpxPreAnalysis => preAnalysis !== null && preAnalysis.status === 'valid')
    .map((preAnalysis) => ({
      fileName: preAnalysis.fileName,
      startLatitude: preAnalysis.startLatitude as number,
      startLongitude: preAnalysis.startLongitude as number,
      endLatitude: preAnalysis.endLatitude as number,
      endLongitude: preAnalysis.endLongitude as number,
    }))
  return checkChainContinuity(rideEntries)
}

/** Whether the current, full ride sequence (existing + newly appended items, in their current order) reads as a loop — always recomputed fresh, never tracked as separately-mutable state, so it can never go stale. */
export function computeLoopPending(state: WizardState): boolean {
  const validEntries = rideFileEntries(state)
    .map(({ entry }) => entry.preAnalysis)
    .filter((preAnalysis): preAnalysis is GpxPreAnalysis => preAnalysis !== null && preAnalysis.status === 'valid')
  if (validEntries.length < 2) return false
  const candidates = validEntries.map((preAnalysis) => ({
    fileName: preAnalysis.fileName,
    startLatitude: preAnalysis.startLatitude as number,
    startLongitude: preAnalysis.startLongitude as number,
    endLatitude: preAnalysis.endLatitude as number,
    endLongitude: preAnalysis.endLongitude as number,
  }))
  return isLikelyLoop(candidates, candidates.map((_candidate, index) => index))
}

export function formValidation(state: WizardState) {
  const strictDuplicates = strictDuplicateFileNames(state)
  return validateWizardForm({
    name: state.name,
    startDate: state.startDate || null,
    files: activeFiles(state).map((entry) => ({
      fileName: entry.file.name,
      status: entry.preAnalysis?.status === 'valid' ? 'valid' : 'invalid',
      isUnresolvedStrictDuplicate: strictDuplicates.has(entry.file.name),
      removed: false,
    })),
  })
}

/** Proposes an order among only the newly-added, now-valid files and appends them — existing structure items (manual order, OFF/transfer slots) are never touched. Mutates `state.structure` in place. */
export function appendNewRideSlots(state: WizardState, newFileIds: readonly FileEntryId[]): void {
  const newValidEntries = newFileIds
    .map((id) => state.files.find((entry) => entry.id === id))
    .filter((entry): entry is FileEntry => entry !== undefined && !entry.removed && entry.preAnalysis !== null && entry.preAnalysis.status === 'valid')
  if (newValidEntries.length === 0) return

  const candidates = newValidEntries.map((entry) => {
    const preAnalysis = entry.preAnalysis as GpxPreAnalysis
    return {
      fileName: preAnalysis.fileName,
      startLatitude: preAnalysis.startLatitude as number,
      startLongitude: preAnalysis.startLongitude as number,
      endLatitude: preAnalysis.endLatitude as number,
      endLongitude: preAnalysis.endLongitude as number,
    }
  })
  const proposal = proposeGpxOrder(candidates)
  const newItems: StructureItem[] = proposal.order.map((position) => ({
    key: nextStructureKey(),
    kind: 'ride',
    fileId: newValidEntries[position]?.id,
  }))
  state.structure = [...state.structure, ...newItems]
}

export interface AddFilesInput {
  readonly rawFiles: readonly { readonly name: string; readonly size: number; readonly lastModified: number; readonly mimeType: string | null; readonly bytes: ArrayBuffer }[]
  readonly idFactory: () => string
  readonly preAnalyzeFiles: (files: readonly GpxImportFile[]) => Promise<readonly GpxPreAnalysis[]>
}

/**
 * Adds newly-selected files to `state`, mutating it in place. Deduplicates
 * against the currently-ACTIVE files by a pre-SHA `name:size:lastModified`
 * signature (CDC hardening section 4) — a file already loaded is silently
 * skipped and reported via `state.duplicateSelectionNotice`, never added as
 * a second, silent copy. Each accepted file's pre-analysis result is
 * written back by matching its own stable id, never a positional
 * `startIndex + offset` — safe even when this call overlaps with another
 * `addFilesToState`/`removeFileFromState` call on the same `state`.
 */
export async function addFilesToState(state: WizardState, input: AddFilesInput): Promise<void> {
  const seenSignatures = new Set(activeFiles(state).map((entry) => entry.tempSignature))
  const accepted: { readonly raw: AddFilesInput['rawFiles'][number]; readonly tempSignature: string }[] = []
  const duplicateNames: string[] = []

  for (const raw of input.rawFiles) {
    const tempSignature = `${raw.name}:${raw.size}:${raw.lastModified}`
    if (seenSignatures.has(tempSignature)) {
      duplicateNames.push(raw.name)
      continue
    }
    seenSignatures.add(tempSignature)
    accepted.push({ raw, tempSignature })
  }
  state.duplicateSelectionNotice = duplicateNames.length === 0 ? null : `Déjà chargé, ignoré : ${duplicateNames.join(', ')}.`
  if (accepted.length === 0) return

  const newEntries: { readonly id: FileEntryId; readonly file: GpxImportFile; readonly tempSignature: string }[] = accepted.map(({ raw, tempSignature }) => {
    const lastModifiedAt = Number.isFinite(raw.lastModified) ? new Date(raw.lastModified).toISOString() : null
    return {
      id: input.idFactory(),
      file: { name: raw.name, mimeType: raw.mimeType, sizeBytes: raw.size, lastModifiedAt, bytes: raw.bytes },
      tempSignature,
    }
  })

  for (const entry of newEntries) {
    state.files.push({ id: entry.id, file: entry.file, tempSignature: entry.tempSignature, preAnalysis: null, removed: false })
  }

  const analyses = await input.preAnalyzeFiles(newEntries.map((entry) => entry.file))
  analyses.forEach((preAnalysis, offset) => {
    const id = newEntries[offset]?.id
    if (id === undefined) return
    const index = state.files.findIndex((entry) => entry.id === id)
    if (index >= 0) state.files[index] = { ...(state.files[index] as FileEntry), preAnalysis }
  })
  appendNewRideSlots(state, newEntries.map((entry) => entry.id))
}

/** Removes exactly this file and exactly its own structure reference — never rebuilds the structure, never touches any other file or slot. */
export function removeFileFromState(state: WizardState, fileId: FileEntryId): void {
  const index = state.files.findIndex((entry) => entry.id === fileId)
  if (index === -1) return
  const entry = state.files[index] as FileEntry
  state.files[index] = { ...entry, removed: true }
  state.structure = state.structure.filter((item) => !(item.kind === 'ride' && item.fileId === fileId))
}

export function moveStructureItem(state: WizardState, position: number, direction: -1 | 1): void {
  if (!Number.isInteger(position) || position < 0 || position >= state.structure.length) return
  const target = position + direction
  if (target < 0 || target >= state.structure.length) return
  const current = state.structure[position]
  const other = state.structure[target]
  if (current === undefined || other === undefined) return
  const next = [...state.structure]
  next[position] = other
  next[target] = current
  state.structure = next
}

export function insertSlot(state: WizardState, afterPosition: number, kind: 'off' | 'transfer'): void {
  if (!Number.isInteger(afterPosition)) return
  const insertAt = Math.min(Math.max(afterPosition + 1, 0), state.structure.length)
  const next = [...state.structure]
  next.splice(insertAt, 0, { key: nextStructureKey(), kind, notes: null })
  state.structure = next
}

export function removeSlot(state: WizardState, position: number): void {
  if (!Number.isInteger(position) || position < 0 || position >= state.structure.length) return
  const target = state.structure[position]
  if (target === undefined || target.kind === 'ride') return
  const next = [...state.structure]
  next.splice(position, 1)
  state.structure = next
}

export function chooseFirstStage(state: WizardState, fileId: FileEntryId): void {
  const rideEntries = rideFileEntries(state)
  if (rideEntries.some(({ entry }) => entry.preAnalysis === null || entry.preAnalysis.status !== 'valid')) return
  const firstPosition = rideEntries.findIndex(({ entry }) => entry.id === fileId)
  if (firstPosition === -1) return

  // `candidates` and `order` are built from the exact same, freshly-indexed
  // `rideEntries` array — never a global file id/index mixed with a
  // separately-filtered candidate list, which is what silently misaligned
  // the historical implementation.
  const candidates = rideEntries.map(({ entry }) => {
    const preAnalysis = entry.preAnalysis as GpxPreAnalysis
    return {
      fileName: preAnalysis.fileName,
      startLatitude: preAnalysis.startLatitude as number,
      startLongitude: preAnalysis.startLongitude as number,
      endLatitude: preAnalysis.endLatitude as number,
      endLongitude: preAnalysis.endLongitude as number,
    }
  })
  const order = rideEntries.map((_entry, index) => index)
  const rotated = rotateLoopOrder(candidates, order, firstPosition)
  state.structure = rotated.map((position) => ({ key: nextStructureKey(), kind: 'ride', fileId: rideEntries[position]?.entry.id }))
}
