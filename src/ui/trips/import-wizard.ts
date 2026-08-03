/**
 * "Créer un voyage" assistant (CDC phase 6C1 sections 8-23, annexe
 * fonctionnelle sections 2-13). Compact by design (section 4: simplicité
 * d'abord) — one continuous sequence, no map, no heavy preview, advanced
 * settings collapsed by default. Follows this codebase's existing render
 * pattern (`innerHTML` rebuilt from state, one delegated listener) rather
 * than a UI framework.
 */

import { importGpxTrip } from '../../import/gpx/import-gpx-trip.ts'
import type { ImportProgressLabel } from '../../import/gpx/import-gpx-trip.ts'
import type { DayStructureSlot } from '../../import/gpx/day-structure.ts'
import type { GpxImportFile } from '../../import/gpx/types.ts'
import {
  checkChainContinuity,
  detectSimilarTraces,
  detectStrictDuplicates,
  preAnalyzeGpxFiles,
  proposeGpxOrder,
  rotateLoopOrder,
  validateWizardForm,
} from '../../trips-manager/index.ts'
import type { GpxPreAnalysis } from '../../trips-manager/index.ts'
import { deleteTripCompletely } from '../../trips-manager/trip-manager-actions.ts'
import type { TripId } from '../../trip-core/index.ts'

function asTripId(value: string): TripId {
  return value as TripId
}

export interface ImportWizardDeps {
  readonly database: IDBDatabase
  readonly now: () => string
  readonly idFactory: () => string
  readonly referenceSpeedKph?: number
}

export interface ImportWizardResult {
  readonly tripId: TripId
  readonly name: string
  readonly startDate: string | null
  readonly endDate: string | null
  readonly stageCount: number
  readonly totalDistanceKm: number
  readonly totalElevationGainM: number
  readonly climbCount: number
}

const PROGRESS_STEPS: ReadonlyArray<{ readonly label: ImportProgressLabel; readonly text: string }> = [
  { label: 'reading', text: 'Lecture' },
  { label: 'validating', text: 'Validation' },
  { label: 'analyzing', text: 'Analyse' },
  { label: 'climbs', text: 'Montées' },
  { label: 'stages', text: 'Étapes' },
  { label: 'saving', text: 'Enregistrement' },
]

interface FileEntry {
  readonly file: GpxImportFile
  readonly preAnalysis: GpxPreAnalysis | null
}

interface StructureItem {
  readonly key: string
  readonly kind: DayStructureSlot['kind']
  readonly fileIndex?: number
  readonly notes?: string | null
}

type WizardStage = 'editing' | 'submitting' | 'cancelled'

