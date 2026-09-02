/**
 * C3.A — explainable, deterministic pause-placement scoring (CDC C3
 * sections 1-33). Answers "where is it actually best to stop on this
 * stage?" instead of `pause-placement.ts`'s plain `city > town > village >
 * mountain-pass/saddle` kind priority, by combining terrain, timing, and
 * already-persisted POI/opening-hours/weather signals — all data this
 * pipeline already has (CDC section 1: "exploiter ensemble... déjà
 * disponibles").
 *
 * Pure, no DOM, no `Date.now()`/`Math.random()`/`fetch()` (CDC section 4) —
 * same inputs always produce the same recommendations. NEVER decides the
 * total pause budget (`pause-budget.ts`/`RideStage.pauseDurationSeconds`
 * stay the sole authority, CDC section 2) and NEVER runs for
 * `pausePlanMode: 'custom'` (CDC section 3) — this module only ever informs
 * automatic placement and the manual editor's own hints, never overrides a
 * saved manual choice.
 *
 * Timing↔pause cycle (CDC section 28): candidates are scored against an
 * APPROXIMATE elapsed time — moving time only (`movingElapsedMinutesAt`,
 * ignoring pauses not yet placed) plus whatever pause budget the ideal
 * anchors before this slot are expected to consume — never the final,
 * pauses-included timeline (which doesn't exist yet at scoring time, and
 * depends circularly on this very selection). Once a pause is actually
 * selected, the caller (`waypoint-timeline.ts`) still runs the exact same
 * `applyPausesToWaypoints`/`buildTimeline` pipeline as before to produce the
 * real, final ETAs — a single deterministic pass, never a convergence loop.
 */

import { PRACTICAL_PLACE_UX_CATEGORIES } from '../practical-places/taxonomy.ts'
import type { PracticalPlaceUxCategory } from '../practical-places/taxonomy.ts'
import { evaluateOpeningAtPassage } from '../practical-places/opening-hours.ts'
import { createRouteClockTime } from '../route/time.ts'
import type { Climb } from '../trip-core/index.ts'
import { isAnchorCandidate } from './pause-placement.ts'
import { PAUSE_MIN_EDGE_BUFFER_FRACTION, PAUSE_MIN_SPACING_FRACTION, PAUSE_SEARCH_WINDOW_FRACTION } from './pause-placement.ts'
import { distributeAutomaticPauses } from './pauses.ts'
import type { CanonicalWaypoint, CanonicalWaypointKind } from './canonical-waypoints.ts'

// --- public types (CDC section 4/23/29) -------------------------------------

/**
 * Internal codes only (CDC section 23-24) — never a phrase built inside the
 * engine. `formatPauseRecommendationReason` (UI layer) is the only place
 * these turn into French text.
 */
export type PauseRecommendationReasonCode =
  | 'after-major-climb'
  | 'after-descent'
  | 'good-timing'
  | 'locality'
  | 'bakery-open'
  | 'supermarket-open'
  | 'water-available'
  | 'toilet-available'
  | 'shelter-available'
  | 'bike-service-available'
  | 'low-detour'
  | 'hours-uncertain'
  | 'significant-detour'
  | 'shop-closed'
  | 'mid-climb'
  | 'wind-exposure'
  | 'rain-shelter'
  | 'heat-water'

export type PauseRecommendationLevel = 'recommended' | 'good' | 'fallback'

export type PauseCandidateOrigin = 'locality' | 'climb-summit' | 'poi' | 'synthetic'

/** A minimal, engine-owned POI shape (CDC section 8) — never the full `PracticalPlace`/provider tag structure; the caller (`waypoint-timeline.ts`) projects it from `bundle.practicalPlaces`, already filtered to the six UX categories. */
export interface PauseCandidatePlace {
  readonly id: string
  readonly category: PracticalPlaceUxCategory
  readonly name: string | null
  /** Already on-route (CDC section 7.B: never used to move the pause point itself, only to explain it). */
  readonly trackDistanceKm: number
  readonly detourKm: number
  readonly openingHours: string | null
}

