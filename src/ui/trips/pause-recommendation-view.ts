/**
 * C3.A UI-adjacent layer (CDC C3 sections 23-24/29-30) — turns
 * `analysis/pause-recommendation.ts`'s internal reason codes/levels into the
 * French text the user actually sees. No DOM here (kept separate from
 * `day-detail-view.ts`'s own HTML builders, exactly like
 * `practical-place-map-layers.ts` stays Leaflet-free) — this module only
 * ever produces plain strings/view-models.
 *
 * Never a raw score (CDC section 24: "l'utilisateur ne doit pas voir Score
 * 73.4/100") — `PauseRecommendationLevel` is the only thing rendered as a
 * badge, `reasons` become at most a short compact line.
 */

import type { PauseRecommendation, PauseRecommendationReasonCode } from '../../analysis/pause-recommendation.ts'
import type { CanonicalWaypoint } from '../../analysis/canonical-waypoints.ts'
import { evaluateOpeningAtPassage } from '../../practical-places/opening-hours.ts'
import type { OpeningStatus } from '../../practical-places/opening-hours.ts'
import { DEPARTURE_SCENARIO_OFFSETS_MINUTES } from '../../weather/alerts/thresholds.ts'

export interface PauseRecommendationViewModel {
  readonly pauseId: string
  readonly distanceKm: number
  readonly durationMinutes: number
  readonly waypointId: string | null
  readonly name: string
  readonly level: PauseRecommendation['level']
  readonly reasons: readonly PauseRecommendationReasonCode[]
  readonly primaryPoiIds: readonly string[]
  /** `null` when no timed waypoint could be matched (untimed stage) — never a fabricated ETA. */
  readonly etaLabel: string | null
}

/** CDC section 23 — one short label per reason code, kept in the CDC's own vocabulary. */
const REASON_LABELS: Readonly<Record<PauseRecommendationReasonCode, string>> = {
  'after-major-climb': 'après une longue montée',
  'after-descent': 'après la descente',
  'good-timing': 'bon timing',
  locality: 'localité',
  'bakery-open': 'boulangerie ouverte',
  'supermarket-open': 'supermarché ouvert',
  'water-available': 'eau disponible',
  'toilet-available': 'toilettes',
  'shelter-available': 'abri',
  'bike-service-available': 'service vélo',
  'low-detour': 'faible détour',
  'hours-uncertain': 'horaires à vérifier',
  'significant-detour': 'détour important',
  'shop-closed': 'commerce fermé',
  'mid-climb': 'milieu de montée',
  'wind-exposure': 'exposition au vent',
  'rain-shelter': 'abri sous la pluie',
  'heat-water': 'eau utile par forte chaleur',
}

/** CDC section 25/30: the compact one-line reason list — capped at three (a Parcours row/badge is never a paragraph), most relevant first (the engine already orders `reasons` by how it found them, positives before caveats in practice). */
export function formatPauseRecommendationReasons(reasons: readonly PauseRecommendationReasonCode[], max = 3): string {
  return reasons.slice(0, max).map((code) => REASON_LABELS[code]).join(' · ')
}

/** CDC section 24/25: "★ Recommandé" / "Bon choix" — a fallback recommendation (no real anchor found) shows no badge at all, exactly as if C3 hadn't run. */
export function pauseRecommendationBadgeLabel(level: PauseRecommendation['level']): string | null {
  if (level === 'recommended') return '★ Recommandé'
  if (level === 'good') return 'Bon choix'
  return null
}

/**
 * CDC section 29: pure, HTML-free view-model — `waypoints` is whatever
 * `computeStageWaypoints` already produced (post-placement, fully timed),
 * used only to look up each recommendation's own final `clockTime` (the
 * exact same one the Parcours row already shows) rather than recomputing a
 * second ETA here.
 */
