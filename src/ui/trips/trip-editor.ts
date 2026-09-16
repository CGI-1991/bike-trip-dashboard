/** Compact structural editor reusing the 6C1 pre-analysis, warnings and GPX engine. */

import type { GpxImportFile } from '../../import/gpx/types.ts'
import { checkChainContinuity, detectStrictDuplicates, editGpxTrip, loadTripEditDraft, preAnalyzeGpxFiles } from '../../trips-manager/index.ts'
import type { GpxPreAnalysis, TripEditSlot } from '../../trips-manager/index.ts'
import { shiftTripStartDate, updateTripPreferences, TRIP_REFERENCE_SPEED_MAX_KPH, TRIP_REFERENCE_SPEED_MIN_KPH, validateTripPreferencesUpdate } from '../../trips-manager/trip-preferences.ts'
import type { TripPreferencesFieldError, TripPreferencesUpdate } from '../../trips-manager/trip-preferences.ts'
import { createTripRepository } from '../../storage/indexeddb/trip-repository.ts'
import { resolveOffLocation, resolveTransferLocations } from '../../analysis/day-location-fill.ts'
import { resetEnrichmentForRecalculation } from '../../route-enrichment/settled-stages.ts'
import { enrichableStageFingerprints } from '../../route-enrichment/enrichment-jobs.ts'
import { createRouteEnrichmentCacheRepository } from '../../storage/indexeddb/route-enrichment-cache-repository.ts'
import { formatShortDate } from '../date-format.ts'
import { climbSensitivityAtIndex, patchClimbSensitivityLabels, renderClimbSensitivitySlider } from './climb-sensitivity-slider.ts'
import { renderRaceModeToggle } from './race-mode-toggle.ts'
import { openChooseOptionDialog } from './choose-option-dialog.ts'
import { applyRaceMode, hasConfiguredStagePauses } from '../../trips-manager/race-mode.ts'
import { applyClimbDetectionSensitivity, resolveClimbDetectionSensitivity } from '../../trips-manager/climb-sensitivity.ts'
import type { AccommodationId, ClimbDetectionSensitivity, IsoDate, SourceFileId, TransferTiming, TripBundle, TripDayId, TripId } from '../../trip-core/index.ts'
import type { TripsManagerDeps } from './trips-manager.ts'

