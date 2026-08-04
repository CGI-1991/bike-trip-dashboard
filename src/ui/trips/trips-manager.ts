/**
 * "Mes voyages" — CDC phase 6C1 sections 5-7/24-27. Lists every stored
 * `TripBundle`, lets the user create one (the import wizard), open its
 * technical view, or delete it. Independent of the historical RGA runtime
 * — see `README.md`.
 */

import { createTripRepository } from '../../storage/indexeddb/trip-repository.ts'
import { enrichStoredTripEndpoints, tripNeedsEndpointGeocoding } from '../../geocoding/endpoint-enrichment.ts'
import type { GeocodingProvider } from '../../geocoding/types.ts'
import { enrichStoredTripClimbNames, tripNeedsClimbNameEnrichment } from '../../climb-names/enrichment.ts'
import type { ClimbNameProvider } from '../../climb-names/types.ts'
import type { RouteEnrichmentProgress, RouteEnrichmentProvider } from '../../route-enrichment/types.ts'
import { runStoredTripAutomaticEnrichment, tripNeedsAutomaticEnrichment } from '../../route-enrichment/automatic-enrichment.ts'
import type { TripId } from '../../trip-core/index.ts'
import { deleteTripCompletely, listTripSummaries, setActiveTrip } from '../../trips-manager/trip-manager-actions.ts'
import type { TripListEntry } from '../../trips-manager/trip-summary.ts'
import { createImportWizard } from './import-wizard.ts'
import type { ImportWizardResult } from './import-wizard.ts'
import { createTripEditor } from './trip-editor.ts'
import { renderTripDetail } from './trip-detail-view.ts'

export interface TripsManagerDeps {
  readonly database: IDBDatabase
  readonly now: () => string
  readonly idFactory: () => string
  readonly geocodingProvider?: GeocodingProvider
  readonly climbNameProvider?: ClimbNameProvider
  readonly routeEnrichmentProvider?: RouteEnrichmentProvider
  readonly onRouteEnrichmentDiagnostic?: (progress: RouteEnrichmentProgress) => void
}

type Mode =
  | { readonly kind: 'list' }
  | { readonly kind: 'wizard' }
  | { readonly kind: 'editor'; readonly tripId: TripId }
  | { readonly kind: 'detail'; readonly tripId: TripId }
  | { readonly kind: 'confirmation'; readonly result: ImportWizardResult }

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

