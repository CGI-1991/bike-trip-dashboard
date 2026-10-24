import { FitBaseType as Base, FitEncoder } from 'fit-file-parser/encoder'
import type { FitEncoderField } from 'fit-file-parser/encoder'
import type { RideStage, RouteGeometryPoint, TripBundle } from '../trip-core/index.ts'
import { selectTravelMode } from '../trip-core/index.ts'
import { buildRaceCourse } from '../analysis/race-bounds.ts'
import { analyzeRaceSegment } from '../analysis/race-segments.ts'
import { computeStageTimingCurve } from '../analysis/waypoint-timeline.ts'
import { raceExportUnavailableReason } from './race-export.ts'

interface CoursePoint {
  readonly offsetM: number
  readonly point: RouteGeometryPoint
  readonly name: string
  readonly type: number
}
export interface FitCourseResult {
  readonly bytes: Uint8Array<ArrayBuffer>
  readonly warnings: readonly string[]
  readonly coursePointCount: number
  readonly recordCount: number
  readonly distanceM: number
}

// FIT Profile: file_id 0, course 31, course_point 32, lap 19, record 20,
// event 21. Explicit protocol 1.0 (0x10); only standard native fields.
const field = (number: number, size: number, baseType: Base, value: number | Uint8Array): FitEncoderField => ({ number, size, baseType, value })
const u32 = (number: number, value: number) => field(number, 4, Base.Uint32, value)
const en = (number: number, value: number) => field(number, 1, Base.Enum, value)
const pos = (number: number, degrees: number) => {
  // +180 and -180 are the same meridian. Never emit the sint32 invalid
  // sentinel 0x7fffffff when rounding a longitude very close to +180.
  let value = Math.round(degrees * (2 ** 31 / 180))
  if (value >= 0x7fffffff) value = -0x80000000
  return field(number, 4, Base.Sint32, value)
}
function text(number: number, value: string): FitEncoderField {
  // Older GPS units allocate 16 bytes for names, including the trailing NUL.
  // Truncate by UTF-8 code point, without breaking an accent or emoji.
  const bytes = new Uint8Array(16)
  let length = 0
  for (const character of value.replaceAll(/[\u0000-\u001f\u007f]/g, ' ').trim()) {
    const encoded = new TextEncoder().encode(character)
    if (length + encoded.length > 15) break
    bytes.set(encoded, length); length += encoded.length
  }
  return field(number, bytes.length, Base.String, bytes)
}
function scaled(value: number, scale: number, maximum = 0xfffffffe): number {
  const raw = Math.round(value * scale)
  if (!Number.isFinite(raw) || raw < 0 || raw > maximum) throw new Error('Ce parcours dépasse les valeurs représentables en FIT. Aucun fichier n’a été créé.')
  return raw
}

/** A Course, never a recorded Activity. Encodes the active course only, using
 * original GPX chainage for both records and explicit segment alerts. */