export interface PauseCandidate {
  readonly id: string
  readonly name: string
  readonly distanceKm: number
  /** An existing canonical waypoint this candidate sits on, or `null` for a POI-only/synthetic position (CDC section 7). */
  readonly waypointId: string | null
  readonly origin: PauseCandidateOrigin
  readonly waypointKind: CanonicalWaypointKind | null
  /** Every POI within merge/attach range of this candidate (CDC section 7.B/15/17) — `[]` for a pure locality/summit with nothing nearby. */
  readonly places: readonly PauseCandidatePlace[]
}

export interface PauseCandidateScore {
  readonly candidate: PauseCandidate
  readonly score: number
  readonly reasons: readonly PauseRecommendationReasonCode[]
}

export interface PauseRecommendation {
  readonly slotId: string
  readonly distanceKm: number
  readonly durationMinutes: number
  readonly waypointId: string | null
  readonly name: string
  readonly level: PauseRecommendationLevel
  readonly reasons: readonly PauseRecommendationReasonCode[]
  readonly primaryPoiIds: readonly string[]
  /** 0-2 distinct runner-ups (CDC section 25: "1-2 alternatives pertinentes", never a long list). */
  readonly alternates: readonly PauseCandidateScore[]
}

/** CDC section 20-21: entirely optional — omitted or `null` fields simply skip that one weather modulation, never block/alter anything else. */
export interface PauseWeatherContext {
  readonly precipitationMm: number | null
  readonly windSpeedKph: number | null
  readonly temperatureMaxC: number | null
}

export interface RecommendAutomaticPausesInput {
  readonly totalBreakMinutes: number
  readonly totalDistanceKm: number
  readonly waypoints: readonly CanonicalWaypoint[]
  readonly climbs: readonly Climb[]
  /** Omitted/`[]` — C3 still runs on terrain + timing alone (CDC section 22/27). */
  readonly places?: readonly PauseCandidatePlace[]
  /** CDC section 28's "timing de base" — moving-only elapsed minutes, ignoring any not-yet-placed pause. Omit when no reference speed/geometry is available; opening-hours scoring is then skipped (neutral), everything else still runs. */
  readonly movingElapsedMinutesAt?: (distanceKm: number) => number
  readonly departureMinutes?: number
  /** 0 (Sunday) – 6 (Saturday), the day's own weekday at departure. */
  readonly weekdayAtDeparture?: number
  readonly weather?: PauseWeatherContext | null
}

// --- tunables (CDC section 15-20) -------------------------------------------

const BASE_SCORE = 100
/** CDC section 18: continuous malus proportional to how far the candidate sits from its own ideal slot, relative to the existing search window. */
const TIMING_PENALTY_WEIGHT = 70
const MID_CLIMB_PENALTY = 55
/** A climb below this gain is never "major" enough to grant an exit-of-climb bonus (CDC section 13) — a purely local, simple threshold, not a second significance engine. */
const MAJOR_CLIMB_ELEVATION_GAIN_M = 150
const POST_CLIMB_BONUS = 18
const POST_CLIMB_WINDOW_KM = 2.5
const DESCENT_BONUS = 14
const DESCENT_SAMPLE_KM = 1
const DESCENT_MIN_DROP_M = 30
const LOCALITY_BASE_BONUS = 8

/** CDC section 15: bakery/supermarket carry real nutritional value; water/toilet/shelter are complementary; bike-service is mechanical-need, not a nutrition stop. Never a flat "+10 per POI" (section 15/17: diversity over quantity — see `bestPerCategory` below). */
const CATEGORY_WEIGHT: Readonly<Record<PracticalPlaceUxCategory, number>> = {
  bakery: 20,
  supermarket: 20,
  water: 10,
  toilet: 8,
  shelter: 10,
  'bike-service': 7,
}
const DIVERSITY_BONUS_PER_EXTRA_CATEGORY = 5
const MAX_DIVERSITY_BONUS = 15

