import { applyRaceBounds } from '../analysis/race-bounds.ts'
import type { RaceBounds } from '../trip-core/model/ride-stage.ts'
import type { RideStageId, TripBundle } from '../trip-core/index.ts'
import { resolveLinkedScheduleConflicts } from './linked-stages.ts'
import type { LinkedScheduleResult } from './linked-stages.ts'

/** Pure mutation for updateTripBundle: bounds, linked departures and weather
 * invalidation commit together, against the latest persisted trip. */
export function updateRaceCourse(bundle: TripBundle, stageId: RideStageId, bounds: RaceBounds | null, expectedFingerprint: string, updatedAt: string): LinkedScheduleResult {
  const next = applyRaceBounds(bundle, stageId, bounds, expectedFingerprint, updatedAt)
  const result = resolveLinkedScheduleConflicts(next)
  if (result.adjustments.length === 0) return result
  const changedDays = new Set(result.adjustments.map(change => change.dayId))
  return { ...result, bundle: { ...result.bundle,
    weather: result.bundle.weather.filter(record => !changedDays.has(record.dayId)),
    stages: result.bundle.stages.map(stage => changedDays.has(stage.dayId) ? { ...stage, weatherRecordIds: [] } : stage),
  } }
}
