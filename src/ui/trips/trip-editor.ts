/** Compact structural editor reusing the 6C1 pre-analysis, warnings and GPX engine. */

import type { GpxImportFile } from '../../import/gpx/types.ts'
import { checkChainContinuity, detectStrictDuplicates, editGpxTrip, loadTripEditDraft, preAnalyzeGpxFiles } from '../../trips-manager/index.ts'
import type { GpxPreAnalysis, TripEditSlot } from '../../trips-manager/index.ts'
import { createTripRepository } from '../../storage/indexeddb/trip-repository.ts'
import { resolveOffLocation, resolveTransferLocations } from '../../analysis/day-location-fill.ts'
import type { SourceFileId, TransferTiming, TripBundle, TripDayId, TripId } from '../../trip-core/index.ts'
import type { TripsManagerDeps } from './trips-manager.ts'

type EditorItem =
  | {
      readonly key: string
      readonly kind: 'ride'
      readonly existingDayId: TripDayId | null
      readonly existingSourceFileId: SourceFileId | null
      readonly file: GpxImportFile
      readonly preAnalysis: GpxPreAnalysis | null
    }
  | {
      readonly key: string
      readonly kind: 'off' | 'transfer'
      readonly existingDayId: TripDayId | null
      readonly notes: string | null
      /** Only meaningful for `kind === 'transfer'` (CDC Jalon B4.4 section 22). */
      readonly transferTiming?: TransferTiming
    }

const TRANSFER_TIMING_LABELS: Readonly<Record<TransferTiming, string>> = {
  dedicated: 'Journée dédiée',
  after_previous: 'Après l’étape précédente',
  before_next: 'Avant l’étape suivante',
}

type EditorStage = 'loading' | 'editing' | 'saving'

let editorKeyCounter = 0
function nextKey(): string {
  editorKeyCounter++
  return `editor-slot-${editorKeyCounter}`
}

function escapeHtml(value: string): string {
  const element = document.createElement('span')
  element.textContent = value
  return element.innerHTML
}

async function browserFileToImportFile(file: File): Promise<GpxImportFile> {
  const bytes = await file.arrayBuffer()
  return {
    name: file.name,
    mimeType: file.type || null,
    sizeBytes: file.size,
    lastModifiedAt: Number.isFinite(file.lastModified) ? new Date(file.lastModified).toISOString() : null,
    bytes,
  }
}

export interface TripEditorHandle {
  /** Removes every listener this editor instance attached to `container` — call before the container is reused for another screen. */
  readonly destroy: () => void
}

