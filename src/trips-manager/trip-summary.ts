/**
 * Pure projection of a stored `TripBundle` into the "Mes voyages" list row
 * (CDC phase 6C1 section 6): name, dates, day/stage counts, total
 * distance, status. No IndexedDB access here — see `trip-manager-actions.ts`
 * for the IO that loads the bundles this reads.
 */

import type { IsoDate, TripBundle, TripId, TripStatus } from '../trip-core/index.ts'
import { countCalendarDays } from '../analysis/day-location-fill.ts'

export interface TripListEntry {
  readonly id: TripId
  readonly name: string
  readonly slug: string
  readonly startDate: IsoDate | null
  readonly endDate: IsoDate | null
  readonly dayCount: number
  readonly stageCount: number
  readonly totalDistanceKm: number
  readonly status: TripStatus
}

export function summarizeTripBundle(bundle: TripBundle): TripListEntry {
  return {
    id: bundle.metadata.id,
    name: bundle.metadata.name,
    slug: bundle.metadata.slug,
    startDate: bundle.metadata.startDate,
    endDate: bundle.metadata.endDate,
    dayCount: countCalendarDays(bundle.days),
    stageCount: bundle.stages.length,
    totalDistanceKm: bundle.stages.reduce((total, stage) => total + (stage.distanceKm ?? 0), 0),
    status: bundle.metadata.status,
  }
}
