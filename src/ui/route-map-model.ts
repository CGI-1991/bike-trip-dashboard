import type { GpxAnalysisSuccess } from '../gpx/types.ts'
import type { Accommodation } from '../trip/accommodations.ts'
import { resolveArrivalDisplay, resolveDepartureDisplay } from '../trip/endpoint-display.ts'
import type { RoadbookMatchReport, RoadbookPointMatch } from '../trip/roadbook-match.ts'
import type { RideDayTimeline } from '../trip/types.ts'
import { getRouteMarkerCategory } from './route-marker-style.ts'
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
