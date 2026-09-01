import type { GpxAnalysisSuccess } from '../gpx/types.ts'
import type { CanonicalWaypoint } from '../analysis/canonical-waypoints.ts'
import type { Accommodation } from '../trip/accommodations.ts'
import { resolveArrivalDisplay, resolveDepartureDisplay } from '../trip/endpoint-display.ts'
import type { RoadbookMatchReport, RoadbookPointMatch } from '../trip/roadbook-match.ts'
import type { RideDayTimeline } from '../trip/types.ts'
import { getGenericRouteMarkerCategory, getRouteMarkerCategory } from './route-marker-style.ts'
import type { RouteMarkerCategory } from './route-marker-style.ts'

/**
 * Leaflet-free data shaping for the route map, kept in its own module so it
 * stays unit-testable under plain Node (importing `route-map.ts` itself pulls
 * in Leaflet's CSS, which only works inside a bundler).
 */
export type LatLngTuple = readonly [number, number]

export interface RouteMapMarkerModel {
  readonly id: string
  readonly category: RouteMarkerCategory
  readonly name: string
  readonly subLabel?: string
  readonly coordinate: LatLngTuple
  readonly offRoute: boolean
  readonly pauseActive: boolean
  readonly pauseDurationMinutes?: number
  /**
   * Rich popup content, opened on click — distinct from the plain hover
   * `subLabel`/tooltip every other marker already carries. Only an opt-in
   * layer's own marker builder sets this; every structural marker leaves it
   * `undefined`, so `installMapLayerPanel` only ever binds a Leaflet popup
   * for the markers that actually have one.
   */
  readonly popupHtml?: string
}

export interface RouteMapModel {
  readonly coordinates: readonly LatLngTuple[]
  readonly markers: readonly RouteMapMarkerModel[]
  /**
   * Extra, geographically-disjoint line segments (e.g. the Aperçu global map,
   * one segment per stage — an OFF/transfer day's gap must never be drawn as
   * a fabricated straight line between two stages). When present, the map
   * renderer draws one polyline per segment instead of a single continuous
   * line through `coordinates`; `coordinates` itself still drives the
   * fit-bounds computation and stays the first drawn segment for single-route
   * callers (RGA, the Étape screen), so neither needs to change.
   */
  readonly extraLines?: readonly (readonly LatLngTuple[])[]
}

export function routeMapHasContent(model: RouteMapModel | null): model is RouteMapModel {
  return model !== null && (
    model.markers.length > 0 ||
    model.coordinates.length > 1 ||
    (model.extraLines ?? []).some((line) => line.length > 1)
  )
}

function pointCoordinate(point: RoadbookPointMatch): LatLngTuple | null {
  const latitude = point.sourceLatitude ?? point.matchedLatitude
  const longitude = point.sourceLongitude ?? point.matchedLongitude
  return latitude === undefined || longitude === undefined ? null : [latitude, longitude]
}

