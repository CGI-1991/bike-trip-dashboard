/**
 * "Voyage" screen (CDC Jalon B4.3 sections 9-11): a compact, RGA-style
 * chronological day-card list for one `TripBundle` — nothing else. Global
 * trip statistics live only in Aperçu (CDC section 9: "ne pas répéter dans
 * Voyage"); structural points/climbs live only in each stage's own Étape
 * view (`day-detail-view.ts`) — never duplicated here. The whole card is the
 * navigation target for a ride day (CDC section 4: no separate "Voir le
 * détail" button when the card itself can carry the action). The global
 * "Mes voyages" app-nav link always returns to the trip list, so this screen
 * carries no redundant "Retour" button of its own (CDC hardening section 14).
 */

import { computeStageWaypoints, resolveStagePauseSettings } from '../../analysis/waypoint-timeline.ts'
import { routeGeometry } from '../../route-enrichment/route-fingerprint.ts'
import { resolveOffLocation, resolveTransferLocations } from '../../analysis/day-location-fill.ts'
import { formatSimpleDate } from '../date-format.ts'
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

function formatKilometers(value: number): string {
  return `${value.toFixed(1).replace('.', ',')} km`
}

function computeDayEta(bundle: TripBundle, stage: TripBundle['stages'][number], dayId: TripDayId): string | null {
  const route = bundle.routes.find((candidate) => candidate.id === stage.sourceRouteId)
  if (route === undefined || routeGeometry(route) === null) return null
  const daySettings = bundle.settings.days.find((candidate) => candidate.dayId === dayId)
  const settings = { referenceSpeedKph: bundle.settings.global.referenceSpeedKph, departureTime: daySettings?.departureTime ?? '08:00' }
  const stageSettings = bundle.settings.stages.find((candidate) => candidate.stageId === stage.id)
  const pauseResolution = resolveStagePauseSettings(bundle.settings.global.pausePlanMode, stageSettings)
  const waypoints = computeStageWaypoints({
    stage, route, routePoints: bundle.routePoints, climbs: bundle.climbs, settings,
    manualPauses: pauseResolution.mode === 'custom' ? pauseResolution.manualPauses : undefined,
    mountainMode: bundle.settings.global.mountainMode ?? false,
  })
  return waypoints.length === 0 ? null : waypoints[waypoints.length - 1]?.clockTime ?? null
}

function renderRideDayCard(bundle: TripBundle, day: TripBundle['days'][number], stage: TripBundle['stages'][number]): string {
  const dateLabel = day.date === null ? null : formatSimpleDate(day.date)
  const locations = `${escapeHtml(stage.startLocationName ?? '—')} → ${escapeHtml(stage.endLocationName ?? '—')}`
  const headerParts = [`J${day.displayNumber}`, dateLabel].filter((part): part is string => part !== null)
  const daySettings = bundle.settings.days.find((candidate) => candidate.dayId === day.id)
  const departureTime = daySettings?.departureTime ?? null
  const eta = computeDayEta(bundle, stage, day.id)
  return `<li>
    <button class="trip-day-card trip-day-card--ride" type="button" data-action="open-day-detail" data-day-id="${escapeHtml(day.id)}">
      <div class="trip-day-card__header"><span class="tag tag--ride">Roulé</span><span class="trip-day-card__label">${headerParts.join(' · ')}</span></div>
      <p class="trip-day-card__route">${locations}</p>
      <dl class="trip-day-card__stats">
        <div><dt>Distance</dt><dd>${stage.distanceKm === null ? '—' : formatKilometers(stage.distanceKm)}</dd></div>
        <div><dt>D+</dt><dd>${stage.elevationGainM === null ? '—' : `+${Math.round(stage.elevationGainM)} m`}</dd></div>
        <div><dt>Départ</dt><dd>${departureTime ?? '—'}</dd></div>
        <div><dt>Arrivée estimée</dt><dd>${eta ?? '—'}</dd></div>
      </dl>
      <span class="trip-day-card__weather-mount" data-trip-day-weather-mount data-day-id="${escapeHtml(day.id)}"></span>
    </button>
  </li>`
}

