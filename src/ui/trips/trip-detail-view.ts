/**
 * "Voyage" screen (CDC Jalon B2 section 9): a compact, RGA-style day-card
 * list for one `TripBundle` — Jx / date / départ→arrivée / distance / D+ /
 * departure time / ETA / OFF-Transfert badges. Structural points (Localités/
 * Villages/Relief) and the climbs list live only inside each stage's own
 * Étape view (`day-detail-view.ts`) — never duplicated here (CDC hardening
 * sections 6/20). The global "Mes voyages" app-nav link always returns to
 * the trip list, so this screen carries no redundant "Retour" button of its
 * own (CDC hardening section 14).
 */

import { computeStageWaypoints } from '../../analysis/waypoint-timeline.ts'
import { routeGeometry } from '../../route-enrichment/route-fingerprint.ts'
import type { EnrichmentProviderStatus, PracticalPlaceCategory, TripBundle, TripDayId } from '../../trip-core/index.ts'

export interface TripDetailRenderOptions {
  readonly canEnrichEndpoints?: boolean
  readonly geocodingPending?: boolean
  readonly geocodingError?: string | null
  readonly automaticEnrichmentPending?: boolean
  readonly automaticEnrichmentProgress?: string | null
  readonly automaticEnrichmentError?: string | null
}

const PRACTICAL_CATEGORY_LABELS: Readonly<Record<PracticalPlaceCategory, string>> = {
  shelter: 'Abri',
  bakery: 'Boulangerie',
  'cafe-or-ice-cream': 'Café',
  water: 'Eau potable',
  'fast-food': 'Restauration',
  'bike-service': 'Service vélo',
  supermarket: 'Alimentation',
  sports: 'Sport',
  toilet: 'Toilettes',
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

/** "2027-05-10" → "10.05.27" — the compact day-header date format (CDC section 11). */
function formatShortDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (match === null) return iso
  const [, year, month, day] = match
  return `${day}.${month}.${year?.slice(2)}`
}

function formatKilometers(value: number): string {
  return `${value.toFixed(1).replace('.', ',')} km`
}

function computeDayEta(bundle: TripBundle, stage: TripBundle['stages'][number], dayId: TripDayId): string | null {
  const route = bundle.routes.find((candidate) => candidate.id === stage.sourceRouteId)
  if (route === undefined || routeGeometry(route) === null) return null
  const daySettings = bundle.settings.days.find((candidate) => candidate.dayId === dayId)
  const settings = { referenceSpeedKph: bundle.settings.global.referenceSpeedKph, departureTime: daySettings?.departureTime ?? '08:00' }
  const waypoints = computeStageWaypoints({ stage, route, routePoints: bundle.routePoints, climbs: bundle.climbs, settings })
  return waypoints.length === 0 ? null : waypoints[waypoints.length - 1]?.clockTime ?? null
}

function renderRideDayRow(bundle: TripBundle, day: TripBundle['days'][number], stage: TripBundle['stages'][number]): string {
  const dateLabel = day.date === null ? null : formatShortDate(day.date)
  const locations = `${escapeHtml(stage.startLocationName ?? '—')} → ${escapeHtml(stage.endLocationName ?? '—')}`
  // Compact day title (CDC section 8): date before locations. The GPX/
  // roadbook stage name (`stage.name`) is deliberately never shown here.
  const headerParts = [`J${day.displayNumber}`, dateLabel, locations].filter((part): part is string => part !== null)
  const daySettings = bundle.settings.days.find((candidate) => candidate.dayId === day.id)
  const departureTime = daySettings?.departureTime ?? null
  const eta = computeDayEta(bundle, stage, day.id)
  return `<li class="trip-detail__day trip-detail__day--ride">
    <span class="tag tag--ride">Roulé</span>
    <header class="trip-detail__day-header"><strong>${headerParts.join(' — ')}</strong></header>
    <dl class="trip-detail__day-stats">
      <div><dt>Distance</dt><dd>${stage.distanceKm === null ? '—' : formatKilometers(stage.distanceKm)}</dd></div>
      <div><dt>D+</dt><dd>${stage.elevationGainM === null ? '—' : `+${Math.round(stage.elevationGainM)} m`}</dd></div>
      <div><dt>Départ</dt><dd>${departureTime ?? '—'}</dd></div>
      <div><dt>Arrivée estimée</dt><dd>${eta ?? '—'}</dd></div>
    </dl>
    <button class="button button--quiet" type="button" data-action="open-day-detail" data-day-id="${escapeHtml(day.id)}">Voir le détail</button>
  </li>`
}