const OPEN_MULTIPLIER = 1
const UNKNOWN_MULTIPLIER = 0.45
const CLOSED_PENALTY: Readonly<Partial<Record<PracticalPlaceUxCategory, number>>> = {
  bakery: 14,
  supermarket: 14,
}

/** CDC section 16: continuous, never a hard cutoff — 0-100 m is nearly free, 300-500 m sensible, beyond only a strong service still clears the bar (its own weight has to outrun the shrinking multiplier). */
function detourFactor(detourKm: number): number {
  const meters = Math.max(0, detourKm) * 1_000
  if (meters <= 100) return 1
  if (meters <= 300) return 1 - 0.3 * ((meters - 100) / 200)
  if (meters <= 500) return 0.7 - 0.4 * ((meters - 300) / 200)
  if (meters <= 800) return 0.3 - 0.25 * ((meters - 500) / 300)
  return 0.05
}

const RAIN_SIGNIFICANT_MM = 3
const WIND_STRONG_KPH = 40
const HEAT_C = 29
const RAIN_SHELTER_BONUS = 10
const WIND_EXPOSURE_PENALTY = 12
const HEAT_WATER_BONUS = 8

/** Candidates within this distance of each other represent the same real stopping point (CDC section 7: "dédupliquer des candidats proches") — the more specific one (a real waypoint) wins over a synthetic POI cluster point. */
const CANDIDATE_MERGE_DISTANCE_KM = 0.35

// --- candidate construction (CDC section 7-8) -------------------------------

function originForWaypoint(waypoint: CanonicalWaypoint): PauseCandidateOrigin {
  return waypoint.kind === 'mountain-pass' || waypoint.kind === 'saddle' || waypoint.kind === 'climb' ? 'climb-summit' : 'locality'
}

/**
 * CDC section 7: waypoint anchors (localities + significant relief) plus,
 * for any POI that isn't already near one of those, one extra synthetic
 * candidate at its own `trackDistanceKm` — never one candidate per POI
 * (`places` groups every POI within merge range onto whichever candidate
 * represents that stop). Deterministic order: by distance, then id.
 */
export function buildPauseCandidates(waypoints: readonly CanonicalWaypoint[], places: readonly PauseCandidatePlace[]): readonly PauseCandidate[] {
  const anchors = waypoints.filter(isAnchorCandidate)
  const base: PauseCandidate[] = anchors
    .slice()
    .sort((left, right) => left.trackDistanceKm - right.trackDistanceKm)
    .map((waypoint) => ({
      id: waypoint.id,
      name: waypoint.name,
      distanceKm: waypoint.trackDistanceKm,
      waypointId: waypoint.id,
      origin: originForWaypoint(waypoint),
      waypointKind: waypoint.kind,
      places: [],
    }))

  for (const place of places) {
    const nearest = base
      .map((candidate) => ({ candidate, distanceKm: Math.abs(candidate.distanceKm - place.trackDistanceKm) }))
      .sort((left, right) => left.distanceKm - right.distanceKm)[0]
    if (nearest !== undefined && nearest.distanceKm <= CANDIDATE_MERGE_DISTANCE_KM) {
      const index = base.indexOf(nearest.candidate)
      base[index] = { ...nearest.candidate, places: [...nearest.candidate.places, place] }
      continue
    }
    // No existing anchor close enough — a standalone POI cluster point of
    // its own, merged with any other unattached POI at essentially the same
    // spot rather than creating a second synthetic candidate right next to it.
    const existingSynthetic = base.find((candidate) => candidate.origin === 'poi' && Math.abs(candidate.distanceKm - place.trackDistanceKm) <= CANDIDATE_MERGE_DISTANCE_KM)
    if (existingSynthetic !== undefined) {
      const index = base.indexOf(existingSynthetic)
      base[index] = { ...existingSynthetic, places: [...existingSynthetic.places, place] }
      continue
    }
    base.push({
      id: `poi:${place.id}`,
      name: place.name ?? 'Service',
      distanceKm: place.trackDistanceKm,
      waypointId: null,
      origin: 'poi',
      waypointKind: null,
      places: [place],
    })
  }

  return base.sort((left, right) => left.distanceKm - right.distanceKm || left.id.localeCompare(right.id))
}

