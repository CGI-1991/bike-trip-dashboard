import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { GpxAnalysisSuccess } from '../gpx/types.ts'
import type { PracticalData } from '../practical/model.ts'
import type { Accommodation } from '../trip/accommodations.ts'
import type { RoadbookMatchReport } from '../trip/roadbook-match.ts'
import type { RideDayTimeline } from '../trip/types.ts'
import { buildRouteMapModel } from './route-map-model.ts'
import type { RouteMapMarkerModel, RouteMapModel } from './route-map-model.ts'
import {
  PAUSE_ACCENT_COLOR_HEX,
  getRouteMarkerLegendEntries,
  getRouteMarkerStyle,
} from './route-marker-style.ts'
import type { RouteMarkerCategory, RouteMarkerShape } from './route-marker-style.ts'
import {
  disposePracticalLayerPanel,
  installPracticalLayerPanel,
} from './practical-map.ts'

export { buildRouteMapModel } from './route-map-model.ts'
export type { RouteMapMarkerModel, RouteMapModel } from './route-map-model.ts'

const mapInstances = new WeakMap<HTMLElement, L.Map>()
const openHandlers = new WeakMap<HTMLButtonElement, EventListener>()
function destroy(container: HTMLElement): void { const map = mapInstances.get(container); if (map !== undefined) { map.remove(); mapInstances.delete(container) } }

function shapeStyle(shape: RouteMarkerShape): string {
  if (shape === 'circle') return 'border-radius: 50%;'
  if (shape === 'rounded-square') return 'border-radius: 30%;'
  return 'border-radius: 20%; transform: rotate(45deg);'
}

function createRouteDivIcon(category: RouteMarkerCategory, options: { readonly offRoute?: boolean; readonly pauseActive?: boolean } = {}): L.DivIcon {
  const style = getRouteMarkerStyle(category)
  const size = style.sizePx
  const ring = options.pauseActive === true ? `box-shadow: 0 0 0 3px ${PAUSE_ACCENT_COLOR_HEX};` : ''
  const surface = options.offRoute === true
    ? `background: transparent; border: 2px dashed ${style.colorHex};`
    : `background: ${style.colorHex}; border: 2px solid #ffffff;`
  const counterRotate = style.shape === 'diamond' ? 'transform: rotate(-45deg);' : ''
  const symbolMarkup = style.symbol === '' ? '' : `<span style="display:block; ${counterRotate} font: 700 ${Math.round(size * 0.55)}px/1 system-ui, sans-serif; color:#ffffff;">${style.symbol}</span>`
  const html = `<span role="img" aria-label="${style.label}" style="box-sizing:border-box; display:flex; align-items:center; justify-content:center; width:${size}px; height:${size}px; ${shapeStyle(style.shape)} ${surface} ${ring}">${symbolMarkup}</span>`
  return L.divIcon({ html, className: `route-marker route-marker--${category}`, iconSize: [size, size], iconAnchor: [size / 2, size / 2] })
}

function markerTooltip(marker: RouteMapMarkerModel): string {
  const base = marker.category === 'start'
    ? `Départ — ${marker.name}`
    : marker.category === 'finish'
      ? `Arrivée — ${marker.name}`
      : marker.name
  const pause = marker.pauseDurationMinutes === undefined ? '' : ` · Pause ${marker.pauseDurationMinutes} min`
  const offRoute = marker.offRoute ? ' · Hors parcours' : ''
  return `${base}${pause}${offRoute}`
}

function toLatLng(tuple: readonly [number, number]): L.LatLngTuple { return [tuple[0], tuple[1]] }

interface CreateMapOptions {
  readonly interactive: boolean
  readonly fitPadding: L.PointExpression
  readonly maxInitialZoom?: number
}

function createMap(container: HTMLElement, model: RouteMapModel, options: CreateMapOptions, onTileError: () => void): L.Map {
  destroy(container)
  const interactive = options.interactive
  const map = L.map(container, { attributionControl: true, dragging: interactive, touchZoom: interactive, doubleClickZoom: interactive, boxZoom: interactive, keyboard: interactive, scrollWheelZoom: false, zoomControl: interactive, tapHold: interactive })
  mapInstances.set(container, map)
  const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap contributors', maxZoom: 19 })
  tiles.on('tileerror', onTileError).addTo(map)
  const line = L.polyline(model.coordinates.map(toLatLng), { color: '#0f766e', weight: 4 }).addTo(map)
  for (const marker of model.markers) {
    L.marker(toLatLng(marker.coordinate), { icon: createRouteDivIcon(marker.category, { offRoute: marker.offRoute, pauseActive: marker.pauseActive }) })
      .bindTooltip(markerTooltip(marker))
      .addTo(map)
  }
  if (model.coordinates.length > 1) {
    map.fitBounds(line.getBounds(), {
      padding: options.fitPadding,
      maxZoom: options.maxInitialZoom,
    })
  }
  return map
}

