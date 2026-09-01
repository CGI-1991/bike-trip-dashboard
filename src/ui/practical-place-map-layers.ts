/**
 * C2's Étape-fullscreen-only practical-POI layers (CDC C2 sections 16-19) —
 * turns `PracticalPlaceViewModel[]` (`practical-places/view-model.ts`, no
 * DOM, no Leaflet) into the six togglable `MapLayerDefinition`s the Étape
 * map's existing "Calques" panel already knows how to render
 * (`route-map.ts::installMapLayerPanel`) plus each marker's own popup HTML.
 * Leaflet-free, like `route-map-model.ts` itself — only ever consumed by
 * `trips-manager.ts`, which owns the actual map-rendering injection seam.
 */

import type { PracticalPlaceViewModel } from '../practical-places/view-model.ts'
import { PRACTICAL_PLACE_UX_CATEGORIES, PRACTICAL_PLACE_UX_LABELS } from '../practical-places/taxonomy.ts'
import type { PracticalPlaceUxCategory } from '../practical-places/taxonomy.ts'
import { buildBicycleDirectionsUrl } from './bicycle-directions.ts'
import type { MapLayerDefinition } from './route-map.ts'
import type { RouteMapMarkerModel } from './route-map-model.ts'
import type { RouteMarkerCategory } from './route-marker-style.ts'

const CATEGORY_TO_MARKER: Readonly<Record<PracticalPlaceUxCategory, RouteMarkerCategory>> = {
  'bike-service': 'practical-bike',
  supermarket: 'practical-supermarket',
  bakery: 'practical-bakery',
  water: 'practical-water',
  shelter: 'practical-shelter',
  toilet: 'practical-toilet',
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function formatTrackKilometers(value: number): string {
  return value.toFixed(1).replace('.', ',')
}

/** "Ouvert/Fermé à votre passage" or the honest "Horaires à vérifier" (CDC section 25) — never a live/commercial-grade claim, always framed as the theoretical ETA it is. */
function openingStatusLine(opening: PracticalPlaceViewModel['opening']): string {
  if (opening === null) return ''
  if (opening.status === 'open') return '<p class="practical-popup__status practical-popup__status--open">Ouvert à votre passage</p>'
  if (opening.status === 'closed') return '<p class="practical-popup__status practical-popup__status--closed">Fermé à votre passage</p>'
  return '<p class="practical-popup__status practical-popup__status--unknown">Horaires à vérifier</p>'
}

/**
 * One compact popup (CDC section 19's own worked example) — name, category,
 * position/détour, ETA, opening status, raw hours, then whichever of
 * website/téléphone/accès/tarif the source actually carries. Never a raw
 * tag dump (section 20's own "éviter une fiche énorme").
 */
function buildPopupHtml(viewModel: PracticalPlaceViewModel): string {
  const { place, categoryLabel, displayName, passageClockTimeLabel, opening } = viewModel
  const detourMeters = Math.round(place.detourKm === null ? 0 : place.detourKm * 1_000)
  const positionLine = place.trackDistanceKm === null
    ? ''
    : `<p class="practical-popup__meta">km ${formatTrackKilometers(place.trackDistanceKm)} · détour ~${detourMeters} m</p>`
  const etaLine = passageClockTimeLabel === null ? '' : `<p class="practical-popup__meta">Passage estimé ${escapeHtml(passageClockTimeLabel)}</p>`
  const rawHoursLine = opening?.rawOpeningHours === null || opening?.rawOpeningHours === undefined
    ? ''
    : `<p class="practical-popup__hours">${escapeHtml(opening.rawOpeningHours)}</p>`
  const tags = place.usefulTags ?? {}
  const links: string[] = []
  const website = tags.website ?? tags['contact:website']
  if (website !== undefined) links.push(`<a href="${escapeHtml(website)}" target="_blank" rel="noopener">Site</a>`)
  const phone = tags.phone ?? tags['contact:phone']
  if (phone !== undefined) links.push(`<a href="tel:${escapeHtml(phone)}">${escapeHtml(phone)}</a>`)
  if (place.category === 'toilet') {
    if (tags.access !== undefined) links.push(`Accès : ${escapeHtml(tags.access)}`)
    if (tags.fee !== undefined) links.push(`Payant : ${tags.fee === 'yes' ? 'oui' : 'non'}`)
  }
  const linksLine = links.length === 0 ? '' : `<p class="practical-popup__links">${links.join(' · ')}</p>`

  // CDC C3 sections 51-55: a static, destination-only URL (works with or
  // without a known current position, section 53) baked in now — never
  // disabled for lack of GPS — then upgraded in place with `&origin=` by
  // `installMapLayerPanel`'s own `popupopen` handler using whatever
  // position is known AT THE MOMENT the popup actually opens (section 55),
  // never frozen at build time. `data-poi-lat`/`data-poi-lon` are what that
  // handler reads to rebuild the URL; the plain `href` alone still works
  // even if that patch never runs.
  const directionsUrl = buildBicycleDirectionsUrl({ latitude: place.latitude, longitude: place.longitude })
  const directionsLine = `<p class="practical-popup__directions"><a class="button button--quiet" href="${escapeHtml(directionsUrl)}" target="_blank" rel="noopener noreferrer" data-poi-directions data-poi-lat="${place.latitude}" data-poi-lon="${place.longitude}" aria-label="Itinéraire vélo vers ${escapeHtml(displayName)}">Itinéraire vélo</a></p>`

  return `<div class="practical-popup">
    <strong class="practical-popup__name">${escapeHtml(displayName)}</strong>
    <span class="practical-popup__category">${escapeHtml(categoryLabel)}</span>
    ${positionLine}
    ${etaLine}
    ${openingStatusLine(opening)}
    ${rawHoursLine}
    ${linksLine}
    ${directionsLine}
  </div>`
}

function buildMarker(viewModel: PracticalPlaceViewModel): RouteMapMarkerModel {
  const { place } = viewModel
  return {
    id: place.id,
    category: CATEGORY_TO_MARKER[viewModel.category],
    name: viewModel.displayName,
    coordinate: [place.latitude, place.longitude],
    offRoute: false,
    pauseActive: false,
    popupHtml: buildPopupHtml(viewModel),
  }
}

/**
 * One `MapLayerDefinition` per UX category, in the CDC's own fixed display
 * order — every one of the six always present (even with zero markers),
 * matching `installMapLayerPanel`'s own `usableLayers = layers.filter
 * (markers.length > 0)` filtering out an empty one automatically. Sorted by
 * `trackDistanceKm` within each layer, matching the fused Parcours
 * ordering elsewhere (CDC section 28) — never alphabetical.
 */
export function buildPracticalPlaceMapLayers(viewModels: readonly PracticalPlaceViewModel[]): readonly MapLayerDefinition[] {
  return PRACTICAL_PLACE_UX_CATEGORIES.map((category) => {
    const markers = viewModels
      .filter((viewModel) => viewModel.category === category)
      .slice()
      .sort((left, right) => (left.place.trackDistanceKm ?? 0) - (right.place.trackDistanceKm ?? 0) || (left.place.detourKm ?? 0) - (right.place.detourKm ?? 0))
      .map(buildMarker)
    return { id: `practical-${category}`, label: PRACTICAL_PLACE_UX_LABELS[category], markers, defaultVisible: false }
  })
}
