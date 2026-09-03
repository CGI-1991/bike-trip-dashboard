/**
 * Pure projection of a stored `TripBundle` into the "Mes voyages" list row
 * (CDC phase 6C1 section 6): name, dates, day/stage counts, total
 * distance, status. No IndexedDB access here — see `trip-manager-actions.ts`
 * for the IO that loads the bundles this reads.
 */

import type { IsoDate, TripBundle, TripId, TripStatus } from '../trip-core/index.ts'
import { countCalendarDays } from '../analysis/day-location-fill.ts'
import type { StagePreparationContext, TripPreparationSummary } from './stage-preparation.ts'
import { computeTripPreparationSummary, NO_STAGE_PREPARATION_CONTEXT } from './stage-preparation.ts'

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
  /**
   * RC2 final-closeout sections 19-20 — the "Mes voyages" card's own
   * discreet enrichment indicator: `null` once every ride day is ready (or
   * the trip has no ride day at all), otherwise a ready/total count. Omitted
   * `preparationContext` (most callers — anything that isn't rendering the
   * list itself, e.g. `selectMostRelevantTrip`'s own bookkeeping) always
   * yields `null` here, never a stale/misleading count.
   */
  readonly preparationSummary: TripPreparationSummary | null
}

export function summarizeTripBundle(bundle: TripBundle, preparationContext: StagePreparationContext = NO_STAGE_PREPARATION_CONTEXT): TripListEntry {
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
    preparationSummary: computeTripPreparationSummary(bundle, preparationContext),
  }
}
