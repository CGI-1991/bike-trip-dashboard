import type { RideStage, TripBundle } from '../trip-core/index.ts'
import { selectOrganizationCapabilities, selectRaceMode } from '../trip-core/index.ts'
import { buildRaceCourse } from '../analysis/race-bounds.ts'
import { raceSegmentStatus } from '../analysis/race-segments.ts'

/** The same current geometry, bounds and segment checks gate both exports. */
export function raceExportUnavailableReason(bundle: TripBundle, stage: RideStage): string | null {
  if (!selectRaceMode(bundle)) return 'Choisissez League ou Tour pour exporter une course enrichie.'
  const course = buildRaceCourse(bundle, stage)
  if (course === null) return 'La trace complète est indisponible.'
  if (course.status === 'stale') return 'Redéfinissez les limites de course sur la trace actuelle.'
  if (selectOrganizationCapabilities(bundle).explicitRaceBounds && course.status !== 'bounded') return 'Définissez le départ et l’arrivée réels avant l’export.'
  if ((stage.raceSegments ?? []).some(segment => raceSegmentStatus(course, segment) !== 'ready')) return 'Replacez les segments signalés ou ajustez les limites de course avant l’export.'
  return null
}
