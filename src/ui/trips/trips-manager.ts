/**
 * "Mes voyages" — CDC phase 6C1 sections 5-7/24-27. Lists every stored
 * `TripBundle`, lets the user create one (the import wizard), open its
 * technical view, or delete it. Independent of the historical RGA runtime
 * — see `README.md`.
 */

import { createTripRepository } from '../../storage/indexeddb/trip-repository.ts'
import type { TripId } from '../../trip-core/index.ts'
import { deleteTripCompletely, listTripSummaries, setActiveTrip } from '../../trips-manager/trip-manager-actions.ts'
import type { TripListEntry } from '../../trips-manager/trip-summary.ts'
import { createImportWizard } from './import-wizard.ts'
import type { ImportWizardResult } from './import-wizard.ts'
import { renderTripDetail } from './trip-detail-view.ts'

export interface TripsManagerDeps {
  readonly database: IDBDatabase
  readonly now: () => string
  readonly idFactory: () => string
}

type Mode = { readonly kind: 'list' } | { readonly kind: 'wizard' } | { readonly kind: 'detail'; readonly tripId: TripId } | { readonly kind: 'confirmation'; readonly result: ImportWizardResult }

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
        <button class="button button--quiet" type="button" data-action="edit-trip" disabled title="Disponible dans une prochaine phase">Modifier l’itinéraire</button>
        <button class="button button--quiet" type="button" data-action="delete-trip" data-trip-id="${escapeHtml(trip.id)}">Supprimer</button>
      </div>
    </li>`
}

export function initializeTripsManager(container: HTMLElement, deps: TripsManagerDeps): { readonly refresh: () => Promise<void> } {
  let mode: Mode = { kind: 'list' }

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
    container.innerHTML = renderTripDetail(bundle)
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
    // 'wizard' mode owns its own rendering via createImportWizard.
  }

  function openWizard(): void {
    mode = { kind: 'wizard' }
    createImportWizard(
      container,
      deps,
      (result) => {
        setActiveTrip(result.tripId)
        mode = { kind: 'confirmation', result }
        renderConfirmation(result)
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
    } else if (action === 'open-trip' && tripId !== undefined) {
      mode = { kind: 'detail', tripId: tripId as TripId }
      void renderDetail(tripId as TripId)
    } else if (action === 'back-to-list') {
      mode = { kind: 'list' }
      void renderList()
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
