/**
 * Pure "most relevant trip" selection (annexe fonctionnelle section 15.1,
 * CDC phase 6C1 section 25). The current date is always injected — never
 * `Date.now()`/`new Date()` here — so this stays deterministic and
 * testable. Not wired into the historical RGA bootstrap (CDC section 25:
 * "ne branche pas encore... si cela crée une régression").
 */

import type { IsoDate, TripId } from '../trip-core/index.ts'

export interface TripSelectionCandidate {
  readonly id: TripId
  readonly startDate: IsoDate | null
  readonly endDate: IsoDate | null
}

function isInProgress(trip: TripSelectionCandidate, todayIso: string): boolean {
  return trip.startDate !== null && trip.endDate !== null && trip.startDate <= todayIso && todayIso <= trip.endDate
}

function isUpcoming(trip: TripSelectionCandidate, todayIso: string): boolean {
  return trip.startDate !== null && trip.startDate > todayIso
}

/** Deterministic tie-break: earliest `startDate` first, then `id` — never insertion order alone. */
function byStartDateThenId(left: TripSelectionCandidate, right: TripSelectionCandidate): number {
  const leftDate = left.startDate ?? ''
  const rightDate = right.startDate ?? ''
  return leftDate < rightDate ? -1 : leftDate > rightDate ? 1 : left.id < right.id ? -1 : left.id > right.id ? 1 : 0
}

/**
 * 1. a trip currently in progress (`startDate <= today <= endDate`);
 * 2. else the nearest upcoming trip (`startDate > today`, smallest `startDate`);
 * 3. else `lastActiveTripId`, only if it still refers to one of `trips`;
 * 4. else `null` — no automatic choice, the caller shows the list instead.
 */
export function selectMostRelevantTrip(
  trips: readonly TripSelectionCandidate[],
  today: IsoDate,
  lastActiveTripId: TripId | null,
): TripId | null {
  const inProgress = trips.filter((trip) => isInProgress(trip, today)).sort(byStartDateThenId)
  if (inProgress.length > 0) return (inProgress[0] as TripSelectionCandidate).id

  const upcoming = trips.filter((trip) => isUpcoming(trip, today)).sort(byStartDateThenId)
  if (upcoming.length > 0) return (upcoming[0] as TripSelectionCandidate).id

  if (lastActiveTripId !== null && trips.some((trip) => trip.id === lastActiveTripId)) {
    return lastActiveTripId
  }

  return null
}