function renderLegend(container: HTMLElement): void {
  const legend = document.createElement('p')
  legend.className = 'route-map__legend'
  legend.setAttribute('aria-label', 'Légende des marqueurs de parcours')
  legend.innerHTML = getRouteMarkerLegendEntries()
    .map(({ symbol, label }) => `<span class="route-map__legend-item"><strong aria-hidden="true">${symbol}</strong> ${label}</span>`)
    .join(' · ')
  container.appendChild(legend)
}

export function renderCompactRouteMapModel(container: HTMLElement, model: RouteMapModel | null): void {
  destroy(container)
  if (model === null || model.coordinates.length < 2) {
    container.innerHTML = '<p class="route-map__fallback">Carte temporairement indisponible.</p>'
    return
  }
  container.innerHTML = '<div class="route-map__canvas" data-today-route-map-canvas></div><p class="route-map__fallback" hidden data-today-route-map-fallback>Fond de carte indisponible. Le tracé reste accessible dans le détail.</p>'
  const canvas = container.querySelector<HTMLElement>('[data-today-route-map-canvas]') as HTMLElement
  const fallback = container.querySelector<HTMLElement>('[data-today-route-map-fallback]') as HTMLElement
  createMap(canvas, model, { interactive: false, fitPadding: [12, 12] }, () => { fallback.hidden = false })
}

export function renderRouteMap(container: HTMLElement, dialog: HTMLDialogElement, gpx: GpxAnalysisSuccess | null, timeline: RideDayTimeline | null, report: RoadbookMatchReport | null, accommodation: Accommodation | null, practicalData: PracticalData | null = null): void {
  destroy(container)
  disposePracticalLayerPanel(dialog)
  if (gpx === null || timeline === null) {
    const practicalToggle = dialog.querySelector<HTMLButtonElement>('[data-practical-layers-toggle]')
    if (practicalToggle !== null) practicalToggle.hidden = true
    container.innerHTML = '<p class="route-map__fallback">Carte indisponible.</p>'
    return
  }
  const model = buildRouteMapModel(gpx, timeline, report, accommodation)
  container.innerHTML = '<div class="route-map__canvas" data-route-map-canvas></div><p class="route-map__fallback" hidden data-route-map-fallback>Fond de carte indisponible. Le tracé reste accessible dans le profil.</p>'
  const canvas = container.querySelector<HTMLElement>('[data-route-map-canvas]') as HTMLElement; const fallback = container.querySelector<HTMLElement>('[data-route-map-fallback]') as HTMLElement
  createMap(canvas, model, { interactive: false, fitPadding: [12, 12] }, () => { fallback.hidden = false })
  renderLegend(container)
  const expanded = dialog.querySelector<HTMLElement>('[data-route-map-expanded]') as HTMLElement
  const open = dialog.previousElementSibling?.querySelector<HTMLButtonElement>('[data-explore-map]')
  if (open !== null && open !== undefined) {
    const previousHandler = openHandlers.get(open)
    if (previousHandler !== undefined) open.removeEventListener('click', previousHandler)
    const handler: EventListener = () => {
      expanded.innerHTML = ''
      const expandedFallback = dialog.querySelector<HTMLElement>('[data-expanded-route-map-fallback]')
      if (expandedFallback !== null) expandedFallback.hidden = true
      dialog.showModal()
      requestAnimationFrame(() => {
        const map = createMap(
          expanded,
          model,
          { interactive: true, fitPadding: [36, 36], maxInitialZoom: 13 },
          () => {
            if (expandedFallback !== null) expandedFallback.hidden = false
          },
        )
        map.invalidateSize()
        installPracticalLayerPanel(dialog, map, practicalData, timeline.day.id)
      })
    }
    openHandlers.set(open, handler)
    open.addEventListener('click', handler)
  }
}

export function closeExpandedRouteMap(dialog: HTMLDialogElement): void {
  disposePracticalLayerPanel(dialog)
  const expanded = dialog.querySelector<HTMLElement>('[data-route-map-expanded]')
  if (expanded !== null) destroy(expanded)
  dialog.close()
}