export async function buildFitCourse(bundle: TripBundle, stage: RideStage, createdAt = new Date()): Promise<FitCourseResult> {
  const reason = raceExportUnavailableReason(bundle, stage)
  if (reason !== null) throw new Error(reason)
  const course = buildRaceCourse(bundle, stage)!
  const route = bundle.routes.find(route => route.id === stage.sourceRouteId)!
  const startM = course.bounds?.startOffsetM ?? 0
  const finishM = course.bounds?.finishOffsetM ?? course.indexed.lengthKm * 1000
  const distanceM = finishM - startM
  const curve = computeStageTimingCurve({ stage, route, routePoints: bundle.routePoints, climbs: bundle.climbs, raceCourse: course,
    settings: { referenceSpeedKph: bundle.settings.global.referenceSpeedKph, travelMode: selectTravelMode(bundle), departureTime: '00:00' },
    manualPauses: [], automaticPausesAllowed: false })
  const durationMinutes = curve?.elapsedMinutesAt(finishM / 1000)
  if (durationMinutes == null || !Number.isFinite(durationMinutes) || durationMinutes <= 0) throw new Error('Les temps du parcours sont indisponibles. Vérifiez son allure avant l’export FIT.')
  // The course's theoretical pace starts at export time. Source GPX timestamps
  // and League dates are not recording times and are deliberately not reused.
  const startTime = FitEncoder.toFitTimestamp(createdAt)
  const timestamp = (offsetM: number) => {
    const minutes = curve?.elapsedMinutesAt(offsetM / 1000)
    if (minutes == null) throw new Error('Les temps du parcours sont incomplets. Export FIT annulé.')
    return scaled(startTime + minutes * 60, 1)
  }
  const first = course.geometry![0]!, last = course.geometry!.at(-1)!
  const warnings: string[] = []
  const points: CoursePoint[] = [{ offsetM: startM, point: first, name: 'START COURSE', type: 0 }]
  const labels = { sprint: 'SPRINT', climb: 'CLIMB', flandrien: 'FLAND' }, counts = { sprint: 0, climb: 0, flandrien: 0 }
  for (const segment of stage.raceSegments ?? []) {
    const analysis = analyzeRaceSegment(course, segment)
    const label = `${labels[segment.type]}${++counts[segment.type]}`
    for (const alert of analysis.alertPoints) points.push({ offsetM: alert.offsetM, point: alert.point,
      name: `${label} ${alert.kind === 'before' ? `${segment.alerts.beforeM}m` : alert.kind.toUpperCase()}`,
      type: alert.kind === 'start' ? 24 : alert.kind === 'end' ? 25 : segment.type === 'sprint' ? 15 : 0 })
    if (analysis.beforeOmitted) warnings.push(`${segment.name} : alerte préalable omise, départ de course trop proche.`)
  }
  points.push({ offsetM: finishM, point: last, name: 'FINISH COURSE', type: 0 })
  points.sort((a, b) => a.offsetM - b.offsetM)
  const encoder = new FitEncoder({ protocolVersion: 0x10, profileVersion: 21188 })
  // Two files created within the same second still need distinct file ids.
  // This is an application-generated id, not a Garmin hardware serial.
  const serial = crypto.getRandomValues(new Uint32Array(1))[0] || 1
  encoder.writeMessage(0, [en(0, 6), field(1, 2, Base.Uint16, 255), field(2, 2, Base.Uint16, 0),
    field(3, 4, Base.Uint32z, serial), u32(4, startTime)], 0)
  encoder.writeMessage(31, [en(4, selectTravelMode(bundle) === 'walking' ? 17 : 2), text(5, stage.customName?.trim() || 'Trip+ Course'),
    u32(6, 2 | 4 | 8 | 16 | 512)], 1)
  encoder.writeMessage(19, [u32(253, timestamp(finishM)), u32(2, startTime), pos(3, first.latitude), pos(4, first.longitude),
    pos(5, last.latitude), pos(6, last.longitude), u32(7, scaled(durationMinutes * 60, 1000)), u32(8, scaled(durationMinutes * 60, 1000)),
    u32(9, scaled(distanceM, 100))], 2)
  const timer = (time: number, type: number) => encoder.writeMessage(21, [u32(253, time), en(0, 0), en(1, type), field(4, 1, Base.Uint8, 0)], 3)
  timer(startTime, 0)
  let alertIndex = 0, recordCount = 0, altitudeOmitted = false
  const writePointsThrough = (offsetM: number) => {
    while (points[alertIndex] !== undefined && points[alertIndex]!.offsetM <= offsetM) {
      const point = points[alertIndex++]!
      encoder.writeMessage(32, [u32(1, timestamp(point.offsetM)), pos(2, point.point.latitude), pos(3, point.point.longitude),
        u32(4, scaled(point.offsetM - startM, 100)), en(5, point.type), text(6, point.name)], 5)
    }
  }
  const record = (offsetM: number, point: RouteGeometryPoint) => {
    // A missing or unrepresentable altitude uses FIT's invalid uint16, never 0.
    const altitude = point.altitudeM === null ? null : Math.round((point.altitudeM + 500) * 5)
    const usableAltitude = altitude !== null && altitude >= 0 && altitude < 0xffff
    if (altitude !== null && !usableAltitude) altitudeOmitted = true
    encoder.writeMessage(20, [u32(253, timestamp(offsetM)), pos(0, point.latitude), pos(1, point.longitude),
      field(2, 2, Base.Uint16, usableAltitude ? altitude : 0xffff), u32(5, scaled(offsetM - startM, 100))], 4)
    recordCount++
  }
  writePointsThrough(startM)
  record(startM, first)
  for (let i = 0; i < course.indexed.points.length; i++) {
    const offsetM = course.indexed.distancesKm[i]! * 1000
    if (offsetM <= startM || offsetM >= finishM) continue
    writePointsThrough(offsetM)
    record(offsetM, course.indexed.points[i]!)
    // Yield during long traces so a phone can paint the preparation status.
    if (recordCount % 2048 === 0) await new Promise(resolve => setTimeout(resolve, 0))
  }
  writePointsThrough(finishM)
  record(finishM, last)
  timer(timestamp(finishM), 4)
  if (altitudeOmitted) warnings.push('Certaines altitudes ne sont pas représentables en FIT et restent inconnues dans ce fichier.')
  return { bytes: encoder.close() as Uint8Array<ArrayBuffer>, warnings, coursePointCount: points.length, recordCount, distanceM }
}
