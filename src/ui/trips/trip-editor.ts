/** Compact structural editor reusing the 6C1 pre-analysis, warnings and GPX engine. */

import type { GpxImportFile } from '../../import/gpx/types.ts'
import { checkChainContinuity, detectStrictDuplicates, editGpxTrip, loadTripEditDraft, preAnalyzeGpxFiles } from '../../trips-manager/index.ts'
import type { GpxPreAnalysis, TripEditSlot } from '../../trips-manager/index.ts'
import type { SourceFileId, TripBundle, TripDayId, TripId } from '../../trip-core/index.ts'
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

export function createTripEditor(
  container: HTMLElement,
  deps: TripsManagerDeps,
  tripId: TripId,
  onSaved: (bundle: TripBundle) => void,
  onCancelled: () => void,
): void {
  let stage: EditorStage = 'loading'
  let items: EditorItem[] = []
  let tripName = ''
  let errorMessage: string | null = null

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
    const target = position + direction
    if (target < 0 || target >= items.length) return
    const next = [...items]
    const value = next[position]
    next[position] = next[target] as EditorItem
    next[target] = value as EditorItem
    items = next
    render()
  }

  function insertAfter(position: number, kind: 'off' | 'transfer'): void {
    items = [...items.slice(0, position + 1), { key: nextKey(), kind, existingDayId: null, notes: null }, ...items.slice(position + 1)]
    render()
  }

  function remove(position: number): void {
    items = [...items.slice(0, position), ...items.slice(position + 1)]
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
        : { kind: item.kind, existingDayId: item.existingDayId, notes: item.notes },
    )
    const result = await editGpxTrip({ database: deps.database, tripId, slots, idFactory: deps.idFactory, now: deps.now })
    if (result.ok) {
      onSaved(result.bundle)
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

  function renderItem(item: EditorItem, position: number): string {
    const moveControls = renderMoveControls(position)
    const insertControls = renderInsertControls(position)
    if (item.kind !== 'ride') {
      const label = item.kind === 'off' ? 'OFF' : 'Transfert'
      return `<li class='wizard-structure__row wizard-structure__row--${item.kind}'><span class='tag tag--off'>${label}</span>${moveControls}<button class='button button--quiet' type='button' data-editor-action='remove' data-position='${position}'>Retirer</button></li>${insertControls}`
    }

    const analysis = item.preAnalysis
    const metrics = analysis?.status === 'valid'
      ? `<dl class='wizard-file__metrics'><div><dt>Distance</dt><dd>${(analysis.distanceKm ?? 0).toFixed(1)} km</dd></div><div><dt>D+</dt><dd>+${Math.round(analysis.elevationGainM ?? 0)} m</dd></div><div><dt>D−</dt><dd>−${Math.round(analysis.elevationLossM ?? 0)} m</dd></div></dl>`
      : `<p class='wizard-file__error'>${analysis === null ? 'Analyse…' : escapeHtml(analysis.errorMessage ?? 'Fichier invalide.')}</p>`
    return `<li class='wizard-structure__row wizard-file'><span class='tag tag--ride'>Étape</span><strong>${escapeHtml(item.file.name)}</strong>${metrics}${moveControls}<label class='button button--quiet'>Remplacer<input type='file' accept='.gpx' data-editor-field='replace' data-position='${position}'></label><button class='button button--quiet' type='button' data-editor-action='remove' data-position='${position}'>Retirer</button></li>${insertControls}`
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
      <div class='field'><label for='editor-add-files'>Ajouter des GPX</label><div class='field__control'><input id='editor-add-files' type='file' accept='.gpx' multiple data-editor-field='add'></div></div>
      <section class='wizard-structure'><h3>Structure du voyage</h3><ul class='wizard-structure__list'>${items.map(renderItem).join('')}</ul></section>
      ${renderWarnings()}
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
      const files = draft.slots.filter((slot) => slot.kind === 'ride').map((slot) => slot.file)
      const analyses = await preAnalyzeGpxFiles(files)
      let rideIndex = 0
      items = draft.slots.map((slot) => {
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
    if (!(target instanceof HTMLInputElement) || target.files === null || target.files.length === 0) return
    if (target.dataset.editorField === 'add') {
      void addFiles(target.files)
    } else if (target.dataset.editorField === 'replace') {
      const position = Number(target.dataset.position)
      const file = target.files[0]
      if (file !== undefined) void replaceFile(position, file)
    }
  })

  container.addEventListener('click', (event) => {
    const target = event.target
    if (!(target instanceof Element)) return
    const button = target.closest<HTMLElement>('[data-editor-action]')
    if (button === null) return
    const action = button.dataset.editorAction
    const position = Number(button.dataset.position)
    if (action === 'move-up') move(position, -1)
    else if (action === 'move-down') move(position, 1)
    else if (action === 'insert-off') insertAfter(position, 'off')
    else if (action === 'insert-transfer') insertAfter(position, 'transfer')
    else if (action === 'remove') remove(position)
    else if (action === 'save') void save()
    else if (action === 'cancel') onCancelled()
  })

  void initialize()
}
