import type { CanonicalWaypoint } from './canonical-waypoints.ts'
import type { Climb, RideStage } from '../trip-core/index.ts'
import type { RaceCourse } from './race-bounds.ts'
import type { RaceSegment } from '../trip-core/model/race-segment.ts'
import { raceSegmentStatus } from './race-segments.ts'
import { pointAtIndexedDistance } from '../route-enrichment/segment-geometry.ts'

/** Manual segments take priority over overlapping detected climbs, including
 * nested/partial overlaps. Endpoint contact alone is not a conflict.
 * Match source chainage, never coordinates: loops remain distinct. */
export function segmentMatchesClimb(segment: RaceSegment, climb: Climb): boolean {
  const start = climb.startDistanceKm * 1000, end = climb.endDistanceKm * 1000
  const overlap = Math.max(0, Math.min(end, segment.endOffsetM) - Math.max(start, segment.startOffsetM))
  return overlap > 0 && end > start && segment.endOffsetM > segment.startOffsetM
}

export function replacedRaceClimbIds(stage: RideStage, climbs: readonly Climb[], course: RaceCourse): ReadonlySet<string> {
  const segments = (stage.raceSegments ?? []).filter(segment => raceSegmentStatus(course, segment) === 'ready')
  return new Set(climbs.filter(climb => stage.climbIds.includes(climb.id) && segments.some(segment => segmentMatchesClimb(segment, climb))).map(climb => climb.id))
}

export function routeClimbs(stage: RideStage, climbs: readonly Climb[], course: RaceCourse): readonly Climb[] {
  if(course.status==='stale')return []
  const replaced=replacedRaceClimbIds(stage,climbs,course)
  return climbs.filter(climb=>stage.climbIds.includes(climb.id)&&!replaced.has(climb.id)&&climb.endDistanceKm>0&&climb.startDistanceKm<course.indexed.lengthKm)
}

/** Count the climbs represented after consolidation, including manual Grimpeur
 * segments. Hidden detector results remain saved for filtering/recalculation. */
export function raceCourseClimbCount(stage: RideStage, climbs: readonly Climb[], course: RaceCourse): number {
  const replaced = replacedRaceClimbIds(stage, climbs, course)
  const start = (course.bounds?.startOffsetM ?? 0) / 1000
  const end = (course.bounds?.finishOffsetM ?? course.indexed.lengthKm * 1000) / 1000
  return climbs.filter(climb => stage.climbIds.includes(climb.id) && !replaced.has(climb.id)
    && climb.startDistanceKm < end && climb.endDistanceKm > start).length
    + (stage.raceSegments ?? []).filter(segment => segment.type === 'climb' && raceSegmentStatus(course, segment) === 'ready').length
}

export function consolidateRaceWaypoints(base: readonly CanonicalWaypoint[], stage: RideStage, climbs: readonly Climb[], course: RaceCourse): readonly CanonicalWaypoint[] {
  const segments = (stage.raceSegments ?? []).filter(segment => raceSegmentStatus(course, segment) === 'ready')
  if (!segments.length) return base
  const replacedClimbs = replacedRaceClimbIds(stage, climbs, course)
  // A named pass carrying that climb is the same duplicate. Keep start/end
  // and independent landmarks, and leave the underlying stored data intact.
  const retained = base.filter(point => point.kind === 'start' || point.kind === 'end'
    || point.climbId === null || !replacedClimbs.has(point.climbId))
  return [...retained, ...segments.map((segment): CanonicalWaypoint => {
    const point = pointAtIndexedDistance(course.indexed, segment.startOffsetM / 1000)
    return { id: `${stage.id}:segment:${segment.id}`, raceSegmentId: segment.id, kind: 'race-segment', importance: 'major', visibleByDefault: true,
      name: segment.name, trackDistanceKm: segment.startOffsetM / 1000, latitude: point.latitude, longitude: point.longitude, elevationM: point.altitudeM,
      climbId: null, pauseDurationMinutes: null, elapsedMinutes: null, clockTime: null }
  })].sort((a, b) => a.trackDistanceKm - b.trackDistanceKm || (a.kind === 'start' || b.kind === 'end' ? -1 : a.kind === 'end' || b.kind === 'start' ? 1 : a.id.localeCompare(b.id)))
}

/** Named summits remain geographic landmarks, independent of list consolidation. */
export function visualRaceWaypoints(points: readonly CanonicalWaypoint[], original: readonly CanonicalWaypoint[], stage: RideStage, course: RaceCourse): readonly CanonicalWaypoint[] {
  const ids = new Set(points.map(point => point.id))
  return [...points, ...original.filter(point => !ids.has(point.id) && point.climbId !== null
    && !/^(?:montée|montee|climb|côte|cote)(?:\s*\d+)?$/i.test(point.name.trim()))]
    .map(point=>{
      const segment=stage.raceSegments?.find(segment=>segment.id===point.raceSegmentId)
      if(segment===undefined)return point
      const middle=(segment.startOffsetM+segment.endOffsetM)/2000
      const position=pointAtIndexedDistance(course.indexed,middle)
      return {...point,trackDistanceKm:middle,latitude:position.latitude,longitude:position.longitude,elevationM:position.altitudeM,clockTime:null,elapsedMinutes:null}
    }).sort((a,b) => a.trackDistanceKm - b.trackDistanceKm)
}
