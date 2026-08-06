/**
 * "Mes voyages" — CDC phase 6C1 sections 5-7/24-27, reworked across Jalons
 * B4.2/B4.3. Lists every stored `TripBundle`, lets the user create one (the
 * import wizard), open its technical view, or delete it. Independent of the
 * historical RGA runtime — see `README.md`.
 */

import { createTripRepository } from '../../storage/indexeddb/trip-repository.ts'
import { createSourceFileRepository } from '../../storage/indexeddb/source-file-repository.ts'
import type { SourceFilePayloadContent } from '../../storage/indexeddb/source-file-repository.ts'
import { enrichStoredTripEndpoints, tripNeedsEndpointGeocoding } from '../../geocoding/endpoint-enrichment.ts'
import type { GeocodingProvider } from '../../geocoding/types.ts'
import type { RouteEnrichmentProgress, RouteEnrichmentProvider } from '../../route-enrichment/types.ts'
import { runStoredTripAutomaticEnrichment, tripNeedsAutomaticEnrichment } from '../../route-enrichment/automatic-enrichment.ts'
import { createSingleFlightGuard } from '../../trips-manager/single-flight.ts'
import type { WaypointVisibilityFilters } from '../../analysis/canonical-waypoints.ts'
import type {
  AccommodationId, IsoDate, RideStageId, RideStageSettings, RoutePointId, StagePauseSetting, TripBundle, TripDayId, TripId,
} from '../../trip-core/index.ts'
import { getActiveTripId } from '../../storage/indexeddb/active-trip.ts'
import { selectMostRelevantTrip } from '../../trips-manager/active-trip-selection.ts'
import { deleteTripCompletely, listTripSummaries, setActiveTrip } from '../../trips-manager/trip-manager-actions.ts'
import type { TripListEntry } from '../../trips-manager/trip-summary.ts'
import { closeExpandedRouteMap, renderGenericRouteMap } from '../route-map.ts'
import type { MapLayerDefinition } from '../route-map.ts'
import { buildGenericOverviewRouteMapModel, buildGenericRouteMapModel } from '../route-map-model.ts'
import { renderGenericElevationProfile } from '../elevation-profile.ts'
import { downloadBlob } from '../gpx-share.ts'
import { buildZipArchive } from '../zip-writer.ts'
import type { ZipEntryInput } from '../zip-writer.ts'
import { buildDayDetail } from './day-detail-view.ts'
import type { DayDetail } from './day-detail-view.ts'
import { createImportWizard } from './import-wizard.ts'
import type { ImportWizardResult } from './import-wizard.ts'
import { createTripEditor } from './trip-editor.ts'
import { renderTripDetail } from './trip-detail-view.ts'
import { buildTripOverview } from './trip-overview-view.ts'

/** One "Villages" layer entry for the fullscreen map (CDC Jalon B4 section 9) — `[]` when the stage has no village at all, so the "Calques" button stays hidden rather than showing an empty layer. */
function villagesLayer(waypoints: readonly import('../../analysis/canonical-waypoints.ts').CanonicalWaypoint[]): readonly MapLayerDefinition[] {
  if (waypoints.length === 0) return []
  return [{ id: 'villages', label: 'Villages', markers: buildGenericRouteMapModel(waypoints, []).markers, defaultVisible: false }]
}

function payloadToUint8Array(content: SourceFilePayloadContent): Promise<Uint8Array> {
  return content instanceof Blob ? content.arrayBuffer().then((buffer) => new Uint8Array(buffer)) : Promise.resolve(new Uint8Array(content))
}

function payloadToBlob(content: SourceFilePayloadContent, mimeType: string): Blob {
  return content instanceof Blob ? content : new Blob([content], { type: mimeType })
}

export interface TripsManagerDeps {
  readonly database: IDBDatabase
  readonly now: () => string
  readonly idFactory: () => string
  readonly geocodingProvider?: GeocodingProvider
  readonly routeEnrichmentProvider?: RouteEnrichmentProvider
  readonly onRouteEnrichmentDiagnostic?: (progress: RouteEnrichmentProgress) => void
  /**
   * Drives the top-level app nav (URL hash + bottom-nav highlighting) when
   * this component navigates on its own initiative — e.g. "Ouvrir" on a
   * trip card (CDC Jalon B4.2 section 5: must be strictly equivalent to
   * selecting the trip active, then clicking the Aperçu nav link). Omitted
   * in tests that don't exercise top-level navigation.
   */
  readonly onNavigateToView?: (view: 'today' | 'trip') => void
}

/** Where the Étape screen's "Retour" action leads back to (CDC section 13). */
type DayOrigin = 'overview' | 'detail'

type Mode =
  | { readonly kind: 'list' }
  | { readonly kind: 'wizard' }
  | { readonly kind: 'editor'; readonly tripId: TripId }
  | { readonly kind: 'overview'; readonly tripId: TripId }
  | { readonly kind: 'detail'; readonly tripId: TripId }
  | { readonly kind: 'day'; readonly tripId: TripId; readonly dayId: TripDayId; readonly origin: DayOrigin }
  | { readonly kind: 'confirmation'; readonly result: ImportWizardResult }

/**
 * Ride days only, in chronological order — the Étape sticky nav's ‹/›
 * (CDC section 13) navigates between them because only ride days have an
 * Étape screen at all; an OFF/transfer day has none to land on.
 */
