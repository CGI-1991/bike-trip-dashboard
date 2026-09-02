/**
 * R2 section 2 — pragmatic transfer mode/times formatting, shared by every
 * screen that shows a transfer day (Voyage card, Aperçu highlighted card,
 * Étape Résumé) so the compact line ("Train · 09:20 → 12:05") is byte-for-
 * byte identical everywhere rather than three parallel implementations.
 * Pure string formatting only — no HTML, no escaping (callers already own
 * that, exactly like `day-location-fill.ts` stays HTML-free).
 */

import type { TripDay } from '../../trip-core/index.ts'
import { formatTransferModeLabel } from './transfer-mode-labels.ts'

/** `null` when nothing to show at all — mode and both times absent (never an empty line). */
export function formatTransferModeAndTimes(day: TripDay): string | null {
  const mode = formatTransferModeLabel(day.transferMode)
  const departure = day.transferDepartureTime ?? null
  const arrival = day.transferArrivalTime ?? null
  const times = departure === null && arrival === null ? null : `${departure ?? '—'} → ${arrival ?? '—'}`
  if (mode === null && times === null) return null
  if (mode === null) return times
  if (times === null) return mode
  return `${mode} · ${times}`
}

/**
 * Only ever derived from the two stored times, never a third stored field
 * (CDC R2 section 11: "ne jamais fabriquer une durée") — `null` whenever
 * either time is missing or arrival isn't strictly after departure (an
 * overnight transfer is never guessed at, just left unshown).
 */
export function formatTransferDuration(day: TripDay): string | null {
  const departure = day.transferDepartureTime ?? null
  const arrival = day.transferArrivalTime ?? null
  if (departure === null || arrival === null) return null
  const [departureHour, departureMinute] = departure.split(':').map(Number)
  const [arrivalHour, arrivalMinute] = arrival.split(':').map(Number)
  const departureMinutes = departureHour * 60 + departureMinute
  const arrivalMinutes = arrivalHour * 60 + arrivalMinute
  const durationMinutes = arrivalMinutes - departureMinutes
  if (durationMinutes <= 0) return null
  const hours = Math.floor(durationMinutes / 60)
  const minutes = durationMinutes % 60
  if (hours === 0) return `${minutes} min`
  return `${hours} h ${String(minutes).padStart(2, '0')}`
}