export function buildRouteMapModel(gpx: GpxAnalysisSuccess, timeline: RideDayTimeline, report: RoadbookMatchReport | null, accommodation: Accommodation | null): RouteMapModel {
  const coordinates = gpx.segments.flatMap(({ points }) => points.map(({ latitude, longitude }) => [latitude, longitude] as LatLngTuple))
  const dayReport = report?.days.find((day) => day.dayId === timeline.day.id)
  const dayPoints = dayReport?.type === 'ride' ? dayReport.points : []
  // A pause is matched strictly by the documented point's own roadbook id
  // (`RoutePause.pointId`), never by nearest-waypoint proximity — the pause
  // never gets a position, marker or tooltip separate from its point's own.
  const pauseByPointId = new Map(timeline.route.pauses.flatMap((pause) => pause.pointId === undefined ? [] : [[pause.pointId, pause] as const]))
  const markers: RouteMapMarkerModel[] = []

  // Start/finish markers render from the GPX endpoints even when the roadbook
  // report is unavailable — the precise merged label just falls back to a
  // generic one so the map keeps its extremities instead of disappearing.
  const startPoint = dayPoints.find(({ type }) => type === 'start')
  const startCoordinate = (startPoint === undefined ? null : pointCoordinate(startPoint)) ?? coordinates[0] ?? null
  if (startCoordinate !== null) {
    const display = dayReport?.type === 'ride' ? resolveDepartureDisplay(dayReport.roadbook) : { primaryName: 'Départ', subLabel: undefined, merged: false }
    const pause = startPoint === undefined ? undefined : pauseByPointId.get(startPoint.id)
    markers.push({ id: `${timeline.day.id}-start`, category: 'start', name: display.primaryName, subLabel: display.subLabel, coordinate: startCoordinate, offRoute: false, pauseActive: pause !== undefined, ...(pause === undefined ? {} : { pauseDurationMinutes: pause.durationMinutes }) })
  }

  const endPoint = dayPoints.find(({ type }) => type === 'end')
  const endCoordinate = (endPoint === undefined ? null : pointCoordinate(endPoint)) ?? coordinates.at(-1) ?? null
  if (endCoordinate !== null) {
    const display = dayReport?.type === 'ride' ? resolveArrivalDisplay(dayReport.roadbook, accommodation) : { primaryName: 'Arrivée', subLabel: undefined, merged: false }
    const pause = endPoint === undefined ? undefined : pauseByPointId.get(endPoint.id)
    markers.push({ id: `${timeline.day.id}-finish`, category: 'finish', name: display.primaryName, subLabel: display.subLabel, coordinate: endCoordinate, offRoute: false, pauseActive: pause !== undefined, ...(pause === undefined ? {} : { pauseDurationMinutes: pause.durationMinutes }) })
    // An accommodation only gets its own marker when it was NOT confirmed close enough
    // to merge into the arrival card, and it has real coordinates of its own — never a
    // fabricated position for one that is neither merged nor independently located.
    if (!display.merged && accommodation !== null && accommodation.latitude !== undefined && accommodation.longitude !== undefined) {
      markers.push({ id: `${timeline.day.id}-lodging`, category: 'passage', name: `Hébergement · ${accommodation.name}`, coordinate: [accommodation.latitude, accommodation.longitude], offRoute: false, pauseActive: false })
    }
  }

  for (const point of dayPoints) {
    if (point.type === 'start' || point.type === 'end') continue
    const coordinate = pointCoordinate(point)
    if (coordinate === null) continue
    const pause = pauseByPointId.get(point.id)
    markers.push({
      id: point.id,
      category: getRouteMarkerCategory(point),
      name: point.name,
      coordinate,
      offRoute: point.resolution !== 'matched',
      pauseActive: pause !== undefined,
      ...(pause === undefined ? {} : { pauseDurationMinutes: pause.durationMinutes }),
    })
  }

  return { coordinates, markers }
}

/**
 * Generic counterpart of `buildRouteMapModel` for the TripBundle pipeline:
 * builds the same already-generic `RouteMapModel`/`RouteMapMarkerModel`
 * shape from `CanonicalWaypoint[]` (`analysis/canonical-waypoints.ts`)
 * instead of RGA-shaped GPX/timeline/report/accommodation inputs. Callers
 * decide which waypoints to include (e.g. filtering out hidden-by-default
 * hamlets) before calling this — it performs no visibility filtering of
 * its own.
 */
export function buildGenericRouteMapModel(waypoints: readonly CanonicalWaypoint[], geometry: readonly LatLngTuple[]): RouteMapModel {
  const markers: RouteMapMarkerModel[] = waypoints.map((waypoint) => ({
    id: waypoint.id,
    category: getGenericRouteMarkerCategory(waypoint.kind),
    name: waypoint.name,
    subLabel: waypoint.elevationM === null ? undefined : `${Math.round(waypoint.elevationM)} m`,
    coordinate: [waypoint.latitude, waypoint.longitude],
    offRoute: false,
    pauseActive: waypoint.pauseDurationMinutes !== null,
    ...(waypoint.pauseDurationMinutes === null ? {} : { pauseDurationMinutes: waypoint.pauseDurationMinutes }),
  }))
  return { coordinates: geometry, markers }
}