function rideDayIds(bundle: TripBundle): readonly TripDayId[] {
  return bundle.days.filter((day) => day.type === 'ride').sort((left, right) => left.index - right.index).map((day) => day.id)
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

/**
 * The whole card navigates ("Ouvrir" → Aperçu, CDC Jalon B4.3 section 4) —
 * `role="button" tabindex="0"` plus the shared keydown handler below give it
 * the same Enter/Space behaviour a real `<button>` gets for free. Modifier/
 * Supprimer stay as real nested buttons: `.closest('[data-action]')`
 * resolves to whichever is nearest, so clicking them never also triggers
 * the card's own `open-trip` action.
 */
function renderTripCard(trip: TripListEntry): string {
  const dateLabel = trip.startDate === null ? 'Non daté' : trip.endDate === null ? trip.startDate : `${trip.startDate} → ${trip.endDate}`
  return `
    <li class="trip-card" data-action="open-trip" data-trip-id="${escapeHtml(trip.id)}" role="button" tabindex="0">
      <div class="trip-card__header"><h3>${escapeHtml(trip.name)}</h3><span class="tag tag--data">${escapeHtml(trip.status)}</span></div>
      <dl class="trip-card__stats">
        <div><dt>Dates</dt><dd>${escapeHtml(dateLabel)}</dd></div>
        <div><dt>Journées</dt><dd>${trip.dayCount}</dd></div>
        <div><dt>Étapes</dt><dd>${trip.stageCount}</dd></div>
        <div><dt>Distance</dt><dd>${trip.totalDistanceKm.toFixed(1)} km</dd></div>
      </dl>
      <div class="trip-card__actions">
        <button class="button button--quiet" type="button" data-action="edit-trip" data-trip-id="${escapeHtml(trip.id)}">Modifier</button>
        <button class="button button--quiet" type="button" data-action="delete-trip" data-trip-id="${escapeHtml(trip.id)}">Supprimer</button>
      </div>
    </li>`
}

export interface TripsManagerHandle {
  readonly refresh: () => Promise<void>
  readonly goToList: () => void
  /** Opens Aperçu for the currently active trip (CDC Jalon B4 section 3: "Mes voyages détermine le voyage actif affiché ailleurs") — falls back to the trip list when there is none yet. */
  readonly goToOverviewForActiveTrip: () => Promise<void>
  /** Same, for Voyage. */
  readonly goToDetailForActiveTrip: () => Promise<void>
}

export function initializeTripsManager(container: HTMLElement, deps: TripsManagerDeps): TripsManagerHandle {
  let mode: Mode = { kind: 'list' }
  // The wizard/editor own their own live DOM listeners (AbortController-based)
  // separate from this container's single delegated click listener — torn
  // down by `teardownSubComponent` at the top of every full-screen render in
  // this file (CDC Jalon B4.3 section 16/2: navigating away — even via the
  // bottom-nav Aperçu/Voyage links, not just "Mes voyages" — while a
  // wizard/editor was still open used to leave its listeners attached to
  // this shared `container`, so a later click could still reach stale
  // wizard/editor state. Every entry point tearing it down structurally
  // rules that out, rather than only the ones this component itself thought
  // to call it from).
  let activeSubComponent: { readonly destroy: () => void } | null = null

  function teardownSubComponent(): void {
    activeSubComponent?.destroy()
    activeSubComponent = null
  }

  const geocodingInFlight = new Set<TripId>()
  const geocodingErrors = new Map<TripId, string>()
  const automaticEnrichmentGuard = createSingleFlightGuard<TripId>()
  const automaticEnrichmentProgress = new Map<TripId, string>()
  const automaticEnrichmentErrors = new Map<TripId, string>()
  /** Montées secondaires toggle (CDC Jalon B4.3 section 29) — local UI state, per day, never persisted; resets to off on reload, same as any other transient view preference in this file. No Villages toggle any more (section 26/28/29). */
  const dayFilters = new Map<TripDayId, { showSecondaryClimbs: boolean }>()

  function getDayFilters(dayId: TripDayId): WaypointVisibilityFilters {
    return dayFilters.get(dayId) ?? { showSecondaryClimbs: false }
  }

  async function renderList(): Promise<void> {
    teardownSubComponent()
    container.innerHTML = '<p role="status">Chargement de vos voyages…</p>'
    const trips = await listTripSummaries(deps.database)

    if (trips.length === 0) {
      container.innerHTML = `
        <div class="trips-empty" data-trips-empty>
          <header class="view-heading"><p class="eyebrow">Mes voyages</p><h2>Aucun voyage pour le moment</h2></header>
          <p>Importez vos traces GPX pour créer votre premier voyage.</p>
          <button class="button button--primary button--full" type="button" data-action="create-trip">Créer un voyage</button>
        </div>`
      return
    }

    container.innerHTML = `
      <div class="trips-list" data-trips-list>
        <header class="view-heading"><p class="eyebrow">Mes voyages</p><h2>${trips.length} voyage${trips.length > 1 ? 's' : ''}</h2></header>
        <button class="button button--primary button--full" type="button" data-action="create-trip">Créer un voyage</button>
        <ul class="trip-card-list">${trips.map(renderTripCard).join('')}</ul>
      </div>`
  }

  async function renderDetail(tripId: TripId): Promise<void> {
    teardownSubComponent()
    container.innerHTML = '<p role="status">Chargement du voyage…</p>'
    const tripRepository = createTripRepository(deps.database)
    const bundle = await tripRepository.loadTripBundle(tripId)
    if (bundle === null) {
      mode = { kind: 'list' }
      await renderList()
      return
    }
    const enrichmentBusy = geocodingInFlight.has(tripId) || automaticEnrichmentGuard.isInFlight(tripId)
    container.innerHTML = renderTripDetail(bundle, {
      canEnrichEndpoints: !enrichmentBusy && deps.geocodingProvider !== undefined && tripNeedsEndpointGeocoding(bundle),
      geocodingPending: geocodingInFlight.has(tripId),
      geocodingError: geocodingErrors.get(tripId) ?? null,
      automaticEnrichmentPending: automaticEnrichmentGuard.isInFlight(tripId),
      automaticEnrichmentProgress: automaticEnrichmentProgress.get(tripId) ?? null,
      automaticEnrichmentError: automaticEnrichmentErrors.get(tripId) ?? null,
    })
  }

  async function renderDay(tripId: TripId, dayId: TripDayId): Promise<void> {
    teardownSubComponent()
    container.innerHTML = '<p role="status">Chargement de la journée…</p>'
    const tripRepository = createTripRepository(deps.database)
    const bundle = await tripRepository.loadTripBundle(tripId)
    if (bundle === null) {
      mode = { kind: 'list' }
      await renderList()
      return
    }
    mountDayDetail(bundle, dayId)
  }

  /** Builds and mounts the whole Étape screen (map + profile + everything) — the *only* place that does a full teardown/rebuild of this screen; every pause/filter mutation instead goes through `patchDayDetail` (CDC Jalon B4.2 section 3). */
  function mountDayDetail(bundle: TripBundle, dayId: TripDayId): DayDetail | null {
    const detail = buildDayDetail(bundle, dayId, { filters: getDayFilters(dayId) })
    if (detail === null) {
      mode = { kind: 'detail', tripId: bundle.metadata.id }
      void renderDetail(bundle.metadata.id)
      return null
    }
    container.innerHTML = detail.html
    mountMapAndProfile(detail)
    // Sticky nav (CDC section 13): ‹/› only ever step between ride days —
    // an OFF/transfer day has no Étape screen to land on — disabled at
    // either boundary rather than wrapping or leading to a dead click.
    const rideIds = rideDayIds(bundle)
    const currentIndex = rideIds.indexOf(dayId)
    const previousButton = container.querySelector<HTMLButtonElement>('[data-action="previous-day"]')
    const nextButton = container.querySelector<HTMLButtonElement>('[data-action="next-day"]')
    if (previousButton !== null) previousButton.disabled = currentIndex <= 0
    if (nextButton !== null) nextButton.disabled = currentIndex < 0 || currentIndex >= rideIds.length - 1
    return detail
  }

  function mountMapAndProfile(detail: DayDetail): void {
    const mapContainer = container.querySelector<HTMLElement>('[data-day-detail-map]')
    const mapDialog = container.querySelector<HTMLDialogElement>('[data-day-detail-map-dialog]')
    if (mapContainer !== null && mapDialog !== null) {
      const visibleWaypoints = detail.waypoints.filter((waypoint) => waypoint.visibleByDefault)
      const model = detail.geometry === null
        ? null
        : buildGenericRouteMapModel(visibleWaypoints, detail.geometry.map((point) => [point.latitude, point.longitude] as const))
      renderGenericRouteMap(mapContainer, mapDialog, model, villagesLayer(detail.villageWaypoints))
      mapDialog.querySelector<HTMLButtonElement>('[data-close-map]')?.addEventListener('click', () => closeExpandedRouteMap(mapDialog))
    }
    const profileContainer = container.querySelector<HTMLElement>('[data-day-detail-profile]')
    if (profileContainer !== null) {
      renderGenericElevationProfile(profileContainer, detail.geometry, detail.waypoints.filter((waypoint) => waypoint.visibleByDefault), detail.stageLabel)
    }
  }

  /**
   * Targeted refresh after a pause/filter mutation (CDC Jalon B4.2/B4.3
   * section 3): patches only the stats/pauses/timeline subtrees plus the
   * map/profile — never wipes the whole Étape screen (no loading flash, no
   * lost scroll position, no unrelated focus loss). Silently no-ops if the
   * screen isn't showing this day any more (e.g. the user navigated away
   * meanwhile).
   */
  function patchDayDetail(bundle: TripBundle, dayId: TripDayId): void {
    if (mode.kind !== 'day' || mode.dayId !== dayId) return
    const detail = buildDayDetail(bundle, dayId, { filters: getDayFilters(dayId) })
    if (detail === null) return
    const statsEl = container.querySelector('[data-day-detail-stats]')
    if (statsEl !== null) statsEl.outerHTML = detail.statsHtml
    const pausesEl = container.querySelector('[data-day-detail-pauses]')
    if (pausesEl !== null) pausesEl.outerHTML = detail.pausesHtml
    const timelineEl = container.querySelector('[data-day-detail-timeline]')
    if (timelineEl !== null) timelineEl.innerHTML = detail.timelineHtml
    mountMapAndProfile(detail)
  }

  /**
   * Targeted refresh for the Infos tab only (CDC Jalon B4.2/B4.3 sections
   * 3/35-36): saving free text or lodging must not reload the whole Étape
   * screen — that would silently flip the visible tab back to Parcours and
   * reset scroll, the exact regression class section 3 exists to prevent.
   * Preserves whichever tab is currently open across the patch, and always
   * lands back in read mode (the fresh fragment's own default).
   */
  function patchInfosPanel(bundle: TripBundle, dayId: TripDayId): void {
    if (mode.kind !== 'day' || mode.dayId !== dayId) return
    const detail = buildDayDetail(bundle, dayId, { filters: getDayFilters(dayId) })
    if (detail === null) return
    const infosEl = container.querySelector<HTMLElement>('[data-day-panel="infos"]')
    if (infosEl === null) return
    const wasHidden = infosEl.hidden
    infosEl.outerHTML = detail.infosHtml
    const replaced = container.querySelector<HTMLElement>('[data-day-panel="infos"]')
    if (replaced !== null) replaced.hidden = wasHidden
  }

  async function renderOverview(tripId: TripId): Promise<void> {
    teardownSubComponent()
    container.innerHTML = '<p role="status">Chargement du voyage…</p>'
    const tripRepository = createTripRepository(deps.database)
    const bundle = await tripRepository.loadTripBundle(tripId)
    if (bundle === null) {
      mode = { kind: 'list' }
      await renderList()
      return
    }
    const overview = buildTripOverview(bundle, deps.now().slice(0, 10))
    container.innerHTML = overview.html
    const mapContainer = container.querySelector<HTMLElement>('[data-trip-overview-map]')
    const mapDialog = container.querySelector<HTMLDialogElement>('[data-trip-overview-map-dialog]')
    if (mapContainer !== null && mapDialog !== null) {
      const model = buildGenericOverviewRouteMapModel(overview.mapStages)
      const villageWaypoints = overview.mapVillageStages.flatMap((stage) => stage.waypoints)
      renderGenericRouteMap(mapContainer, mapDialog, model, villagesLayer(villageWaypoints))
      mapDialog.querySelector<HTMLButtonElement>('[data-close-map]')?.addEventListener('click', () => closeExpandedRouteMap(mapDialog))
    }
    // The highlighted day's own compact map (CDC Jalon B4.3 section 8) — a
    // second, independent, non-interactive preview; no fullscreen dialog of
    // its own (that's what "Voir cette étape" / the card's own navigation
    // leads to, via the real Étape screen's map).
    const dayMapContainer = container.querySelector<HTMLElement>('[data-trip-overview-day-map]')
    if (dayMapContainer !== null && overview.highlightedDayMap !== null) {
      const model = buildGenericRouteMapModel(overview.highlightedDayMap.waypoints, overview.highlightedDayMap.geometry)
      // Reuses the same primitive as the main map, but this preview has no
      // expand dialog of its own — a throwaway `<dialog>` keeps the shared
      // function's dialog-wiring a no-op here.
      renderGenericRouteMap(dayMapContainer, document.createElement('dialog'), model, [])
    }
  }

  /**
   * Single-flight per `tripId` via `automaticEnrichmentGuard` (stability
   * hardening 2026-08-04): opening the same trip twice in a row (a double
   * click on "Ouvrir", or navigating away and back before the first job
   * settles) used to run two full enrichment jobs concurrently for the same
   * trip — observed in the network capture as duplicate/correlated Postpass
   * requests — because the old ad-hoc guard only claimed its `Set` entry
   * *after* its first `await`. `createSingleFlightGuard` claims
   * synchronously, before `fn` runs at all, so that race is now structurally
   * impossible.
   */
  async function startAutomaticEnrichment(tripId: TripId): Promise<void> {
    await automaticEnrichmentGuard.run(tripId, async () => {
      const requestId = deps.idFactory()
      if (import.meta.env.DEV) console.debug('[automatic-enrichment] start', { tripId, requestId })

      try {
        const repository = createTripRepository(deps.database)
        const bundle = await repository.loadTripBundle(tripId)
        if (bundle === null) return
        if (!tripNeedsAutomaticEnrichment(bundle, deps)) return

        automaticEnrichmentErrors.delete(tripId)
        const report = await runStoredTripAutomaticEnrichment({
          database: deps.database,
          tripId,
          geocodingProvider: deps.geocodingProvider,
          routeEnrichmentProvider: deps.routeEnrichmentProvider,
          idFactory: deps.idFactory,
          now: deps.now,
          onProgress: (progress) => {
            if (progress.phase === 'endpoints') automaticEnrichmentProgress.set(tripId, 'Départs / arrivées')
            else {
              const detail = progress.detail
              if (import.meta.env.DEV) {
                console.debug('[automatic-enrichment] stage', {
                  tripId, requestId, stageId: detail.stageId, source: detail.source,
                  status: detail.status, durationMs: detail.durationMs,
                })
              }
              deps.onRouteEnrichmentDiagnostic?.(detail)
              const source = detail.source === 'cache' ? 'cache' : `${Math.round(detail.durationMs)} ms`
              const errors = detail.errorCount === 0 ? '' : ` · ${detail.errorCount} étape(s) en erreur`
              automaticEnrichmentProgress.set(tripId, `Points structurants — étape ${detail.stageIndex + 1}/${detail.stageCount} · ${source} · ${detail.retainedCandidateCount}/${detail.rawCandidateCount} retenus${errors}`)
            }
            void refreshIfShowing(tripId)
          },
        })
        if (report.partial) automaticEnrichmentErrors.set(tripId, 'Certaines données seront complétées lors d’une prochaine ouverture.')
      } catch (error) {
        automaticEnrichmentErrors.set(tripId, error instanceof Error ? error.message : 'Certaines données seront complétées ultérieurement.')
      } finally {
        if (import.meta.env.DEV) console.debug('[automatic-enrichment] finish', { tripId, requestId })
        automaticEnrichmentProgress.delete(tripId)
        await refreshIfShowing(tripId)
      }
    })
  }

  /** Re-renders whichever of Aperçu/Voyage is currently open for `tripId` — enrichment can finish while the user is on either screen. */
  async function refreshIfShowing(tripId: TripId): Promise<void> {
    if (mode.kind === 'overview' && mode.tripId === tripId) await renderOverview(tripId)
    else if (mode.kind === 'detail' && mode.tripId === tripId) await renderDetail(tripId)
  }

  /**
   * The trip's landing screen (CDC: Mes voyages → Aperçu → Voyage → Étape) —
   * kicks off automatic enrichment exactly once, same as opening used to from
   * Voyage directly. Also the single place that marks a trip active (CDC
   * section 3): every path that lands here (list click, or the bottom-nav
   * Aperçu/Voyage links resolving the last active trip) agrees on the same
   * trip afterwards. Creating/editing a trip deliberately does NOT call this
   * any more (CDC Jalon B4.3 section 17) — it returns to the list instead.
   */
  async function openOverview(tripId: TripId): Promise<void> {
    setActiveTrip(tripId)
    mode = { kind: 'overview', tripId }
    await renderOverview(tripId)
    void startAutomaticEnrichment(tripId)
  }

  /** CDC section 3/25: in progress > nearest upcoming > last active > none (shows the list instead). Re-resolved from storage every call, so switching trips in "Mes voyages" is immediately reflected the next time Aperçu/Voyage is opened from the bottom nav. */
  async function resolveActiveTripId(): Promise<TripId | null> {
    const trips = await listTripSummaries(deps.database)
    return selectMostRelevantTrip(trips, deps.now().slice(0, 10) as IsoDate, getActiveTripId())
  }

  async function goToOverviewForActiveTrip(): Promise<void> {
    const tripId = await resolveActiveTripId()
    if (tripId === null) { goToList(); return }
    await openOverview(tripId)
  }

  async function goToDetailForActiveTrip(): Promise<void> {
    const tripId = await resolveActiveTripId()
    if (tripId === null) { goToList(); return }
    await openDetail(tripId)
  }

  async function openDetail(tripId: TripId): Promise<void> {
    mode = { kind: 'detail', tripId }
    await renderDetail(tripId)
  }

  async function openDay(tripId: TripId, dayId: TripDayId, origin: DayOrigin): Promise<void> {
    mode = { kind: 'day', tripId, dayId, origin }
    await renderDay(tripId, dayId)
  }

  /**
   * Persists one stage's pause plan (CDC Jalon B4 section 15): replaces
   * (or, for `entry === null`, drops — reverting to the trip-wide default)
   * that stage's entry in `TripSettings.stages` and re-saves the whole
   * bundle, exactly like every other mutation in this file — never a second
   * storage path alongside `saveTripBundle`. Silently no-ops if the trip
   * disappeared meanwhile (deleted from another tab, etc.). Returns the
   * freshly saved bundle so the caller can patch the screen from it directly
   * — avoids a second full-bundle read+validate just to re-render.
   */
  async function saveStagePauseSettings(tripId: TripId, stageId: RideStageId, entry: RideStageSettings | null): Promise<TripBundle | null> {
    const tripRepository = createTripRepository(deps.database)
    const bundle = await tripRepository.loadTripBundle(tripId)
    if (bundle === null) return null
    const stages = bundle.settings.stages.filter((candidate) => candidate.stageId !== stageId)
    if (entry !== null) stages.push(entry)
    const updated: TripBundle = { ...bundle, settings: { ...bundle.settings, stages } }
    await tripRepository.saveTripBundle(updated)
    return updated
  }

  /** Order must stay a contiguous 0..n-1 sequence (validated by `validateTripBundle`) — reassigned every time the pause list changes rather than trusted to already be correct. */
  function withContiguousOrder(pauses: readonly StagePauseSetting[]): readonly StagePauseSetting[] {
    return pauses.slice().sort((left, right) => left.order - right.order).map((pause, index) => ({ ...pause, order: index }))
  }

  /** Global "Mes voyages" nav click (CDC hardening section 14): always returns to the trip list, whatever screen was open — the reason none of Aperçu/Voyage/Étape carries its own "Retour à Mes voyages" button. */
  function goToList(): void {
    mode = { kind: 'list' }
    void renderList()
  }

  async function enrichEndpoints(tripId: TripId): Promise<void> {
    if (deps.geocodingProvider === undefined || automaticEnrichmentGuard.isInFlight(tripId) || geocodingInFlight.has(tripId)) return
    geocodingInFlight.add(tripId)
    geocodingErrors.delete(tripId)
    await renderDetail(tripId)
    try {
      await enrichStoredTripEndpoints({
        database: deps.database,
        tripId,
        provider: deps.geocodingProvider,
        idFactory: deps.idFactory,
        now: deps.now,
      })
    } catch (error) {
      geocodingErrors.set(tripId, error instanceof Error ? error.message : 'L’enrichissement des lieux a échoué.')
    } finally {
      geocodingInFlight.delete(tripId)
      if (mode.kind === 'detail' && mode.tripId === tripId) await renderDetail(tripId)
    }
  }

  function renderConfirmation(result: ImportWizardResult): void {
    const dateLabel = result.startDate === null ? 'Non daté' : result.endDate === null ? result.startDate : `${result.startDate} → ${result.endDate}`
    container.innerHTML = `
      <div class="trip-confirmation" data-trip-confirmation>
        <header class="view-heading"><p class="eyebrow">Voyage créé</p><h2>${escapeHtml(result.name)}</h2></header>
        <dl class="trip-confirmation__summary">
          <div><dt>Dates</dt><dd>${escapeHtml(dateLabel)}</dd></div>
          <div><dt>Étapes</dt><dd>${result.stageCount}</dd></div>
          <div><dt>Distance</dt><dd>${result.totalDistanceKm.toFixed(1)} km</dd></div>
          <div><dt>D+</dt><dd>+${Math.round(result.totalElevationGainM)} m</dd></div>
          <div><dt>Montées détectées</dt><dd>${result.climbCount}</dd></div>
        </dl>
        <button class="button button--primary button--full" type="button" data-action="back-to-list">Retour à Mes voyages</button>
      </div>`
  }

  async function refresh(): Promise<void> {
    if (mode.kind === 'list') await renderList()
    else if (mode.kind === 'overview') await renderOverview(mode.tripId)
    else if (mode.kind === 'detail') await renderDetail(mode.tripId)
    else if (mode.kind === 'day') await renderDay(mode.tripId, mode.dayId)
    else if (mode.kind === 'confirmation') renderConfirmation(mode.result)
    // Wizard/editor modes own their rendering through their dedicated components.
  }

  /**
   * CDC Jalon B4.3 section 17: creating/editing a trip always returns to
   * Mes voyages — never opens Aperçu automatically, never silently changes
   * the active trip. The trip simply appears in the list; the user's own
   * "Ouvrir" click is what makes it active (CDC section 4/5).
   */
  function openWizard(): void {
    mode = { kind: 'wizard' }
    let wizard: { readonly destroy: () => void }
    wizard = createImportWizard(
      container,
      deps,
      () => {
        wizard.destroy()
        activeSubComponent = null
        goToList()
      },
      () => {
        wizard.destroy()
        activeSubComponent = null
        goToList()
      },
    )
    activeSubComponent = wizard
  }

  function openEditor(tripId: TripId): void {
    mode = { kind: 'editor', tripId }
    let editor: { readonly destroy: () => void }
    editor = createTripEditor(
      container,
      deps,
      tripId,
      () => {
        editor.destroy()
        activeSubComponent = null
        goToList()
      },
      () => {
        editor.destroy()
        activeSubComponent = null
        goToList()
      },
    )
    activeSubComponent = editor
  }

  /** Persists a full-bundle mutation the same way every other action in this file does — load, mutate, save, return the fresh bundle (or `null` if the trip vanished meanwhile). */
  async function mutateTripBundle(tripId: TripId, mutate: (bundle: TripBundle) => TripBundle): Promise<TripBundle | null> {
    const tripRepository = createTripRepository(deps.database)
    const bundle = await tripRepository.loadTripBundle(tripId)
    if (bundle === null) return null
    const updated = mutate(bundle)
    await tripRepository.saveTripBundle(updated)
    return updated
  }

  function trimmedOrNull(value: string): string | null {
    const trimmed = value.trim()
    return trimmed === '' ? null : trimmed
  }

  /** GPX filename for one route's original source file — never a technical id, never a reconstruction (CDC Jalon B4.3 sections 15/33). */
  async function downloadRouteGpx(tripId: TripId, sourceFileId: string): Promise<void> {
    const bundle = await createTripRepository(deps.database).loadTripBundle(tripId)
    const sourceFile = bundle?.sourceFiles.find((candidate) => candidate.id === sourceFileId)
    if (bundle === undefined || bundle === null || sourceFile === undefined) return
    const payload = await createSourceFileRepository(deps.database).getSourceFilePayload(tripId, sourceFile.id)
    if (payload === null) return
    downloadBlob(payloadToBlob(payload.content, 'application/gpx+xml'), sourceFile.originalName)
  }

  /** One archive of every ride day's original GPX (CDC Jalon B4.3 section 15) — the stored originals, never a re-serialization of the analysed geometry; OFF/transfer days (no GPX) are naturally excluded since they have no route/source file to begin with. */
  async function downloadTripGpxArchive(tripId: TripId, tripName: string): Promise<void> {
    const bundle = await createTripRepository(deps.database).loadTripBundle(tripId)
    if (bundle === null) return
    const sourceFileRepository = createSourceFileRepository(deps.database)
    const entries: ZipEntryInput[] = []
    for (const stage of bundle.stages) {
      const route = bundle.routes.find((candidate) => candidate.id === stage.sourceRouteId)
      const sourceFile = route?.sourceFileId === null || route?.sourceFileId === undefined
        ? undefined
        : bundle.sourceFiles.find((candidate) => candidate.id === route.sourceFileId)
      if (sourceFile === undefined) continue
      const payload = await sourceFileRepository.getSourceFilePayload(tripId, sourceFile.id)
      if (payload === null) continue
      entries.push({ name: sourceFile.originalName, data: await payloadToUint8Array(payload.content) })
    }
    if (entries.length === 0) return
    const zip = buildZipArchive(entries, new Date(deps.now()))
    const safeName = tripName.replaceAll(/[\\/:*?"<>|]/g, '_').trim() || 'voyage'
    downloadBlob(zip, `${safeName}_GPX.zip`)
  }

  container.addEventListener('click', (event) => {
    const target = event.target
    if (!(target instanceof Element)) return

    // Pure client-side UI toggles (CDC Jalon B4.2/B4.3 sections 3/17): never
    // a data mutation, never a re-render — a full detail rebuild here would
    // reintroduce exactly the "reload feel" bug this pass fixes.
    const tab = target.closest<HTMLButtonElement>('[data-day-tab]')
    if (tab !== null && container.contains(tab)) {
      const requested = tab.dataset.dayTab
      for (const panel of container.querySelectorAll<HTMLElement>('[data-day-panel]')) panel.hidden = panel.dataset.dayPanel !== requested
      for (const candidate of container.querySelectorAll<HTMLButtonElement>('[data-day-tab]')) {
        candidate.setAttribute('aria-selected', String(candidate === tab))
        candidate.tabIndex = candidate === tab ? 0 : -1
      }
      return
    }
    const climbToggle = target.closest<HTMLButtonElement>('[data-action="toggle-climb-profile"]')
    if (climbToggle !== null) {
      const panel = container.querySelector<HTMLElement>(`#${CSS.escape(climbToggle.getAttribute('aria-controls') ?? '')}`)
      if (panel !== null) {
        const nextExpanded = panel.hidden
        panel.hidden = !nextExpanded
        climbToggle.setAttribute('aria-expanded', String(nextExpanded))
      }
      return
    }
    if (target.closest('[data-action="edit-day-infos"]') !== null) {
      const readView = container.querySelector<HTMLElement>('[data-day-infos-read]')
      const editView = container.querySelector<HTMLElement>('[data-day-infos-edit]')
      if (readView !== null) readView.hidden = true
      if (editView !== null) editView.hidden = false
      return
    }
    if (target.closest('[data-action="cancel-edit-day-infos"]') !== null) {
      const readView = container.querySelector<HTMLElement>('[data-day-infos-read]')
      const editView = container.querySelector<HTMLElement>('[data-day-infos-edit]')
      if (editView !== null) editView.hidden = true
      if (readView !== null) readView.hidden = false
      return
    }

    const button = target.closest<HTMLElement>('[data-action]')
    if (button === null) return
    const action = button.dataset.action
    const tripId = button.dataset.tripId
    const dayId = button.dataset.dayId

    if (action === 'create-trip') {
      openWizard()
    } else if (action === 'edit-trip' && tripId !== undefined) {
      openEditor(tripId as TripId)
    } else if (action === 'open-trip' && tripId !== undefined) {
      void openOverview(tripId as TripId)
      deps.onNavigateToView?.('today')
    } else if (action === 'open-day-detail' && dayId !== undefined && (mode.kind === 'detail' || mode.kind === 'overview')) {
      void openDay(mode.tripId, dayId as TripDayId, mode.kind)
    } else if (action === 'back-to-trip-detail' && mode.kind === 'day') {
      if (mode.origin === 'overview') void openOverview(mode.tripId)
      else void openDetail(mode.tripId)
    } else if (action === 'previous-day' && mode.kind === 'day') {
      void (async () => {
        const bundle = await createTripRepository(deps.database).loadTripBundle(mode.tripId)
        if (bundle === null) return
        const rideIds = rideDayIds(bundle)
        const previousId = rideIds[rideIds.indexOf(mode.dayId) - 1]
        if (previousId !== undefined) await openDay(mode.tripId, previousId, mode.origin)
      })()
    } else if (action === 'next-day' && mode.kind === 'day') {
      void (async () => {
        const bundle = await createTripRepository(deps.database).loadTripBundle(mode.tripId)
        if (bundle === null) return
        const rideIds = rideDayIds(bundle)
        const nextId = rideIds[rideIds.indexOf(mode.dayId) + 1]
        if (nextId !== undefined) await openDay(mode.tripId, nextId, mode.origin)
      })()
    } else if (action === 'back-to-list') {
      goToList()
    } else if (action === 'enrich-trip-endpoints' && mode.kind === 'detail') {
      void enrichEndpoints(mode.tripId)
    } else if (action === 'delete-trip' && tripId !== undefined) {
      if (!window.confirm('Supprimer définitivement ce voyage et toutes ses données ?')) return
      void (async () => {
        await deleteTripCompletely(deps.database, tripId as TripId, deps.now().slice(0, 10))
        mode = { kind: 'list' }
        await renderList()
      })()
    } else if (action === 'toggle-parcours-filter' && mode.kind === 'day' && button.dataset.filter === 'secondary-climbs') {
      const { tripId, dayId } = mode
      const current = getDayFilters(dayId)
      dayFilters.set(dayId, { showSecondaryClimbs: !(current.showSecondaryClimbs ?? false) })
      void (async () => {
        const bundle = await createTripRepository(deps.database).loadTripBundle(tripId)
        if (bundle !== null) patchDayDetail(bundle, dayId)
      })()
    } else if (action === 'pause-mode-automatic' && mode.kind === 'day') {
      const stageId = findCurrentStageId()
      const { tripId, dayId } = mode
      if (stageId === undefined) return
      void (async () => {
        const bundle = await saveStagePauseSettings(tripId, stageId, null)
        if (bundle !== null) patchDayDetail(bundle, dayId)
      })()
    } else if (action === 'save-manual-pauses' && mode.kind === 'day') {
      const { tripId, dayId } = mode
      const stageId = findCurrentStageId()
      if (stageId === undefined) return
      const rows = container.querySelectorAll<HTMLElement>('.pause-editor__row')
      const existingPauses = new Map<string, StagePauseSetting>()
      void (async () => {
        const tripRepository = createTripRepository(deps.database)
        const bundle = await tripRepository.loadTripBundle(tripId)
        const current = bundle?.settings.stages.find((entry) => entry.stageId === stageId)
        for (const pause of current?.pauses ?? []) if (pause.routePointId !== null) existingPauses.set(pause.routePointId, pause)
        const nextPauses: StagePauseSetting[] = []
        rows.forEach((row) => {
          const candidateId = row.dataset.candidateId
          const checkbox = row.querySelector<HTMLInputElement>('[data-field="pause-active"]')
          const durationInput = row.querySelector<HTMLInputElement>('[data-field="pause-duration"]')
          if (candidateId === undefined || checkbox === null || !checkbox.checked) return
          const minutes = durationInput !== null && Number.isFinite(durationInput.valueAsNumber) ? Math.max(0, Math.round(durationInput.valueAsNumber)) : 15
          const existing = existingPauses.get(candidateId)
          nextPauses.push({
            id: existing?.id ?? deps.idFactory(), active: true, routePointId: candidateId as RoutePointId,
            durationSeconds: minutes * 60, order: nextPauses.length, origin: existing?.origin ?? 'custom',
          })
        })
        const updated = await saveStagePauseSettings(tripId, stageId, { stageId, pausePlanMode: 'custom', pauses: withContiguousOrder(nextPauses) })
        if (updated !== null) {
          patchDayDetail(updated, dayId)
          // Re-collapse the panel after save (CDC Jalon B4.3 section 31) —
          // scroll/focus stay put since only the pauses subtree was patched.
          const details = container.querySelector<HTMLDetailsElement>('[data-pause-editor]')
          if (details !== null) details.open = false
        }
      })()
    } else if (action === 'save-day-infos' && mode.kind === 'day') {
      const { tripId, dayId } = mode
      const textarea = container.querySelector<HTMLTextAreaElement>('[data-field="day-notes"]')
      const nameField = container.querySelector<HTMLInputElement>('[data-field="lodging-name"]')
      const mapsField = container.querySelector<HTMLInputElement>('[data-field="lodging-maps-url"]')
      const websiteField = container.querySelector<HTMLInputElement>('[data-field="lodging-website"]')
      const notes = trimmedOrNull(textarea?.value ?? '')
      const name = trimmedOrNull(nameField?.value ?? '')
      const mapsUrl = trimmedOrNull(mapsField?.value ?? '')
      const website = trimmedOrNull(websiteField?.value ?? '')
      // CDC Jalon B4.3 section 36: clearing every lodging field and saving
      // removes the lodging — no separate "Supprimer" action needed.
      const clearLodging = name === null && mapsUrl === null && website === null
      void (async () => {
        const updated = await mutateTripBundle(tripId, (bundle) => {
          const day = bundle.days.find((candidate) => candidate.id === dayId)
          const existingId = day?.accommodationId ?? null
          if (clearLodging) {
            return {
              ...bundle,
              accommodations: bundle.accommodations.filter((entry) => entry.id !== existingId),
              days: bundle.days.map((candidate) => (candidate.id === dayId ? { ...candidate, notes, accommodationId: null } : candidate)),
            }
          }
          const accommodationId = (existingId ?? deps.idFactory()) as AccommodationId
          const record = {
            id: accommodationId, name: name ?? 'Hébergement', type: 'hotel' as const, address: null, latitude: null, longitude: null,
            mapsUrl, website, phone: null, bookingReference: null, notes: null, confirmed: true,
            provenance: { sourceType: 'user' as const, sourceId: null, fetchedAt: null, engineVersion: 'trips-manager-lodging@1', confidence: null, manuallyOverridden: true },
          }
          const accommodations = existingId === null ? [...bundle.accommodations, record] : bundle.accommodations.map((entry) => (entry.id === existingId ? record : entry))
          return {
            ...bundle, accommodations,
            days: bundle.days.map((candidate) => (candidate.id === dayId ? { ...candidate, notes, accommodationId } : candidate)),
          }
        })
        if (updated !== null) patchInfosPanel(updated, dayId)
      })()
    } else if (action === 'download-stage-gpx' && mode.kind === 'day') {
      const { tripId, dayId } = mode
      void (async () => {
        const bundle = await createTripRepository(deps.database).loadTripBundle(tripId)
        if (bundle === null) return
        const day = bundle.days.find((candidate) => candidate.id === dayId)
        const stage = day === undefined || day.stageId === null ? undefined : bundle.stages.find((candidate) => candidate.id === day.stageId)
        const route = stage === undefined ? undefined : bundle.routes.find((candidate) => candidate.id === stage.sourceRouteId)
        if (route?.sourceFileId === null || route?.sourceFileId === undefined) return
        await downloadRouteGpx(tripId, route.sourceFileId)
      })()
    } else if (action === 'download-trip-gpx' && (mode.kind === 'detail' || mode.kind === 'overview')) {
      const { tripId } = mode
      void (async () => {
        const bundle = await createTripRepository(deps.database).loadTripBundle(tripId)
        if (bundle !== null) await downloadTripGpxArchive(tripId, bundle.metadata.name)
      })()
    }

    /** Resolves the stage id backing the currently-open Étape screen — the pause editor's own wrapper carries it via `data-stage-id`. */
    function findCurrentStageId(): RideStageId | undefined {
      const value = container.querySelector<HTMLElement>('[data-day-detail-pauses]')?.dataset.stageId
      return value === undefined ? undefined : (value as RideStageId)
    }
  })

  /** Roving Enter/Space activation for `role="button"` elements that aren't real `<button>`s (trip cards, the Aperçu highlighted-day card) — only when focus is directly on the role=button element itself, never re-triggered for a nested real button (which already handles its own keys natively). */
  container.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    const target = event.target
    if (!(target instanceof HTMLElement) || target.getAttribute('role') !== 'button') return
    event.preventDefault()
    target.click()
  })

  container.addEventListener('change', (event) => {
    const target = event.target
    if (!(target instanceof HTMLInputElement)) return
    // Pure client-side reveal (CDC Jalon B4.3 section 31: "Durée uniquement
    // si Pause = oui") — never a save, matches every checked/unchecked row
    // locally until the single "Enregistrer" action reads them all.
    if (target.dataset.field === 'pause-active') {
      const row = target.closest<HTMLElement>('.pause-editor__row')
      const durationField = row?.querySelector<HTMLElement>('.pause-editor__row-duration')
      if (durationField !== null && durationField !== undefined) durationField.hidden = !target.checked
    }
  })

  void renderList()

  return { refresh, goToList, goToOverviewForActiveTrip, goToDetailForActiveTrip }
}