export function createTripEditor(
  container: HTMLElement,
  deps: TripsManagerDeps,
  tripId: TripId,
  onSaved: (bundle: TripBundle) => void,
  onCancelled: () => void,
): TripEditorHandle {
  const controller = new AbortController()
  let stage: EditorStage = 'loading'
  let items: EditorItem[] = []
  let tripName = ''
  let errorMessage: string | null = null
  /** Trip-level settings (CDC Jalon B4.3 sections 19-21): reference speed and Mode montagne belong to the trip — edited here, never per-stage/per-day, never a separate global settings screen. */
  let referenceSpeedKph = 18
  let mountainMode = false
  /** Kept only to preview the auto-filled OFF/transfer location (CDC Jalon B4.3 sections 13-14) for slots that already existed before this editing session — a brand-new slot has no neighbouring stage data to preview from yet (it is only produced once this edit is saved and re-analysed). */
  let originalBundle: TripBundle | null = null

  function rideItems(): readonly Extract<EditorItem, { readonly kind: 'ride' }>[] {
    return items.filter((item): item is Extract<EditorItem, { readonly kind: 'ride' }> => item.kind === 'ride')
  }

  function strictDuplicateNames(): ReadonlySet<string> {
    const candidates = rideItems().filter((item) => item.preAnalysis?.status === 'valid')
    const groups = detectStrictDuplicates(
      candidates.map((item) => ({
        fileName: item.file.name,
        sha256: item.preAnalysis?.sha256 ?? null,
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

  function continuityWarnings() {
    return checkChainContinuity(
      rideItems()
        .filter((item) => item.preAnalysis?.status === 'valid')
        .map((item) => ({
          fileName: item.file.name,
          startLatitude: item.preAnalysis?.startLatitude ?? 0,
          startLongitude: item.preAnalysis?.startLongitude ?? 0,
          endLatitude: item.preAnalysis?.endLatitude ?? 0,
          endLongitude: item.preAnalysis?.endLongitude ?? 0,
        })),
    )
  }

  function canSave(): boolean {
    const rides = rideItems()
    return stage === 'editing' && rides.length > 0 && rides.every((item) => item.preAnalysis?.status === 'valid') && strictDuplicateNames().size === 0
  }

  async function addFiles(files: FileList): Promise<void> {
    const importFiles = await Promise.all(Array.from(files).map(browserFileToImportFile))
    const analyses = await preAnalyzeGpxFiles(importFiles)
    importFiles.forEach((file, index) => {
      items.push({ key: nextKey(), kind: 'ride', existingDayId: null, existingSourceFileId: null, file, preAnalysis: analyses[index] ?? null })
    })
    render()
  }

  async function replaceFile(position: number, file: File): Promise<void> {
    const current = items[position]
    if (current === undefined || current.kind !== 'ride') return
    const importFile = await browserFileToImportFile(file)
    const [preAnalysis] = await preAnalyzeGpxFiles([importFile])
    items[position] = { ...current, existingSourceFileId: null, file: importFile, preAnalysis: preAnalysis ?? null }
    render()
  }

  function move(position: number, direction: -1 | 1): void {
    if (!Number.isInteger(position) || position < 0 || position >= items.length) return
    const target = position + direction
    if (target < 0 || target >= items.length) return
    const current = items[position]
    const other = items[target]
    if (current === undefined || other === undefined) return
    const next = [...items]
    next[position] = other
    next[target] = current
    items = next
    render()
  }

  function insertAfter(position: number, kind: 'off' | 'transfer'): void {
    if (!Number.isInteger(position)) return
    const insertAt = Math.min(Math.max(position + 1, 0), items.length)
    items = [...items.slice(0, insertAt), { key: nextKey(), kind, existingDayId: null, notes: null }, ...items.slice(insertAt)]
    render()
  }

  function remove(position: number): void {
    if (!Number.isInteger(position) || position < 0 || position >= items.length) return
    items = [...items.slice(0, position), ...items.slice(position + 1)]
    render()
  }

  /** CDC Jalon B4.4 section 22 — the only UI that lets the user actually pick a transfer's `transferTiming`; a no-op for any other item kind. */
  function setItemTransferTiming(position: number, timing: TransferTiming): void {
    const target = items[position]
    if (target === undefined || target.kind !== 'transfer') return
    const next = [...items]
    next[position] = { ...target, transferTiming: timing }
    items = next
    render()
  }

  async function save(): Promise<void> {
    if (!canSave()) return
    stage = 'saving'
    errorMessage = null
    render()
    const slots: TripEditSlot[] = items.map((item) =>
      item.kind === 'ride'
        ? { kind: 'ride', existingDayId: item.existingDayId, existingSourceFileId: item.existingSourceFileId, file: item.file }
        : item.kind === 'transfer'
          ? { kind: 'transfer', existingDayId: item.existingDayId, notes: item.notes, transferTiming: item.transferTiming }
          : { kind: item.kind, existingDayId: item.existingDayId, notes: item.notes },
    )
    const result = await editGpxTrip({ database: deps.database, tripId, slots, idFactory: deps.idFactory, now: deps.now })
    if (result.ok) {
      // Trip-level settings (CDC Jalon B4.3 sections 19-21) are edited here
      // but are not part of `editGpxTrip`'s structural concern — applied as
      // a small follow-up patch, the same load/mutate/save shape used
      // everywhere else in this codebase, never a second storage path.
      const tripRepository = createTripRepository(deps.database)
      const patched: TripBundle = {
        ...result.bundle,
        settings: { ...result.bundle.settings, global: { ...result.bundle.settings.global, referenceSpeedKph, mountainMode } },
      }
      await tripRepository.saveTripBundle(patched)
      onSaved(patched)
      return
    }
    stage = 'editing'
    errorMessage = result.message
    render()
  }

  function renderMoveControls(position: number): string {
    const upDisabled = position === 0 ? 'disabled' : ''
    const downDisabled = position === items.length - 1 ? 'disabled' : ''
    return `<div class='wizard-structure__move'><button class='button button--quiet' type='button' data-editor-action='move-up' data-position='${position}' ${upDisabled}>↑</button><button class='button button--quiet' type='button' data-editor-action='move-down' data-position='${position}' ${downDisabled}>↓</button></div>`
  }

  function renderInsertControls(position: number): string {
    return `<div class='wizard-structure__insert'><button class='button button--quiet' type='button' data-editor-action='insert-off' data-position='${position}'>+ OFF</button><button class='button button--quiet' type='button' data-editor-action='insert-transfer' data-position='${position}'>+ Transfert</button></div>`
  }

  /**
   * Read-only preview of the auto-filled location (CDC Jalon B4.3 sections
   * 13-14) — "visible dans l'éditeur" without waiting for the final
   * re-analysed Voyage screen. Only available for a slot that already
   * existed before this editing session (a brand-new OFF/transfer has no
   * neighbouring stage data yet — it only gets one once this edit is saved
   * and re-analysed).
   */
  function renderAutoFillPreview(item: Extract<EditorItem, { readonly kind: 'off' | 'transfer' }>): string {
    if (originalBundle === null || item.existingDayId === null) return ''
    const day = originalBundle.days.find((candidate) => candidate.id === item.existingDayId)
    if (day === undefined) return ''
    // Bug 5-9 closeout: this used to reimplement the previous/next-ride
    // fallback chain by hand instead of calling the shared resolver — a
    // second place the rule would need to change if it ever did. Calling
    // `resolveOffLocation`/`resolveTransferLocations` here keeps this
    // preview byte-for-byte consistent with the Voyage card and Journée
    // detail shell, which already call the same functions.
    if (item.kind === 'off') {
      const location = resolveOffLocation(originalBundle, day)
      return location.name === null ? '' : `<p class='wizard-structure__autofill'>Lieu (auto) : ${escapeHtml(location.name)}</p>`
    }
    const { origin, destination } = resolveTransferLocations(originalBundle, day)
    if (origin === null && destination === null) return ''
    return `<p class='wizard-structure__autofill'>${escapeHtml(origin ?? '—')} → ${escapeHtml(destination ?? '—')} (auto)</p>`
  }

  /** CDC Jalon B4.4 section 22 — the only UI that lets the user actually pick a transfer's `transferTiming`. Takes the off/transfer `EditorItem` variant (same `Extract` shape `renderAutoFillPreview` already uses) — `transferTiming` is optional on it, so this only ever gets called for an actual `'transfer'` row. */
  function renderTransferTimingSelect(item: Extract<EditorItem, { readonly kind: 'off' | 'transfer' }>, position: number): string {
    const current = item.transferTiming ?? 'dedicated'
    const options = (Object.keys(TRANSFER_TIMING_LABELS) as TransferTiming[])
      .map((value) => `<option value='${value}' ${value === current ? 'selected' : ''}>${TRANSFER_TIMING_LABELS[value]}</option>`)
      .join('')
    return `<label class='wizard-structure__timing'>Moment<select data-editor-action='set-transfer-timing' data-position='${position}'>${options}</select></label>`
  }

  function renderItem(item: EditorItem, position: number): string {
    const moveControls = renderMoveControls(position)
    const insertControls = renderInsertControls(position)
    if (item.kind !== 'ride') {
      const label = item.kind === 'off' ? 'OFF' : 'Transfert'
      const timingControl = item.kind === 'transfer' ? renderTransferTimingSelect(item, position) : ''
      return `<li class='wizard-structure__row wizard-structure__row--${item.kind}'><span class='tag tag--off'>${label}</span>${renderAutoFillPreview(item)}${timingControl}${moveControls}<button class='button button--quiet' type='button' data-editor-action='remove' data-position='${position}'>Retirer</button></li>${insertControls}`
    }

    const analysis = item.preAnalysis
    const metrics = analysis?.status === 'valid'
      ? `<dl class='wizard-file__metrics'><div><dt>Distance</dt><dd>${(analysis.distanceKm ?? 0).toFixed(1)} km</dd></div><div><dt>D+</dt><dd>+${Math.round(analysis.elevationGainM ?? 0)} m</dd></div><div><dt>D−</dt><dd>−${Math.round(analysis.elevationLossM ?? 0)} m</dd></div></dl>`
      : `<p class='wizard-file__error'>${analysis === null ? 'Analyse…' : escapeHtml(analysis.errorMessage ?? 'Fichier invalide.')}</p>`
    // CDC Jalon B4.4 section 18: a real button proxies a visually-hidden
    // per-row `<input type="file">` — never the native file control exposed
    // directly (the old `<label class="button">Remplacer<input …></label>`
    // pattern let the browser's own file-input UI show through the label).
    return `<li class='wizard-structure__row wizard-file'><span class='tag tag--ride'>Étape</span><strong>${escapeHtml(item.file.name)}</strong>${metrics}${moveControls}<button class='button button--quiet' type='button' data-editor-action='trigger-replace' data-position='${position}'>Remplacer</button><input type='file' accept='.gpx' class='visually-hidden' data-editor-field='replace' data-position='${position}' tabindex='-1' aria-hidden='true'><button class='button button--quiet' type='button' data-editor-action='remove' data-position='${position}'>Retirer</button></li>${insertControls}`
  }

  function renderWarnings(): string {
    const duplicateNames = strictDuplicateNames()
    const warnings = continuityWarnings()
    const rows: string[] = []
    if (duplicateNames.size > 0) rows.push(`<li class='wizard-alert wizard-alert--blocking'>Doublon strict détecté — retirez ou remplacez le fichier concerné.</li>`)
    warnings.forEach((warning) => rows.push(`<li class='wizard-alert'>Rupture de continuité entre ${escapeHtml(warning.fromFileName)} et ${escapeHtml(warning.toFileName)} (${warning.gapKm.toFixed(1)} km, non bloquant).</li>`))
    return rows.length === 0 ? '' : `<ul class='wizard-alerts'>${rows.join('')}</ul>`
  }

  function render(): void {
    if (stage === 'loading') {
      container.innerHTML = `<p role='status'>Chargement du voyage…</p>`
      return
    }
    const rides = rideItems()
    const validationMessage = rides.length === 0
      ? 'Ajoutez au moins un GPX.'
      : rides.some((item) => item.preAnalysis?.status !== 'valid')
        ? 'Corrigez les fichiers GPX invalides avant d’enregistrer.'
        : strictDuplicateNames().size > 0
          ? 'Retirez les doublons stricts avant d’enregistrer.'
          : null
    container.innerHTML = `<div class='wizard' data-trip-editor>
      <header class='view-heading'><p class='eyebrow'>Mes voyages</p><h2>Modifier ${escapeHtml(tripName)}</h2></header>
      <button class='button button--quiet' type='button' data-editor-action='trigger-add'>+ Ajouter des GPX</button>
      <input id='editor-add-files' class='visually-hidden' type='file' accept='.gpx' multiple data-editor-field='add' tabindex='-1' aria-hidden='true'>
      <ul class='wizard-structure__list'>${items.map(renderItem).join('')}</ul>
      ${renderWarnings()}
      <details class='wizard-advanced'><summary>Réglages avancés</summary>
        <div class='field'><label for='editor-reference-speed'>Vitesse de référence</label><div class='field__control'><input id='editor-reference-speed' type='number' min='8' max='40' step='0.5' data-editor-field='reference-speed' value='${referenceSpeedKph}'><span>km/h</span></div></div>
        <label class='trip-settings__toggle'><input type='checkbox' data-editor-field='mountain-mode' ${mountainMode ? 'checked' : ''}> Mode montagne (voyage alpin)</label>
      </details>
      ${errorMessage === null ? '' : `<p class='wizard-error' role='alert'>${escapeHtml(errorMessage)}</p>`}
      ${stage === 'saving' ? `<p role='status'>Recalcul et enregistrement atomique…</p>` : ''}
      <footer class='wizard-actions'><button class='button button--primary' type='button' data-editor-action='save' ${canSave() ? '' : 'disabled'}>Enregistrer les modifications</button><button class='button button--quiet' type='button' data-editor-action='cancel' ${stage === 'saving' ? 'disabled' : ''}>Annuler</button></footer>
      ${validationMessage === null ? '' : `<p class='wizard-validation-reasons'>${escapeHtml(validationMessage)}</p>`}
    </div>`
  }

  async function initialize(): Promise<void> {
    render()
    try {
      const draft = await loadTripEditDraft(deps.database, tripId)
      if (draft === null) {
        stage = 'editing'
        errorMessage = 'Voyage introuvable.'
        render()
        return
      }
      tripName = draft.bundle.metadata.name
      originalBundle = draft.bundle
      referenceSpeedKph = draft.bundle.settings.global.referenceSpeedKph
      mountainMode = draft.bundle.settings.global.mountainMode ?? false
      const files = draft.slots.filter((slot) => slot.kind === 'ride').map((slot) => slot.file)
      const analyses = await preAnalyzeGpxFiles(files)
      let rideIndex = 0
      items = draft.slots.map((slot) => {
        if (slot.kind === 'transfer') return { key: nextKey(), kind: 'transfer', existingDayId: slot.existingDayId, notes: slot.notes ?? null, transferTiming: slot.transferTiming }
        if (slot.kind !== 'ride') return { key: nextKey(), kind: slot.kind, existingDayId: slot.existingDayId, notes: slot.notes ?? null }
        const item: EditorItem = { key: nextKey(), ...slot, preAnalysis: analyses[rideIndex] ?? null }
        rideIndex++
        return item
      })
      stage = 'editing'
      render()
    } catch (error) {
      stage = 'editing'
      errorMessage = error instanceof Error ? error.message : 'Chargement impossible.'
      render()
    }
  }

  container.addEventListener('change', (event) => {
    const target = event.target
    if (target instanceof HTMLSelectElement && target.dataset.editorAction === 'set-transfer-timing' && target.dataset.position !== undefined) {
      setItemTransferTiming(Number(target.dataset.position), target.value as TransferTiming)
      return
    }
    if (!(target instanceof HTMLInputElement)) return
    if (target.dataset.editorField === 'mountain-mode') {
      mountainMode = target.checked
      return
    }
    if (target.files === null || target.files.length === 0) return
    if (target.dataset.editorField === 'add') {
      const files = target.files
      target.value = ''
      void addFiles(files)
    } else if (target.dataset.editorField === 'replace') {
      const position = Number(target.dataset.position)
      const file = target.files[0]
      const input = target
      input.value = ''
      if (file !== undefined) void replaceFile(position, file)
    }
  }, { signal: controller.signal })

  container.addEventListener('input', (event) => {
    const target = event.target
    if (!(target instanceof HTMLInputElement) || target.dataset.editorField !== 'reference-speed') return
    if (Number.isFinite(target.valueAsNumber)) referenceSpeedKph = target.valueAsNumber
  }, { signal: controller.signal })

  container.addEventListener('click', (event) => {
    const target = event.target
    if (!(target instanceof Element)) return
    const button = target.closest<HTMLElement>('[data-editor-action]')
    if (button === null) return
    const action = button.dataset.editorAction
    const position = Number(button.dataset.position)
    // CDC Jalon B4.4 sections 17-18: both file pickers are real buttons
    // proxying their own visually-hidden `<input type="file">` — never the
    // native control shown directly in the layout.
    if (action === 'trigger-add') { container.querySelector<HTMLInputElement>('#editor-add-files')?.click(); return }
    if (action === 'trigger-replace') { container.querySelector<HTMLInputElement>(`input[data-editor-field="replace"][data-position="${position}"]`)?.click(); return }
    if (action === 'move-up') move(position, -1)
    else if (action === 'move-down') move(position, 1)
    else if (action === 'insert-off') insertAfter(position, 'off')
    else if (action === 'insert-transfer') insertAfter(position, 'transfer')
    else if (action === 'remove') remove(position)
    else if (action === 'save') void save()
    else if (action === 'cancel') onCancelled()
  }, { signal: controller.signal })

  void initialize()

  return { destroy: () => controller.abort() }
}
