import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { GpxAnalysisSuccess } from '../gpx/types.ts'
import type { PracticalData } from '../practical/model.ts'
import type { Accommodation } from '../trip/accommodations.ts'
import type { RoadbookMatchReport } from '../trip/roadbook-match.ts'
import type { RideDayTimeline } from '../trip/types.ts'
import { lockDocumentScroll } from './document-scroll-lock.ts'
import { createMapOverlayHistory } from './map-overlay-history.ts'
import type { MapOverlayHistoryController } from './map-overlay-history.ts'
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
import type { PracticalLayerPanelController } from './practical-map.ts'

export { buildGenericRouteMapModel, buildRouteMapModel } from './route-map-model.ts'
export type { RouteMapMarkerModel, RouteMapModel } from './route-map-model.ts'

const mapInstances = new WeakMap<HTMLElement, L.Map>()
const openHandlers = new WeakMap<HTMLButtonElement, EventListener>()
const expandedOpeners = new WeakMap<HTMLDialogElement, HTMLButtonElement>()
const expandedHistory = new WeakMap<HTMLDialogElement, MapOverlayHistoryController>()
const scrollUnlocks = new WeakMap<HTMLDialogElement, () => void>()
const pendingFrames = new WeakMap<HTMLDialogElement, number>()
const mapLayerControllers = new WeakMap<HTMLDialogElement, { dispose(): void }>()
/** Exported so other map screens (e.g. the trip-wide overview map) can destroy their own Leaflet instances the same way. */
export function destroyRouteMap(container: HTMLElement): void { const map = mapInstances.get(container); if (map !== undefined) { map.remove(); mapInstances.delete(container) } }
function destroy(container: HTMLElement): void { destroyRouteMap(container) }

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

export interface CreateRouteMapOptions {
  readonly interactive: boolean
  readonly fitPadding: L.PointExpression
  readonly maxInitialZoom?: number
  readonly invalidateBeforeInitialFit?: boolean
}

/**
 * Shared Leaflet instantiation (tiles, polyline, markers, fit-bounds) so every
 * map screen renders identically and stays a single place to fix map bugs —
 * used directly by the trip-wide overview map, not just this day's map.
 */
export function createRouteMap(container: HTMLElement, model: RouteMapModel, options: CreateRouteMapOptions, onTileError: () => void): L.Map {
  destroy(container)
  const interactive = options.interactive
  const map = L.map(container, { attributionControl: true, dragging: interactive, touchZoom: interactive, doubleClickZoom: interactive, boxZoom: interactive, keyboard: interactive, scrollWheelZoom: false, zoomControl: interactive, tapHold: interactive })
  mapInstances.set(container, map)
  const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap contributors', maxZoom: 19 })
  tiles.on('tileerror', onTileError).addTo(map)
  // `extraLines` (the Aperçu global map) draws one polyline per geographically
  // disjoint stage — never one continuous line spanning an OFF/transfer gap.
  const lineSegments = [model.coordinates, ...(model.extraLines ?? [])].filter((segment) => segment.length > 1)
  const bounds = L.latLngBounds([])
  for (const segment of lineSegments) {
    bounds.extend(L.polyline(segment.map(toLatLng), { color: '#0f766e', weight: 4 }).addTo(map).getBounds())
  }
  for (const marker of model.markers) {
    L.marker(toLatLng(marker.coordinate), { icon: createRouteDivIcon(marker.category, { offRoute: marker.offRoute, pauseActive: marker.pauseActive }) })
      .bindTooltip(markerTooltip(marker))
      .addTo(map)
  }
  if (bounds.isValid()) {
    if (options.invalidateBeforeInitialFit === true) map.invalidateSize()
    map.fitBounds(bounds, {
      padding: options.fitPadding,
      maxZoom: options.maxInitialZoom,
    })
  }
  return map
}

/**
 * One togglable layer of extra markers on the fullscreen map (CDC Jalon B4
 * section 9): V1 only ever passes a single "Villages" entry, but the panel
 * itself takes an arbitrary list so a future POI layer (water, shelter,
 * bike repair…) is just one more entry, never a rewritten system.
 */
