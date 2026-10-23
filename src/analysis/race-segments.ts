import type { RaceSegment, RaceSegmentFields, RideStageId, RouteGeometryPoint, TripBundle } from '../trip-core/index.ts'
import { buildRaceCourse, raceCourseMetrics } from './race-bounds.ts'
import type { RaceCourse } from './race-bounds.ts'
import { isValidRaceSegmentFields } from '../trip-core/validation/race-segment.ts'
import { pointAtIndexedDistance, sliceRouteGeometry } from '../route-enrichment/segment-geometry.ts'
import { projectOnSegment } from '../route/route-proximity.ts'

export type RaceSegmentStatus = 'ready' | 'outside-course' | 'stale' | 'course-stale'
export interface RaceSegmentAnalysis {
  readonly status: RaceSegmentStatus
  readonly geometry: readonly RouteGeometryPoint[] | null
  readonly distanceM: number | null
  readonly elevationGainM: number | null
  readonly averageGradientPercent: number | null
  readonly partialAltitude: boolean
  readonly beforeOmitted: boolean
  /** Prepared export points only; this module never sends notifications. */
  readonly alertPoints: readonly { readonly kind: 'before' | 'start' | 'end'; readonly offsetM: number; readonly point: RouteGeometryPoint }[]
}
const analyses = new WeakMap<RaceSegment, WeakMap<RaceCourse, RaceSegmentAnalysis>>()

export function raceSegmentStatus(course: RaceCourse, segment: RaceSegment): RaceSegmentStatus {
  if (segment.routeFingerprint !== course.fingerprint || segment.endOffsetM > course.indexed.lengthKm * 1000 + .001) return 'stale'
  if (course.status === 'stale') return 'course-stale'
  return segment.startOffsetM < (course.bounds?.startOffsetM ?? 0) || segment.endOffsetM > (course.bounds?.finishOffsetM ?? course.indexed.lengthKm * 1000) ? 'outside-course' : 'ready'
}

export function analyzeRaceSegment(course: RaceCourse, segment: RaceSegment): RaceSegmentAnalysis {
  const cached = analyses.get(segment)?.get(course)
  if (cached !== undefined) return cached
  const status = raceSegmentStatus(course, segment)
  const geometry = status === 'stale' ? null : sliceRouteGeometry(course.indexed, segment.startOffsetM / 1000, segment.endOffsetM / 1000)
  const length = segment.endOffsetM - segment.startOffsetM
  const first = geometry?.[0], last = geometry?.at(-1)
  const alerts: RaceSegmentAnalysis['alertPoints'][number][] = []
  const before = segment.startOffsetM - segment.alerts.beforeM
  const beforeOmitted = status === 'ready' && segment.alerts.beforeEnabled && before < (course.bounds?.startOffsetM ?? 0)
  const add = (kind: 'before' | 'start' | 'end', offsetM: number) => alerts.push({ kind, offsetM,
    point: pointAtIndexedDistance(course.indexed, offsetM / 1000) })
  if (status === 'ready') {
    if (segment.alerts.beforeEnabled && !beforeOmitted && (segment.alerts.beforeM > 0 || !segment.alerts.atStart)) add('before', before)
    if (segment.alerts.atStart) add('start', segment.startOffsetM)
    if (segment.alerts.atEnd) add('end', segment.endOffsetM)
  }
  const result: RaceSegmentAnalysis = { status, geometry, distanceM: geometry === null ? null : length,
    elevationGainM: geometry === null ? null : raceCourseMetrics(geometry).elevationGainM,
    averageGradientPercent: first?.altitudeM == null || last?.altitudeM == null ? null : (last.altitudeM - first.altitudeM) / length * 100,
    partialAltitude: geometry?.some(point => point.altitudeM === null) ?? false, beforeOmitted, alertPoints: alerts }
  let byCourse = analyses.get(segment)
  if (byCourse === undefined) { byCourse = new WeakMap(); analyses.set(segment, byCourse) }
  byCourse.set(course, result)
  return result
}

export type RaceSegmentChange = { readonly kind: 'add' | 'edit'; readonly id: string; readonly fields: RaceSegmentFields }
  | { readonly kind: 'delete'; readonly id: string }

