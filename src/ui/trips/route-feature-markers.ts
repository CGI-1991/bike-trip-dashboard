import type { CanonicalWaypoint } from '../../analysis/canonical-waypoints.ts'
import type { Climb, RaceSegment } from '../../trip-core/index.ts'
import type { RaceCourse } from '../../analysis/race-bounds.ts'
import { analyzeRaceSegment, raceSegmentStatus } from '../../analysis/race-segments.ts'
import type { RouteMapModel } from '../route-map-model.ts'
import { renderRouteFeaturePopup } from '../route-feature-popup.ts'
import { RACE_SEGMENT_STYLE } from './race-segment-style.ts'
import { pointAtIndexedDistance } from '../../route-enrichment/segment-geometry.ts'

/** Uses exactly the retained timeline points: suppressed climbs never reappear. */
export function withRouteFeatureMarkers(model: RouteMapModel, waypoints: readonly CanonicalWaypoint[], climbs: readonly Climb[], course: RaceCourse, segments: readonly RaceSegment[]): RouteMapModel {
  if (course.status === 'stale') return model
  const pointsById = new Map(waypoints.map(point => [point.id, point]))
  const climbsById = new Map(climbs.map(climb => [climb.id, climb]))
  const markers = model.markers.map(marker => {
    const climbId = pointsById.get(marker.id)?.climbId
    const climb = climbId === null || climbId === undefined ? undefined : climbsById.get(climbId)
    return climb === undefined ? marker : { ...marker, popupHtml: renderRouteFeaturePopup(marker.name, 'Montée', climb.endDistanceKm - climb.startDistanceKm, climb.elevationGainM, climb.averageGradientPercent) }
  })
  for (const point of waypoints) {
    if (point.raceSegmentId === undefined) continue
    const segment = segments.find(segment => segment.id === point.raceSegmentId)
    if (segment === undefined || raceSegmentStatus(course, segment) !== 'ready') continue
    const analysis = analyzeRaceSegment(course, segment)
    const middle=pointAtIndexedDistance(course.indexed,(segment.startOffsetM+segment.endOffsetM)/2000)
    markers.push({ id: point.id, category: `race-${segment.type}`, name: point.name, coordinate: [middle.latitude, middle.longitude],
      offRoute: false, pauseActive: false,
      popupHtml: renderRouteFeaturePopup(point.name, RACE_SEGMENT_STYLE[segment.type].label, analysis.distanceM === null ? null : analysis.distanceM / 1000,
        analysis.partialAltitude ? null : analysis.elevationGainM, analysis.averageGradientPercent, analysis.partialAltitude) })
  }
  return { ...model, markers }
}