export interface MapLayerDefinition {
  readonly id: string
  readonly label: string
  readonly markers: readonly RouteMapMarkerModel[]
  readonly defaultVisible: boolean
}

export function disposeMapLayerPanel(dialog: HTMLDialogElement): void {
  mapLayerControllers.get(dialog)?.dispose()
  mapLayerControllers.delete(dialog)
}

/**
 * Installs the small "Calques" panel on the fullscreen map (structural
 * points are always drawn by `createRouteMap`, never part of this panel —
 * only additional, opt-in layers like Villages are). Reuses the practical
 * layers panel's own CSS classes so it looks identical without new styling.
 */
function installMapLayerPanel(dialog: HTMLDialogElement, map: L.Map, layers: readonly MapLayerDefinition[]): void {
  disposeMapLayerPanel(dialog)
  const toggle = dialog.querySelector<HTMLButtonElement>('[data-map-layers-toggle]')
  const panel = dialog.querySelector<HTMLElement>('[data-map-layers-panel]')
  const list = dialog.querySelector<HTMLElement>('[data-map-layers-list]')
  const backdrop = dialog.querySelector<HTMLButtonElement>('[data-map-layers-backdrop]')
  const close = dialog.querySelector<HTMLButtonElement>('[data-map-layers-close]')
  if (toggle === null || panel === null || list === null || backdrop === null || close === null) return

  const usableLayers = layers.filter((layer) => layer.markers.length > 0)
  toggle.hidden = usableLayers.length === 0
  panel.hidden = true
  backdrop.hidden = true
  toggle.setAttribute('aria-expanded', 'false')
  list.replaceChildren()
  if (usableLayers.length === 0) return

  const eventController = new AbortController()
  const { signal } = eventController
  const groups = new Map<string, L.LayerGroup>()

  for (const layer of usableLayers) {
    const label = document.createElement('label')
    label.className = 'practical-layer-option'
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.checked = layer.defaultVisible
    input.dataset.mapLayer = layer.id
    const symbol = document.createElement('span')
    symbol.className = 'practical-layer-option__symbol'
    symbol.style.setProperty('--practical-color', '#3f5a72')
    symbol.setAttribute('aria-hidden', 'true')
    const name = document.createElement('span')
    name.className = 'practical-layer-option__name'
    name.textContent = layer.label
    const count = document.createElement('span')
    count.className = 'practical-layer-option__count'
    count.textContent = `${layer.markers.length}`
    label.append(input, symbol, name, count)
    list.appendChild(label)

    const group = L.layerGroup(layer.markers.map((marker) =>
      L.marker(toLatLng(marker.coordinate), { icon: createRouteDivIcon(marker.category, { offRoute: marker.offRoute, pauseActive: marker.pauseActive }) })
        .bindTooltip(markerTooltip(marker)),
    ))
    groups.set(layer.id, group)
    if (layer.defaultVisible) group.addTo(map)

    input.addEventListener('change', () => {
      if (input.checked) group.addTo(map)
      else group.remove()
    }, { signal })
  }

  const openPanel = (): void => {
    if (!panel.hidden) return
    panel.hidden = false
    backdrop.hidden = false
    toggle.setAttribute('aria-expanded', 'true')
    close.focus()
  }
  const closePanel = (): void => {
    if (panel.hidden) return
    panel.hidden = true
    backdrop.hidden = true
    toggle.setAttribute('aria-expanded', 'false')
    toggle.focus()
  }
  toggle.addEventListener('click', () => { if (panel.hidden) openPanel(); else closePanel() }, { signal })
  backdrop.addEventListener('click', closePanel, { signal })
  close.addEventListener('click', closePanel, { signal })
  dialog.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || panel.hidden) return
    event.preventDefault()
    event.stopPropagation()
    closePanel()
  }, { signal })

  mapLayerControllers.set(dialog, {
    dispose(): void {
      eventController.abort()
      for (const group of groups.values()) group.remove()
    },
  })
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
  createRouteMap(canvas, model, { interactive: false, fitPadding: [12, 12] }, () => { fallback.hidden = false })
}