// CDC Jalon B4.4 section 23/35: OFF/transfer cards are real navigation
// targets now that `day-detail-view.ts` has a shell to open them into — a
// `<button data-action="open-day-detail">`, exactly like a ride day card,
// not the plain non-interactive `<div>` these used to be.
function renderOffDayCard(bundle: TripBundle, day: TripBundle['days'][number]): string {
  const dateLabel = day.date === null ? null : formatSimpleDate(day.date)
  const headerParts = [`J${day.displayNumber}`, dateLabel].filter((part): part is string => part !== null)
  const location = resolveOffLocation(bundle, day)
  return `<li>
    <button class="trip-day-card trip-day-card--off" type="button" data-action="open-day-detail" data-day-id="${escapeHtml(day.id)}">
      <div class="trip-day-card__header"><span class="tag tag--off">OFF</span><span class="trip-day-card__label">${headerParts.join(' · ')}</span></div>
      ${location.name === null ? '' : `<p class="trip-day-card__route">${escapeHtml(location.name)}</p>`}
      <span class="trip-day-card__weather-mount" data-trip-day-weather-mount data-day-id="${escapeHtml(day.id)}"></span>
    </button>
  </li>`
}

function renderTransferDayCard(bundle: TripBundle, day: TripBundle['days'][number]): string {
  const dateLabel = day.date === null ? null : formatSimpleDate(day.date)
  const headerParts = [`J${day.displayNumber}`, dateLabel].filter((part): part is string => part !== null)
  const { origin, destination } = resolveTransferLocations(bundle, day)
  const route = origin === null && destination === null ? null : `${escapeHtml(origin ?? '—')} → ${escapeHtml(destination ?? '—')}`
  return `<li>
    <button class="trip-day-card trip-day-card--transfer" type="button" data-action="open-day-detail" data-day-id="${escapeHtml(day.id)}">
      <div class="trip-day-card__header"><span class="tag tag--transfer">Transfert</span><span class="trip-day-card__label">${headerParts.join(' · ')}</span></div>
      ${route === null ? '' : `<p class="trip-day-card__route">${route}</p>`}
    </button>
  </li>`
}

function renderDayCard(bundle: TripBundle, day: TripBundle['days'][number]): string {
  const stage = day.stageId === null ? null : bundle.stages.find((candidate) => candidate.id === day.stageId) ?? null
  if (stage !== null) return renderRideDayCard(bundle, day, stage)
  if (day.type === 'off') return renderOffDayCard(bundle, day)
  return renderTransferDayCard(bundle, day)
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
  const hasOsmEndpoints = bundle.routePoints.some((point) =>
    (point.type === 'start' || point.type === 'end') && point.provenance.sourceType === 'osm',
  )
  const hasOsmClimbNames = bundle.climbs.some((climb) => climb.provenance.sourceType === 'osm')
  const hasOsmRouteData = bundle.routePoints.some((point) => point.provenance.sourceType === 'osm')
  const hasOsmPracticalPlaces = bundle.practicalPlaces.some((place) => place.provenance.sourceType === 'osm')
  const osmState = bundle.enrichmentMetadata.providers.find((state) => state.provider === 'osm')
  const practicalPlacesState = bundle.enrichmentMetadata.providers.find((state) => state.provider === 'osm-practical-places')
  const routeEnrichmentState = bundle.enrichmentMetadata.providers.find((state) => state.provider === 'postpass-route-enrichment')
  const hasRideStages = bundle.stages.length > 0
  const automaticStatus = options.automaticEnrichmentPending
    ? `<div class="trip-detail__enrichment" role="status"><strong>Enrichissement en cours…</strong><span>${escapeHtml(options.automaticEnrichmentProgress ?? 'Préparation')}</span></div>`
    : options.automaticEnrichmentError !== null && options.automaticEnrichmentError !== undefined
      ? `<div class="trip-detail__enrichment" role="status"><strong>Enrichissement partiel</strong><span>${escapeHtml(options.automaticEnrichmentError)}</span></div>`
      : routeEnrichmentState?.status === 'success' && (osmState === undefined || osmState.status === 'success')
        ? ''
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

  return `
    <div class="trip-detail" data-trip-detail>
      <header class="view-heading"><p class="eyebrow">Voyage</p><h2>${escapeHtml(bundle.metadata.name)}</h2></header>
      <ol class="trip-day-list">${bundle.days.map((day) => renderDayCard(bundle, day)).join('')}</ol>
      ${hasRideStages ? '<button class="button button--quiet button--full" type="button" data-action="download-trip-gpx">Télécharger les GPX</button>' : ''}
      ${automaticStatus}
      ${geocodingStatus}
      ${geocodingAction}
      ${attribution}
      <details class="technical-details" data-trip-detail-practical><summary>Lieux pratiques</summary>${renderPracticalPlaces(bundle, practicalPlacesState?.status ?? null)}</details>
    </div>`
}
