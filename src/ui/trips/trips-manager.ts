/**
 * "Mes voyages" — CDC phase 6C1 sections 5-7/24-27. Lists every stored
 * `TripBundle`, lets the user create one (the import wizard), open its
 * technical view, or delete it. Independent of the historical RGA runtime
 * — see `README.md`.
 */

import { createTripRepository } from '../../storage/indexeddb/trip-repository.ts'
import { enrichStoredTripEndpoints, tripNeedsEndpointGeocoding } from '../../geocoding/endpoint-enrichment.ts'
import type { GeocodingProvider } from '../../geocoding/types.ts'
import type { RouteEnrichmentProgress, RouteEnrichmentProvider } from '../../route-enrichment/types.ts'
import { runStoredTripAutomaticEnrichment, tripNeedsAutomaticEnrichment } from '../../route-enrichment/automatic-enrichment.ts'
import { createSingleFlightGuard } from '../../trips-manager/single-flight.ts'
import type { TripBundle, TripDayId, TripId } from '../../trip-core/index.ts'
import { deleteTripCompletely, listTripSummaries, setActiveTrip } from '../../trips-manager/trip-manager-actions.ts'
import type { TripListEntry } from '../../trips-manager/trip-summary.ts'
import { closeExpandedRouteMap, renderGenericRouteMap } from '../route-map.ts'
import { buildGenericOverviewRouteMapModel, buildGenericRouteMapModel } from '../route-map-model.ts'
import { renderGenericElevationProfile } from '../elevation-profile.ts'
import { buildDayDetail } from './day-detail-view.ts'
import { createImportWizard } from './import-wizard.ts'
import type { ImportWizardResult } from './import-wizard.ts'
import { createTripEditor } from './trip-editor.ts'
import { renderTripDetail } from './trip-detail-view.ts'
import { buildTripOverview } from './trip-overview-view.ts'

