import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { lockDocumentScroll } from './document-scroll-lock.ts'
import { createMapOverlayHistory } from './map-overlay-history.ts'
import type { MapOverlayHistoryController } from './map-overlay-history.ts'
import { getRouteMarkerStyle } from './route-marker-style.ts'
import type { OverviewMapMarker, OverviewMapModel, OverviewTrackState } from './overview-map-model.ts'

export { buildOverviewMapModel } from './overview-map-model.ts'
export type { OverviewMapMarker, OverviewMapModel, OverviewMapTrack, OverviewTrackState } from './overview-map-model.ts'

const mapInstances = new WeakMap<HTMLElement, L.Map>()
const openHandlers = new WeakMap<HTMLButtonElement, EventListener>()
const expandedOpeners = new WeakMap<HTMLDialogElement, HTMLButtonElement>()
const expandedHistory = new WeakMap<HTMLDialogElement, MapOverlayHistoryController>()
const scrollUnlocks = new WeakMap<HTMLDialogElement, () => void>()
const pendingFrames = new WeakMap<HTMLDialogElement, number>()

function destroy(container: HTMLElement): void {
  const map = mapInstances.get(container)
  if (map !== undefined) { map.remove(); mapInstances.delete(container) }
}

const TRACK_COLOR: Record<OverviewTrackState, string> = { past: '#9ca3af', current: '#d97706', future: '#0f766e' }
const TRACK_WEIGHT: Record<OverviewTrackState, number> = { past: 3, current: 5, future: 3 }
const TRACK_OPACITY: Record<OverviewTrackState, number> = { past: 0.6, current: 1, future: 0.9 }

function toLatLng(tuple: readonly [number, number]): L.LatLngTuple { return [tuple[0], tuple[1]] }

function createMarkerIcon(marker: OverviewMapMarker): L.DivIcon {
  if (marker.kind === 'position') {
    const html = '<span class="overview-position-marker__pulse"></span><span class="overview-position-marker__dot"></span>'
    return L.divIcon({ html, className: 'overview-marker overview-marker--position', iconSize: [18, 18], iconAnchor: [9, 9] })
  }
  const style = getRouteMarkerStyle(marker.kind)
  const size = style.sizePx
  const radius = style.shape === 'circle' ? '50%' : style.shape === 'rounded-square' ? '30%' : '20%'
  const html = `<span style="box-sizing:border-box; display:flex; align-items:center; justify-content:center; width:${size}px; height:${size}px; border-radius:${radius}; background:${style.colorHex}; border:2px solid #ffffff; font:700 ${Math.round(size * 0.55)}px/1 system-ui, sans-serif; color:#ffffff;">${style.symbol}</span>`
  return L.divIcon({ html, className: `overview-marker overview-marker--${marker.kind}`, iconSize: [size, size], iconAnchor: [size / 2, size / 2] })
}

interface CreateOverviewMapOptions {
  readonly interactive: boolean
  readonly fitPadding: L.PointExpression
  readonly maxInitialZoom?: number
  readonly invalidateBeforeInitialFit?: boolean
}

function createOverviewMap(container: HTMLElement, model: OverviewMapModel, options: CreateOverviewMapOptions, onTileError: () => void): L.Map {
  destroy(container)
  const interactive = options.interactive
  const map = L.map(container, { attributionControl: true, dragging: interactive, touchZoom: interactive, doubleClickZoom: interactive, boxZoom: interactive, keyboard: interactive, scrollWheelZoom: false, zoomControl: interactive, tapHold: interactive })
  mapInstances.set(container, map)
  const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap contributors', maxZoom: 19 })
  tiles.on('tileerror', onTileError).addTo(map)

  // The current day's track draws last so its accent line sits visually on top of past/future ones.
  const ordered = [...model.tracks].sort((left, right) => Number(left.state === 'current') - Number(right.state === 'current'))
  const bounds: L.LatLngBounds[] = []
  for (const track of ordered) {
    const line = L.polyline(track.coordinates.map(toLatLng), {
      color: TRACK_COLOR[track.state],
      weight: TRACK_WEIGHT[track.state],
      opacity: TRACK_OPACITY[track.state],
    }).addTo(map)
    bounds.push(line.getBounds())
  }
  for (const marker of model.markers) {
    L.marker(toLatLng(marker.coordinate), { icon: createMarkerIcon(marker) }).bindTooltip(marker.name).addTo(map)
  }
  if (bounds.length > 0) {
    if (options.invalidateBeforeInitialFit === true) map.invalidateSize()
    const combined = bounds.slice(1).reduce((acc, next) => acc.extend(next), bounds[0] as L.LatLngBounds)
    map.fitBounds(combined, { padding: options.fitPadding, maxZoom: options.maxInitialZoom })
  }
  return map
}

