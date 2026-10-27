import { DEFAULT_RACE_SEGMENT_ALERTS, selectRaceMode } from '../trip-core/index.ts'
import type { TripBundle, RideStageId, ClimbId, RaceSegment } from '../trip-core/index.ts'
import { buildRaceCourse } from './race-bounds.ts'
import { applyRaceSegmentChange, raceSegmentStatus } from './race-segments.ts'

const ENGINE = 'climb-segment-conversion@1'
export function convertedClimbId(segment: RaceSegment): string | null {
  return segment.provenance.engineVersion === ENGINE ? segment.provenance.sourceId : null
}

/** Keep the detected climb intact. Only its user-owned representation changes. */
export function convertClimbToSegment(bundle: TripBundle, stageId: RideStageId, climbId: ClimbId, id: string, fingerprint: string, now: string): TripBundle {
  if (!selectRaceMode(bundle)) throw new Error('Les segments Grimpeur sont disponibles en League et Tour.')
  const stage = bundle.stages.find(stage => stage.id === stageId)
  const climb = bundle.climbs.find(climb => climb.id === climbId && stage?.climbIds.includes(climb.id))
  const course = stage === undefined ? null : buildRaceCourse(bundle, stage)
  if (stage === undefined || climb === undefined || course === null || course.fingerprint !== fingerprint || course.status === 'stale') throw new Error('La montée ou le parcours a changé. Rouvrez cette étape.')
  if (stage.raceSegments?.some(segment => convertedClimbId(segment) === climbId)) return bundle
  const fields = { type: 'climb' as const, name: climb.name?.trim() || 'Grimpeur', startOffsetM: climb.startDistanceKm * 1000,
    endOffsetM: Math.min(climb.endDistanceKm, course.indexed.lengthKm) * 1000, alerts: DEFAULT_RACE_SEGMENT_ALERTS }
  const candidate: RaceSegment = { ...fields, id, routeFingerprint: fingerprint, provenance: climb.provenance }
  if (raceSegmentStatus(course, candidate) !== 'ready') throw new Error('La montée doit être entièrement comprise dans la course pour être convertie.')
  const updated = applyRaceSegmentChange(bundle, stageId, { kind: 'add', id, fields }, fingerprint, now)
  return { ...updated, stages: updated.stages.map(value => value.id !== stageId ? value : { ...value,
    raceSegments: value.raceSegments?.map(segment => segment.id !== id ? segment : { ...segment,
      provenance: { ...segment.provenance, sourceId: climbId, engineVersion: ENGINE } }) }) }
}

export function revertClimbSegment(bundle: TripBundle, stageId: RideStageId, id: string, fingerprint: string, now: string): TripBundle {
  const stage=bundle.stages.find(stage=>stage.id===stageId)
  const segment = stage?.raceSegments?.find(segment => segment.id === id)
  if (segment === undefined || convertedClimbId(segment) === null) throw new Error('Ce segment ne provient pas d’une conversion de montée.')
  const source=convertedClimbId(segment)
  if(!bundle.climbs.some(climb=>climb.id===source&&stage?.climbIds.includes(climb.id)))throw new Error('La détection des montées a changé. Le segment est conservé ; vous pouvez le modifier ou le supprimer depuis Course.')
  return applyRaceSegmentChange(bundle, stageId, { kind: 'delete', id }, fingerprint, now)
}
