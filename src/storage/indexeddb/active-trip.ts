/**
 * The one piece of trip state this module allows in localStorage (CDC
 * section 9.3/14): which trip is currently active. Everything else — the
 * `TripBundle` itself, its source files, import jobs — lives in IndexedDB
 * only. Not wired into any bootstrap or UI yet; a later phase decides when
 * to actually read/write this.
 */

import type { TripId } from '../../trip-core/index.ts'

export const ACTIVE_TRIP_ID_STORAGE_KEY = 'bike-trip-dashboard.active-trip-id.v1'

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

/**
 * The only place this module reads a global. `globalThis.localStorage` is
 * read defensively — not just called-and-caught — because in some hosts
 * (e.g. a browser with storage fully disabled) merely accessing the
 * property throws, rather than only its methods. No environment is assumed
 * to exist; `undefined` means "no default storage available here".
 */
function resolveDefaultStorage(): Storage | undefined {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage
  } catch {
    return undefined
  }
}

/** `null` for "no active trip", an invalid stored value, or an unavailable `storage` — never throws. */
export function getActiveTripId(storage: Storage | undefined = resolveDefaultStorage()): TripId | null {
  if (storage === undefined) return null
  try {
    const value = storage.getItem(ACTIVE_TRIP_ID_STORAGE_KEY)
    return isNonEmptyString(value) ? (value as TripId) : null
  } catch {
    return null
  }
}

/** Returns `false` (never throws) for an empty `tripId` or an unavailable `storage`. */
export function setActiveTripId(tripId: TripId, storage: Storage | undefined = resolveDefaultStorage()): boolean {
  if (!isNonEmptyString(tripId) || storage === undefined) return false
  try {
    storage.setItem(ACTIVE_TRIP_ID_STORAGE_KEY, tripId)
    return true
  } catch {
    return false
  }
}

/** Returns `false` (never throws) only when `storage` itself is unavailable; clearing an already-absent key still returns `true`. */
export function clearActiveTripId(storage: Storage | undefined = resolveDefaultStorage()): boolean {
  if (storage === undefined) return false
  try {
    storage.removeItem(ACTIVE_TRIP_ID_STORAGE_KEY)
    return true
  } catch {
    return false
  }
}