// --- scoring (CDC section 9-20) ---------------------------------------------

interface ScoringContext {
  readonly climbs: readonly Climb[]
  readonly geometryAltitudeAt?: (distanceKm: number) => number | null
  readonly elapsedMinutesAt?: (distanceKm: number) => number
  readonly weekdayAtDeparture?: number
  readonly departureMinutes?: number
  readonly weather?: PauseWeatherContext | null
  readonly idealDistanceKm: number
  readonly windowKm: number
}

function weekdayAt(context: ScoringContext, distanceKm: number): number | null {
  if (context.elapsedMinutesAt === undefined || context.departureMinutes === undefined || context.weekdayAtDeparture === undefined) return null
  const elapsed = context.elapsedMinutesAt(distanceKm)
  const clock = createRouteClockTime(context.departureMinutes, Math.max(0, elapsed))
  return ((context.weekdayAtDeparture + clock.dayOffset) % 7 + 7) % 7
}

function clockMinutesAt(context: ScoringContext, distanceKm: number): number | null {
  if (context.elapsedMinutesAt === undefined || context.departureMinutes === undefined) return null
  const elapsed = context.elapsedMinutesAt(distanceKm)
  return createRouteClockTime(context.departureMinutes, Math.max(0, elapsed)).clockMinutes
}

/** CDC section 9: reuses `evaluateOpeningAtPassage` verbatim — never a second `opening_hours` parser — with THIS engine's own pre-final-timeline ETA (never the circular, pauses-included one, section 28). */
function poiOpeningStatus(context: ScoringContext, place: PauseCandidatePlace): 'open' | 'closed' | 'unknown' {
  const weekday = weekdayAt(context, place.trackDistanceKm)
  const clockMinutes = clockMinutesAt(context, place.trackDistanceKm)
  if (weekday === null || clockMinutes === null) return 'unknown'
  return evaluateOpeningAtPassage(place.openingHours, weekday, clockMinutes).status
}

function terrainScore(context: ScoringContext, candidate: PauseCandidate): { readonly delta: number; readonly reasons: readonly PauseRecommendationReasonCode[] } {
  const reasons: PauseRecommendationReasonCode[] = []
  let delta = 0

  const enclosingClimb = context.climbs.find((climb) => candidate.distanceKm > climb.startDistanceKm && candidate.distanceKm < climb.endDistanceKm - 0.15)
  if (enclosingClimb !== undefined) {
    delta -= MID_CLIMB_PENALTY
    reasons.push('mid-climb')
  }

  // Strictly PAST the summit (CDC section 14: the summit point itself gets
  // no automatic bonus just for being a climb's own endpoint — only a real
  // stop reached after some descent/flat does).
  const justAfterMajorClimb = context.climbs.find((climb) =>
    climb.elevationGainM >= MAJOR_CLIMB_ELEVATION_GAIN_M
    && candidate.distanceKm - climb.endDistanceKm > 0.2
    && candidate.distanceKm - climb.endDistanceKm <= POST_CLIMB_WINDOW_KM)
  if (justAfterMajorClimb !== undefined) {
    delta += POST_CLIMB_BONUS
    reasons.push('after-major-climb')
  }

  if (context.geometryAltitudeAt !== undefined) {
    const here = context.geometryAltitudeAt(candidate.distanceKm)
    const before = context.geometryAltitudeAt(Math.max(0, candidate.distanceKm - DESCENT_SAMPLE_KM))
    if (here !== null && before !== null && before - here >= DESCENT_MIN_DROP_M) {
      delta += DESCENT_BONUS
      if (!reasons.includes('after-major-climb')) reasons.push('after-descent')
    }
  }

  if (candidate.origin === 'locality') {
    delta += LOCALITY_BASE_BONUS
    reasons.push('locality')
  }
  // A bare climb summit (col/saddle) with nothing else going for it gets
  // neither bonus nor malus here (CDC section 14) — its fate is decided by
  // whatever POI/weather signals it does or doesn't carry.

  return { delta, reasons }
}