interface WizardState {
  name: string
  startDate: string
  files: FileEntry[]
  removedFileIndices: Set<number>
  structure: StructureItem[]
  loopPending: boolean
  stage: WizardStage
  progressReached: Set<ImportProgressLabel>
  errorMessage: string | null
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

let structureKeyCounter = 0
function nextStructureKey(): string {
  structureKeyCounter += 1
  return `slot-${structureKeyCounter}`
}

function activeFileIndices(state: WizardState): readonly number[] {
  return state.files.map((_file, index) => index).filter((index) => !state.removedFileIndices.has(index))
}

/** Rebuilds `structure` from scratch against the currently active files, proposing an order automatically. Any previous OFF/transfer insertions are intentionally not preserved — CDC phase 6C1 keeps this simple by design; see the module header. */
function rebuildStructure(state: WizardState): void {
  const activeIndices = activeFileIndices(state)
  const analyzed = activeIndices
    .map((index) => ({ index, preAnalysis: state.files[index]?.preAnalysis ?? null }))
    .filter((entry): entry is { index: number; preAnalysis: GpxPreAnalysis } => entry.preAnalysis !== null && entry.preAnalysis.status === 'valid')

  if (analyzed.length === 0) {
    state.structure = []
    state.loopPending = false
    return
  }

  const candidates = analyzed.map((entry) => ({
    fileName: entry.preAnalysis.fileName,
    startLatitude: entry.preAnalysis.startLatitude as number,
    startLongitude: entry.preAnalysis.startLongitude as number,
    endLatitude: entry.preAnalysis.endLatitude as number,
    endLongitude: entry.preAnalysis.endLongitude as number,
  }))
  const proposal = proposeGpxOrder(candidates)
  state.loopPending = proposal.isLoop
  state.structure = proposal.order.map((position) => ({
    key: nextStructureKey(),
    kind: 'ride',
    fileIndex: analyzed[position]?.index,
  }))
}

export function createImportWizard(container: HTMLElement, deps: ImportWizardDeps, onCreated: (result: ImportWizardResult) => void, onCancelled: () => void): void {
  const state: WizardState = {
    name: '',
    startDate: '',
    files: [],
    removedFileIndices: new Set(),
    structure: [],
    loopPending: false,
    stage: 'editing',
    progressReached: new Set(),
    errorMessage: null,
  }

  function rideFileEntries(): readonly { readonly item: StructureItem; readonly entry: FileEntry }[] {
    return state.structure
      .filter((item) => item.kind === 'ride' && item.fileIndex !== undefined)
      .map((item) => ({ item, entry: state.files[item.fileIndex as number] as FileEntry }))
  }

  function strictDuplicateFileNames(): ReadonlySet<string> {
    const candidates = state.files
      .map((entry, index) => ({ entry, index }))
      .filter(({ index }) => !state.removedFileIndices.has(index))
      .map(({ entry }) => ({ fileName: entry.file.name, sha256: entry.preAnalysis?.sha256 ?? null }))
    const groups = detectStrictDuplicates(
      candidates.map((candidate) => ({
        fileName: candidate.fileName,
        sha256: candidate.sha256,
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

  function similarPairs() {
    const active = state.files
      .map((entry, index) => ({ entry, index }))
      .filter(({ index, entry }) => !state.removedFileIndices.has(index) && entry.preAnalysis?.status === 'valid')
      .map(({ entry }) => entry.preAnalysis as GpxPreAnalysis)
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

  function continuityWarnings() {
    const rideEntries = rideFileEntries()
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

  function formValidation() {
    const strictDuplicates = strictDuplicateFileNames()
    return validateWizardForm({
      name: state.name,
      startDate: state.startDate || null,
      files: state.files
        .map((entry, index) => ({ entry, index }))
        .filter(({ index }) => !state.removedFileIndices.has(index))
        .map(({ entry }) => ({
          fileName: entry.file.name,
          status: entry.preAnalysis?.status === 'valid' ? 'valid' : 'invalid',
          isUnresolvedStrictDuplicate: strictDuplicates.has(entry.file.name),
          removed: false,
        })),
    })
  }

  async function addFiles(fileList: FileList): Promise<void> {
    const newImportFiles: GpxImportFile[] = []
    for (const file of Array.from(fileList)) {
      const bytes = await file.arrayBuffer()
      // `file.lastModified` is data carried by the file itself, not the
      // current time — converting it to ISO-8601 here is the one
      // unavoidable browser-boundary `Date` use in this whole feature.
      const lastModifiedAt = Number.isFinite(file.lastModified) ? new Date(file.lastModified).toISOString() : null
      newImportFiles.push({ name: file.name, mimeType: file.type || null, sizeBytes: file.size, lastModifiedAt, bytes })
    }

    const startIndex = state.files.length
    for (const file of newImportFiles) {
      state.files.push({ file, preAnalysis: null })
    }
    render()

    const analyses = await preAnalyzeGpxFiles(newImportFiles)
    analyses.forEach((preAnalysis, offset) => {
      const entry = state.files[startIndex + offset]
      if (entry !== undefined) state.files[startIndex + offset] = { ...entry, preAnalysis }
    })
    rebuildStructure(state)
    render()
  }

  function removeFile(index: number): void {
    state.removedFileIndices.add(index)
    rebuildStructure(state)
    render()
  }

  function moveStructureItem(position: number, direction: -1 | 1): void {
    const target = position + direction
    if (target < 0 || target >= state.structure.length) return
    const next = [...state.structure]
    const temp = next[position]
    next[position] = next[target] as StructureItem
    next[target] = temp as StructureItem
    state.structure = next
    render()
  }

  function insertSlot(afterPosition: number, kind: 'off' | 'transfer'): void {
    const insertAt = Math.min(Math.max(afterPosition + 1, 0), state.structure.length)
    const next = [...state.structure]
    next.splice(insertAt, 0, { key: nextStructureKey(), kind, notes: null })
    state.structure = next
    render()
  }

  function removeSlot(position: number): void {
    const target = state.structure[position]
    if (target === undefined || target.kind === 'ride') return
    const next = [...state.structure]
    next.splice(position, 1)
    state.structure = next
    render()
  }

  function chooseFirstStage(fileIndex: number): void {
    const rideItems = state.structure.filter((item) => item.kind === 'ride')
    const order = rideItems.map((item) => item.fileIndex as number)
    const candidates = order
      .map((index) => state.files[index]?.preAnalysis)
      .filter((preAnalysis): preAnalysis is GpxPreAnalysis => preAnalysis !== null && preAnalysis !== undefined)
      .map((preAnalysis) => ({
        fileName: preAnalysis.fileName,
        startLatitude: preAnalysis.startLatitude as number,
        startLongitude: preAnalysis.startLongitude as number,
        endLatitude: preAnalysis.endLatitude as number,
        endLongitude: preAnalysis.endLongitude as number,
      }))
    const rotated = rotateLoopOrder(candidates, order, fileIndex)
    state.structure = rotated.map((index) => ({ key: nextStructureKey(), kind: 'ride', fileIndex: index }))
    state.loopPending = false
    render()
  }

  async function submit(): Promise<void> {
    const validation = formValidation()
    if (!validation.canCreate) return

    state.stage = 'submitting'
    state.progressReached = new Set()
    state.errorMessage = null
    render()

    const orderedFiles = rideFileEntries().map(({ entry }) => entry.file)
    const daySlots: DayStructureSlot[] = state.structure.map((item) =>
      item.kind === 'ride' ? { kind: 'ride' } : { kind: item.kind, notes: item.notes ?? null },
    )
    const tripId = asTripId(deps.idFactory())
    const importedAt = deps.now()

    const result = await importGpxTrip({
      files: orderedFiles,
      options: {
        tripId,
        slug: String(tripId),
        name: state.name.trim(),
        startDate: state.startDate,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        referenceSpeedKph: deps.referenceSpeedKph,
        totalBreakMinutes: 'adaptive',
        importedAt,
        engineVersion: 'trips-manager-wizard@1',
      },
      database: deps.database,
      idFactory: deps.idFactory,
      now: deps.now,
      dayStructure: daySlots,
      onProgress: (label) => {
        state.progressReached.add(label)
        render()
      },
    })

    if ((state.stage as WizardStage) === 'cancelled') {
      // The user cancelled while the (short, atomic) write was already in
      // flight — CDC section 21: it cannot be aborted mid-flight, so let it
      // finish, then never activate it, and remove it again so no unwanted
      // trip lingers ("aucun TripBundle partiel" in spirit — and no unwanted
      // complete one either).
      if (result.ok) {
        await deleteTripCompletely(deps.database, result.bundle.metadata.id, importedAt.slice(0, 10))
      }
      onCancelled()
      return
    }

    if (!result.ok) {
      state.stage = 'editing'
      state.errorMessage = result.error.message
      render()
      return
    }

    onCreated({
      tripId: result.bundle.metadata.id,
      name: result.bundle.metadata.name,
      startDate: result.bundle.metadata.startDate,
      endDate: result.bundle.metadata.endDate,
      stageCount: result.bundle.stages.length,
      totalDistanceKm: result.bundle.stages.reduce((total, stage) => total + (stage.distanceKm ?? 0), 0),
      totalElevationGainM: result.bundle.stages.reduce((total, stage) => total + (stage.elevationGainM ?? 0), 0),
      climbCount: result.bundle.climbs.length,
    })
  }

  function cancel(): void {
    if (state.stage === 'submitting') {
      state.stage = 'cancelled'
      render()
      return
    }
    onCancelled()
  }

  function renderFileRow(entry: FileEntry, index: number): string {
    const removed = state.removedFileIndices.has(index)
    if (removed) return ''
    const preAnalysis = entry.preAnalysis
    const isDuplicate = strictDuplicateFileNames().has(entry.file.name)

    if (preAnalysis === null) {
      return `<li class="wizard-file" data-file-row><span class="wizard-file__name">${escapeHtml(entry.file.name)}</span><span class="tag tag--data">Analyse…</span></li>`
    }
    if (preAnalysis.status === 'invalid') {
      return `<li class="wizard-file wizard-file--invalid" data-file-row><span class="wizard-file__name">${escapeHtml(entry.file.name)}</span><span class="tag tag--error">À corriger</span><p class="wizard-file__error">${escapeHtml(preAnalysis.errorMessage ?? 'Fichier invalide.')}</p><button class="button button--quiet" type="button" data-action="remove-file" data-file-index="${index}">Retirer</button></li>`
    }
    return `<li class="wizard-file" data-file-row><span class="wizard-file__name">${escapeHtml(entry.file.name)}</span>${isDuplicate ? '<span class="tag tag--error">Doublon strict</span>' : ''}<dl class="wizard-file__metrics"><div><dt>Distance</dt><dd>${(preAnalysis.distanceKm ?? 0).toFixed(1)} km</dd></div><div><dt>D+</dt><dd>${preAnalysis.elevationGainM === null ? '—' : `+${Math.round(preAnalysis.elevationGainM)} m`}</dd></div><div><dt>D−</dt><dd>${preAnalysis.elevationLossM === null ? '—' : `−${Math.round(preAnalysis.elevationLossM)} m`}</dd></div></dl><button class="button button--quiet" type="button" data-action="remove-file" data-file-index="${index}">Retirer</button></li>`
  }

  function renderStructureRow(item: StructureItem, position: number): string {
    const isFirst = position === 0
    const isLast = position === state.structure.length - 1
    const moveControls = `<div class="wizard-structure__move"><button class="button button--quiet" type="button" data-action="move-up" data-position="${position}" ${isFirst ? 'disabled' : ''} aria-label="Monter">↑</button><button class="button button--quiet" type="button" data-action="move-down" data-position="${position}" ${isLast ? 'disabled' : ''} aria-label="Descendre">↓</button></div>`
    const insertControls = `<div class="wizard-structure__insert"><button class="button button--quiet" type="button" data-action="insert-off" data-position="${position}">+ OFF</button><button class="button button--quiet" type="button" data-action="insert-transfer" data-position="${position}">+ Transfert</button></div>`

    if (item.kind === 'ride') {
      const entry = item.fileIndex !== undefined ? state.files[item.fileIndex] : undefined
      const name = entry?.file.name ?? '—'
      return `<li class="wizard-structure__row" data-structure-row data-position="${position}"><span class="tag tag--ride">Étape ${position + 1}</span><span class="wizard-structure__name">${escapeHtml(name)}</span>${moveControls}</li>${insertControls}`
    }

    const label = item.kind === 'off' ? 'OFF' : 'Transfert'
    return `<li class="wizard-structure__row wizard-structure__row--${item.kind}" data-structure-row data-position="${position}"><span class="tag tag--off">${label}</span>${moveControls}<button class="button button--quiet" type="button" data-action="remove-slot" data-position="${position}">Retirer</button></li>${insertControls}`
  }

  function renderAlerts(): string {
    const duplicates = strictDuplicateFileNames()
    const similar = similarPairs()
    const continuity = continuityWarnings()
    if (duplicates.size === 0 && similar.length === 0 && continuity.length === 0) return ''

    const items: string[] = []
    if (duplicates.size > 0) {
      items.push(`<li class="wizard-alert wizard-alert--blocking">Doublon strict détecté (${duplicates.size} fichier(s)) — retirez-le avant de continuer.</li>`)
    }
    for (const pair of similar) {
      items.push(`<li class="wizard-alert">Traces très similaires : ${escapeHtml(pair.fileNameA)} et ${escapeHtml(pair.fileNameB)} (non bloquant).</li>`)
    }
    for (const warning of continuity) {
      items.push(`<li class="wizard-alert">Rupture de continuité entre ${escapeHtml(warning.fromFileName)} et ${escapeHtml(warning.toFileName)} (${warning.gapKm.toFixed(1)} km, non bloquant).</li>`)
    }
    return `<ul class="wizard-alerts" data-wizard-alerts>${items.join('')}</ul>`
  }

  function renderProgress(): string {
    if (state.stage !== 'submitting') return ''
    const items = PROGRESS_STEPS.map(
      ({ label, text }) => `<li class="${state.progressReached.has(label) ? 'is-done' : ''}">${text}</li>`,
    ).join('')
    return `<ol class="wizard-progress" data-wizard-progress role="status" aria-live="polite">${items}</ol>`
  }

  function render(): void {
    const validation = formValidation()
    const activeCount = activeFileIndices(state).length
    const invalidCount = state.files.filter((entry, index) => !state.removedFileIndices.has(index) && entry.preAnalysis?.status === 'invalid').length
    const validCount = activeCount - invalidCount

    const summaryLine =
      state.files.length === 0
        ? ''
        : `<p class="wizard-summary" data-wizard-summary>${validCount} fichier${validCount > 1 ? 's' : ''} prêt${validCount > 1 ? 's' : ''}${invalidCount > 0 ? ` · ${invalidCount} fichier${invalidCount > 1 ? 's' : ''} à corriger` : ''}</p>`

    const loopChoice = state.loopPending
      ? `<div class="wizard-loop-choice" data-wizard-loop-choice><p>Boucle détectée — choisissez la première étape :</p><select data-action="choose-first-stage">${rideFileEntries()
          .map(({ item, entry }) => `<option value="${item.fileIndex}">${escapeHtml(entry.file.name)}</option>`)
          .join('')}</select></div>`
      : ''

    container.innerHTML = `
      <div class="wizard" data-wizard>
        <header class="view-heading"><p class="eyebrow">Nouveau voyage</p><h2>Créer un voyage</h2></header>
        <div class="field"><label for="wizard-name">Nom du voyage</label><div class="field__control"><input id="wizard-name" type="text" data-field="name" value="${escapeHtml(state.name)}" required></div></div>
        <div class="field"><label for="wizard-start-date">Date de départ</label><div class="field__control"><input id="wizard-start-date" type="date" data-field="start-date" value="${escapeHtml(state.startDate)}" required></div></div>
        <div class="field"><label for="wizard-files">Fichiers GPX</label><div class="field__control"><input id="wizard-files" type="file" accept=".gpx" multiple data-field="files"></div></div>
        ${summaryLine}
        <ul class="wizard-file-list" data-wizard-file-list>${state.files.map((entry, index) => renderFileRow(entry, index)).join('')}</ul>
        ${state.structure.length > 0
          ? `<section class="wizard-structure" data-wizard-structure><h3>Structure du voyage</h3>${loopChoice}<ul class="wizard-structure__list">${state.structure.map((item, position) => renderStructureRow(item, position)).join('')}</ul></section>`
          : ''}
        ${renderAlerts()}
        <details class="wizard-advanced"><summary>Réglages avancés</summary><p>Vitesse de référence : ${deps.referenceSpeedKph ?? 18} km/h. Budget de pauses calculé automatiquement selon la distance, la durée et le D+ de chaque étape.</p></details>
        ${state.errorMessage !== null ? `<p class="wizard-error" role="alert">${escapeHtml(state.errorMessage)}</p>` : ''}
        ${renderProgress()}
        <footer class="wizard-actions">
          <button class="button button--primary" type="button" data-action="submit" ${validation.canCreate && state.stage === 'editing' ? '' : 'disabled'}>Créer le voyage</button>
          <button class="button button--quiet" type="button" data-action="cancel">Annuler</button>
        </footer>
        ${!validation.canCreate && state.stage === 'editing' ? `<ul class="wizard-validation-reasons">${validation.reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join('')}</ul>` : ''}
      </div>`
  }

  container.addEventListener('input', (event) => {
    const target = event.target
    if (!(target instanceof HTMLInputElement)) return
    if (target.dataset.field === 'name') state.name = target.value
    else if (target.dataset.field === 'start-date') state.startDate = target.value
    else return
    render()
  })

  container.addEventListener('change', (event) => {
    const target = event.target
    if (target instanceof HTMLInputElement && target.dataset.field === 'files' && target.files !== null && target.files.length > 0) {
      void addFiles(target.files)
      return
    }
    if (target instanceof HTMLSelectElement && target.dataset.action === 'choose-first-stage') {
      chooseFirstStage(Number(target.value))
    }
  })

  container.addEventListener('click', (event) => {
    const target = event.target
    if (!(target instanceof Element)) return
    const button = target.closest<HTMLElement>('[data-action]')
    if (button === null) return
    const action = button.dataset.action
    const position = button.dataset.position === undefined ? null : Number(button.dataset.position)
    const fileIndex = button.dataset.fileIndex === undefined ? null : Number(button.dataset.fileIndex)

    if (action === 'remove-file' && fileIndex !== null) removeFile(fileIndex)
    else if (action === 'move-up' && position !== null) moveStructureItem(position, -1)
    else if (action === 'move-down' && position !== null) moveStructureItem(position, 1)
    else if (action === 'insert-off' && position !== null) insertSlot(position, 'off')
    else if (action === 'insert-transfer' && position !== null) insertSlot(position, 'transfer')
    else if (action === 'remove-slot' && position !== null) removeSlot(position)
    else if (action === 'submit') void submit()
    else if (action === 'cancel') cancel()
  })

  render()
}
