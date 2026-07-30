import type { GpxAnalysisReport } from '../gpx/types.ts'
import type { TripDayId, TripPlan } from '../trip/types.ts'
import type { TheoreticalPosition } from '../trip/progress.ts'
import type { LatLngTuple } from './route-map-model.ts'

export type OverviewTrackState = 'past' | 'current' | 'future'

export interface OverviewMapTrack {
  readonly dayId: TripDayId
  readonly coordinates: readonly LatLngTuple[]
  readonly state: OverviewTrackState
}

export interface OverviewMapMarker {
  readonly id: string
  readonly kind: 'start' | 'finish' | 'position'
  readonly name: string
  readonly coordinate: LatLngTuple
}

export interface OverviewMapModel {
  readonly tracks: readonly OverviewMapTrack[]
  readonly markers: readonly OverviewMapMarker[]
}

function trackState(dayNumber: number, currentDayNumber: number | null): OverviewTrackState {
  if (currentDayNumber === null) return 'future'
  if (dayNumber < currentDayNumber) return 'past'
  if (dayNumber === currentDayNumber) return 'current'
  return 'future'
}

/**
 * Merges the real GPX tracks of every ride day into one dataset for the
 * Aperçu overview map — no practical KML layers, no roadbook points, only
 * the tracks themselves plus the departure/arrival markers and the current
 * theoretical position. Days whose GPX failed to parse are simply absent
 * (no fabricated line), never rendered as a fake straight segment.
 */
export function buildOverviewMapModel(
  plan: TripPlan,
  gpxReport: GpxAnalysisReport | null,
  currentDayId: TripDayId | null,
  position: TheoreticalPosition | null,
): OverviewMapModel {
  const currentDayNumber = currentDayId === null ? null : plan.days.find(({ id }) => id === currentDayId)?.dayNumber ?? null
  const rideDays = plan.days.filter((day) => day.type === 'ride')
  const tracks: OverviewMapTrack[] = []
  const markers: OverviewMapMarker[] = []
  let departureMarked = false

  for (const day of rideDays) {
    const file = gpxReport?.files.find((entry) => entry.status === 'success' && entry.source.fileName === day.gpxFile)
    const success = file?.status === 'success' ? file : null
    if (success === null) continue
    const coordinates = success.segments.flatMap(({ points }) => points.map(({ latitude, longitude }): LatLngTuple => [latitude, longitude]))
    if (coordinates.length < 2) continue
    const firstCoordinate = coordinates[0] as LatLngTuple
    const lastCoordinate = coordinates[coordinates.length - 1] as LatLngTuple

    tracks.push({ dayId: day.id, coordinates, state: trackState(day.dayNumber, currentDayNumber) })

    if (!departureMarked) {
      markers.push({ id: 'overview-start', kind: 'start', name: `Départ général · ${day.startName}`, coordinate: firstCoordinate })
      departureMarked = true
    }
    markers.push({ id: `overview-finish-${day.id}`, kind: 'finish', name: `${day.id} · ${day.endName}`, coordinate: lastCoordinate })
  }

  if (position !== null) {
    markers.push({ id: 'overview-position', kind: 'position', name: 'Position théorique', coordinate: [position.latitude, position.longitude] })
  }

  return { tracks, markers }
}