/** Synchronous mutation intended for the repository's latest-value transaction. */
export function applyRaceSegmentChange(bundle: TripBundle, stageId: RideStageId, change: RaceSegmentChange, expectedFingerprint: string, now: string): TripBundle {
  const stage = bundle.stages.find(stage => stage.id === stageId)
  const course = stage === undefined ? null : buildRaceCourse(bundle, stage)
  if (stage === undefined || course === null || course.fingerprint !== expectedFingerprint) throw new Error('Le parcours a changé. Rouvrez la course avant de modifier ses segments.')
  const segments = stage.raceSegments ?? []
  const previous = segments.find(segment => segment.id === change.id)
  if (change.kind !== 'add' && previous === undefined) throw new Error('Ce segment a été supprimé. Rouvrez la course.')
  if (change.kind === 'add' && bundle.stages.some(stage => stage.raceSegments?.some(segment => segment.id === change.id))) throw new Error('Identifiant de segment déjà utilisé.')
  let next: readonly RaceSegment[]
  if (change.kind === 'delete') next = segments.filter(segment => segment.id !== change.id)
  else {
    if (!isValidRaceSegmentFields(change.fields)) throw new Error('Indiquez un nom, un type et des limites de segment valides.')
    const fields = { ...change.fields, name: change.fields.name.trim() }
    if (course.status === 'stale') throw new Error('Redéfinissez d’abord les limites de course.')
    if (!change.id.trim() || !isValidRaceSegmentFields(fields) || fields.endOffsetM > course.indexed.lengthKm * 1000 + .001) throw new Error('Indiquez un nom, un type et un début avant la fin, dans la trace GPX.')
    const segment: RaceSegment = { ...fields, alerts: { ...fields.alerts }, id: change.id, routeFingerprint: course.fingerprint,
      provenance: previous === undefined ? { sourceType: 'user', sourceId: null, fetchedAt: null, engineVersion: 'race-segments@1', confidence: 'high', manuallyOverridden: true }
        : { ...previous.provenance, manuallyOverridden: true } }
    next = change.kind === 'add' ? [...segments, segment] : segments.map(value => value.id === change.id ? segment : value)
  }
  return { ...bundle, metadata: { ...bundle.metadata, updatedAt: now }, stages: bundle.stages.map(value => value.id === stageId ? { ...value, raceSegments: next } : value) }
}

export interface RaceProjection { readonly offsetM: number; readonly lateralM: number }
/** Local minima preserve distinct passes at loops and nearby parallel roads.
 * Adjacent segments projecting to the same vertex collapse by chainage only. */
export function projectRacePosition(course: RaceCourse, point: Pick<RouteGeometryPoint, 'latitude' | 'longitude'>, maximumLateralM = 75): readonly RaceProjection[] {
  const { points, distancesKm } = course.indexed
  const projected: RaceProjection[] = []
  let minimum = Infinity
  for (let i = 1; i < points.length; i++) {
    const value = projectOnSegment(point, points[i - 1]!, points[i]!)
    minimum = Math.min(minimum, value.distanceMeters)
    projected.push({ offsetM: ((distancesKm[i - 1] ?? 0) + ((distancesKm[i] ?? 0) - (distancesKm[i - 1] ?? 0)) * value.ratio) * 1000, lateralM: value.distanceMeters })
  }
  if (minimum > maximumLateralM || !Number.isFinite(minimum)) return []
  const candidates = projected.filter((value, i) => value.lateralM <= Math.min(maximumLateralM, minimum + 10)
    && value.lateralM <= (projected[i - 1]?.lateralM ?? Infinity) + 1e-7
    && value.lateralM <= (projected[i + 1]?.lateralM ?? Infinity) + 1e-7)
  return candidates.filter((value, i) => i === 0 || Math.abs(value.offsetM - candidates[i - 1]!.offsetM) > .001)
}

/** Lowest available row; shared endpoints may share a row, overlaps never do. */
export function raceSegmentLanes(segments: readonly RaceSegment[]): readonly { readonly segment: RaceSegment; readonly lane: number }[] {
  const ends: number[] = []
  return [...segments].sort((a, b) => a.startOffsetM - b.startOffsetM || a.endOffsetM - b.endOffsetM || a.id.localeCompare(b.id)).map(segment => {
    let lane = ends.findIndex(end => end <= segment.startOffsetM)
    if (lane < 0) lane = ends.length
    ends[lane] = segment.endOffsetM
    return { segment, lane }
  })
}
