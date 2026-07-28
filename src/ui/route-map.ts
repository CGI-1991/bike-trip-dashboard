import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { GpxAnalysisSuccess } from '../gpx/types.ts'
import type { Accommodation } from '../trip/accommodations.ts'
import type { RoadbookMatchReport } from '../trip/roadbook-match.ts'
import type { RideDayTimeline } from '../trip/types.ts'

const mapInstances = new WeakMap<HTMLElement, L.Map>()
const openHandlers = new WeakMap<HTMLButtonElement, EventListener>()
function destroy(container: HTMLElement): void { const map = mapInstances.get(container); if (map !== undefined) { map.remove(); mapInstances.delete(container) } }

export interface RouteMapModel { readonly coordinates: readonly L.LatLngTuple[]; readonly documentedPoints: readonly { name: string; coordinate: L.LatLngTuple; offRoute: boolean }[]; readonly pauses: readonly { name: string; coordinate: L.LatLngTuple; durationMinutes: number }[]; readonly accommodation: { name: string; coordinate: L.LatLngTuple } | null }

export function buildRouteMapModel(gpx: GpxAnalysisSuccess, timeline: RideDayTimeline, report: RoadbookMatchReport | null, accommodation: Accommodation | null): RouteMapModel {
  const coordinates = gpx.segments.flatMap(({ points }) => points.map(({ latitude, longitude }) => [latitude, longitude] as L.LatLngTuple))
  const documentedPoints = (report?.allPointMatches.filter(({ dayId, sourceLatitude, sourceLongitude, matchedLatitude, matchedLongitude }) => dayId === timeline.day.id && (sourceLatitude !== undefined && sourceLongitude !== undefined || matchedLatitude !== undefined && matchedLongitude !== undefined)) ?? []).map((point) => ({ name: point.name, coordinate: [point.sourceLatitude ?? point.matchedLatitude as number, point.sourceLongitude ?? point.matchedLongitude as number] as L.LatLngTuple, offRoute: point.resolution !== 'matched' }))
  const end = coordinates.at(-1) ?? [0, 0]
  const pauses = timeline.route.pauses.map(({ name, latitude, longitude, durationMinutes }) => ({ name, coordinate: [latitude, longitude] as L.LatLngTuple, durationMinutes }))
  return { coordinates, documentedPoints, pauses, accommodation: accommodation === null ? null : { name: accommodation.name, coordinate: accommodation.latitude === undefined || accommodation.longitude === undefined ? end : [accommodation.latitude, accommodation.longitude] } }
}

function createMap(container: HTMLElement, model: RouteMapModel, interactive: boolean, onTileError: () => void): L.Map {
  destroy(container)
  const map = L.map(container, { attributionControl: true, dragging: interactive, touchZoom: interactive, doubleClickZoom: interactive, boxZoom: interactive, keyboard: interactive, scrollWheelZoom: false, zoomControl: interactive, tapHold: interactive })
  mapInstances.set(container, map)
  const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap contributors', maxZoom: 19 })
  tiles.on('tileerror', onTileError).addTo(map)
  const line = L.polyline([...model.coordinates], { color: '#0f766e', weight: 4 }).addTo(map)
  const start = model.coordinates[0]; const end = model.coordinates.at(-1)
  if (start !== undefined) L.circleMarker(start, { radius: 6, color: '#166534', fillOpacity: 1 }).bindTooltip('Départ').addTo(map)
  if (end !== undefined) L.circleMarker(end, { radius: 6, color: '#991b1b', fillOpacity: 1 }).bindTooltip('Arrivée').addTo(map)
  for (const point of model.documentedPoints) L.circleMarker(point.coordinate, { radius: 4, color: point.offRoute ? '#b45309' : '#1d4ed8', dashArray: point.offRoute ? '3 2' : undefined, fillOpacity: point.offRoute ? 0 : .8 }).bindTooltip(point.name).addTo(map)
  for (const pause of model.pauses) L.circleMarker(pause.coordinate, { radius: 6, color: '#7c3aed', fillOpacity: 1 }).bindTooltip(`Pause ${pause.durationMinutes} min · ${pause.name}`).addTo(map)
  if (model.accommodation !== null) L.circleMarker(model.accommodation.coordinate, { radius: 7, color: '#7c3aed', fillOpacity: .8 }).bindTooltip(`Hébergement · ${model.accommodation.name}`).addTo(map)
  if (model.coordinates.length > 1) map.fitBounds(line.getBounds(), { padding: [12, 12] })
  return map
}

export function renderRouteMap(container: HTMLElement, dialog: HTMLDialogElement, gpx: GpxAnalysisSuccess | null, timeline: RideDayTimeline | null, report: RoadbookMatchReport | null, accommodation: Accommodation | null): void {
  destroy(container)
  if (gpx === null || timeline === null) { container.innerHTML = '<p class="route-map__fallback">Carte indisponible.</p>'; return }
  const model = buildRouteMapModel(gpx, timeline, report, accommodation)
  container.innerHTML = '<div class="route-map__canvas" data-route-map-canvas></div><p class="route-map__fallback" hidden data-route-map-fallback>Fond de carte indisponible. Le tracé reste accessible dans le profil.</p>'
  const canvas = container.querySelector<HTMLElement>('[data-route-map-canvas]') as HTMLElement; const fallback = container.querySelector<HTMLElement>('[data-route-map-fallback]') as HTMLElement
  createMap(canvas, model, false, () => { fallback.hidden = false })
  const expanded = dialog.querySelector<HTMLElement>('[data-route-map-expanded]') as HTMLElement
  const open = dialog.previousElementSibling?.querySelector<HTMLButtonElement>('[data-explore-map]')
  if (open !== null && open !== undefined) {
    const previousHandler = openHandlers.get(open)
    if (previousHandler !== undefined) open.removeEventListener('click', previousHandler)
    const handler: EventListener = () => { expanded.innerHTML = ''; createMap(expanded, model, true, () => undefined); dialog.showModal(); requestAnimationFrame(() => mapInstances.get(expanded)?.invalidateSize()) }
    openHandlers.set(open, handler)
    open.addEventListener('click', handler)
  }
}

export function closeExpandedRouteMap(dialog: HTMLDialogElement): void { const expanded = dialog.querySelector<HTMLElement>('[data-route-map-expanded]'); if (expanded !== null) destroy(expanded); dialog.close() }
