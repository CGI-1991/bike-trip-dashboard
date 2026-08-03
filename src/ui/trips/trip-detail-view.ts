/**
 * Minimal technical view of a `TripBundle` (CDC phase 6C1 section 23):
 * days, stats, timings, climbs. Not the final Voyage/Aperçu screens —
 * those stay out of scope for this phase.
 */

import type { EnrichmentProviderStatus, PracticalPlaceCategory, TripBundle } from '../../trip-core/index.ts'

export interface TripDetailRenderOptions {
  readonly canEnrichEndpoints?: boolean
  readonly geocodingPending?: boolean
  readonly geocodingError?: string | null
  readonly canEnrichClimbNames?: boolean
  readonly climbNamingPending?: boolean
  readonly climbNamingError?: string | null
  readonly canSearchPracticalPlaces?: boolean
  readonly practicalPlacesPending?: boolean
  readonly practicalPlacesError?: string | null
  readonly practicalPlacesProgress?: string | null
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

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.round((seconds % 3600) / 60)
  return `${hours} h ${String(minutes).padStart(2, '0')}`
}

function renderDayRow(bundle: TripBundle, day: TripBundle['days'][number]): string {
  const stage = day.stageId === null ? null : bundle.stages.find((candidate) => candidate.id === day.stageId) ?? null
  const typeLabel = day.type === 'ride' ? 'Roulé' : day.type === 'off' ? 'OFF' : 'Transfert'
  const dateLabel = day.date ?? '—'

  if (stage === null) {
    return `<li class="trip-detail__day"><span class="tag tag--off">${typeLabel}</span><strong>J${day.displayNumber}</strong><span>${dateLabel}</span><span>${escapeHtml(day.startLocationName ?? '—')} → ${escapeHtml(day.endLocationName ?? '—')}</span></li>`
  }

  const climbCount = stage.climbIds.length
  const stageName = stage.name === null ? '' : `<span>${escapeHtml(stage.name)}</span>`
  const locations = `${escapeHtml(stage.startLocationName ?? '—')} → ${escapeHtml(stage.endLocationName ?? '—')}`
  const localities = stage.routePointIds
    .map((id) => bundle.routePoints.find((point) => point.id === id))
    .filter((point) => point?.osmFeatureType === 'city' || point?.osmFeatureType === 'town' || point?.osmFeatureType === 'village')
    .sort((left, right) => (left?.trackDistanceKm ?? Number.POSITIVE_INFINITY) - (right?.trackDistanceKm ?? Number.POSITIVE_INFINITY))
  const localityText = localities.length === 0 ? '' : `<p class="trip-detail__localities"><strong>Passage :</strong> ${localities.map((point) => escapeHtml(point?.name ?? '')).join(' · ')}</p>`
  return `<li class="trip-detail__day"><span class="tag tag--ride">${typeLabel}</span><strong>J${day.displayNumber}</strong><span>${dateLabel}</span>${stageName}<span data-stage-locations>${locations}</span>${localityText}<dl class="trip-detail__stats"><div><dt>Distance</dt><dd>${stage.distanceKm === null ? '—' : `${stage.distanceKm.toFixed(1)} km`}</dd></div><div><dt>D+</dt><dd>${stage.elevationGainM === null ? '—' : `+${Math.round(stage.elevationGainM)} m`}</dd></div><div><dt>D−</dt><dd>${stage.elevationLossM === null ? '—' : `−${Math.round(stage.elevationLossM)} m`}</dd></div><div><dt>Roulage</dt><dd>${formatDuration(stage.movingDurationSeconds)}</dd></div><div><dt>Pauses</dt><dd>${stage.pauseDurationSeconds === null ? '—' : `${Math.round(stage.pauseDurationSeconds / 60)} min`}</dd></div><div><dt>Montées</dt><dd>${climbCount}</dd></div></dl></li>`
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

  const climbsList =
    bundle.climbs.length === 0
      ? '<p>Aucune montée détectée.</p>'
      : `<ul class="trip-detail__climbs">${bundle.climbs
          .map(
            (climb) =>
              `<li><strong>${escapeHtml(climb.name ?? 'Montée')}</strong> — ${(climb.endDistanceKm - climb.startDistanceKm).toFixed(1)} km, +${Math.round(climb.elevationGainM)} m, ${climb.averageGradientPercent.toFixed(1)} % (${climb.confidence})</li>`,
          )
          .join('')}</ul>`

  const hasOsmEndpoints = bundle.routePoints.some((point) =>
    (point.type === 'start' || point.type === 'end') && point.provenance.sourceType === 'osm',
  )
  const hasOsmClimbNames = bundle.climbs.some((climb) => climb.provenance.sourceType === 'osm')
  const hasOsmRouteData = bundle.routePoints.some((point) => point.provenance.sourceType === 'osm')
  const hasOsmPracticalPlaces = bundle.practicalPlaces.some((place) => place.provenance.sourceType === 'osm')
  const osmState = bundle.enrichmentMetadata.providers.find((state) => state.provider === 'osm')
  const practicalPlacesState = bundle.enrichmentMetadata.providers.find((state) => state.provider === 'osm-practical-places')
  const routeEnrichmentState = bundle.enrichmentMetadata.providers.find((state) => state.provider === 'osm-route-enrichment')
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
  const climbNamingStatus = options.climbNamingPending
    ? '<p role="status">Recherche de noms de montées en cours…</p>'
    : options.climbNamingError !== null && options.climbNamingError !== undefined
      ? `<p role="alert">${escapeHtml(options.climbNamingError)}</p>`
      : ''
  const climbNamingAction = options.canEnrichClimbNames && !options.climbNamingPending
    ? '<button class="button button--quiet" type="button" data-action="enrich-trip-climb-names">Rechercher les noms des montées</button>'
    : ''
  const practicalPlacesStatus = options.practicalPlacesPending
    ? `<p role="status">Recherche des lieux utiles en cours…${options.practicalPlacesProgress ? ` ${escapeHtml(options.practicalPlacesProgress)}` : ''}</p>`
    : options.practicalPlacesError !== null && options.practicalPlacesError !== undefined
      ? `<p role="alert">${escapeHtml(options.practicalPlacesError)}</p>`
      : practicalPlacesState?.status === 'error' || practicalPlacesState?.status === 'partial'
        ? `<p role="alert">${escapeHtml(practicalPlacesState.message ?? 'La recherche des lieux pratiques a échoué.')}</p>`
        : ''
  const practicalPlacesAction = options.canSearchPracticalPlaces && !options.practicalPlacesPending
    ? '<button class="button button--quiet" type="button" data-action="enrich-trip-practical-places">Rechercher les lieux utiles</button>'
    : ''
  const attribution = hasOsmEndpoints || hasOsmRouteData || hasOsmClimbNames || hasOsmPracticalPlaces ? '<p class="trip-detail__attribution">Données géographiques : © OpenStreetMap contributors.</p>' : ''

  return `
    <div class="trip-detail" data-trip-detail>
      <header class="view-heading"><p class="eyebrow">Vue technique</p><h2>${escapeHtml(bundle.metadata.name)}</h2></header>
      <dl class="trip-detail__summary">
        <div><dt>Dates</dt><dd>${bundle.metadata.startDate ?? 'Non daté'}${bundle.metadata.endDate ? ` → ${bundle.metadata.endDate}` : ''}</dd></div>
        <div><dt>Journées</dt><dd>${bundle.days.length}</dd></div>
        <div><dt>Étapes</dt><dd>${bundle.stages.length}</dd></div>
        <div><dt>Distance totale</dt><dd>${totalDistanceKm.toFixed(1)} km</dd></div>
        <div><dt>D+ total</dt><dd>+${Math.round(totalElevationGainM)} m</dd></div>
        <div><dt>Montées détectées</dt><dd>${bundle.climbs.length}</dd></div>
        <div><dt>Statut</dt><dd>${escapeHtml(bundle.metadata.status)}</dd></div>
      </dl>
      <p class="tag tag--data">Disponible localement</p>
      ${automaticStatus}
      ${geocodingStatus}
      ${geocodingAction}
      ${climbNamingStatus}
      ${climbNamingAction}
      ${practicalPlacesStatus}
      ${practicalPlacesAction}
      <h3>Journées</h3>
      <ol class="trip-detail__day-list">${bundle.days.map((day) => renderDayRow(bundle, day)).join('')}</ol>
      ${attribution}
      <h3>Lieux pratiques</h3>
      ${renderPracticalPlaces(bundle, practicalPlacesState?.status ?? null)}
      <h3>Montées</h3>
      ${climbsList}
      <button class="button button--quiet" type="button" data-action="back-to-list">← Retour à Mes voyages</button>
    </div>`
}
