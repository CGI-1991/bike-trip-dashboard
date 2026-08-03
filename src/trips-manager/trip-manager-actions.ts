/**
 * IO-level actions behind "Mes voyages" (CDC phase 6C1 section 6/24/25/26):
 * listing, switching, and deleting trips. Thin glue over the phase 5
 * repositories (`trip-repository.ts`, `active-trip.ts`) and the pure
 * `selectMostRelevantTrip` — no business rule lives in this file itself.
 */

import { clearActiveTripId, getActiveTripId, setActiveTripId } from '../storage/indexeddb/active-trip.ts'
import { createTripRepository } from '../storage/indexeddb/trip-repository.ts'
import type { IsoDate, TripId } from '../trip-core/index.ts'
import { selectMostRelevantTrip } from './active-trip-selection.ts'
import { summarizeTripBundle } from './trip-summary.ts'
import type { TripListEntry } from './trip-summary.ts'

function asIsoDate(value: string): IsoDate {
  return value as IsoDate
}

/** Every stored trip, newest storage order from `listTrips()` re-summarized for the list view. `null` bundles (a load race) are silently skipped, never shown as a broken row. */
export async function listTripSummaries(database: IDBDatabase): Promise<readonly TripListEntry[]> {
  const tripRepository = createTripRepository(database)
  const metadataList = await tripRepository.listTrips()
  const bundles = await Promise.all(metadataList.map((metadata) => tripRepository.loadTripBundle(metadata.id)))
  return bundles.filter((bundle) => bundle !== null).map((bundle) => summarizeTripBundle(bundle))
}

export function setActiveTrip(tripId: TripId): boolean {
  return setActiveTripId(tripId)
}

export interface DeleteTripResult {
  readonly deleted: boolean
  readonly wasActive: boolean
  readonly nextActiveTripId: TripId | null
}

/**
 * Deletes a trip completely (bundle + source payloads, cascaded by
 * `deleteTrip`) and, only if it was the active one, clears `activeTripId`
 * and re-selects the next most relevant remaining trip (CDC section 26).
 */
export async function deleteTripCompletely(database: IDBDatabase, tripId: TripId, today: string): Promise<DeleteTripResult> {
  const tripRepository = createTripRepository(database)
  const wasActive = getActiveTripId() === tripId

  const deleted = await tripRepository.deleteTrip(tripId)
  if (!deleted) {
    return { deleted: false, wasActive: false, nextActiveTripId: getActiveTripId() }
  }

  if (!wasActive) {
    return { deleted: true, wasActive: false, nextActiveTripId: getActiveTripId() }
  }

  clearActiveTripId()
  const remaining = await listTripSummaries(database)
  const nextActiveTripId = selectMostRelevantTrip(remaining, asIsoDate(today), null)
  if (nextActiveTripId !== null) setActiveTripId(nextActiveTripId)

  return { deleted: true, wasActive: true, nextActiveTripId }
}