export function renderRouteMap(container: HTMLElement, dialog: HTMLDialogElement, gpx: GpxAnalysisSuccess | null, timeline: RideDayTimeline | null, report: RoadbookMatchReport | null, accommodation: Accommodation | null, practicalData: PracticalData | null = null): void {
  destroy(container)
  if (dialog.open || scrollUnlocks.has(dialog) || expandedHistory.has(dialog)) {
    closeExpandedRouteMap(dialog)
  }
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
  createRouteMap(canvas, model, { interactive: false, fitPadding: [12, 12] }, () => { fallback.hidden = false })
  renderLegend(container)
  const expanded = dialog.querySelector<HTMLElement>('[data-route-map-expanded]') as HTMLElement
  const open = dialog.previousElementSibling?.querySelector<HTMLButtonElement>('[data-explore-map]')
  if (open !== null && open !== undefined) {
    const previousHandler = openHandlers.get(open)
    if (previousHandler !== undefined) open.removeEventListener('click', previousHandler)
    const handler: EventListener = () => {
      if (dialog.open || scrollUnlocks.has(dialog) || expandedHistory.has(dialog)) {
        closeExpandedRouteMap(dialog)
      }
      expanded.innerHTML = ''
      const expandedFallback = dialog.querySelector<HTMLElement>('[data-expanded-route-map-fallback]')
      if (expandedFallback !== null) expandedFallback.hidden = true
      expandedOpeners.set(dialog, open)
      scrollUnlocks.set(dialog, lockDocumentScroll())

      let map: L.Map | null = null
      let panel: PracticalLayerPanelController | null = null
      let popupOpen = false
      const historyController = createMapOverlayHistory({
        isMapOpen: () => dialog.open,
        isPanelOpen: () => panel?.isOpen() ?? false,
        closePopup: () => {
          if (!popupOpen || map === null) return false
          map.closePopup()
          popupOpen = false
          return true
        },
        closePanelFromHistory: () => panel?.close('history'),
        closeMapFromHistory: () => closeExpandedRouteMap(dialog, 'history'),
      })
      expandedHistory.set(dialog, historyController)

      try {
        dialog.showModal()
        historyController.startMap()
      } catch {
        closeExpandedRouteMap(dialog, 'history')
        return
      }

      const frame = requestAnimationFrame(() => {
        pendingFrames.delete(dialog)
        if (!dialog.open) return
        try {
          map = createRouteMap(
            expanded,
            model,
            {
              interactive: true,
              fitPadding: [36, 36],
              maxInitialZoom: 13,
              invalidateBeforeInitialFit: true,
            },
            () => {
              if (expandedFallback !== null) expandedFallback.hidden = false
            },
          )
          map.on('popupopen', () => { popupOpen = true })
          map.on('popupclose', () => { popupOpen = false })
          panel = installPracticalLayerPanel(dialog, map, practicalData, timeline.day.id, {
            onOpened: historyController.panelOpened,
            onClosed: (reason) => {
              if (reason === 'normal') historyController.panelClosedNormally()
            },
          })
        } catch {
          closeExpandedRouteMap(dialog)
        }
      })
      pendingFrames.set(dialog, frame)
    }
    openHandlers.set(open, handler)
    open.addEventListener('click', handler)
  }
}

/**
 * Generic counterpart of `renderRouteMap` for the TripBundle pipeline: takes
 * an already-built `RouteMapModel` directly (see `route-map-model.ts::
 * buildGenericRouteMapModel`) instead of RGA-shaped GPX/timeline/report/
 * accommodation inputs, and has no practical-places layer (out of scope for
 * this phase). Reuses the same `createRouteMap` Leaflet primitive, the same
 * fullscreen-dialog/back-button history wiring, and the same legend.
 */
