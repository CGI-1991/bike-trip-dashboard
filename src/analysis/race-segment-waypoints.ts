import type { CanonicalWaypoint } from './canonical-waypoints.ts'
import type { Climb, RideStage } from '../trip-core/index.ts'
import type { RaceCourse } from './race-bounds.ts'
import type { RaceSegment } from '../trip-core/model/race-segment.ts'
import { raceSegmentStatus } from './race-segments.ts'
import { pointAtIndexedDistance } from '../route-enrichment/segment-geometry.ts'

/** Require comparable extents. A short sprint inside a long climb is no match.
 * 80% mutual coverage, or both endpoints within 150 m and 60% climb coverage.
 * All matching is by source chainage: loops/identical coordinates are safe. */
export function segmentMatchesClimb(segment: RaceSegment, climb: Climb): boolean {
  const start = climb.startDistanceKm * 1000, end = climb.endDistanceKm * 1000
  const overlap = Math.max(0, Math.min(end, segment.endOffsetM) - Math.max(start, segment.startOffsetM))
  const climbLength = end - start, segmentLength = segment.endOffsetM - segment.startOffsetM
  if (overlap <= 0 || climbLength <= 0 || segmentLength <= 0) return false
  return (overlap / climbLength >= .8 && overlap / segmentLength >= .8)
    || (Math.abs(segment.startOffsetM - start) <= 150 && Math.abs(segment.endOffsetM - end) <= 150 && overlap / climbLength >= .6 && overlap / segmentLength >= .6)
}

export function consolidateRaceWaypoints(base: readonly CanonicalWaypoint[], stage: RideStage, climbs: readonly Climb[], course: RaceCourse): readonly CanonicalWaypoint[] {
  const segments = (stage.raceSegments ?? []).filter(segment => raceSegmentStatus(course, segment) === 'ready')
  if (!segments.length) return base
  const replacedClimbs = new Set(climbs.filter(climb => stage.climbIds.includes(climb.id) && segments.some(segment => segmentMatchesClimb(segment, climb))).map(climb => climb.id))
  // Named passes remain landmarks, without a second automatic climb card.
  const retained = base.flatMap(point => point.climbId === null || !replacedClimbs.has(point.climbId) ? [point]
    : point.kind === 'climb' ? [] : [{ ...point, climbId: null }])
  return [...retained, ...segments.map((segment): CanonicalWaypoint => {
    const point = pointAtIndexedDistance(course.indexed, segment.startOffsetM / 1000)
    return { id: `${stage.id}:segment:${segment.id}`, raceSegmentId: segment.id, kind: 'race-segment', importance: 'major', visibleByDefault: true,
      name: segment.name, trackDistanceKm: segment.startOffsetM / 1000, latitude: point.latitude, longitude: point.longitude, elevationM: point.altitudeM,
      climbId: null, pauseDurationMinutes: null, elapsedMinutes: null, clockTime: null }
  })].sort((a, b) => a.trackDistanceKm - b.trackDistanceKm || (a.kind === 'start' || b.kind === 'end' ? -1 : a.kind === 'end' || b.kind === 'start' ? 1 : a.id.localeCompare(b.id)))
}
