import type { RaceCourse } from '../../analysis/race-bounds.ts'
import type { RaceSegment, ClimbId } from '../../trip-core/index.ts'
import { analyzeRaceSegment } from '../../analysis/race-segments.ts'
import { buildClimbProfile } from '../../analysis/climb-profile.ts'
import { renderClimbProfileBar } from './mini-profile-view.ts'

export function segmentMiniProfile(course: RaceCourse, segment: RaceSegment): string {
  const value = analyzeRaceSegment(course, segment)
  if (value.geometry === null || !value.geometry.some(point => point.altitudeM !== null)) return '<p class="day-detail__climb-profile-empty">Profil altimétrique indisponible pour ce segment.</p>'
  // Reuse the same climb renderer, on the exact interpolated segment geometry.
  // Restore original GPX chainage for the keyboard/touch readout.
  const lengthKm = (segment.endOffsetM - segment.startOffsetM) / 1000
  const profile = buildClimbProfile(value.geometry, { id: segment.id as ClimbId, startDistanceKm: 0, endDistanceKm: lengthKm }, Math.max(1, Math.min(100, lengthKm * 1000 / 40)))
  const offset = segment.startOffsetM / 1000
  return renderClimbProfileBar(profile.segments.map(item => ({ ...item, startDistanceKm: item.startDistanceKm + offset, endDistanceKm: item.endDistanceKm + offset })),segment.id).replace('aria-label="Profil interactif de la montée"', 'aria-label="Profil interactif du segment"')
}