export interface TripsManagerDeps {
  readonly database: IDBDatabase
  readonly now: () => string
  readonly idFactory: () => string
  readonly geocodingProvider?: GeocodingProvider
  readonly routeEnrichmentProvider?: RouteEnrichmentProvider
  readonly onRouteEnrichmentDiagnostic?: (progress: RouteEnrichmentProgress) => void
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

function renderTripCard(trip: TripListEntry): string {
  const dateLabel = trip.startDate === null ? 'Non daté' : trip.endDate === null ? trip.startDate : `${trip.startDate} → ${trip.endDate}`
  return `
    <li class="trip-card" data-trip-card data-trip-id="${escapeHtml(trip.id)}">
      <div class="trip-card__header"><h3>${escapeHtml(trip.name)}</h3><span class="tag tag--data">${escapeHtml(trip.status)}</span></div>
      <dl class="trip-card__stats">
        <div><dt>Dates</dt><dd>${escapeHtml(dateLabel)}</dd></div>
        <div><dt>Journées</dt><dd>${trip.dayCount}</dd></div>
        <div><dt>Étapes</dt><dd>${trip.stageCount}</dd></div>
        <div><dt>Distance</dt><dd>${trip.totalDistanceKm.toFixed(1)} km</dd></div>
      </dl>
      <p class="tag tag--data">Disponible localement</p>
      <div class="trip-card__actions">
        <button class="button button--primary" type="button" data-action="open-trip" data-trip-id="${escapeHtml(trip.id)}">Ouvrir</button>
        <button class="button button--quiet" type="button" data-action="edit-trip" data-trip-id="${escapeHtml(trip.id)}">Modifier</button>
        <button class="button button--quiet" type="button" data-action="delete-trip" data-trip-id="${escapeHtml(trip.id)}">Supprimer</button>
      </div>
    </li>`
}

export function initializeTripsManager(container: HTMLElement, deps: TripsManagerDeps): { readonly refresh: () => Promise<void>; readonly goToList: () => void } {
  let mode: Mode = { kind: 'list' }
  // The wizard/editor own their own live DOM listeners (AbortController-based)
  // separate from this container's single delegated click listener — tracked
  // here purely so `goToList` (the global "Mes voyages" nav) can tear them
  // down cleanly if the user jumps away mid-wizard/mid-edit.
  let activeSubComponent: { readonly destroy: () => void } | null = null
  const geocodingInFlight = new Set<TripId>()
  const geocodingErrors = new Map<TripId, string>()
  const automaticEnrichmentGuard = createSingleFlightGuard<TripId>()
  const automaticEnrichmentProgress = new Map<TripId, string>()
  const automaticEnrichmentErrors = new Map<TripId, string>()

  async function renderList(): Promise<void> {
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
    container.innerHTML = '<p role="status">Chargement de la journée…</p>'
    const tripRepository = createTripRepository(deps.database)
    const bundle = await tripRepository.loadTripBundle(tripId)
    if (bundle === null) {
      mode = { kind: 'list' }
      await renderList()
      return
    }
    const detail = buildDayDetail(bundle, dayId)
    if (detail === null) {
      mode = { kind: 'detail', tripId }
      await renderDetail(tripId)
      return
    }
    container.innerHTML = detail.html
    const mapContainer = container.querySelector<HTMLElement>('[data-day-detail-map]')
    const mapDialog = container.querySelector<HTMLDialogElement>('[data-day-detail-map-dialog]')
    if (mapContainer !== null && mapDialog !== null) {
      const visibleWaypoints = detail.waypoints.filter((waypoint) => waypoint.visibleByDefault)
      const model = detail.geometry === null
        ? null
        : buildGenericRouteMapModel(visibleWaypoints, detail.geometry.map((point) => [point.latitude, point.longitude] as const))
      renderGenericRouteMap(mapContainer, mapDialog, model)
      mapDialog.querySelector<HTMLButtonElement>('[data-close-map]')?.addEventListener('click', () => closeExpandedRouteMap(mapDialog))
    }
    const profileContainer = container.querySelector<HTMLElement>('[data-day-detail-profile]')
    if (profileContainer !== null) {
      renderGenericElevationProfile(profileContainer, detail.geometry, detail.waypoints.filter((waypoint) => waypoint.visibleByDefault), detail.stageLabel)
    }
    // Sticky nav (CDC section 13): ‹/› only ever step between ride days —
    // an OFF/transfer day has no Étape screen to land on — disabled at
    // either boundary rather than wrapping or leading to a dead click.
    const rideIds = rideDayIds(bundle)
    const currentIndex = rideIds.indexOf(dayId)
    const previousButton = container.querySelector<HTMLButtonElement>('[data-action="previous-day"]')
    const nextButton = container.querySelector<HTMLButtonElement>('[data-action="next-day"]')
    if (previousButton !== null) previousButton.disabled = currentIndex <= 0
    if (nextButton !== null) nextButton.disabled = currentIndex < 0 || currentIndex >= rideIds.length - 1
  }

  async function renderOverview(tripId: TripId): Promise<void> {
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
      renderGenericRouteMap(mapContainer, mapDialog, model)
      mapDialog.querySelector<HTMLButtonElement>('[data-close-map]')?.addEventListener('click', () => closeExpandedRouteMap(mapDialog))
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

  /** The trip's landing screen (CDC: Mes voyages → Aperçu → Voyage → Étape) — kicks off automatic enrichment exactly once, same as opening used to from Voyage directly. */
  async function openOverview(tripId: TripId): Promise<void> {
    mode = { kind: 'overview', tripId }
    await renderOverview(tripId)
    void startAutomaticEnrichment(tripId)
  }

  async function openDetail(tripId: TripId): Promise<void> {
    mode = { kind: 'detail', tripId }
    await renderDetail(tripId)
  }

  async function openDay(tripId: TripId, dayId: TripDayId, origin: DayOrigin): Promise<void> {
    mode = { kind: 'day', tripId, dayId, origin }
    await renderDay(tripId, dayId)
  }

  /** Global "Mes voyages" nav click (CDC hardening section 14): always returns to the trip list, whatever screen was open — the reason none of Aperçu/Voyage/Étape carries its own "Retour à Mes voyages" button. */
  function goToList(): void {
    activeSubComponent?.destroy()
    activeSubComponent = null
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
        <button class="button button--primary button--full" type="button" data-action="open-trip" data-trip-id="${escapeHtml(result.tripId)}">Ouvrir</button>
        <button class="button button--quiet button--full" type="button" data-action="back-to-list">Retour à Mes voyages</button>
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

  function openWizard(): void {
    mode = { kind: 'wizard' }
    let wizard: { readonly destroy: () => void }
    wizard = createImportWizard(
      container,
      deps,
      (result) => {
        wizard.destroy()
        activeSubComponent = null
        setActiveTrip(result.tripId)
        void openOverview(result.tripId)
      },
      () => {
        wizard.destroy()
        activeSubComponent = null
        mode = { kind: 'list' }
        void renderList()
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
      (bundle) => {
        editor.destroy()
        activeSubComponent = null
        void openOverview(bundle.metadata.id)
      },
      () => {
        editor.destroy()
        activeSubComponent = null
        mode = { kind: 'list' }
        void renderList()
      },
    )
    activeSubComponent = editor
  }

  container.addEventListener('click', (event) => {
    const target = event.target
    if (!(target instanceof Element)) return
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
    } else if (action === 'open-trip-detail' && mode.kind === 'overview') {
      void openDetail(mode.tripId)
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
    }
  })

  void renderList()

  return { refresh, goToList }
}
