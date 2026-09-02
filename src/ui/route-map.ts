import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { buildBicycleDirectionsUrl } from './bicycle-directions.ts'
import { sharedCurrentLocationService } from './current-location.ts'
import type { GpxAnalysisSuccess } from '../gpx/types.ts'
import type { PracticalData } from '../practical/model.ts'
import type { Accommodation } from '../trip/accommodations.ts'
import type { RoadbookMatchReport } from '../trip/roadbook-match.ts'
import type { RideDayTimeline } from '../trip/types.ts'
import { lockDocumentScroll } from './document-scroll-lock.ts'
import { createMapOverlayHistory } from './map-overlay-history.ts'
import type { MapOverlayHistoryController } from './map-overlay-history.ts'
import { buildRouteMapModel, routeMapHasContent } from './route-map-model.ts'
import type { RouteMapMarkerModel, RouteMapModel } from './route-map-model.ts'
import {
  PAUSE_ACCENT_COLOR_HEX,
  allRouteMarkerCategories,
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
const openHandlers = new WeakMap<HTMLElement, { readonly click: EventListener; readonly keydown: EventListener }>()
const expandedOpeners = new WeakMap<HTMLDialogElement, HTMLElement>()
const expandedHistory = new WeakMap<HTMLDialogElement, MapOverlayHistoryController>()
const scrollUnlocks = new WeakMap<HTMLDialogElement, () => void>()
const pendingFrames = new WeakMap<HTMLDialogElement, number>()
const mapLayerControllers = new WeakMap<HTMLDialogElement, { dispose(): void }>()
const temporaryMarkers = new WeakMap<HTMLElement, L.CircleMarker>()
const mapClickHandlers = new WeakMap<HTMLElement, (event: L.LeafletMouseEvent) => void>()
const currentLocationMarkers = new WeakMap<HTMLElement, { readonly dot: L.CircleMarker; readonly halo: L.Circle | null }>()

/**
 * C3.B sections 34-37: dedicated panes so the profile's temporary cursor
 * (`profileCursorPane`) always renders above every marker on the map —
 * structural, POI, or "vous êtes ici" (`currentLocationPane`) — regardless
 * of DOM/z-fighting order, without touching any existing marker's own pane
 * (they all keep Leaflet's default `markerPane`, CDC section 36's
 * hierarchy: tiles < route < structural/POI markers < current location <
 * profile cursor). Created once per map instance, right after `L.map(...)`.
 */
function installCustomPanes(map: L.Map): void {
  const currentLocationPane = map.createPane('currentLocationPane')
  currentLocationPane.style.zIndex = '620'
  const profileCursorPane = map.createPane('profileCursorPane')
  profileCursorPane.style.zIndex = '650'
}
/** Exported so other map screens (e.g. the trip-wide overview map) can destroy their own Leaflet instances the same way. */
export function destroyRouteMap(container: HTMLElement): void {
  const map = mapInstances.get(container)
  if (map !== undefined) { map.remove(); mapInstances.delete(container) }
  // A stale reference to a marker whose own map instance was just torn down
  // would otherwise survive into the next render (CDC D1.1 section 19) —
  // `setTemporaryMarker` must never resurrect/reuse it.
  temporaryMarkers.delete(container)
  currentLocationMarkers.delete(container)
  mapClickHandlers.delete(container)
}
function destroy(container: HTMLElement): void { destroyRouteMap(container) }

/**
 * The smallest generic seam the profile↔map sync (CDC D1.1 sections 18-19)
 * needs: a transient, non-persistent marker the caller moves with
 * `setTemporaryMarker` — never `map.panTo`/`fitBounds`/any other view
 * change, and never confused with the map's own permanent markers (a
 * distinct visual, added/removed independently of `createRouteMap`'s own
 * marker loop).
 */
export interface RouteMapInteractionHandle {
  setTemporaryMarker(latitude: number, longitude: number): void
  clearTemporaryMarker(): void
  /**
   * C3.B section 45-47: the "vous êtes ici" marker — a distinct dot/halo,
   * never reusing the pause/col/POI/profile-cursor visuals. The caller
   * (`trips-manager.ts`) is the only one that ever calls this, driven by
   * `current-location.ts`'s shared watch — moving the marker never pans,
   * zooms, or `fitBounds`s the map (section 47).
   */
  setCurrentLocationMarker(latitude: number, longitude: number, accuracyMeters: number | null): void
  clearCurrentLocationMarker(): void
  /**
   * R2.1 sections 40-41 — "Choisir sur la carte": lets the caller
   * (`trips-manager.ts`) enter a click-to-pick mode on this exact map
   * instance, with no new Leaflet concept of its own — a tap just reports
   * its coordinates, same map, same tiles, same zoom/pan the user already
   * has. At most one handler at a time (a second call replaces the first,
   * exactly like `setTemporaryMarker`'s single marker); `null` removes it.
   * Never installed by default — only while a picker is actually open.
   */
  onMapClick(handler: ((latitude: number, longitude: number) => void) | null): void
}

/**
 * Returns a handle for the Leaflet map currently mounted in `container` —
 * the compact map only (CDC D1.1 section 18: "placer... un marker temporaire
 * sur la carte compacte"), resolved the same way `renderGenericRouteMap`
 * itself locates its canvas (`[data-route-map-canvas]`) whether `container`
 * is the outer mount point (`trips-manager.ts`'s own reference) or that
 * canvas directly. `null` when no map is mounted (e.g. no usable geometry,
 * or before the first render). No global Leaflet access, no DOM reach-in
 * from `elevation-profile.ts` — that module only ever dispatches a plain
 * `CustomEvent` on its own container; `trips-manager.ts` is the one place
 * that owns both this handle and the profile's events, and connects the two.
 */
export function getRouteMapInteractionHandle(container: HTMLElement): RouteMapInteractionHandle | null {
  const canvas = container.querySelector<HTMLElement>('[data-route-map-canvas]') ?? container
  const map = mapInstances.get(canvas)
  if (map === undefined) return null
  return {
    setTemporaryMarker(latitude, longitude): void {
      const existing = temporaryMarkers.get(canvas)
      if (existing !== undefined) { existing.setLatLng([latitude, longitude]); return }
      const marker = L.circleMarker([latitude, longitude], {
        // `pane: 'profileCursorPane'` (CDC C3 sections 34-37) — the actual
        // fix: a plain `L.circleMarker` defaults to Leaflet's `overlayPane`
        // (z-index 400), BELOW every `L.marker`-based structural/POI icon
        // (`markerPane`, z-index 600) — this used to let a waypoint/pause/
        // col/POI marker silently cover the temporary cursor.
        pane: 'profileCursorPane',
        radius: 7, weight: 2, color: '#ffffff', fillColor: '#dc2626', fillOpacity: 1, interactive: false, className: 'route-map__temporary-marker',
      }).addTo(map)
      temporaryMarkers.set(canvas, marker)
    },
    clearTemporaryMarker(): void {
      const existing = temporaryMarkers.get(canvas)
      if (existing === undefined) return
      existing.remove()
      temporaryMarkers.delete(canvas)
    },
    setCurrentLocationMarker(latitude, longitude, accuracyMeters): void {
      const existing = currentLocationMarkers.get(canvas)
      if (existing !== undefined) {
        existing.dot.setLatLng([latitude, longitude])
        existing.halo?.setLatLng([latitude, longitude])
        if (existing.halo !== null && accuracyMeters !== null) existing.halo.setRadius(accuracyMeters)
        return
      }
      // A soft accuracy halo only when the platform actually reports one
      // (CDC section 45's own "éventuellement") — never a fabricated radius.
      const halo = accuracyMeters === null ? null : L.circle([latitude, longitude], {
        pane: 'currentLocationPane', radius: accuracyMeters, interactive: false,
        color: '#2563eb', weight: 1, fillColor: '#2563eb', fillOpacity: 0.12, className: 'route-map__current-location-halo',
      }).addTo(map)
      const dot = L.circleMarker([latitude, longitude], {
        pane: 'currentLocationPane', radius: 7, weight: 2, color: '#ffffff', fillColor: '#2563eb', fillOpacity: 1,
        interactive: false, className: 'route-map__current-location-marker',
      }).addTo(map)
      currentLocationMarkers.set(canvas, { dot, halo })
    },
    clearCurrentLocationMarker(): void {
      const existing = currentLocationMarkers.get(canvas)
      if (existing === undefined) return
      existing.dot.remove()
      existing.halo?.remove()
      currentLocationMarkers.delete(canvas)
    },
    onMapClick(handler): void {
      const existing = mapClickHandlers.get(canvas)
      if (existing !== undefined) map.off('click', existing)
      if (handler === null) { mapClickHandlers.delete(canvas); return }
      const listener = (event: L.LeafletMouseEvent): void => handler(event.latlng.lat, event.latlng.lng)
      mapClickHandlers.set(canvas, listener)
      map.on('click', listener)
    },
  }
}

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
  installCustomPanes(map)
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
    bounds.extend(toLatLng(marker.coordinate))
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
 * R2.1 section 26 (correcting R1 section 18): a light UX shortcut only —
 * never a new POI category, never a change to the enrichment/search engine
 * (`practical-places/*`). Exactly the three practical-place layer ids the
 * CDC names ("Eau, Supermarché, Toilettes") — Abris/Vélo/Boulangerie are
 * deliberately excluded now; every individual category checkbox stays fully
 * independent and usable on its own, this only ever toggles several of them
 * together.
 */
const ESSENTIAL_LAYER_IDS: ReadonlySet<string> = new Set(['practical-water', 'practical-supermarket', 'practical-toilet'])

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

  // R1 section 18/19: "Essentiels" — one tap to enable Eau/Abris/Toilettes/
  // Vélo together for the field scenario ("il pleut, j'ouvre la carte, je
  // veux un abri") — shown only when at least one of those four categories
  // actually has something to show here; a trip with none of them present
  // gets no dead shortcut. Placed first so it reads as a shortcut to what
  // follows, not one more layer among the six.
  if (usableLayers.some((layer) => ESSENTIAL_LAYER_IDS.has(layer.id))) {
    const essentialButton = document.createElement('button')
    essentialButton.type = 'button'
    essentialButton.className = 'practical-layer-preset'
    essentialButton.dataset.mapLayerPreset = 'essentials'
    essentialButton.setAttribute('aria-pressed', 'false')
    essentialButton.textContent = 'Essentiels'
    list.appendChild(essentialButton)
  }

  for (const layer of usableLayers) {
    const label = document.createElement('label')
    label.className = 'practical-layer-option'
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.checked = layer.defaultVisible
    input.dataset.mapLayer = layer.id
    // UI-POLISH-01 section 28: the legend swatch used to be one fixed
    // grey-blue circle for every layer, with no glyph — a "Vélo"/"Eau"/
    // "Boulangerie" row looked identical to any other. Every marker in a
    // layer shares the same category (`buildMarker`/`villagesLayer`), so its
    // first marker's own colour/symbol (the exact same ones drawn on the
    // map) is a safe, always-available representative for the whole row.
    const representativeStyle = layer.markers[0] === undefined ? null : getRouteMarkerStyle(layer.markers[0].category)
    const symbol = document.createElement('span')
    symbol.className = 'practical-layer-option__symbol'
    symbol.style.setProperty('--practical-color', representativeStyle?.colorHex ?? '#3f5a72')
    symbol.textContent = representativeStyle?.symbol ?? ''
    symbol.setAttribute('aria-hidden', 'true')
    const name = document.createElement('span')
    name.className = 'practical-layer-option__name'
    name.textContent = layer.label
    const count = document.createElement('span')
    count.className = 'practical-layer-option__count'
    count.textContent = `${layer.markers.length}`
    label.append(input, symbol, name, count)
    list.appendChild(label)

    const group = L.layerGroup(layer.markers.map((marker) => {
      const built = L.marker(toLatLng(marker.coordinate), { icon: createRouteDivIcon(marker.category, { offRoute: marker.offRoute, pauseActive: marker.pauseActive }) })
        .bindTooltip(markerTooltip(marker))
      // C2 (CDC section 19): a practical-POI marker carries its own rich
      // popup, opened on click — every structural marker leaves `popupHtml`
      // unset and keeps its plain tooltip-only behaviour, unchanged.
      // UI-POLISH-01 section 31: explicit `maxWidth`/`autoPanPadding` so the
      // popup never renders under the fullscreen toolbar or Leaflet's own
      // zoom controls — it used to rely entirely on Leaflet's defaults.
      if (marker.popupHtml !== undefined) {
        built.bindPopup(marker.popupHtml, { maxWidth: 300, autoPan: true, autoPanPadding: [16, 60] })
        // CDC C3 section 55: the directions link's `origin` is refreshed from
        // whatever position is known AT THE MOMENT the popup actually opens —
        // never the static one baked into `popupHtml` when it was first built
        // (the cyclist may well have moved since the Étape screen opened).
        built.on('popupopen', () => {
          const element = built.getPopup()?.getElement()
          const link = element?.querySelector<HTMLAnchorElement>('[data-poi-directions]')
          if (link === null || link === undefined) return
          const lat = Number(link.dataset.poiLat)
          const lon = Number(link.dataset.poiLon)
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) return
          const position = sharedCurrentLocationService.getState().position
          link.href = buildBicycleDirectionsUrl({ latitude: lat, longitude: lon }, position === null ? null : { latitude: position.latitude, longitude: position.longitude })
        })
      }
      return built
    }))
    groups.set(layer.id, group)
    if (layer.defaultVisible) group.addTo(map)

    input.addEventListener('change', () => {
      if (input.checked) group.addTo(map)
      else group.remove()
    }, { signal })
  }

  // R1 section 18: reads the essential checkboxes back out of `list` rather
  // than tracking them separately — there is exactly one source of truth
  // (the checkboxes themselves), this button only ever drives them. Toggling
  // dispatches a real `change` event on each so the existing per-checkbox
  // listener above (map add/remove) fires exactly as if the user had
  // clicked each one — never a second, parallel "add to map" code path.
  const essentialButton = list.querySelector<HTMLButtonElement>('[data-map-layer-preset="essentials"]')
  if (essentialButton !== null) {
    const essentialInputs = (): HTMLInputElement[] =>
      Array.from(list.querySelectorAll<HTMLInputElement>('input[data-map-layer]')).filter((input) => ESSENTIAL_LAYER_IDS.has(input.dataset.mapLayer ?? ''))
    essentialButton.addEventListener('click', () => {
      const inputs = essentialInputs()
      const nextChecked = !inputs.every((input) => input.checked)
      for (const input of inputs) {
        if (input.checked === nextChecked) continue
        input.checked = nextChecked
        input.dispatchEvent(new Event('change'))
      }
      essentialButton.setAttribute('aria-pressed', String(nextChecked))
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

const directToggleControllers = new WeakMap<HTMLDialogElement, { dispose(): void }>()

export function disposeDirectLayerToggle(dialog: HTMLDialogElement): void {
  directToggleControllers.get(dialog)?.dispose()
  directToggleControllers.delete(dialog)
}

/**
 * CDC D1.2 sections 4-7: the Aperçu global map's own "Détail" control acts
 * directly on click — no Calques panel, no picking a layer from a list (the
 * Étape map's own "Villages" Calques panel is untouched, `installMapLayerPanel`
 * above). Reuses the exact same `L.layerGroup` construction for the layer's
 * markers, just toggled by one button instead of a checkbox inside a
 * slide-over panel. State is `aria-pressed` only — never "Détail ON/OFF"
 * text (CDC section 5); the label always stays "Détail".
 */
function installDirectLayerToggle(dialog: HTMLDialogElement, map: L.Map, layers: readonly MapLayerDefinition[]): void {
  disposeDirectLayerToggle(dialog)
  const toggle = dialog.querySelector<HTMLButtonElement>('[data-map-layers-toggle]')
  if (toggle === null) return
  const markers = layers.flatMap((layer) => layer.markers)
  toggle.hidden = markers.length === 0
  toggle.setAttribute('aria-pressed', 'false')
  if (markers.length === 0) return
  const group = L.layerGroup(markers.map((marker) =>
    L.marker(toLatLng(marker.coordinate), { icon: createRouteDivIcon(marker.category, { offRoute: marker.offRoute, pauseActive: marker.pauseActive }) })
      .bindTooltip(markerTooltip(marker)),
  ))
  const handler = (): void => {
    const active = toggle.getAttribute('aria-pressed') === 'true'
    if (active) { group.remove(); toggle.setAttribute('aria-pressed', 'false') }
    else { group.addTo(map); toggle.setAttribute('aria-pressed', 'true') }
  }
  toggle.addEventListener('click', handler)
  directToggleControllers.set(dialog, {
    dispose(): void {
      group.remove()
      toggle.removeEventListener('click', handler)
    },
  })
}

/**
 * `categories` omitted keeps the RGA screen's exact historical 4-entry
 * legend, unaffected; a generic caller passes only the categories actually
 * present in its own model, so e.g. the Aperçu map's two `overview-*`
 * categories never show alongside irrelevant Étape-only entries.
 */
function renderLegend(container: HTMLElement, categories?: readonly RouteMarkerCategory[]): void {
  const entries = getRouteMarkerLegendEntries(categories)
  if (entries.length === 0) return
  const legend = document.createElement('p')
  legend.className = 'route-map__legend'
  legend.setAttribute('aria-label', 'Légende des marqueurs de parcours')
  legend.innerHTML = entries
    .map(({ symbol, label }) => `<span class="route-map__legend-item"><strong aria-hidden="true">${symbol}</strong> ${label}</span>`)
    .join(' · ')
  container.appendChild(legend)
}

/** The distinct categories actually present in `model.markers`, in `allRouteMarkerCategories`' stable order — the generic map's own dynamic legend input. */
function presentCategories(model: RouteMapModel): readonly RouteMarkerCategory[] {
  const present = new Set(model.markers.map((marker) => marker.category))
  return allRouteMarkerCategories.filter((category) => present.has(category))
}

export function renderCompactRouteMapModel(container: HTMLElement, model: RouteMapModel | null): void {
  destroy(container)
  if (!routeMapHasContent(model)) {
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
  const open = dialog.previousElementSibling?.querySelector<HTMLElement>('[data-explore-map]')
  if (open !== null && open !== undefined) {
    const previousHandlers = openHandlers.get(open)
    if (previousHandlers !== undefined) {
      open.removeEventListener('click', previousHandlers.click)
      open.removeEventListener('keydown', previousHandlers.keydown)
    }
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
    const keydown: EventListener = (event) => {
      if (!(event instanceof KeyboardEvent) || (event.key !== 'Enter' && event.key !== ' ')) return
      event.preventDefault()
      handler(event)
    }
    openHandlers.set(open, { click: handler, keydown })
    open.addEventListener('click', handler)
    open.addEventListener('keydown', keydown)
  }
}

/**
 * Generic counterpart of `renderRouteMap` for the TripBundle pipeline: takes
 * an already-built `RouteMapModel` directly (see `route-map-model.ts::
 * buildGenericRouteMapModel`) instead of RGA-shaped GPX/timeline/report/
 * accommodation inputs, and has no practical-places layer (out of scope for
 * this phase). Reuses the same `createRouteMap` Leaflet primitive, the same
 * fullscreen-dialog/back-button history wiring, and the same legend.
 * `options.directLayerToggle` (CDC D1.2 sections 4-7) swaps the fullscreen
 * "Détail"/"Calques" button from opening a layer-picker panel to acting
 * directly on click — the Aperçu global map's own dialog only ever has one
 * layer to offer, so a panel just to pick it is one needless step.
 */
export function renderGenericRouteMap(container: HTMLElement, dialog: HTMLDialogElement, model: RouteMapModel | null, layers: readonly MapLayerDefinition[] = [], options: { readonly directLayerToggle?: boolean } = {}): void {
  destroy(container)
  if (dialog.open || scrollUnlocks.has(dialog) || expandedHistory.has(dialog)) {
    closeExpandedRouteMap(dialog)
  }
  const practicalToggle = dialog.querySelector<HTMLButtonElement>('[data-practical-layers-toggle]')
  if (practicalToggle !== null) practicalToggle.hidden = true
  disposeMapLayerPanel(dialog)
  disposeDirectLayerToggle(dialog)
  if (!routeMapHasContent(model)) {
    container.innerHTML = '<p class="route-map__fallback">Carte indisponible.</p>'
    return
  }
  container.innerHTML = '<div class="route-map__canvas" data-route-map-canvas></div><p class="route-map__fallback" hidden data-route-map-fallback>Fond de carte indisponible. Le tracé reste accessible dans le profil.</p>'
  const canvas = container.querySelector<HTMLElement>('[data-route-map-canvas]') as HTMLElement
  const fallback = container.querySelector<HTMLElement>('[data-route-map-fallback]') as HTMLElement
  createRouteMap(canvas, model, { interactive: false, fitPadding: [12, 12] }, () => { fallback.hidden = false })
  renderLegend(container, presentCategories(model))
  const expanded = dialog.querySelector<HTMLElement>('[data-route-map-expanded]') as HTMLElement
  const open = dialog.previousElementSibling?.querySelector<HTMLElement>('[data-explore-map]')
  if (open === null || open === undefined) return
  const previousHandlers = openHandlers.get(open)
  if (previousHandlers !== undefined) {
    open.removeEventListener('click', previousHandlers.click)
    open.removeEventListener('keydown', previousHandlers.keydown)
  }
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
        if (options.directLayerToggle === true) installDirectLayerToggle(dialog, map, layers)
        else installMapLayerPanel(dialog, map, layers)
      } catch {
        closeExpandedRouteMap(dialog)
      }
    })
    pendingFrames.set(dialog, frame)
  }
  const keydown: EventListener = (event) => {
    if (!(event instanceof KeyboardEvent) || (event.key !== 'Enter' && event.key !== ' ')) return
    event.preventDefault()
    handler(event)
  }
  openHandlers.set(open, { click: handler, keydown })
  open.addEventListener('click', handler)
  open.addEventListener('keydown', keydown)
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
    disposeDirectLayerToggle(dialog)
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