const OPEN_REASON_BY_CATEGORY: Readonly<Partial<Record<PracticalPlaceUxCategory, PauseRecommendationReasonCode>>> = {
  bakery: 'bakery-open',
  supermarket: 'supermarket-open',
  water: 'water-available',
  toilet: 'toilet-available',
  shelter: 'shelter-available',
  'bike-service': 'bike-service-available',
}

function servicesScore(context: ScoringContext, candidate: PauseCandidate): { readonly delta: number; readonly reasons: readonly PauseRecommendationReasonCode[]; readonly primaryPoiIds: readonly string[] } {
  if (candidate.places.length === 0) return { delta: 0, reasons: [], primaryPoiIds: [] }

  const reasons: PauseRecommendationReasonCode[] = []
  let sawUnknownHours = false
  let sawSignificantDetour = false
  let sawLowDetour = false

  // CDC section 17: diversity over quantity — the best contribution PER
  // CATEGORY counts once, never summed across duplicates of the same one.
  const bestByCategory = new Map<PracticalPlaceUxCategory, { readonly weighted: number; readonly place: PauseCandidatePlace; readonly status: 'open' | 'closed' | 'unknown' }>()
  for (const place of candidate.places) {
    const status = poiOpeningStatus(context, place)
    const multiplier = status === 'open' ? OPEN_MULTIPLIER : status === 'unknown' ? UNKNOWN_MULTIPLIER : 0
    const weighted = CATEGORY_WEIGHT[place.category] * multiplier * detourFactor(place.detourKm)
    const closedPenalty = status === 'closed' ? (CLOSED_PENALTY[place.category] ?? 0) : 0
    const net = weighted - closedPenalty
    if (status === 'unknown') sawUnknownHours = true
    if (place.detourKm * 1_000 > 300) sawSignificantDetour = true
    if (place.detourKm * 1_000 <= 100) sawLowDetour = true
    const existing = bestByCategory.get(place.category)
    if (existing === undefined || net > existing.weighted) bestByCategory.set(place.category, { weighted: net, place, status })
  }

  let delta = 0
  const primaryPoiIds: string[] = []
  for (const category of PRACTICAL_PLACE_UX_CATEGORIES) {
    const best = bestByCategory.get(category)
    if (best === undefined) continue
    delta += best.weighted
    primaryPoiIds.push(best.place.id)
    if (best.status === 'open') {
      const reason = OPEN_REASON_BY_CATEGORY[category]
      if (reason !== undefined) reasons.push(reason)
    } else if (best.status === 'closed' && (category === 'bakery' || category === 'supermarket')) {
      reasons.push('shop-closed')
    }
  }

  const distinctCategories = bestByCategory.size
  if (distinctCategories > 1) delta += Math.min(MAX_DIVERSITY_BONUS, DIVERSITY_BONUS_PER_EXTRA_CATEGORY * (distinctCategories - 1))

  if (sawLowDetour) reasons.push('low-detour')
  else if (sawSignificantDetour) reasons.push('significant-detour')
  if (sawUnknownHours) reasons.push('hours-uncertain')

  return { delta, reasons, primaryPoiIds }
}