/**
 * Same-location dedup (CDC D1.1 section 1): when a stage's arrival and the
 * next stage's departure share the same name/coordinates (within ~11 m —
 * four decimal degrees), only the first drawn marker survives. Applied
 * within one bucket of markers at a time (principal vs. detail) — never
 * across the two, which stay visually and semantically distinct layers.
 */
function dedupeMarkersByLocation(markers: readonly RouteMapMarkerModel[]): RouteMapMarkerModel[] {
  const seen = new Set<string>()
  return markers.filter((marker) => {
    const locationKey = `${marker.name.trim().toLocaleLowerCase()}|${marker.coordinate[0].toFixed(4)}|${marker.coordinate[1].toFixed(4)}`
    if (seen.has(locationKey)) return false
    seen.add(locationKey)
    return true
  })
}

/**
 * The Aperçu screen's global map (CDC D1.1 section 1): the FULL ridden GPX
 * trace for every stage, each drawn as its own disjoint line segment — an
 * OFF/transfer day's gap between two stages is simply not drawn, never a
 * fabricated straight line connecting them. Markers stay deliberately
 * separate from the Étape map's own richer graphic language: every waypoint
 * passed in becomes a plain, un-iconified `overview-primary` point (no
 * Départ/Arrivée symbol) — callers are expected to have already filtered
 * each stage's waypoints down to just its principal points (start/end), so
 * in practice none of them ever carry `col-summit` here; the guard below
 * exists only so this function stays correct if a caller's own filtering
 * ever changes, matching `buildGenericOverviewDetailMarkers` below.
 */
export function buildGenericOverviewRouteMapModel(stages: readonly { readonly waypoints: readonly CanonicalWaypoint[]; readonly geometry: readonly LatLngTuple[] }[]): RouteMapModel {
  const withGeometry = stages.filter((stage) => stage.geometry.length > 1)
  const [first, ...rest] = withGeometry
  const markers = dedupeMarkersByLocation(
    stages
      .flatMap((stage) => buildGenericRouteMapModel(stage.waypoints, stage.geometry).markers)
      .map((marker) => ({ ...marker, category: marker.category === 'col-summit' ? 'col-summit' as const : 'overview-primary' as const })),
  )
  return { coordinates: first?.geometry ?? [], markers, extraLines: rest.map((stage) => stage.geometry) }
}

/**
 * The Aperçu global map's fullscreen-only "Détail" layer (CDC D1.1 section
 * 3): significant intermediate waypoints (pauses, cols nommés — already
 * computed by the caller, see `trip-overview-view.ts::isOverviewDetailWaypoint`).
 * Jalon C2.5 section 58: a named mountain-pass/saddle waypoint keeps the
 * exact `col-summit` diamond/orange marker already used on the Étape map
 * (`buildGenericRouteMapModel` already assigns it correctly — this used to
 * unconditionally overwrite it) instead of the plain `overview-secondary`
 * dot every other detail point (pauses, localities) still gets. A named col
 * is by construction always genuinely named (the route-enrichment pipeline
 * only ever creates a `mountain-pass`/`saddle` `RoutePoint` when it has an
 * OSM name — `route-enrichment/enrichment.ts`), so no anonymous summit or
 * secondary climb can ever reach this branch.
 */
export function buildGenericOverviewDetailMarkers(stages: readonly { readonly waypoints: readonly CanonicalWaypoint[] }[]): readonly RouteMapMarkerModel[] {
  return dedupeMarkersByLocation(
    stages
      .flatMap((stage) => buildGenericRouteMapModel(stage.waypoints, []).markers)
      .map((marker) => ({ ...marker, category: marker.category === 'col-summit' ? 'col-summit' as const : 'overview-secondary' as const })),
  )
}
