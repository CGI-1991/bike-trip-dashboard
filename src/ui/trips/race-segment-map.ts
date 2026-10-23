import type { RideStage, TripBundle } from '../../trip-core/index.ts'
import { buildRaceCourse } from '../../analysis/race-bounds.ts'
import { analyzeRaceSegment } from '../../analysis/race-segments.ts'
import type { RouteMapModel } from '../route-map-model.ts'
import { RACE_SEGMENT_STYLE } from './race-segment-style.ts'

export function withRaceSegmentMap(model: RouteMapModel | null, bundle: TripBundle, stage: RideStage | undefined): RouteMapModel | null {
  if (model === null || stage === undefined) return model
  const course = buildRaceCourse(bundle, stage)
  if (course === null || course.status === 'stale') return model
  const markers = [...model.markers], segmentLines = [...model.segmentLines ?? []]
  for (const segment of stage.raceSegments ?? []) {
    const analysis = analyzeRaceSegment(course, segment)
    if (analysis.geometry === null) continue
    const style = RACE_SEGMENT_STYLE[segment.type]
    const warning = analysis.status === 'outside-course' ? ' · hors course' : ''
    segmentLines.push({ color: style.color, name: `${style.label} · ${segment.name}${warning}`, dashed: analysis.status !== 'ready', coordinates: analysis.geometry.map(point => [point.latitude, point.longitude] as const) })
    for (const [label, point] of [['Début', analysis.geometry[0]!], ['Fin', analysis.geometry.at(-1)!]] as const) {
      markers.push({ id: `${segment.id}:${label}`, category: `race-${segment.type}`, name: `${label} ${style.label} · ${segment.name}${warning}`, coordinate: [point.latitude, point.longitude], offRoute: analysis.status !== 'ready', pauseActive: false })
    }
  }
  return { ...model, markers, segmentLines }
}