function weatherScore(context: ScoringContext, candidate: PauseCandidate): { readonly delta: number; readonly reasons: readonly PauseRecommendationReasonCode[] } {
  const weather = context.weather
  if (weather === null || weather === undefined) return { delta: 0, reasons: [] }
  const reasons: PauseRecommendationReasonCode[] = []
  let delta = 0

  const hasShelter = candidate.places.some((place) => place.category === 'shelter')
  if (weather.precipitationMm !== null && weather.precipitationMm >= RAIN_SIGNIFICANT_MM && hasShelter) {
    delta += RAIN_SHELTER_BONUS
    reasons.push('rain-shelter')
  }

  const isExposedCol = candidate.waypointKind === 'mountain-pass' || candidate.waypointKind === 'saddle'
  if (weather.windSpeedKph !== null && weather.windSpeedKph >= WIND_STRONG_KPH && isExposedCol) {
    delta -= WIND_EXPOSURE_PENALTY
    reasons.push('wind-exposure')
  }

  const hasWater = candidate.places.some((place) => place.category === 'water')
  if (weather.temperatureMaxC !== null && weather.temperatureMaxC >= HEAT_C && hasWater) {
    delta += HEAT_WATER_BONUS
    reasons.push('heat-water')
  }

  return { delta, reasons }
}

function timingScore(context: ScoringContext, candidate: PauseCandidate): { readonly delta: number; readonly reasons: readonly PauseRecommendationReasonCode[] } {
  const distanceFromIdeal = Math.abs(candidate.distanceKm - context.idealDistanceKm)
  const ratio = context.windowKm <= 0 ? 0 : Math.min(1.5, distanceFromIdeal / context.windowKm)
  const delta = -TIMING_PENALTY_WEIGHT * ratio
  return { delta, reasons: ratio <= 0.25 ? ['good-timing'] : [] }
}

/** Scores one candidate for one ideal slot — pure, deterministic (CDC section 4/18). */
export function scorePauseCandidate(candidate: PauseCandidate, context: ScoringContext): PauseCandidateScore {
  const timing = timingScore(context, candidate)
  const terrain = terrainScore(context, candidate)
  const services = servicesScore(context, candidate)
  const weather = weatherScore(context, candidate)
  const score = BASE_SCORE + timing.delta + terrain.delta + services.delta + weather.delta
  const reasons = [...new Set([...timing.reasons, ...terrain.reasons, ...services.reasons, ...weather.reasons])]
  return { candidate, score, reasons }
}

// --- selection (CDC section 6/19/25) ----------------------------------------

function levelFor(score: PauseCandidateScore): PauseRecommendationLevel {
  if (score.candidate.origin === 'synthetic') return 'fallback'
  if (score.score >= BASE_SCORE + 15) return 'recommended'
  return 'good'
}

/**
 * One recommendation per ideal slot (CDC section 25/6/19) — hard
 * constraints (edge buffer, spacing, no duplicate anchor) reuse the exact
 * same fractions `pause-placement.ts` already applies, never a second,
 * looser rule that could let an excellent but oddly-timed candidate steal a
 * slot far from its own window (CDC section 6's own explicit worked
 * example).
 */