export function renderGenericRouteMap(container: HTMLElement, dialog: HTMLDialogElement, model: RouteMapModel | null, layers: readonly MapLayerDefinition[] = []): void {
  destroy(container)
  if (dialog.open || scrollUnlocks.has(dialog) || expandedHistory.has(dialog)) {
    closeExpandedRouteMap(dialog)
  }
  const practicalToggle = dialog.querySelector<HTMLButtonElement>('[data-practical-layers-toggle]')
  if (practicalToggle !== null) practicalToggle.hidden = true
  disposeMapLayerPanel(dialog)
  if (model === null || model.coordinates.length < 2) {
    container.innerHTML = '<p class="route-map__fallback">Carte indisponible.</p>'
    return
  }
  container.innerHTML = '<div class="route-map__canvas" data-route-map-canvas></div><p class="route-map__fallback" hidden data-route-map-fallback>Fond de carte indisponible. Le tracé reste accessible dans le profil.</p>'
  const canvas = container.querySelector<HTMLElement>('[data-route-map-canvas]') as HTMLElement
  const fallback = container.querySelector<HTMLElement>('[data-route-map-fallback]') as HTMLElement
  createRouteMap(canvas, model, { interactive: false, fitPadding: [12, 12] }, () => { fallback.hidden = false })
  renderLegend(container)
  const expanded = dialog.querySelector<HTMLElement>('[data-route-map-expanded]') as HTMLElement
  const open = dialog.previousElementSibling?.querySelector<HTMLButtonElement>('[data-explore-map]')
  if (open === null || open === undefined) return
  const previousHandler = openHandlers.get(open)
  if (previousHandler !== undefined) open.removeEventListener('click', previousHandler)
  const handler: EventListener = () => {
    if (dialog.open || scrollUnlocks.has(dialog) || expandedHistory.has(dialog)) {
      closeExpandedRouteMap(dialog)
    }
    expanded.innerHTML = ''
    const expandedFallback = dialog.querySelector<HTMLElement>('[data-expanded-route-map-fallback]')
    if (expandedFallback !== null) expandedFallback.hidden = true
    expandedOpeners.set(dialog, open)
    scrollUnlocks.set(dialog, lockDocumentScroll())

    let map: L.Map | null = null
    let popupOpen = false
    const historyController = createMapOverlayHistory({
      isMapOpen: () => dialog.open,
      isPanelOpen: () => false,
      closePopup: () => {
        if (!popupOpen || map === null) return false
        map.closePopup()
        popupOpen = false
        return true
      },
      closePanelFromHistory: () => undefined,
      closeMapFromHistory: () => closeExpandedRouteMap(dialog, 'history'),
    })
    expandedHistory.set(dialog, historyController)

    try {
      dialog.showModal()
      historyController.startMap()
    } catch {
      closeExpandedRouteMap(dialog, 'history')
      return
    }

    const frame = requestAnimationFrame(() => {
      pendingFrames.delete(dialog)
      if (!dialog.open) return
      try {
        map = createRouteMap(
          expanded,
          model,
          { interactive: true, fitPadding: [36, 36], maxInitialZoom: 13, invalidateBeforeInitialFit: true },
          () => { if (expandedFallback !== null) expandedFallback.hidden = false },
        )
        map.on('popupopen', () => { popupOpen = true })
        map.on('popupclose', () => { popupOpen = false })
        installMapLayerPanel(dialog, map, layers)
      } catch {
        closeExpandedRouteMap(dialog)
      }
    })
    pendingFrames.set(dialog, frame)
  }
  openHandlers.set(open, handler)
  open.addEventListener('click', handler)
}

type ExpandedMapCloseReason = 'normal' | 'history'

export function closeExpandedRouteMap(
  dialog: HTMLDialogElement,
  reason: ExpandedMapCloseReason = 'normal',
): void {
  const frame = pendingFrames.get(dialog)
  if (frame !== undefined) {
    cancelAnimationFrame(frame)
    pendingFrames.delete(dialog)
  }

  const historyController = expandedHistory.get(dialog)
  expandedHistory.delete(dialog)
  if (reason === 'normal') {
    historyController?.mapClosedNormally()
  } else {
    historyController?.dispose()
  }

  try {
    disposePracticalLayerPanel(dialog)
    disposeMapLayerPanel(dialog)
    const expanded = dialog.querySelector<HTMLElement>('[data-route-map-expanded]')
    if (expanded !== null) destroy(expanded)
    if (dialog.open) dialog.close()
  } finally {
    const unlock = scrollUnlocks.get(dialog)
    scrollUnlocks.delete(dialog)
    unlock?.()
    const opener = expandedOpeners.get(dialog)
    expandedOpeners.delete(dialog)
    opener?.focus()
  }
}
