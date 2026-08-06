/**
 * "Créer un voyage" assistant (CDC phase 6C1 sections 8-23, annexe
 * fonctionnelle sections 2-13). Compact by design (section 4: simplicité
 * d'abord) — one continuous sequence, no map, no heavy preview, advanced
 * settings collapsed by default. Follows this codebase's existing render
 * pattern (`innerHTML` rebuilt from state, one delegated listener) rather
 * than a UI framework.
 *
 * All state mutation and validation logic lives in `import-wizard-state.ts`
 * (DOM-free, directly unit-testable) — this module is only rendering plus
 * DOM event wiring.
 */

import { importGpxTrip } from '../../import/gpx/import-gpx-trip.ts'
import type { ImportProgressLabel } from '../../import/gpx/import-gpx-trip.ts'
import type { DayStructureSlot } from '../../import/gpx/day-structure.ts'
import { preAnalyzeGpxFiles } from '../../trips-manager/index.ts'
import type { GpxPreAnalysis } from '../../trips-manager/index.ts'
import type { GpxImportFile } from '../../import/gpx/types.ts'
import { deleteTripCompletely } from '../../trips-manager/trip-manager-actions.ts'
import type { TripId } from '../../trip-core/index.ts'
import {
  activeFiles,
  addFilesToState,
  chooseFirstStage,
  computeLoopPending,
  continuityWarnings,
  createEmptyWizardState,
  formValidation,
  insertSlot,
  moveStructureItem,
  removeFileFromState,
  removeSlot,
  rideFileEntries,
  similarPairs,
  strictDuplicateFileNames,
} from './import-wizard-state.ts'
import type { FileEntry, FileEntryId, StructureItem, WizardStage, WizardState } from './import-wizard-state.ts'

function asTripId(value: string): TripId {
  return value as TripId
}