export function initializeTripsManager(container: HTMLElement, deps: TripsManagerDeps): { readonly refresh: () => Promise<void> } {
  let mode: Mode = { kind: 'list' }
  const geocodingInFlight = new Set<TripId>()
  const geocodingErrors = new Map<TripId, string>()
  const climbNamingInFlight = new Set<TripId>()
  const climbNamingErrors = new Map<TripId, string>()
  const automaticEnrichmentInFlight = new Set<TripId>()
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
    const enrichmentBusy = geocodingInFlight.has(tripId) || climbNamingInFlight.has(tripId) || automaticEnrichmentInFlight.has(tripId)
    container.innerHTML = renderTripDetail(bundle, {
      canEnrichEndpoints: !enrichmentBusy && deps.geocodingProvider !== undefined && tripNeedsEndpointGeocoding(bundle),
      geocodingPending: geocodingInFlight.has(tripId),
      geocodingError: geocodingErrors.get(tripId) ?? null,
      canEnrichClimbNames: !enrichmentBusy && deps.climbNameProvider !== undefined && tripNeedsClimbNameEnrichment(bundle),
      climbNamingPending: climbNamingInFlight.has(tripId),
      climbNamingError: climbNamingErrors.get(tripId) ?? null,
      automaticEnrichmentPending: automaticEnrichmentInFlight.has(tripId),
      automaticEnrichmentProgress: automaticEnrichmentProgress.get(tripId) ?? null,
      automaticEnrichmentError: automaticEnrichmentErrors.get(tripId) ?? null,
    })
  }

  async function startAutomaticEnrichment(tripId: TripId): Promise<void> {
    if (automaticEnrichmentInFlight.has(tripId)) return
    const repository = createTripRepository(deps.database)
    const bundle = await repository.loadTripBundle(tripId)
    if (bundle === null) return
    if (!tripNeedsAutomaticEnrichment(bundle, deps)) return

    automaticEnrichmentInFlight.add(tripId)
    automaticEnrichmentErrors.delete(tripId)
    try {
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
            deps.onRouteEnrichmentDiagnostic?.(detail)
            const source = detail.source === 'cache' ? 'cache' : `${Math.round(detail.durationMs)} ms`
            const errors = detail.errorCount === 0 ? '' : ` · ${detail.errorCount} étape(s) en erreur`
            automaticEnrichmentProgress.set(tripId, `Points structurants — étape ${detail.stageIndex + 1}/${detail.stageCount} · ${source} · ${detail.retainedCandidateCount}/${detail.rawCandidateCount} retenus${errors}`)
          }
          if (mode.kind === 'detail' && mode.tripId === tripId) void renderDetail(tripId)
        },
      })
      if (report.partial) automaticEnrichmentErrors.set(tripId, 'Certaines données seront complétées lors d’une prochaine ouverture.')
    } catch (error) {
      automaticEnrichmentErrors.set(tripId, error instanceof Error ? error.message : 'Certaines données seront complétées ultérieurement.')
    } finally {
      automaticEnrichmentInFlight.delete(tripId)
      automaticEnrichmentProgress.delete(tripId)
      if (mode.kind === 'detail' && mode.tripId === tripId) await renderDetail(tripId)
    }
  }

  async function openDetail(tripId: TripId): Promise<void> {
    mode = { kind: 'detail', tripId }
    await renderDetail(tripId)
    void startAutomaticEnrichment(tripId)
  }

  async function enrichEndpoints(tripId: TripId): Promise<void> {
    if (deps.geocodingProvider === undefined || automaticEnrichmentInFlight.has(tripId) || geocodingInFlight.has(tripId) || climbNamingInFlight.has(tripId)) return
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

  async function enrichClimbNames(tripId: TripId): Promise<void> {
    if (deps.climbNameProvider === undefined || automaticEnrichmentInFlight.has(tripId) || geocodingInFlight.has(tripId) || climbNamingInFlight.has(tripId)) return
    climbNamingInFlight.add(tripId)
    climbNamingErrors.delete(tripId)
    await renderDetail(tripId)
    try {
      await enrichStoredTripClimbNames({
        database: deps.database,
        tripId,
        provider: deps.climbNameProvider,
        now: deps.now,
      })
    } catch (error) {
      climbNamingErrors.set(tripId, error instanceof Error ? error.message : 'L’enrichissement des montées a échoué.')
    } finally {
      climbNamingInFlight.delete(tripId)
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
    else if (mode.kind === 'detail') await renderDetail(mode.tripId)
    else if (mode.kind === 'confirmation') renderConfirmation(mode.result)
    // Wizard/editor modes own their rendering through their dedicated components.
  }

  function openWizard(): void {
    mode = { kind: 'wizard' }
    createImportWizard(
      container,
      deps,
      (result) => {
        setActiveTrip(result.tripId)
        void openDetail(result.tripId)
      },
      () => {
        mode = { kind: 'list' }
        void renderList()
      },
    )
  }

  function openEditor(tripId: TripId): void {
    mode = { kind: 'editor', tripId }
    createTripEditor(
      container,
      deps,
      tripId,
      (bundle) => {
        void openDetail(bundle.metadata.id)
      },
      () => {
        mode = { kind: 'list' }
        void renderList()
      },
    )
  }

  container.addEventListener('click', (event) => {
    const target = event.target
    if (!(target instanceof Element)) return
    const button = target.closest<HTMLElement>('[data-action]')
    if (button === null) return
    const action = button.dataset.action
    const tripId = button.dataset.tripId

    if (action === 'create-trip') {
      openWizard()
    } else if (action === 'edit-trip' && tripId !== undefined) {
      openEditor(tripId as TripId)
    } else if (action === 'open-trip' && tripId !== undefined) {
      void openDetail(tripId as TripId)
    } else if (action === 'back-to-list') {
      mode = { kind: 'list' }
      void renderList()
    } else if (action === 'enrich-trip-endpoints' && mode.kind === 'detail') {
      void enrichEndpoints(mode.tripId)
    } else if (action === 'enrich-trip-climb-names' && mode.kind === 'detail') {
      void enrichClimbNames(mode.tripId)
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

  return { refresh }
}
