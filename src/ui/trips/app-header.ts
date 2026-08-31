/**
 * Generic top app-shell header content (bug 48B closeout).
 *
 * The header used to be a permanently RGA-hardcoded shell (`ui/render.ts`'s
 * `<h1>RGA 2026</h1><p>Route des Grandes Alpes</p>`, plus a
 * `[data-day-indicator]` driven only by the legacy `rga2026TripPlan`
 * constant — `J1 sur ${plan.totalDays}` where `totalDays` traced back to a
 * hand-written `12`, never `bundle.days.length`). `trips-manager.ts`'s
 * generic multi-trip screens (Aperçu/Voyage/Étape/Mes voyages) never touched
 * `.brand`/`[data-day-indicator]` at all, so the header kept showing the RGA
 * trip's name regardless of which generic trip was actually active — even
 * once "Mes voyages" became the app's real entry point.
 *
 * This is the single, pure view-model both `trips-manager.ts` (which knows
 * the active bundle/day) and `main.ts` (which owns the actual DOM nodes,
 * outside `trips-manager`'s own `[data-trips-manager]` container) agree on —
 * never a second, divergent header-building rule in either file.
 */

import { deriveTripTemporalState } from '../../trips-manager/trip-day-temporal-state.ts'
import { formatShortDate } from '../date-format.ts'
import type { TripBundle, TripDay, TripDayType } from '../../trip-core/index.ts'

export interface GenericAppHeaderState {
  /**
   * `null` means "no active-trip context" — Mes voyages, the trip creation
   * wizard, the trip editor, or the post-import confirmation screen. Never
   * the last active trip's name in that case (CDC: "ne jamais afficher le
   * nom du dernier voyage actif comme si l'utilisateur était encore
   * dedans").
   */
  readonly tripName: string | null
  /**
   * One compact, screen-appropriate line (CDC D1.2 section 1) — this header
   * is now the SOLE general trip identity across every screen, so each
   * screen's own content never repeats the trip name again:
   * - Aperçu: the trip's date span + total day count ("02 sept. → 15 sept.
   *   · 14 jours").
   * - Voyage: the priority day (same `deriveTripTemporalState` rule D1
   *   uses everywhere else) + how many days remain after it ("J2 sur 14 ·
   *   12 jours à venir").
   * - Étape/Journée: that day's own position + type ("J2 sur 14 · Étape").
   * `null` whenever there is nothing meaningful to add, or `tripName` is
   * `null`.
   */
  readonly subtitle: string | null
}

/** Matches `public/manifest.webmanifest`'s own `"name"` — never a second, invented app title. */
export const GENERIC_APP_TITLE = 'Bike Trip Dashboard'

/** No active trip context at all — Mes voyages, wizard, editor, post-import confirmation. */
export const GENERIC_APP_HEADER_NO_ACTIVE_TRIP: GenericAppHeaderState = { tripName: null, subtitle: null }

/** CDC D1.2 section 9: the Détail header/subtitle use "Étape", matching the Voyage day card's own badge wording (D1.1 section 3) — never "Roulé" any more. */
const DAY_TYPE_LABELS: Readonly<Record<TripDayType, string>> = {
  ride: 'Étape', off: 'OFF', transfer: 'Transfert',
}

function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count > 1 ? 's' : ''}`
}

function overviewSubtitle(bundle: TripBundle): string | null {
  const dayCount = bundle.days.length
  if (dayCount === 0) return null
  const { startDate, endDate } = bundle.metadata
  const dayLabel = pluralize(dayCount, 'jour')
  if (startDate === null) return dayLabel
  const range = endDate === null || endDate === startDate ? formatShortDate(startDate) : `${formatShortDate(startDate)} → ${formatShortDate(endDate)}`
  return `${range} · ${dayLabel}`
}

/** `now` reuses D1's own completion rule (`deriveTripTemporalState`) — never a second "which day is current" heuristic. `null` once the whole trip is finished (nothing left to be "up next"). */
function tripSubtitle(bundle: TripBundle, now: Date | string | null): string | null {
  const temporal = deriveTripTemporalState(bundle, now)
  const priorityDay = temporal.priorityDayId === null ? undefined : bundle.days.find((day) => day.id === temporal.priorityDayId)
  if (priorityDay === undefined) return null
  const remaining = bundle.days.length - priorityDay.displayNumber
  const remainingLabel = remaining <= 0 ? 'Dernier jour' : pluralize(remaining, 'jour') + ' à venir'
  return `J${priorityDay.displayNumber} sur ${bundle.days.length} · ${remainingLabel}`
}

function daySubtitle(bundle: TripBundle, day: TripDay): string {
  return `J${day.displayNumber} sur ${bundle.days.length} · ${DAY_TYPE_LABELS[day.type]}`
}

export type GenericAppHeaderContext =
  | { readonly view: 'overview' }
  | { readonly view: 'trip'; readonly now: Date | string | null }
  | { readonly view: 'day'; readonly day: TripDay }

/**
 * One compact, contextual subtitle per screen (CDC D1.2 section 1) — never
 * a second, screen-owned repetition of the trip name (D1.2 section 2: that
 * repetition is what this jalon removes from Aperçu's own content).
 */
export function buildGenericAppHeader(bundle: TripBundle, context: GenericAppHeaderContext): GenericAppHeaderState {
  const tripName = bundle.metadata.name
  if (context.view === 'overview') return { tripName, subtitle: overviewSubtitle(bundle) }
  if (context.view === 'trip') return { tripName, subtitle: tripSubtitle(bundle, context.now) }
  return { tripName, subtitle: daySubtitle(bundle, context.day) }
}
