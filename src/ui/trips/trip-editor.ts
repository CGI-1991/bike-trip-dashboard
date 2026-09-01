/** Compact structural editor reusing the 6C1 pre-analysis, warnings and GPX engine. */

import type { GpxImportFile } from '../../import/gpx/types.ts'
import { checkChainContinuity, detectStrictDuplicates, editGpxTrip, loadTripEditDraft, preAnalyzeGpxFiles } from '../../trips-manager/index.ts'
import type { GpxPreAnalysis, TripEditSlot } from '../../trips-manager/index.ts'
import { shiftTripStartDate, updateTripPreferences, TRIP_REFERENCE_SPEED_MAX_KPH, TRIP_REFERENCE_SPEED_MIN_KPH, validateTripPreferencesUpdate } from '../../trips-manager/trip-preferences.ts'
import type { TripPreferencesFieldError, TripPreferencesUpdate } from '../../trips-manager/trip-preferences.ts'
import { deriveTripTerrainContext, TRIP_TERRAIN_LABELS } from '../../analysis/terrain-context.ts'
import { createTripRepository } from '../../storage/indexeddb/trip-repository.ts'
import { resolveOffLocation, resolveTransferLocations } from '../../analysis/day-location-fill.ts'
import { formatShortDate } from '../date-format.ts'
import type { IsoDate, SourceFileId, TransferTiming, TripBundle, TripDayId, TripId } from '../../trip-core/index.ts'
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
  let fieldErrors: readonly TripPreferencesFieldError[] = []
  /**
   * D3.1 sections 1/3-4/17: "Informations" (name/date/speed/terrain) is a
   * genuinely separate category from "Structure" (the GPX/OFF/transfer list
   * below) — saved through the light `updateTripPreferences` path whenever
   * nothing structural actually changed (section 28-29), never through
   * `editGpxTrip`'s heavy rebuild. `name`/`startDate`/`referenceSpeedKph`/
   * `terrainOverride` are the live-edited values; the `original*` copies
   * (captured once in `initialize()`) are what dirty-state/no-op detection
   * and the structural-vs-light routing decision compare against.
   */
  let name = ''
  let startDate: string | null = null
  let referenceSpeedKph = 18
  /** `null` = Automatique (CDC section 14-15) — mirrors `GlobalTripSettings.mountainMode`'s own `undefined` state, never a second boolean-vs-tristate representation. */
  let terrainOverride: boolean | null = null
  let originalName = ''
  let originalStartDate: string | null = null
  let originalReferenceSpeedKph = 18
  let originalTerrainOverride: boolean | null = null
  let originalStructureSnapshot = ''
  /** Kept only to preview the auto-filled OFF/transfer location (CDC Jalon B4.3 sections 13-14) for slots that already existed before this editing session — a brand-new slot has no neighbouring stage data to preview from yet (it is only produced once this edit is saved and re-analysed). Also the source `deriveTripTerrainContext` reads for the live "Terrain" display — its own aggregate elevation-gain-per-km never changes just from a preference edit, so re-deriving it from the ORIGINAL bundle throughout the session is correct. */
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

  /**
   * D3.1 section 28: the exact, order-sensitive shape a structural rebuild
   * actually cares about — kind, retained identity, and the couple of
   * fields (`notes`/`transferTiming`) `editGpxTrip` itself restructures
   * around. Never includes `preAnalysis`/`key` (session-local bookkeeping)
   * or any Informations field. Two sessions with an identical snapshot are
   * structurally identical, whatever their `EditorItem.key`s are.
   */
  function structureSnapshot(entries: readonly EditorItem[]): string {
    return JSON.stringify(entries.map((item) => item.kind === 'ride'
      ? { kind: 'ride', existingDayId: item.existingDayId, existingSourceFileId: item.existingSourceFileId }
      : { kind: item.kind, existingDayId: item.existingDayId, notes: item.notes, transferTiming: item.kind === 'transfer' ? item.transferTiming ?? 'dedicated' : undefined }))
  }

  /** D3.1 section 28: `true` the moment ANY add/remove/reorder/replace/OFF-transfer-timing edit happened — the only condition allowed to route `save()` through the heavy `editGpxTrip` pipeline. */
  function isStructureDirty(): boolean {
    return structureSnapshot(items) !== originalStructureSnapshot
  }

  /** D3.1 sections 17/30: any Informations field that actually differs from what was loaded — mirrors `trip-preferences.ts::tripPreferencesUpdateIsNoop`'s own comparison so the button's enabled state and the actual no-op decision never disagree. */
  function isPreferencesDirty(): boolean {
    return name.trim() !== originalName
      || (startDate !== null && startDate !== originalStartDate)
      || referenceSpeedKph !== originalReferenceSpeedKph
      || terrainOverride !== originalTerrainOverride
  }

  /** D3.1 section 36: the exact same field validation the light save path enforces, reused here so Save stays disabled for an invalid name/speed regardless of which path (light or heavy) would end up handling it. */
  function currentPreferencesUpdate(): TripPreferencesUpdate {
    const update: TripPreferencesUpdate = {}
    if (name.trim() !== originalName) update.name = name
    if (startDate !== null && startDate !== originalStartDate) update.startDate = startDate
    if (referenceSpeedKph !== originalReferenceSpeedKph) update.referenceSpeedKph = referenceSpeedKph
    if (terrainOverride !== originalTerrainOverride) update.terrainOverride = terrainOverride
    return update
  }

  function canSave(): boolean {
    const rides = rideItems()
    const structurallyValid = rides.length > 0 && rides.every((item) => item.preAnalysis?.status === 'valid') && strictDuplicateNames().size === 0
    const preferencesValid = validateTripPreferencesUpdate(currentPreferencesUpdate()).length === 0
    // D3.1 section 30: Save is only ever active when there is something
    // real to save (section 29 — a genuine no-op stays disabled) — never
    // just because the structural list happens to currently validate.
    return stage === 'editing' && structurallyValid && preferencesValid && (isStructureDirty() || isPreferencesDirty())
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

  /**
   * D3.1 sections 17/19/28-29: the ONE light path — never `buildGpxTrip`/
   * `editGpxTrip`, never a second save pass. Used whenever nothing
   * structural changed this session, however many Informations fields did.
   */
  async function saveLight(): Promise<void> {
    stage = 'saving'
    errorMessage = null
    fieldErrors = []
    render()
    const result = await updateTripPreferences({ database: deps.database, tripId, update: currentPreferencesUpdate(), now: deps.now })
    if (result.ok) {
      onSaved(result.bundle)
      return
    }
    stage = 'editing'
    errorMessage = result.message
    fieldErrors = result.errors ?? []
    render()
  }

  /**
   * The pre-existing heavy pipeline, unchanged in shape — now also folding
   * in whatever Informations edits happened in the SAME session (CDC
   * section 39: keep this path's own structure, just carry the extra
   * fields through its existing single follow-up patch rather than
   * silently dropping them because the user also touched the GPX list).
   */
  async function saveStructural(): Promise<void> {
    stage = 'saving'
    errorMessage = null
    fieldErrors = []
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
      const tripRepository = createTripRepository(deps.database)
      const trimmedName = name.trim()
      let patched: TripBundle = {
        ...result.bundle,
        metadata: { ...result.bundle.metadata, name: trimmedName === '' ? result.bundle.metadata.name : trimmedName },
        settings: { ...result.bundle.settings, global: { ...result.bundle.settings.global, referenceSpeedKph, mountainMode: terrainOverride ?? undefined } },
      }
      if (startDate !== null && startDate !== patched.calendar.startDate) patched = shiftTripStartDate(patched, startDate as IsoDate)
      await tripRepository.saveTripBundle(patched)
      onSaved(patched)
      return
    }
    stage = 'editing'
    errorMessage = result.message
    render()
  }

  async function save(): Promise<void> {
    if (!canSave()) return
    if (isStructureDirty()) await saveStructural()
    else await saveLight()
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

  /** D3.1 sections 13-16: reads the live (not-yet-saved) `terrainOverride` against the ORIGINAL bundle's own aggregate terrain data — that data never changes from a preference edit, only the override choice does. */
  function currentTerrainContext() {
    if (originalBundle === null) return { mode: 'automatic' as const, label: 'rolling' as const }
    return deriveTripTerrainContext({
      ...originalBundle,
      settings: { ...originalBundle.settings, global: { ...originalBundle.settings.global, mountainMode: terrainOverride ?? undefined } },
    })
  }

  /**
   * D3.1 sections 4-5/9/14/34-35: a clearly separate "Informations" card —
   * name/date/speed always editable here, terrain shown as a live-derived
   * read (CDC section 14: "l'app s'en occupe"), never a 12-category
   * classifier. The structural list below is untouched by this section.
   */
  /** Whatever `save()` last got back from `updateTripPreferences`'s own validation (CDC section 36) — `[]` the rest of the time, so every field's error span simply renders empty. */
  function fieldErrorFor(field: TripPreferencesFieldError['field']): string {
    return fieldErrors.find((error) => error.field === field)?.message ?? ''
  }

  function renderInformationsSection(): string {
    const terrain = currentTerrainContext()
    const terrainLine = `${terrain.mode === 'automatic' ? 'Automatique' : 'Forcé'} · ${TRIP_TERRAIN_LABELS[terrain.label]}`
    const dateField = startDate === null ? '' : `<div class='field'>
        <label for='editor-start-date'>Date de départ</label>
        <input id='editor-start-date' type='date' data-editor-field='start-date' value='${startDate}'>
        <p class='field__hint'>${escapeHtml(formatShortDate(startDate))} ${startDate.slice(0, 4)}</p>
        <span id='editor-start-date-error' class='field__error' data-field-error='startDate' role='status'>${escapeHtml(fieldErrorFor('startDate'))}</span>
      </div>`
    return `<section class='card trip-editor__info' data-trip-editor-info aria-label="Informations du voyage">
      <p class='eyebrow'>Informations</p>
      <div class='field'>
        <label for='editor-name'>Nom du voyage</label>
        <input id='editor-name' type='text' data-editor-field='name' value='${escapeHtml(name)}' maxlength='200' aria-describedby='editor-name-error'>
        <span id='editor-name-error' class='field__error' data-field-error='name' role='status'>${escapeHtml(fieldErrorFor('name'))}</span>
      </div>
      ${dateField}
      <div class='field'>
        <label for='editor-reference-speed'>Vitesse de référence</label>
        <div class='field__control'><input id='editor-reference-speed' type='number' min='${TRIP_REFERENCE_SPEED_MIN_KPH}' max='${TRIP_REFERENCE_SPEED_MAX_KPH}' step='0.5' data-editor-field='reference-speed' value='${referenceSpeedKph}' aria-describedby='editor-reference-speed-hint editor-reference-speed-error'><span>km/h</span></div>
        <p id='editor-reference-speed-hint' class='field__hint'>Base utilisée pour estimer les temps de roulage.</p>
        <span id='editor-reference-speed-error' class='field__error' data-field-error='referenceSpeedKph' role='status'>${escapeHtml(fieldErrorFor('referenceSpeedKph'))}</span>
      </div>
      <div class='field'>
        <span class='field__label' id='editor-terrain-label'>Terrain</span>
        <p aria-labelledby='editor-terrain-label'>${escapeHtml(terrainLine)}</p>
      </div>
    </section>`
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
    // D3.1 section 27: a light preferences-only save never claims to
    // "recalculer" GPX — only a real structural rebuild does.
    const savingMessage = isStructureDirty() ? 'Recalcul et enregistrement atomique…' : 'Enregistrement…'
    container.innerHTML = `<div class='wizard' data-trip-editor>
      <header class='view-heading'><p class='eyebrow'>Mes voyages</p><h2>Modifier ${escapeHtml(tripName)}</h2></header>
      ${renderInformationsSection()}
      <p class='eyebrow'>Structure du voyage</p>
      <button class='button button--quiet' type='button' data-editor-action='trigger-add'>+ Ajouter des GPX</button>
      <input id='editor-add-files' class='visually-hidden' type='file' accept='.gpx' multiple data-editor-field='add' tabindex='-1' aria-hidden='true'>
      <ul class='wizard-structure__list'>${items.map(renderItem).join('')}</ul>
      ${renderWarnings()}
      <details class='wizard-advanced'><summary>Réglages avancés</summary>
        <div class='field'>
          <label for='editor-terrain-override'>Comportement terrain</label>
          <select id='editor-terrain-override' data-editor-field='terrain-override'>
            <option value='automatic' ${terrainOverride === null ? 'selected' : ''}>Automatique</option>
            <option value='mountain' ${terrainOverride === true ? 'selected' : ''}>Forcer mode montagne</option>
            <option value='normal' ${terrainOverride === false ? 'selected' : ''}>Forcer mode normal</option>
          </select>
          <p class='field__hint'>Change uniquement le seuil utilisé pour distinguer les montées principales des secondaires.</p>
        </div>
      </details>
      ${errorMessage === null ? '' : `<p class='wizard-error' role='alert'>${escapeHtml(errorMessage)}</p>`}
      ${stage === 'saving' ? `<p role='status'>${escapeHtml(savingMessage)}</p>` : ''}
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
      name = draft.bundle.metadata.name
      originalName = draft.bundle.metadata.name
      startDate = draft.bundle.calendar.startDate
      originalStartDate = draft.bundle.calendar.startDate
      referenceSpeedKph = draft.bundle.settings.global.referenceSpeedKph
      originalReferenceSpeedKph = draft.bundle.settings.global.referenceSpeedKph
      terrainOverride = draft.bundle.settings.global.mountainMode ?? null
      originalTerrainOverride = terrainOverride
      // D3.1 section 42: this re-analyzes every retained GPX byte-for-byte
      // on every editor open, even when nothing about it will change this
      // session — real cost on a many-stage trip, but skipping it would mean
      // trusting the bundle's already-derived metrics as a stand-in for a
      // fresh validity check on the actual file bytes, which is exactly the
      // kind of "look safe, break silently later" shortcut this app avoids
      // elsewhere. Left as is rather than risked (CDC section 42's own
      // explicit allowance) — documented here as the known, deliberate cost.
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
      originalStructureSnapshot = structureSnapshot(items)
      stage = 'editing'
      render()
    } catch (error) {
      stage = 'editing'
      errorMessage = error instanceof Error ? error.message : 'Chargement impossible.'
      render()
    }
  }

  /**
   * D3.1 sections 30/36: toggles the Save button's own `disabled` attribute
   * and the one field's inline error text directly — never a full
   * `render()` for a keystroke/number edit, which would reset the input's
   * own cursor position (the exact reason the pre-existing `reference-speed`
   * listener already avoided it; `name` now needs the same care since a
   * trip name is typically typed continuously, unlike a `<select>`/native
   * date-picker change, which are discrete actions a full render is safe
   * after).
   */
  function updateSaveButtonState(): void {
    const saveButton = container.querySelector<HTMLButtonElement>('[data-editor-action="save"]')
    if (saveButton !== null) saveButton.disabled = !canSave()
  }

  function updateFieldError(field: TripPreferencesFieldError['field'], message: string | null): void {
    const element = container.querySelector<HTMLElement>(`[data-field-error="${field}"]`)
    if (element !== null) element.textContent = message ?? ''
  }

  container.addEventListener('change', (event) => {
    const target = event.target
    if (target instanceof HTMLSelectElement && target.dataset.editorAction === 'set-transfer-timing' && target.dataset.position !== undefined) {
      setItemTransferTiming(Number(target.dataset.position), target.value as TransferTiming)
      return
    }
    if (target instanceof HTMLSelectElement && target.dataset.editorField === 'terrain-override') {
      terrainOverride = target.value === 'automatic' ? null : target.value === 'mountain'
      render()
      return
    }
    if (target instanceof HTMLInputElement && target.dataset.editorField === 'start-date') {
      startDate = target.value === '' ? startDate : target.value
      render()
      return
    }
    if (!(target instanceof HTMLInputElement)) return
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
    if (!(target instanceof HTMLInputElement)) return
    if (target.dataset.editorField === 'reference-speed') {
      if (Number.isFinite(target.valueAsNumber)) referenceSpeedKph = target.valueAsNumber
      updateFieldError('referenceSpeedKph', referenceSpeedKph < TRIP_REFERENCE_SPEED_MIN_KPH || referenceSpeedKph > TRIP_REFERENCE_SPEED_MAX_KPH
        ? `Entre ${TRIP_REFERENCE_SPEED_MIN_KPH} et ${TRIP_REFERENCE_SPEED_MAX_KPH} km/h.`
        : null)
      updateSaveButtonState()
      return
    }
    if (target.dataset.editorField === 'name') {
      name = target.value
      updateFieldError('name', name.trim() === '' ? 'Le nom du voyage ne peut pas être vide.' : null)
      updateSaveButtonState()
    }
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
