import type { RaceSegment } from '../../trip-core/model/race-segment.ts'
import type { CanonicalWaypoint } from '../../analysis/canonical-waypoints.ts'
import type { RaceCourse } from '../../analysis/race-bounds.ts'
import { raceSegmentStatus } from '../../analysis/race-segments.ts'
import { segmentStats } from './race-segments-view.ts'
import { RACE_SEGMENT_STYLE } from './race-segment-style.ts'
const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
const km = (m: number) => (m / 1000).toFixed(1).replace('.', ',')
export function renderRaceSegmentTimelineRow(course: RaceCourse, segment: RaceSegment, waypoint?: CanonicalWaypoint): string {
  const style = RACE_SEGMENT_STYLE[segment.type], status = raceSegmentStatus(course, segment)
  const warning = status === 'stale' ? 'Trace modifiée · à replacer' : status === 'outside-course' ? 'Hors course' : status === 'course-stale' ? 'Limites de course à redéfinir' : ''
  return `<li class="day-detail__timeline-row day-detail__timeline-row--major" data-waypoint-id="${escape(waypoint?.id ?? segment.id)}" data-waypoint-kind="race-segment">
    <button type="button" class="day-detail__climb-toggle" data-segment-edit="${escape(segment.id)}" aria-label="Modifier ${escape(segment.name)}">
      <span class="day-detail__timeline-time">${escape(waypoint?.clockTime ?? '—')}</span><span class="day-detail__timeline-body"><strong><span class="race-segment-tag race-segment--${segment.type}" aria-hidden="true">${style.letter}</span> ${escape(segment.name)}</strong>
      <span class="day-detail__timeline-meta">${style.label} · km ${km(segment.startOffsetM)} → ${km(segment.endOffsetM)} · ${segmentStats(course, segment)}</span>${warning ? `<span class="race-segments__warning">${warning}</span>` : ''}
      <span class="day-detail__timeline-weather" data-waypoint-weather data-waypoint-id="${escape(waypoint?.id ?? segment.id)}"></span></span></button></li>`
}
