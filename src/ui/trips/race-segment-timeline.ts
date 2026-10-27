import type { RaceSegment } from '../../trip-core/model/race-segment.ts'
import type { CanonicalWaypoint } from '../../analysis/canonical-waypoints.ts'
import type { RaceCourse } from '../../analysis/race-bounds.ts'
import { analyzeRaceSegment, raceSegmentStatus } from '../../analysis/race-segments.ts'
import { RACE_SEGMENT_STYLE } from './race-segment-style.ts'
import { renderInteractionCue } from '../icons.ts'
const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
function compactSegmentStats(course: RaceCourse, segment: RaceSegment): string {
  const value = analyzeRaceSegment(course, segment)
  const length = value.distanceM === null ? '— km' : `${(value.distanceM / 1000).toFixed(1).replace('.', ',')} km`
  const gain = value.elevationGainM === null ? 'D+ —' : `+${Math.round(value.elevationGainM)} m`
  const grade = value.averageGradientPercent === null ? '— %' : `${value.averageGradientPercent.toFixed(1).replace('.', ',')} %`
  return `${length} · ${gain} · ${grade}${value.partialAltitude ? ' · altitude incomplète' : ''}`
}
export function renderRaceSegmentTimelineRow(course: RaceCourse, segment: RaceSegment, waypoint?: CanonicalWaypoint, profileHtml = ''): string {
  const style = RACE_SEGMENT_STYLE[segment.type], status = raceSegmentStatus(course, segment)
  const warning = status === 'stale' ? 'Trace modifiée · à replacer' : status === 'outside-course' ? 'Hors course' : status === 'course-stale' ? 'Limites de course à redéfinir' : ''
  const profileId = `segment-profile-${segment.id}`
  return `<li class="day-detail__timeline-row day-detail__timeline-row--major day-detail__climb-card" data-waypoint-id="${escape(waypoint?.id ?? segment.id)}" data-waypoint-kind="race-segment">
    <button type="button" class="day-detail__climb-toggle" data-action="toggle-climb-profile" data-segment-view="${escape(segment.id)}" aria-controls="${escape(profileId)}" aria-expanded="false" aria-label="Profil de ${escape(segment.name)}">
      <span class="day-detail__timeline-time-col"><span class="day-detail__timeline-time">${escape(waypoint?.clockTime ?? '—')}</span></span><span class="day-detail__timeline-body"><strong><span class="race-segment-tag race-segment--${segment.type}" aria-hidden="true">${style.letter}</span> ${escape(segment.name)}</strong>
      <span class="day-detail__timeline-meta">${compactSegmentStats(course, segment)}</span>${warning ? `<span class="race-segments__warning">${warning}</span>` : ''}
      <span class="day-detail__timeline-weather" data-waypoint-weather data-waypoint-id="${escape(waypoint?.id ?? segment.id)}" data-wind-start-km="${segment.startOffsetM / 1000}" data-wind-end-km="${segment.endOffsetM / 1000}"></span></span>${renderInteractionCue('expand')}</button><div class="day-detail__climb-profile" id="${escape(profileId)}" data-climb-profile hidden>${profileHtml}</div></li>`
}