function renderOffOrTransferDayRow(day: TripBundle['days'][number]): string {
  const dateLabel = day.date === null ? null : formatShortDate(day.date)
  const typeLabel = day.type === 'off' ? 'OFF' : 'Transfert'
  const headerParts = [`J${day.displayNumber}`, typeLabel, dateLabel].filter((part): part is string => part !== null)
  const known = day.startLocationName !== null && day.startLocationName === day.endLocationName
    ? escapeHtml(day.startLocationName)
    : `${escapeHtml(day.startLocationName ?? '—')} → ${escapeHtml(day.endLocationName ?? '—')}`
  return `<li class="trip-detail__day trip-detail__day--${day.type}">
    <span class="tag tag--off">${typeLabel}</span>
    <header class="trip-detail__day-header"><strong>${headerParts.join(' — ')}</strong><span class="trip-detail__day-subtitle">${known}</span></header>
  </li>`
}

function renderDayRow(bundle: TripBundle, day: TripBundle['days'][number]): string {
  const stage = day.stageId === null ? null : bundle.stages.find((candidate) => candidate.id === day.stageId) ?? null
  return stage === null ? renderOffOrTransferDayRow(day) : renderRideDayRow(bundle, day, stage)
}

function renderPracticalPlaces(bundle: TripBundle, searchStatus: EnrichmentProviderStatus | null): string {
  const groups = bundle.stages.map((stage) => {
    const day = bundle.days.find((candidate) => candidate.id === stage.dayId)
    const places = bundle.practicalPlaces
      .filter((place) => place.stageId === stage.id || (place.stageId === undefined && place.dayIds.includes(stage.dayId)))
      .filter((place) => !place.hidden)
      .slice()
      .sort((left, right) => (left.trackDistanceKm ?? Number.POSITIVE_INFINITY) - (right.trackDistanceKm ?? Number.POSITIVE_INFINITY))
    if (places.length === 0) return ''
    const label = day === undefined ? escapeHtml(stage.name ?? 'Étape') : `J${day.displayNumber}`
    const rows = places.map((place) => {
      const distance = place.trackDistanceKm === null ? 'km inconnu' : `≈ ${place.trackDistanceKm.toFixed(1)} km`
      const name = place.name === null ? 'Sans nom' : escapeHtml(place.name)
      return `<li><span class="trip-detail__place-category">${PRACTICAL_CATEGORY_LABELS[place.category]}</span><strong>${name}</strong><span>${distance}</span></li>`
    }).join('')
    return `<section class="trip-detail__place-stage"><h4>${label}</h4><ul>${rows}</ul></section>`
  }).join('')
  if (groups !== '') return `<div class="trip-detail__places">${groups}</div>`
  if (searchStatus === 'success') return '<p>Recherche effectuée : aucun lieu pratique trouvé.</p>'
  if (searchStatus === 'partial') return '<p>Recherche partielle : aucun lieu pratique disponible.</p>'
  if (searchStatus === 'error') return '<p>Aucun lieu disponible : la dernière recherche a échoué.</p>'
  return '<p>Recherche de lieux pratiques non encore effectuée.</p>'
}