export function renderCompactOverviewMap(container: HTMLElement, model: OverviewMapModel): void {
  destroy(container)
  if (model.tracks.length === 0) {
    container.innerHTML = '<p class="route-map__fallback">Carte du voyage temporairement indisponible.</p>'
    return
  }
  container.innerHTML = '<div class="route-map__canvas" data-overview-map-canvas></div><p class="route-map__fallback" hidden data-overview-map-fallback>Fond de carte indisponible. Le tracé reste accessible dans Voyage.</p>'
  const canvas = container.querySelector<HTMLElement>('[data-overview-map-canvas]') as HTMLElement
  const fallback = container.querySelector<HTMLElement>('[data-overview-map-fallback]') as HTMLElement
  createOverviewMap(canvas, model, { interactive: false, fitPadding: [12, 12] }, () => { fallback.hidden = false })
}

type ExpandedOverviewMapCloseReason = 'normal' | 'history'

export function closeExpandedOverviewMap(dialog: HTMLDialogElement, reason: ExpandedOverviewMapCloseReason = 'normal'): void {
  const frame = pendingFrames.get(dialog)
  if (frame !== undefined) {
    cancelAnimationFrame(frame)
    pendingFrames.delete(dialog)
  }
  const historyController = expandedHistory.get(dialog)
  expandedHistory.delete(dialog)
  if (reason === 'normal') historyController?.mapClosedNormally()
  else historyController?.dispose()

  try {
    const expanded = dialog.querySelector<HTMLElement>('[data-overview-map-expanded]')
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

/**
 * Renders the compact overview map and wires its own fullscreen dialog —
 * reusing the same scroll-lock and history-controller primitives as the
 * per-day route map (`route-map.ts`), and the same `.route-map-dialog` CSS,
 * so it inherits the already-fixed mobile height/scroll behaviour instead of
 * risking a second, diverging implementation of it.
 */
export function renderOverviewMap(
  container: HTMLElement,
  dialog: HTMLDialogElement,
  model: OverviewMapModel,
  openButton: HTMLButtonElement | null,
): void {
  renderCompactOverviewMap(container, model)
  if (dialog.open || scrollUnlocks.has(dialog) || expandedHistory.has(dialog)) closeExpandedOverviewMap(dialog)
  if (openButton === null) return
  const expanded = dialog.querySelector<HTMLElement>('[data-overview-map-expanded]') as HTMLElement
  const previousHandler = openHandlers.get(openButton)
  if (previousHandler !== undefined) openButton.removeEventListener('click', previousHandler)

  const handler: EventListener = () => {
    if (dialog.open || scrollUnlocks.has(dialog) || expandedHistory.has(dialog)) closeExpandedOverviewMap(dialog)
    expanded.innerHTML = ''
    const expandedFallback = dialog.querySelector<HTMLElement>('[data-overview-map-expanded-fallback]')
    if (expandedFallback !== null) expandedFallback.hidden = true
    expandedOpeners.set(dialog, openButton)
    scrollUnlocks.set(dialog, lockDocumentScroll())

    const historyController = createMapOverlayHistory({
      isMapOpen: () => dialog.open,
      isPanelOpen: () => false,
      closePopup: () => false,
      closePanelFromHistory: () => undefined,
      closeMapFromHistory: () => closeExpandedOverviewMap(dialog, 'history'),
    })
    expandedHistory.set(dialog, historyController)

    try {
      dialog.showModal()
      historyController.startMap()
    } catch {
      closeExpandedOverviewMap(dialog, 'history')
      return
    }

    const frame = requestAnimationFrame(() => {
      pendingFrames.delete(dialog)
      if (!dialog.open) return
      try {
        createOverviewMap(
          expanded,
          model,
          { interactive: true, fitPadding: [36, 36], maxInitialZoom: 13, invalidateBeforeInitialFit: true },
          () => { if (expandedFallback !== null) expandedFallback.hidden = false },
        )
      } catch {
        closeExpandedOverviewMap(dialog)
      }
    })
    pendingFrames.set(dialog, frame)
  }
  openHandlers.set(openButton, handler)
  openButton.addEventListener('click', handler)
}
