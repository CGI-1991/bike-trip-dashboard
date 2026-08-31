import type { TripDayId, TripId } from '../trip-core/index.ts'

export interface TripDetailAutoScrollSession {
  enter(tripId: TripId): void
  consume(tripId: TripId): boolean
}

/** One-shot navigation gate: rerenders cannot consume a second scroll. */
export function createTripDetailAutoScrollSession(): TripDetailAutoScrollSession {
  let pendingTripId: TripId | null = null
  return {
    enter(tripId): void { pendingTripId = tripId },
    consume(tripId): boolean {
      if (pendingTripId !== tripId) return false
      pendingTripId = null
      return true
    },
  }
}

export function scrollTripDayCardIntoView(root: ParentNode, dayId: TripDayId): boolean {
  const escapedDayId = globalThis.CSS?.escape === undefined
    ? String(dayId).replaceAll('\\', '\\\\').replaceAll('"', '\\"')
    : globalThis.CSS.escape(dayId)
  const target = root.querySelector<HTMLElement>(`[data-day-id="${escapedDayId}"]`)
  if (target === null) return false
  target.scrollIntoView({ block: 'start', behavior: 'auto' })
  return true
}