export function renderTripDetail(bundle: TripBundle, options: TripDetailRenderOptions = {}): string {
  const totalDistanceKm = bundle.stages.reduce((total, stage) => total + (stage.distanceKm ?? 0), 0)
  const totalElevationGainM = bundle.stages.reduce((total, stage) => total + (stage.elevationGainM ?? 0), 0)

  const hasOsmEndpoints = bundle.routePoints.some((point) =>
    (point.type === 'start' || point.type === 'end') && point.provenance.sourceType === 'osm',
  )
  const hasOsmClimbNames = bundle.climbs.some((climb) => climb.provenance.sourceType === 'osm')
  const hasOsmRouteData = bundle.routePoints.some((point) => point.provenance.sourceType === 'osm')
  const hasOsmPracticalPlaces = bundle.practicalPlaces.some((place) => place.provenance.sourceType === 'osm')
  const osmState = bundle.enrichmentMetadata.providers.find((state) => state.provider === 'osm')
  const practicalPlacesState = bundle.enrichmentMetadata.providers.find((state) => state.provider === 'osm-practical-places')
  const routeEnrichmentState = bundle.enrichmentMetadata.providers.find((state) => state.provider === 'postpass-route-enrichment')
  const automaticStatus = options.automaticEnrichmentPending
    ? `<div class="trip-detail__enrichment" role="status"><strong>Enrichissement en cours…</strong><span>${escapeHtml(options.automaticEnrichmentProgress ?? 'Préparation')}</span></div>`
    : options.automaticEnrichmentError !== null && options.automaticEnrichmentError !== undefined
      ? `<div class="trip-detail__enrichment" role="status"><strong>Enrichissement partiel</strong><span>${escapeHtml(options.automaticEnrichmentError)}</span></div>`
      : routeEnrichmentState?.status === 'success' && (osmState === undefined || osmState.status === 'success')
        ? '<p class="trip-detail__enrichment"><strong>Voyage enrichi</strong></p>'
        : routeEnrichmentState?.status === 'partial' || routeEnrichmentState?.status === 'error' || osmState?.status === 'partial' || osmState?.status === 'error'
          ? '<p class="trip-detail__enrichment"><strong>Enrichissement partiel</strong> — certaines données seront complétées ultérieurement.</p>'
          : ''
  const geocodingStatus = options.geocodingPending
    ? '<p role="status">Identification des lieux en cours…</p>'
    : options.geocodingError !== null && options.geocodingError !== undefined
      ? `<p role="alert">${escapeHtml(options.geocodingError)}</p>`
      : osmState?.status === 'error'
        ? `<p role="status">${escapeHtml(osmState.message ?? 'Les lieux n’ont pas pu être identifiés.')}</p>`
        : ''
  const geocodingAction = options.canEnrichEndpoints && !options.geocodingPending
    ? '<button class="button button--quiet" type="button" data-action="enrich-trip-endpoints">Identifier les lieux de départ et d’arrivée</button>'
    : ''
  const attribution = hasOsmEndpoints || hasOsmRouteData || hasOsmClimbNames || hasOsmPracticalPlaces ? '<p class="trip-detail__attribution">Données géographiques : © OpenStreetMap contributors.</p>' : ''
  const routeDiagnostic = routeEnrichmentState?.message === null || routeEnrichmentState?.message === undefined
    ? ''
    : `<p class="trip-detail__enrichment-diagnostic">Provider = Postpass · ${escapeHtml(routeEnrichmentState.message)}</p>`

  return `
    <div class="trip-detail" data-trip-detail>
      <header class="view-heading"><p class="eyebrow">Voyage</p><h2>${escapeHtml(bundle.metadata.name)}</h2></header>
      <dl class="trip-detail__summary">
        <div><dt>Dates</dt><dd>${bundle.metadata.startDate ?? 'Non daté'}${bundle.metadata.endDate ? ` → ${bundle.metadata.endDate}` : ''}</dd></div>
        <div><dt>Journées</dt><dd>${bundle.days.length}</dd></div>
        <div><dt>Étapes</dt><dd>${bundle.stages.length}</dd></div>
        <div><dt>Distance totale</dt><dd>${totalDistanceKm.toFixed(1)} km</dd></div>
        <div><dt>D+ total</dt><dd>+${Math.round(totalElevationGainM)} m</dd></div>
      </dl>
      <p class="tag tag--data">Disponible localement</p>
      ${automaticStatus}
      ${routeDiagnostic}
      ${geocodingStatus}
      ${geocodingAction}
      <ol class="trip-detail__day-list">${bundle.days.map((day) => renderDayRow(bundle, day)).join('')}</ol>
      ${attribution}
      <h3>Lieux pratiques</h3>
      ${renderPracticalPlaces(bundle, practicalPlacesState?.status ?? null)}
    </div>`
}
