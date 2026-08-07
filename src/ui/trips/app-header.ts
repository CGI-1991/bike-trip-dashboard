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
   * `"Jx sur N · Roulé/OFF/Transfert"` when a specific day is open (the
   * Étape/Journée screen); `null` on Aperçu/Voyage (no day context) or
   * whenever `tripName` is `null`.
   */
  readonly subtitle: string | null
}

/** Matches `public/manifest.webmanifest`'s own `"name"` — never a second, invented app title. */
export const GENERIC_APP_TITLE = 'Bike Trip Dashboard'

/** No active trip context at all — Mes voyages, wizard, editor, post-import confirmation. */
export const GENERIC_APP_HEADER_NO_ACTIVE_TRIP: GenericAppHeaderState = { tripName: null, subtitle: null }

const DAY_TYPE_LABELS: Readonly<Record<TripDayType, string>> = {
  ride: 'Roulé', off: 'OFF', transfer: 'Transfert',
}

/**
 * Aperçu/Voyage (`activeDay: null`): trip name only, no `Jx sur N`.
 * Étape/OFF/Transfer (`activeDay` set): trip name plus
 * `"Jx sur N · Roulé/OFF/Transfert"` — `N` from `bundle.days.length`, the
 * type from the day's own `type`, never a hardcoded total or "Roulé".
 */
export function buildGenericAppHeader(bundle: TripBundle, activeDay: TripDay | null): GenericAppHeaderState {
  const subtitle = activeDay === null ? null : `J${activeDay.displayNumber} sur ${bundle.days.length} · ${DAY_TYPE_LABELS[activeDay.type]}`
  return { tripName: bundle.metadata.name, subtitle }
}