type EditorItem =
  | {
      readonly key: string
      readonly kind: 'ride'
      readonly existingDayId: TripDayId | null
      readonly existingSourceFileId: SourceFileId | null
      readonly file: GpxImportFile
      readonly preAnalysis: GpxPreAnalysis | null
      /** The traveller's own optional stage name (`RideStage.customName`) — `null` means "none". */
      readonly customName: string | null
      /** "Étape liée": ridden the same calendar day as the ride row right above it. */
      readonly linkedToPrevious: boolean
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
  dedicated: 'Journée indépendante',
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
  /** DER-DES-DER sections 34-36 — in-flight guard + the short confirmation feedback for "Recalculer les données du parcours". */
  let recalculating = false
  let recalculationMessage: string | null = null
  /**
   * D3.1 sections 1/3-4/17: "Informations" (name/date/speed/terrain) is a
   * genuinely separate category from "Structure" (the GPX/OFF/transfer list
   * below) — saved through the light `updateTripPreferences` path whenever
   * nothing structural actually changed (section 28-29), never through
   * `editGpxTrip`'s heavy rebuild. `name`/`startDate`/`referenceSpeedKph`
   * are the live-edited values; the `original*` copies (captured once in
   * `initialize()`) are what dirty-state/no-op detection and the
   * structural-vs-light routing decision compare against.
   */
  let name = ''
  let startDate: string | null = null
  let referenceSpeedKph = 18
  /** Mode "Course / Tour" — in-stage pauses disabled, and the only mode in which stages may be linked onto one day. */
  let raceMode = false
  let climbSensitivity: ClimbDetectionSensitivity = 'standard'
  /** Which lodging each newly formed group keeps, answered at link time — keyed by the group's head day (see `editGpxTrip`'s own `lodgingResolutions`). */
  const lodgingResolutions = new Map<TripDayId, AccommodationId>()
  let originalName = ''
  let originalStartDate: string | null = null
  let originalReferenceSpeedKph = 18
  let originalRaceMode = false
  let originalClimbSensitivity: ClimbDetectionSensitivity = 'standard'
  let originalStructureSnapshot = ''
  /** Kept only to preview the auto-filled OFF/transfer location (CDC Jalon B4.3 sections 13-14) for slots that already existed before this editing session — a brand-new slot has no neighbouring stage data to preview from yet (it is only produced once this edit is saved and re-analysed). */
  let originalBundle: TripBundle | null = null

  /**
   * "Informer brièvement l'utilisateur si des horaires ont été ajustés" —
   * said BEFORE leaving the editor, because the save immediately navigates
   * away and a message rendered here would never be read. One modal, one
   * "Continuer": informational, never a question.
   */
  async function reportScheduleChanges(
    adjustments: readonly { readonly stageLabel: string; readonly from: string; readonly to: string }[],
    overflows: readonly { readonly stageLabel: string }[],
  ): Promise<void> {
    const parts: string[] = []
    if (adjustments.length > 0) parts.push(`Horaires ajustés : ${adjustments.map((entry) => `${entry.stageLabel} ${entry.from} → ${entry.to}`).join(', ')}.`)
    if (overflows.length > 0) parts.push(`${overflows.map((entry) => entry.stageLabel).join(', ')} dépasse minuit : ces étapes ne tiennent plus dans une même journée.`)
    if (parts.length === 0) return
    const notify = deps.chooseOption ?? openChooseOptionDialog
    await notify({ title: 'Horaires des étapes liées', message: parts.join(' '), options: [{ value: 'ok', label: 'Continuer' }] })
  }

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
      // `customName`/`linkedToPrevious` ride along with the structure rather
      // than with the Informations card: both are written by the same
      // `applyDayStructure` pass that assigns each day its index and date,
      // and a link genuinely changes the trip's calendar shape.
      ? { kind: 'ride', existingDayId: item.existingDayId, existingSourceFileId: item.existingSourceFileId, customName: item.customName, linkedToPrevious: item.linkedToPrevious }
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
      || raceMode !== originalRaceMode
      || climbSensitivity !== originalClimbSensitivity
  }

  /** D3.1 section 36: the exact same field validation the light save path enforces, reused here so Save stays disabled for an invalid name/speed regardless of which path (light or heavy) would end up handling it. */
  function currentPreferencesUpdate(): TripPreferencesUpdate {
    return {
      ...(name.trim() !== originalName ? { name } : {}),
      ...(startDate !== null && startDate !== originalStartDate ? { startDate } : {}),
      ...(referenceSpeedKph !== originalReferenceSpeedKph ? { referenceSpeedKph } : {}),
      ...(raceMode !== originalRaceMode ? { raceMode } : {}),
      ...(climbSensitivity !== originalClimbSensitivity ? { climbDetectionSensitivity: climbSensitivity } : {}),
    }
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

  /**
   * Drops a link a reorder/removal left dangling: a ride row that is now
   * first, or no longer preceded by another ride row, cannot be "the same
   * day as the previous stage". Called after every structural mutation, so
   * the draft can never hold an orphan link — and `applyDayStructure`
   * applies the same rule again on save, as a second line of defence.
   */
  function normalizeLinks(): void {
    items = items.map((item, index) => {
      if (item.kind !== 'ride' || !item.linkedToPrevious) return item
      return items[index - 1]?.kind === 'ride' ? item : { ...item, linkedToPrevious: false }
    })
  }

  async function addFiles(files: FileList): Promise<void> {
    const importFiles = await Promise.all(Array.from(files).map(browserFileToImportFile))
    const analyses = await preAnalyzeGpxFiles(importFiles)
    importFiles.forEach((file, index) => {
      items.push({ key: nextKey(), kind: 'ride', existingDayId: null, existingSourceFileId: null, file, preAnalysis: analyses[index] ?? null, customName: null, linkedToPrevious: false })
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
    normalizeLinks()
    render()
  }

  function insertAfter(position: number, kind: 'off' | 'transfer'): void {
    if (!Number.isInteger(position)) return
    const insertAt = Math.min(Math.max(position + 1, 0), items.length)
    items = [...items.slice(0, insertAt), { key: nextKey(), kind, existingDayId: null, notes: null }, ...items.slice(insertAt)]
    normalizeLinks()
    render()
  }

  function remove(position: number): void {
    if (!Number.isInteger(position) || position < 0 || position >= items.length) return
    items = [...items.slice(0, position), ...items.slice(position + 1)]
    normalizeLinks()
    render()
  }

  /** The traveller's own stage name. Blank/whitespace-only is stored as `null`, i.e. "no custom name" — the one normalization, applied here at the source. */
  function setItemCustomName(position: number, value: string): void {
    const target = items[position]
    if (target === undefined || target.kind !== 'ride') return
    const trimmed = value.trim()
    const next = [...items]
    next[position] = { ...target, customName: trimmed === '' ? null : trimmed }
    items = next
  }

  /** The ride rows that would share one calendar day with `position`, once `position` itself is linked. Used to spot a lodging conflict before creating the link. */
  function groupPositionsAround(position: number, linked: boolean): readonly number[] {
    const isLinkedAt = (index: number): boolean => (index === position ? linked : items[index]?.kind === 'ride' && (items[index] as Extract<EditorItem, { kind: 'ride' }>).linkedToPrevious)
    let first = position
    while (first > 0 && isLinkedAt(first)) first -= 1
    let last = position
    while (last + 1 < items.length && items[last + 1]?.kind === 'ride' && isLinkedAt(last + 1)) last += 1
    return Array.from({ length: last - first + 1 }, (_value, offset) => first + offset)
  }

  /**
   * The distinct lodgings already attached to the days this group would
   * cover. Only days that existed before this editing session can carry one
   * — a brand-new GPX row has no day, and therefore no booking, yet.
   */
  function groupLodgingOptions(positions: readonly number[]): readonly { readonly dayId: TripDayId; readonly accommodationId: AccommodationId; readonly label: string }[] {
    if (originalBundle === null) return []
    const options: { dayId: TripDayId; accommodationId: AccommodationId; label: string }[] = []
    for (const position of positions) {
      const item = items[position]
      if (item === undefined || item.kind !== 'ride' || item.existingDayId === null) continue
      const day = originalBundle.days.find((candidate) => candidate.id === item.existingDayId)
      if (day === undefined || day.accommodationId === null) continue
      if (options.some((option) => option.accommodationId === day.accommodationId)) continue
      const accommodation = originalBundle.accommodations.find((candidate) => candidate.id === day.accommodationId)
      const stage = originalBundle.stages.find((candidate) => candidate.id === day.stageId)
      const stageLabel = stage?.customName?.trim() !== undefined && stage?.customName?.trim() !== ''
        ? stage.customName as string
        : `${stage?.startLocationName ?? '—'} → ${stage?.endLocationName ?? '—'}`
      options.push({ dayId: day.id, accommodationId: day.accommodationId, label: `${accommodation?.name ?? 'Hébergement'} (${stageLabel})` })
    }
    return options
  }

  /**
   * Links this ride row to the one above it (both must be rides — a group
   * never spans an OFF day or a transfer). When the resulting group would
   * hold two genuinely different lodgings, the traveller picks which one to
   * keep BEFORE the link exists; cancelling leaves the trip exactly as it
   * was.
   */
  async function linkStage(position: number): Promise<void> {
    const target = items[position]
    const previous = items[position - 1]
    if (target === undefined || target.kind !== 'ride' || previous === undefined || previous.kind !== 'ride') return

    const positions = groupPositionsAround(position, true)
    const options = groupLodgingOptions(positions)
    let keptAccommodationId: AccommodationId | null = null
    if (options.length > 1) {
      const ask = deps.chooseOption ?? openChooseOptionDialog
      const chosen = await ask({
        title: 'Un seul hébergement pour la journée',
        message: 'Ces étapes partageront une même nuit. Quel hébergement conserver ?',
        options: options.map((option) => ({ value: option.accommodationId, label: option.label })),
      })
      if (chosen === null) return
      keptAccommodationId = chosen as AccommodationId
    }

    const next = [...items]
    next[position] = { ...target, linkedToPrevious: true }
    items = next
    if (keptAccommodationId !== null) {
      const headPosition = groupPositionsAround(position, true)[0]
      const head = headPosition === undefined ? undefined : items[headPosition]
      if (head !== undefined && head.kind === 'ride' && head.existingDayId !== null) lodgingResolutions.set(head.existingDayId, keptAccommodationId)
    }
    render()
  }

  /**
   * Splits the group at this row: it and everything still linked behind it
   * move to the next day, and the rest of the planning shifts with them —
   * the calendar offsets do that on their own, preserving order, other
   * groups and every OFF/transfer block.
   */
  function unlinkStage(position: number): void {
    const target = items[position]
    if (target === undefined || target.kind !== 'ride' || !target.linkedToPrevious) return
    const next = [...items]
    next[position] = { ...target, linkedToPrevious: false }
    items = next
    render()
  }

  /**
   * Tour on: existing stops are removed and every ETA recomputed without
   * them — confirmed first, and cancelling leaves the trip intact. Back to
   * Voyage: linked stages can no longer exist, so they are separated (each
   * onto its own day) rather than left as orphan links the UI would no
   * longer show. Also confirmed first.
   */
  async function setRaceMode(enabled: boolean): Promise<void> {
    if (enabled === raceMode) return
    if (enabled && originalBundle !== null && hasConfiguredStagePauses(originalBundle)) {
      if (!window.confirm('Passer en mode Tour ?\n\nLes arrêts prévus pendant les étapes seront retirés et les heures d’arrivée recalculées sans eux. Les journées OFF, les transferts et les points d’intérêt sont conservés.')) return
    }
    if (!enabled && items.some((item) => item.kind === 'ride' && item.linkedToPrevious)) {
      if (!window.confirm('Revenir en mode Voyage ?\n\nLes étapes liées seront replacées chacune sur sa propre journée et la suite du planning sera décalée.')) return
      items = items.map((item) => (item.kind === 'ride' && item.linkedToPrevious ? { ...item, linkedToPrevious: false } : item))
      lodgingResolutions.clear()
    }
    raceMode = enabled
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
    // `idFactory` matters only for a climb-sensitivity change, which mints
    // brand-new `Climb` ids — passed through so they come from the app's own
    // source rather than the module's fallback counter.
    const result = await updateTripPreferences({ database: deps.database, tripId, update: currentPreferencesUpdate(), now: deps.now, idFactory: deps.idFactory })
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
        ? {
            kind: 'ride',
            existingDayId: item.existingDayId,
            existingSourceFileId: item.existingSourceFileId,
            file: item.file,
            customName: item.customName,
            // A link only means anything in Course/Tour mode; leaving the
            // mode drops every link in the draft first (`setRaceMode`), and
            // this second guard makes the saved structure independent of the
            // order those two states happened to be touched in.
            sameCalendarDayAsPrevious: raceMode && item.linkedToPrevious,
          }
        : item.kind === 'transfer'
          ? { kind: 'transfer', existingDayId: item.existingDayId, notes: item.notes, transferTiming: item.transferTiming }
          : { kind: item.kind, existingDayId: item.existingDayId, notes: item.notes },
    )
    const result = await editGpxTrip({ database: deps.database, tripId, slots, idFactory: deps.idFactory, now: deps.now, lodgingResolutions })
    if (result.ok) {
      const tripRepository = createTripRepository(deps.database)
      const trimmedName = name.trim()
      let patched: TripBundle = {
        ...result.bundle,
        metadata: { ...result.bundle.metadata, name: trimmedName === '' ? result.bundle.metadata.name : trimmedName },
        settings: { ...result.bundle.settings, global: { ...result.bundle.settings.global, referenceSpeedKph } },
      }
      if (startDate !== null && startDate !== patched.calendar.startDate) patched = shiftTripStartDate(patched, startDate as IsoDate)
      // Both go through the same functions the light path uses, so a
      // structural save and a preferences-only save can never apply them
      // differently. Order matters only in that the timing pass (race mode)
      // has the last word on durations.
      patched = applyRaceMode(patched, raceMode)
      patched = applyClimbDetectionSensitivity(patched, climbSensitivity, deps.idFactory)
      await tripRepository.saveTripBundle(patched)
      await reportScheduleChanges(result.scheduleAdjustments, result.scheduleOverflows)
      onSaved(patched)
      return
    }
    stage = 'editing'
    errorMessage = result.message
    render()
  }

  /**
   * DER-DES-DER sections 34-37 — "Recalculer les données du parcours".
   *
   * Section 36 asks for a confirmation first, in plain terms. Section 33's
   * "invalidation explicite" then happens through the one function that owns
   * that concept (`resetEnrichmentForRecalculation`): every provider drops
   * back to `pending` and forgets its settled fingerprints, which is exactly
   * what makes the next automatic pass re-query every stage. The pass itself
   * is not started here — reopening the trip runs it, through the same single
   * orchestration entry point everything else uses (section 38: never a
   * second, parallel enrichment path).
   */
  async function recalculate(): Promise<void> {
    if (recalculating || stage === 'saving') return
    if (!window.confirm('Recalculer les lieux, services et pauses du voyage ?\n\nLes données automatiques seront rafraîchies à la prochaine ouverture du voyage. Vos saisies manuelles sont conservées.')) return
    recalculating = true
    recalculationMessage = null
    render()
    try {
      const repository = createTripRepository(deps.database)
      const bundle = await repository.loadTripBundle(tripId)
      if (bundle === null) {
        recalculationMessage = 'Voyage introuvable.'
        return
      }
      // Clearing the job record alone would achieve nothing: every request
      // would be answered from the provider cache with exactly what it
      // returned before. This action exists to pick up changes in OSM
      // itself, so the cached answers for this trip's routes go too.
      await createRouteEnrichmentCacheRepository(deps.database)
        .clearForRouteFingerprints(enrichableStageFingerprints(bundle))
      await repository.saveTripBundle(resetEnrichmentForRecalculation(bundle))
      recalculationMessage = 'Les données seront rafraîchies à la prochaine ouverture du voyage.'
    } catch {
      recalculationMessage = 'Le recalcul n’a pas pu être préparé. Réessayez plus tard.'
    } finally {
      recalculating = false
      render()
    }
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

  /**
   * The small chain button that sits BETWEEN two consecutive stage blocks
   * — the one place a link is created or removed. Only ever rendered in
   * Course/Tour mode, and only between two ride rows: a group never spans an
   * OFF day or a transfer, so there is simply no control there to click.
   */
  function renderLinkControl(position: number): string {
    if (!raceMode) return ''
    const item = items[position]
    const previous = items[position - 1]
    if (item === undefined || item.kind !== 'ride' || previous === undefined || previous.kind !== 'ride') return ''
    const linked = item.linkedToPrevious
    const label = linked ? 'Étapes liées — séparer' : 'Lier à l’étape précédente (même journée)'
    return `<li class="wizard-structure__link-row"><button class="button button--quiet wizard-structure__link${linked ? ' is-linked' : ''}" type="button" data-editor-action="${linked ? 'unlink-stage' : 'link-stage'}" data-position="${position}" aria-pressed="${linked}" aria-label="${label}" title="${label}">⛓</button></li>`
  }

  /** One `<li>` per structure row, plus (for a ride row that can be linked) the chain control above it. `withLinkControl: false` is used when the caller already emitted it outside a group wrapper. */
  function renderItem(item: EditorItem, position: number, options: { readonly withLinkControl?: boolean } = {}): string {
    const linkControl = options.withLinkControl === false ? '' : renderLinkControl(position)
    const moveControls = renderMoveControls(position)
    const insertControls = renderInsertControls(position)
    if (item.kind !== 'ride') {
      const label = item.kind === 'off' ? 'OFF' : 'Transfert'
      const timingControl = item.kind === 'transfer' ? renderTransferTimingSelect(item, position) : ''
      return `${linkControl}<li class='wizard-structure__row wizard-structure__row--${item.kind}'><span class='tag tag--off'>${label}</span>${renderAutoFillPreview(item)}${timingControl}${moveControls}<button class='button button--quiet' type='button' data-editor-action='remove' data-position='${position}'>Retirer</button></li>${insertControls}`
    }

    const analysis = item.preAnalysis
    const metrics = analysis?.status === 'valid'
      ? `<dl class='wizard-file__metrics'><div><dt>Distance</dt><dd>${(analysis.distanceKm ?? 0).toFixed(1)} km</dd></div><div><dt>D+</dt><dd>+${Math.round(analysis.elevationGainM ?? 0)} m</dd></div><div><dt>D−</dt><dd>−${Math.round(analysis.elevationLossM ?? 0)} m</dd></div></dl>`
      : `<p class='wizard-file__error'>${analysis === null ? 'Analyse…' : escapeHtml(analysis.errorMessage ?? 'Fichier invalide.')}</p>`
    // CDC Jalon B4.4 section 18: a real button proxies a visually-hidden
    // per-row `<input type="file">` — never the native file control exposed
    // directly (the old `<label class="button">Remplacer<input …></label>`
    // pattern let the browser's own file-input UI show through the label).
    // The stage's own optional name, edited right where the stage itself is
    // configured. It never touches the GPX, the ids or the départ/arrivée
    // places — leaving it empty keeps every label exactly as it is today.
    const nameField = `<label class='wizard-structure__stage-name'><span>Nom de l’étape</span><input type='text' data-editor-field='stage-name' data-position='${position}' value='${escapeHtml(item.customName ?? '')}' maxlength='120' placeholder='Facultatif'></label>`
    return `${linkControl}<li class='wizard-structure__row wizard-file'><span class='tag tag--ride'>Étape</span><strong>${escapeHtml(item.file.name)}</strong>${nameField}${metrics}${moveControls}<button class='button button--quiet' type='button' data-editor-action='trigger-replace' data-position='${position}'>Remplacer</button><input type='file' accept='.gpx' class='visually-hidden' data-editor-field='replace' data-position='${position}' tabindex='-1' aria-hidden='true'><button class='button button--quiet' type='button' data-editor-action='remove' data-position='${position}'>Retirer</button></li>${insertControls}`
  }

  /**
   * The structure list, with each run of linked stages wrapped in one shared
   * container so a group reads as a single journée at a glance. Every row
   * inside keeps its own block, its own GPX and its own controls — nothing
   * is merged, only grouped.
   */
  function renderStructureList(): string {
    const parts: string[] = []
    let position = 0
    while (position < items.length) {
      let last = position
      while (last + 1 < items.length) {
        const next = items[last + 1]
        if (next?.kind !== 'ride' || !next.linkedToPrevious || !raceMode) break
        last += 1
      }
      const current = items[position]
      if (current === undefined) break
      if (last > position) {
        const rows = items.slice(position, last + 1)
          .map((item, offset) => renderItem(item, position + offset, offset === 0 ? { withLinkControl: false } : {}))
          .join('')
        parts.push(renderLinkControl(position))
        parts.push(`<li class='wizard-structure__group'><p class='wizard-structure__group-label'>Même journée — ${last - position + 1} étapes</p><ul class='wizard-structure__group-list'>${rows}</ul></li>`)
        position = last + 1
        continue
      }
      parts.push(renderItem(current, position))
      position += 1
    }
    return parts.join('')
  }

  function renderWarnings(): string {
    const duplicateNames = strictDuplicateNames()
    const warnings = continuityWarnings()
    const rows: string[] = []
    if (duplicateNames.size > 0) rows.push(`<li class='wizard-alert wizard-alert--blocking'>Doublon strict détecté — retirez ou remplacez le fichier concerné.</li>`)
    warnings.forEach((warning) => rows.push(`<li class='wizard-alert'>Rupture de continuité entre ${escapeHtml(warning.fromFileName)} et ${escapeHtml(warning.toFileName)} (${warning.gapKm.toFixed(1)} km, non bloquant).</li>`))
    return rows.length === 0 ? '' : `<ul class='wizard-alerts'>${rows.join('')}</ul>`
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
    </section>`
  }

  /**
   * DER-DES-DER sections 34-37 — the ONE explicit way to make the app
   * re-query everything it has already settled.
   *
   * A trip prepared months in advance is the case this exists for (section
   * 35): OSM has moved on, a shop closed, a village gained a fountain. Since
   * the pipeline became genuinely one-shot (sections 31-33), nothing else
   * ever re-queries a settled stage — so this is deliberately discreet and
   * deliberately reachable, tucked under Réglages avancés rather than
   * anywhere a rider could hit it by accident in the field.
   *
   * Section 37: it clears provider BOOKKEEPING only. Custom pauses, notes,
   * lodging, reservations, transfers, location overrides and departure times
   * live elsewhere in the bundle and are structurally out of its reach — the
   * hint says so plainly, in the user's own terms.
   */
  function renderRecalculationAction(): string {
    return `<div class='wizard-advanced__action'>
      <button class='button button--quiet' type='button' data-editor-action='recalculate' ${stage === 'saving' || recalculating ? 'disabled' : ''}>Recalculer les données du parcours</button>
      <p class='field__hint'>Relance la recherche des lieux, services et pauses automatiques. Vos saisies (pauses choisies, notes, logement, réservations) sont conservées.</p>
      ${recalculationMessage === null ? '' : `<p class='field__hint' role='status'>${escapeHtml(recalculationMessage)}</p>`}
    </div>`
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
      <ul class='wizard-structure__list'>${renderStructureList()}</ul>
      ${renderWarnings()}
      <details class='wizard-advanced'><summary>Réglages avancés</summary>
        ${renderRaceModeToggle(raceMode)}
        ${renderClimbSensitivitySlider(climbSensitivity)}
        ${renderRecalculationAction()}
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
      // Both default to what the bundle already means for a trip saved
      // before these settings existed: Classique, and the historical
      // detection calibration.
      raceMode = draft.bundle.settings.global.raceMode === true
      originalRaceMode = raceMode
      climbSensitivity = resolveClimbDetectionSensitivity(draft.bundle)
      originalClimbSensitivity = climbSensitivity
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
        const item: EditorItem = {
          key: nextKey(),
          ...slot,
          customName: slot.customName ?? null,
          linkedToPrevious: slot.sameCalendarDayAsPrevious === true,
          preAnalysis: analyses[rideIndex] ?? null,
        }
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
      return
    }
    // Same focus-preserving treatment as the trip name and the reference
    // speed: a full `render()` per keystroke would reset the caret.
    if (target.dataset.editorField === 'stage-name' && target.dataset.position !== undefined) {
      setItemCustomName(Number(target.dataset.position), target.value)
      updateSaveButtonState()
      return
    }
    // A range input must never be re-rendered mid-drag either — only its
    // two label lines are refreshed in place.
    if (target.dataset.editorField === 'climb-sensitivity') {
      climbSensitivity = climbSensitivityAtIndex(Number(target.value))
      patchClimbSensitivityLabels(container, climbSensitivity)
      updateSaveButtonState()
    }
  }, { signal: controller.signal })

  container.addEventListener('click', (event) => {
    const target = event.target
    if (!(target instanceof Element)) return
    // The shared Voyage/Tour control (`race-mode-toggle.ts`, also used by
    // the creation wizard) carries a plain `data-action`, not this file's own
    // `data-editor-action` convention — checked first, on its own.
    const raceButton = target.closest<HTMLElement>('[data-action="set-race-mode"]')
    if (raceButton !== null) {
      void setRaceMode(raceButton.dataset.raceMode === 'on')
      return
    }
    const button = target.closest<HTMLElement>('[data-editor-action]')
    if (button === null) return
    const action = button.dataset.editorAction
    const position = Number(button.dataset.position)
    // CDC Jalon B4.4 sections 17-18: both file pickers are real buttons
    // proxying their own visually-hidden `<input type="file">` — never the
    // native control shown directly in the layout.
    if (action === 'trigger-add') { container.querySelector<HTMLInputElement>('#editor-add-files')?.click(); return }
    if (action === 'trigger-replace') { container.querySelector<HTMLInputElement>(`input[data-editor-field="replace"][data-position="${position}"]`)?.click(); return }
    if (action === 'link-stage') { void linkStage(position); return }
    if (action === 'unlink-stage') { unlinkStage(position); return }
    if (action === 'move-up') move(position, -1)
    else if (action === 'move-down') move(position, 1)
    else if (action === 'insert-off') insertAfter(position, 'off')
    else if (action === 'insert-transfer') insertAfter(position, 'transfer')
    else if (action === 'remove') remove(position)
    else if (action === 'save') void save()
    else if (action === 'recalculate') void recalculate()
    else if (action === 'cancel') onCancelled()
  }, { signal: controller.signal })

  void initialize()

  return { destroy: () => controller.abort() }
}