export interface ImportWizardDeps {
  readonly database: IDBDatabase
  readonly now: () => string
  readonly idFactory: () => string
  /** Test-only seam; defaults to the real `preAnalyzeGpxFiles`. */
  readonly preAnalyzeFiles?: (files: readonly GpxImportFile[]) => Promise<readonly GpxPreAnalysis[]>
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

export interface ImportWizardHandle {
  /** Removes every listener this wizard instance attached to `container` — call before the container is reused for another screen. */
  readonly destroy: () => void
}

const PROGRESS_STEPS: ReadonlyArray<{ readonly label: ImportProgressLabel; readonly text: string }> = [
  { label: 'reading', text: 'Lecture' },
  { label: 'validating', text: 'Validation' },
  { label: 'analyzing', text: 'Analyse' },
  { label: 'climbs', text: 'Montées' },
  { label: 'stages', text: 'Étapes' },
  { label: 'saving', text: 'Enregistrement' },
]

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

export function createImportWizard(container: HTMLElement, deps: ImportWizardDeps, onCreated: (result: ImportWizardResult) => void, onCancelled: () => void): ImportWizardHandle {
  const controller = new AbortController()
  const preAnalyzeFiles = deps.preAnalyzeFiles ?? preAnalyzeGpxFiles
  const state: WizardState = createEmptyWizardState()

  async function addFiles(rawFiles: readonly File[]): Promise<void> {
    const rawEntries = await Promise.all(rawFiles.map(async (file) => ({
      name: file.name,
      size: file.size,
      lastModified: file.lastModified,
      mimeType: file.type || null,
      bytes: await file.arrayBuffer(),
    })))
    await addFilesToState(state, { rawFiles: rawEntries, idFactory: deps.idFactory, preAnalyzeFiles })
    render()
  }

  async function submit(): Promise<void> {
    const validation = formValidation(state)
    if (!validation.canCreate) return

    state.stage = 'submitting'
    state.progressReached = new Set()
    state.errorMessage = null
    render()

    const orderedFiles = rideFileEntries(state).map(({ entry }) => entry.file)
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
        referenceSpeedKph: state.referenceSpeedKph,
        mountainMode: state.mountainMode,
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

  function renderFileRow(entry: FileEntry): string {
    if (entry.removed) return ''
    const preAnalysis = entry.preAnalysis
    const isDuplicate = strictDuplicateFileNames(state).has(entry.file.name)

    if (preAnalysis === null) {
      return `<li class="wizard-file" data-file-row><span class="wizard-file__name">${escapeHtml(entry.file.name)}</span><span class="tag tag--data">Analyse…</span></li>`
    }
    if (preAnalysis.status === 'invalid') {
      return `<li class="wizard-file wizard-file--invalid" data-file-row><span class="wizard-file__name">${escapeHtml(entry.file.name)}</span><span class="tag tag--error">À corriger</span><p class="wizard-file__error">${escapeHtml(preAnalysis.errorMessage ?? 'Fichier invalide.')}</p><button class="button button--quiet" type="button" data-action="remove-file" data-file-id="${escapeHtml(entry.id)}">Retirer</button></li>`
    }
    return `<li class="wizard-file" data-file-row><span class="wizard-file__name">${escapeHtml(entry.file.name)}</span>${isDuplicate ? '<span class="tag tag--error">Doublon strict</span>' : ''}<dl class="wizard-file__metrics"><div><dt>Distance</dt><dd>${(preAnalysis.distanceKm ?? 0).toFixed(1)} km</dd></div><div><dt>D+</dt><dd>${preAnalysis.elevationGainM === null ? '—' : `+${Math.round(preAnalysis.elevationGainM)} m`}</dd></div><div><dt>D−</dt><dd>${preAnalysis.elevationLossM === null ? '—' : `−${Math.round(preAnalysis.elevationLossM)} m`}</dd></div></dl><button class="button button--quiet" type="button" data-action="remove-file" data-file-id="${escapeHtml(entry.id)}">Retirer</button></li>`
  }

  function renderStructureRow(item: StructureItem, position: number): string {
    const isFirst = position === 0
    const isLast = position === state.structure.length - 1
    const moveControls = `<div class="wizard-structure__move"><button class="button button--quiet" type="button" data-action="move-up" data-position="${position}" ${isFirst ? 'disabled' : ''} aria-label="Monter">↑</button><button class="button button--quiet" type="button" data-action="move-down" data-position="${position}" ${isLast ? 'disabled' : ''} aria-label="Descendre">↓</button></div>`
    const insertControls = `<div class="wizard-structure__insert"><button class="button button--quiet" type="button" data-action="insert-off" data-position="${position}">+ OFF</button><button class="button button--quiet" type="button" data-action="insert-transfer" data-position="${position}">+ Transfert</button></div>`

    if (item.kind === 'ride') {
      const entry = item.fileId !== undefined ? state.files.find((candidate) => candidate.id === item.fileId) : undefined
      const name = entry?.file.name ?? '—'
      return `<li class="wizard-structure__row" data-structure-row data-position="${position}"><span class="tag tag--ride">Étape ${position + 1}</span><span class="wizard-structure__name">${escapeHtml(name)}</span>${moveControls}</li>${insertControls}`
    }

    const label = item.kind === 'off' ? 'OFF' : 'Transfert'
    return `<li class="wizard-structure__row wizard-structure__row--${item.kind}" data-structure-row data-position="${position}"><span class="tag tag--off">${label}</span>${moveControls}<button class="button button--quiet" type="button" data-action="remove-slot" data-position="${position}">Retirer</button></li>${insertControls}`
  }

  function renderAlerts(): string {
    const duplicates = strictDuplicateFileNames(state)
    const similar = similarPairs(state)
    const continuity = continuityWarnings(state)
    if (duplicates.size === 0 && similar.length === 0 && continuity.length === 0 && state.duplicateSelectionNotice === null) return ''

    const items: string[] = []
    if (state.duplicateSelectionNotice !== null) {
      items.push(`<li class="wizard-alert">${escapeHtml(state.duplicateSelectionNotice)}</li>`)
    }
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
    const validation = formValidation(state)
    const active = activeFiles(state)
    const invalidCount = active.filter((entry) => entry.preAnalysis?.status === 'invalid').length
    const validCount = active.length - invalidCount
    const loopPending = computeLoopPending(state)

    const summaryLine =
      state.files.length === 0
        ? ''
        : `<p class="wizard-summary" data-wizard-summary>${validCount} fichier${validCount > 1 ? 's' : ''} prêt${validCount > 1 ? 's' : ''}${invalidCount > 0 ? ` · ${invalidCount} fichier${invalidCount > 1 ? 's' : ''} à corriger` : ''}</p>`

    const loopChoice = loopPending
      ? `<div class="wizard-loop-choice" data-wizard-loop-choice><p>Boucle détectée — choisissez la première étape :</p><select data-action="choose-first-stage">${rideFileEntries(state)
          .map(({ entry }) => `<option value="${escapeHtml(entry.id)}">${escapeHtml(entry.file.name)}</option>`)
          .join('')}</select></div>`
      : ''

    // Defensive: `renderStructureRow` must never receive `undefined` — this
    // filter is a last-resort guard even though every mutation in
    // `import-wizard-state.ts` is written to keep `state.structure` dense
    // by construction.
    const structureRows = state.structure
      .map((item, position) => ({ item, position }))
      .filter((entry): entry is { item: StructureItem; position: number } => entry.item !== undefined)
      .map(({ item, position }) => renderStructureRow(item, position))
      .join('')

    container.innerHTML = `
      <div class="wizard" data-wizard>
        <header class="view-heading"><p class="eyebrow">Nouveau voyage</p><h2>Créer un voyage</h2></header>
        <div class="field"><label for="wizard-name">Nom du voyage</label><div class="field__control"><input id="wizard-name" type="text" data-field="name" value="${escapeHtml(state.name)}" required></div></div>
        <div class="field"><label for="wizard-start-date">Date de départ</label><div class="field__control"><input id="wizard-start-date" type="date" data-field="start-date" value="${escapeHtml(state.startDate)}" required></div></div>
        <div class="field"><label for="wizard-files">Fichiers GPX</label><div class="field__control"><input id="wizard-files" type="file" accept=".gpx" multiple data-field="files"></div></div>
        ${summaryLine}
        <ul class="wizard-file-list" data-wizard-file-list>${state.files.map((entry) => renderFileRow(entry)).join('')}</ul>
        ${state.structure.length > 0
          ? `<section class="wizard-structure" data-wizard-structure><h3>Structure du voyage</h3>${loopChoice}<ul class="wizard-structure__list">${structureRows}</ul></section>`
          : ''}
        ${renderAlerts()}
        <details class="wizard-advanced"><summary>Réglages avancés</summary>
          <div class="field"><label for="wizard-reference-speed">Vitesse de référence</label><div class="field__control"><input id="wizard-reference-speed" type="number" min="8" max="40" step="0.5" data-field="reference-speed" value="${state.referenceSpeedKph}"><span>km/h</span></div></div>
          <label class="trip-settings__toggle"><input type="checkbox" data-field="mountain-mode" ${state.mountainMode ? 'checked' : ''}> Mode montagne (voyage alpin)</label>
          <p>Budget de pauses calculé automatiquement selon la distance, la durée et le D+ de chaque étape.</p>
        </details>
        ${state.errorMessage !== null ? `<p class="wizard-error" role="alert">${escapeHtml(state.errorMessage)}</p>` : ''}
        ${renderProgress()}
        <footer class="wizard-actions">
          <button class="button button--primary" type="button" data-action="submit" ${validation.canCreate && state.stage === 'editing' ? '' : 'disabled'}>Créer le voyage</button>
          <button class="button button--quiet" type="button" data-action="cancel">Annuler</button>
        </footer>
        <ul class="wizard-validation-reasons" data-wizard-validation-reasons>${renderValidationReasons(validation)}</ul>
      </div>`
  }

  function renderValidationReasons(validation: ReturnType<typeof formValidation>): string {
    return !validation.canCreate && state.stage === 'editing' ? validation.reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join('') : ''
  }

  /**
   * Focus-preserving update path for a plain text/date field (stability
   * hardening 2026-08-04): typing a name/date is not a *structural* state
   * change — nothing else in the tree needs to change shape, only the
   * submit button's disabled state and the validation-reasons list, which
   * both depend on `formValidation`. A full `render()` on every keystroke
   * destroys and recreates the `<input>` itself via `innerHTML`, which
   * drops focus/caret after every character. This updates only those two
   * derived nodes directly, never touching the input the user is typing
   * into.
   */
  function updateValidationUI(): void {
    const validation = formValidation(state)
    const submitButton = container.querySelector('[data-action="submit"]')
    if (submitButton instanceof HTMLButtonElement) {
      submitButton.disabled = !(validation.canCreate && state.stage === 'editing')
    }
    const reasonsList = container.querySelector('[data-wizard-validation-reasons]')
    if (reasonsList !== null) reasonsList.innerHTML = renderValidationReasons(validation)
  }

  container.addEventListener('input', (event) => {
    const target = event.target
    if (!(target instanceof HTMLInputElement)) return
    if (target.dataset.field === 'name') state.name = target.value
    else if (target.dataset.field === 'start-date') state.startDate = target.value
    else if (target.dataset.field === 'reference-speed') { if (Number.isFinite(target.valueAsNumber)) state.referenceSpeedKph = target.valueAsNumber; return }
    else return
    updateValidationUI()
  }, { signal: controller.signal })

  container.addEventListener('change', (event) => {
    const target = event.target
    if (target instanceof HTMLInputElement && target.dataset.field === 'mountain-mode') {
      state.mountainMode = target.checked
      return
    }
    if (target instanceof HTMLInputElement && target.dataset.field === 'files' && target.files !== null && target.files.length > 0) {
      const files = Array.from(target.files)
      // Reset immediately after capturing a plain-array snapshot, so the
      // browser never implicitly re-offers this same selection on a later,
      // unrelated `change` — every future addition must come from a fresh,
      // explicit pick (CDC hardening section 4).
      target.value = ''
      void addFiles(files)
      return
    }
    if (target instanceof HTMLSelectElement && target.dataset.action === 'choose-first-stage') {
      chooseFirstStage(state, target.value as FileEntryId)
      render()
    }
  }, { signal: controller.signal })

  container.addEventListener('click', (event) => {
    const target = event.target
    if (!(target instanceof Element)) return
    const button = target.closest<HTMLElement>('[data-action]')
    if (button === null) return
    const action = button.dataset.action
    const position = button.dataset.position === undefined ? null : Number(button.dataset.position)
    const fileId = button.dataset.fileId

    if (action === 'remove-file' && fileId !== undefined) { removeFileFromState(state, fileId); render() }
    else if (action === 'move-up' && position !== null) { moveStructureItem(state, position, -1); render() }
    else if (action === 'move-down' && position !== null) { moveStructureItem(state, position, 1); render() }
    else if (action === 'insert-off' && position !== null) { insertSlot(state, position, 'off'); render() }
    else if (action === 'insert-transfer' && position !== null) { insertSlot(state, position, 'transfer'); render() }
    else if (action === 'remove-slot' && position !== null) { removeSlot(state, position); render() }
    else if (action === 'submit') void submit()
    else if (action === 'cancel') cancel()
  }, { signal: controller.signal })

  render()

  return { destroy: () => controller.abort() }
}