export function selectPauseRecommendations(
  candidates: readonly PauseCandidate[],
  idealAnchors: readonly { readonly id: string; readonly name: string; readonly distanceKm: number; readonly durationMinutes: number }[],
  totalDistanceKm: number,
  scoringContextFor: (idealDistanceKm: number, windowKm: number, priorPauseMinutes: number) => Omit<ScoringContext, 'idealDistanceKm' | 'windowKm'>,
): readonly PauseRecommendation[] {
  const minEdgeKm = totalDistanceKm * PAUSE_MIN_EDGE_BUFFER_FRACTION
  const windowKm = totalDistanceKm * PAUSE_SEARCH_WINDOW_FRACTION
  const minSpacingKm = totalDistanceKm * PAUSE_MIN_SPACING_FRACTION
  const selectedDistances: number[] = []
  const usedCandidateIds = new Set<string>()
  const recommendations: PauseRecommendation[] = []
  let priorPauseMinutes = 0

  for (const ideal of idealAnchors) {
    const usable = candidates.filter((candidate) =>
      candidate.distanceKm >= minEdgeKm
      && candidate.distanceKm <= totalDistanceKm - minEdgeKm
      && Math.abs(candidate.distanceKm - ideal.distanceKm) <= windowKm
      && !usedCandidateIds.has(candidate.id)
      // R2.1 section 15-16: a standalone POI (no nearby structural anchor —
      // `origin: 'poi'`, `waypointId: null`) can never itself become the
      // pause's own anchor/name — that is the exact source of the "Service"
      // generic-lieu bug (a bare `PauseCandidatePlace.name` with no real
      // waypoint to anchor it). It still fully participates in SCORING a
      // real anchor nearby (`buildPauseCandidates`'s own merge step, CDC
      // section 16 "POI = service utile associé"); it just never wins a
      // slot on its own. A slot with no real anchor nearby falls through to
      // the 'fallback' synthetic-position branch below, named after the
      // slot itself ("Pause du matin"/etc.) — never a POI category name.
      && candidate.waypointId !== null
      && selectedDistances.every((distanceKm) => Math.abs(distanceKm - candidate.distanceKm) >= minSpacingKm))

    const context: ScoringContext = { ...scoringContextFor(ideal.distanceKm, windowKm, priorPauseMinutes), idealDistanceKm: ideal.distanceKm, windowKm }
    const scored = usable
      .map((candidate) => scorePauseCandidate(candidate, context))
      .sort((left, right) => right.score - left.score
        || Math.abs(left.candidate.distanceKm - ideal.distanceKm) - Math.abs(right.candidate.distanceKm - ideal.distanceKm)
        || left.candidate.id.localeCompare(right.candidate.id))

    const best = scored[0]
    if (best === undefined) {
      const fallbackDistanceKm = Math.min(Math.max(ideal.distanceKm, minEdgeKm), totalDistanceKm - minEdgeKm)
      recommendations.push({
        slotId: ideal.id, distanceKm: fallbackDistanceKm, durationMinutes: ideal.durationMinutes, waypointId: null,
        name: ideal.name, level: 'fallback', reasons: [], primaryPoiIds: [], alternates: [],
      })
    } else {
      usedCandidateIds.add(best.candidate.id)
      selectedDistances.push(best.candidate.distanceKm)
      const alternates = scored.slice(1, 3)
      recommendations.push({
        slotId: ideal.id, distanceKm: best.candidate.distanceKm, durationMinutes: ideal.durationMinutes,
        waypointId: best.candidate.waypointId, name: best.candidate.name, level: levelFor(best),
        reasons: best.reasons, primaryPoiIds: servicesScore(context, best.candidate).primaryPoiIds, alternates,
      })
    }
    priorPauseMinutes += ideal.durationMinutes
  }

  return recommendations
}

/**
 * Top-level entry point (CDC section 4/26) — the one function
 * `waypoint-timeline.ts` calls in automatic mode. Reuses
 * `distributeAutomaticPauses` verbatim for the ideal positions/duration
 * split (CDC section 5), so the total budget and per-slot duration are
 * byte-identical to what `placeAutomaticPauses` would have used — only the
 * WHICH-ANCHOR decision changes.
 */
export function recommendAutomaticPauses(input: RecommendAutomaticPausesInput, geometryAltitudeAt?: (distanceKm: number) => number | null): readonly PauseRecommendation[] {
  const idealAnchors = distributeAutomaticPauses(input.totalDistanceKm, input.totalBreakMinutes)
  if (idealAnchors.length === 0 || !(input.totalDistanceKm > 0)) return []

  const candidates = buildPauseCandidates(input.waypoints, input.places ?? [])
  return selectPauseRecommendations(candidates, idealAnchors, input.totalDistanceKm, (_idealDistanceKm, _windowKm, priorPauseMinutes) => ({
    climbs: input.climbs,
    geometryAltitudeAt,
    elapsedMinutesAt: input.movingElapsedMinutesAt === undefined ? undefined : (distanceKm: number) => (input.movingElapsedMinutesAt as (d: number) => number)(distanceKm) + priorPauseMinutes,
    weekdayAtDeparture: input.weekdayAtDeparture,
    departureMinutes: input.departureMinutes,
    weather: input.weather,
  }))
}
