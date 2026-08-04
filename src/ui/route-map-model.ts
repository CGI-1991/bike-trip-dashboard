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
 * The Aperçu screen's global map (CDC Jalon B2 section 9): every stage's own
 * geometry drawn as its own disjoint line segment — an OFF/transfer day's
 * gap between two stages is simply not drawn, never a fabricated straight
 * line connecting them — with every stage's waypoints merged into one marker
 * list. Callers are expected to have already filtered each stage's
 * waypoints down to the compact-map default set (start/end/city/town/
 * mountain-pass/saddle — no villages), exactly like the single-stage Étape
 * map (CDC hardening section 19/21).
 */
export function buildGenericOverviewRouteMapModel(stages: readonly { readonly waypoints: readonly CanonicalWaypoint[]; readonly geometry: readonly LatLngTuple[] }[]): RouteMapModel {
  const withGeometry = stages.filter((stage) => stage.geometry.length > 1)
  const [first, ...rest] = withGeometry
  const markers = stages.flatMap((stage) => buildGenericRouteMapModel(stage.waypoints, stage.geometry).markers)
  return { coordinates: first?.geometry ?? [], markers, extraLines: rest.map((stage) => stage.geometry) }
}
