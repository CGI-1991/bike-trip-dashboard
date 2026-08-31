/**
 * Pure per-POI view-model (CDC C2 sections 20-21/26-27) — one place, its
 * theoretical passage ETA, and its opening status at that ETA. Reused as-is
 * by whatever surface needs it (fullscreen map popup today; C3's own
 * scoring later, per section 27) rather than coupling DOM directly to the
 * raw `PracticalPlace`/provider tag structure. Never a second timing/weather
 * fetch of its own — `timingCurve` is the exact same `StageTimingCurve`
 * (`analysis/waypoint-timeline.ts::computeStageTimingCurve`) the profile's
 * own ETA band already uses (`day-detail-view.ts::DayDetail.timingCurve`).
 */

import { createRouteClockTime, formatRouteClockTime } from '../route/time.ts'
import { parseClockToMinutes } from '../analysis/timing.ts'
import type { StageTimingCurve } from '../analysis/waypoint-timeline.ts'
import { addCivilDays } from '../trip-core/validation/primitives.ts'
import type { PracticalPlace, TripDay } from '../trip-core/index.ts'
import { evaluateOpeningAtPassage } from './opening-hours.ts'
import type { OpeningEvaluation } from './opening-hours.ts'
import { PRACTICAL_PLACE_UX_LABELS, isPracticalPlaceUxCategory } from './taxonomy.ts'
import type { PracticalPlaceUxCategory } from './taxonomy.ts'

/** Never an anonymous marker on the map (CDC section 29) — one honest fallback per category, used only for the corridor categories that allow an unnamed candidate through in the first place. */
const FALLBACK_NAMES: Readonly<Record<PracticalPlaceUxCategory, string>> = {
  'bike-service': 'Atelier / station vélo',
  supermarket: 'Supermarché',
  bakery: 'Boulangerie',
  water: 'Point d’eau',
  shelter: 'Abri',
  toilet: 'Toilettes',
}

export interface PracticalPlaceViewModel {
  readonly place: PracticalPlace
  readonly category: PracticalPlaceUxCategory
  readonly categoryLabel: string
  readonly displayName: string
  /** "HH:MM", possibly suffixed "(+N j)" for a passage past local midnight — the exact same formatter every other ETA in the app already uses. */
  readonly passageClockTimeLabel: string | null
  /** `null` only when no timing was available at all for this stage (untimed/degenerate) — never a fabricated ETA. */
  readonly opening: OpeningEvaluation | null
}

/** 0 (Sunday) – 6 (Saturday), from an already-resolved local `IsoDate` — no further timezone math needed (the date itself was already resolved in the trip's own calendar upstream, exactly like every other `TripDay.date`/`WeatherSamplePoint.tripDate` consumer in the codebase). */
function weekdayOf(isoDate: string): number {
  return new Date(`${isoDate}T12:00:00Z`).getUTCDay()
}

function buildOne(place: PracticalPlace, category: PracticalPlaceUxCategory, day: TripDay, timingCurve: StageTimingCurve | null, departureMinutes: number): PracticalPlaceViewModel {
  const displayName = place.name ?? FALLBACK_NAMES[category]
  const categoryLabel = PRACTICAL_PLACE_UX_LABELS[category]
  if (timingCurve === null || place.trackDistanceKm === null || day.date === null) {
    return { place, category, categoryLabel, displayName, passageClockTimeLabel: null, opening: null }
  }
  const elapsedMinutes = timingCurve.elapsedMinutesAt(place.trackDistanceKm)
  const clock = createRouteClockTime(departureMinutes, elapsedMinutes)
  const passageDate = clock.dayOffset === 0 ? day.date : addCivilDays(day.date, clock.dayOffset)
  const opening = evaluateOpeningAtPassage(place.openingHours, weekdayOf(passageDate), clock.clockMinutes)
  return { place, category, categoryLabel, displayName, passageClockTimeLabel: formatRouteClockTime(clock), opening }
}

/**
 * Filters to the six UX categories (CDC section 3) and builds one
 * view-model per place — the single place every fullscreen-map POI layer
 * and popup builder reads from.
 */
export function buildPracticalPlaceViewModels(
  places: readonly PracticalPlace[],
  day: TripDay,
  timingCurve: StageTimingCurve | null,
  departureTime: string,
): readonly PracticalPlaceViewModel[] {
  const departureMinutes = parseClockToMinutes(departureTime)
  return places
    .filter((place): place is PracticalPlace & { readonly category: PracticalPlaceUxCategory } => isPracticalPlaceUxCategory(place.category))
    .map((place) => buildOne(place, place.category, day, timingCurve, departureMinutes))
}