export function buildPauseRecommendationViewModels(recommendations: readonly PauseRecommendation[], waypoints: readonly CanonicalWaypoint[]): readonly PauseRecommendationViewModel[] {
  return recommendations.map((recommendation) => {
    const waypoint = recommendation.waypointId === null ? undefined : waypoints.find((candidate) => candidate.id === recommendation.waypointId)
    return {
      pauseId: recommendation.slotId,
      distanceKm: recommendation.distanceKm,
      durationMinutes: recommendation.durationMinutes,
      waypointId: recommendation.waypointId,
      name: recommendation.name,
      level: recommendation.level,
      reasons: recommendation.reasons,
      primaryPoiIds: recommendation.primaryPoiIds,
      etaLabel: waypoint?.clockTime ?? null,
    }
  })
}

/** Looks up this one waypoint's own recommendation, if any (CDC section 30: badge/reason line attaches to the exact same waypoint row the pause badge already renders on) — `undefined` for a waypoint C3 has nothing to say about (manual mode, fallback slot, or simply not a recommended pause). */
export function findPauseRecommendationForWaypoint(viewModels: readonly PauseRecommendationViewModel[], waypointId: string): PauseRecommendationViewModel | undefined {
  return viewModels.find((viewModel) => viewModel.waypointId === waypointId)
}

/** R2.1 sections 9-10 own vocabulary — never the raw `OpeningStatus`/opening_hours string directly. */
const OPENING_STATUS_LABELS: Readonly<Record<OpeningStatus, string>> = {
  open: 'Ouvert à l’ETA', closed: 'Fermé à l’ETA', unknown: 'Horaires inconnus',
}

/** R2.1 sections 9-10: -1h/+1h before -2h/+2h — the closest, most likely-relevant alternative departure, never every scenario at once. */
const SCENARIO_HINT_PRIORITY: readonly number[] = [-60, 60, -120, 120]
const SCENARIO_OFFSET_LABELS: Readonly<Record<number, string>> = { [-120]: '−2 h', [-60]: '−1 h', 60: '+1 h', 120: '+2 h' }

export interface CandidateOpeningStatusViewModel {
  readonly label: string
  /** R2.1 section 10: only ever set when genuinely useful — closed at the current ETA, but a real, coherent difference exists with one of the 5 departure scenarios (`DEPARTURE_SCENARIO_OFFSETS_MINUTES` — the exact same ones the weather panel already offers, never a new one). `null` otherwise (open/unknown, or nothing actually changes). */
  readonly scenarioHint: string | null
}

/**
 * R2.1 sections 9-10: a candidate's opening status at its own current ETA
 * (`clockMinutes`), reusing `evaluateOpeningAtPassage` exactly as C3's own
 * scoring already does (`analysis/pause-recommendation.ts`) — never a
 * second opening-hours parser. `null` when there is genuinely nothing to
 * show (no `openingHours` string at all for this candidate — CDC section 9:
 * "pour chaque candidat disposant d'horaires fiables", never a line for a
 * spot with no commerce/POI nearby at all).
 */
export function computeCandidateOpeningStatus(openingHours: string | null, weekday: number, clockMinutes: number): CandidateOpeningStatusViewModel | null {
  if (openingHours === null || openingHours.trim() === '') return null
  const current = evaluateOpeningAtPassage(openingHours, weekday, clockMinutes)
  if (current.status !== 'closed') return { label: OPENING_STATUS_LABELS[current.status], scenarioHint: null }
  for (const offset of SCENARIO_HINT_PRIORITY) {
    if (!DEPARTURE_SCENARIO_OFFSETS_MINUTES.includes(offset as (typeof DEPARTURE_SCENARIO_OFFSETS_MINUTES)[number])) continue
    const shiftedMinutes = ((clockMinutes + offset) % 1_440 + 1_440) % 1_440
    if (evaluateOpeningAtPassage(openingHours, weekday, shiftedMinutes).status === 'open') {
      return { label: OPENING_STATUS_LABELS.closed, scenarioHint: `ouvert avec départ ${SCENARIO_OFFSET_LABELS[offset]}` }
    }
  }
  return { label: OPENING_STATUS_LABELS.closed, scenarioHint: null }
}
