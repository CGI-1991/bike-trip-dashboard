/**
 * D3.1 — a genuinely LIGHT save path for the trip's own preferences (name,
 * start date, reference speed, terrain override), entirely separate from
 * the heavy structural pipeline (`trip-editor.ts`'s `buildGpxTrip` →
 * `mergeEditedTripBundle`). Never touches GPX/route geometry/Postpass/POI —
 * only the small set of derived fields that genuinely depend on the changed
 * preference (CDC section 17): local, pure, one atomic save.
 */

import { computeStageTiming } from '../analysis/timing.ts'
import { estimateAutomaticBreakBudget } from '../analysis/pause-budget.ts'
import { routeGeometryWithDistances } from '../analysis/canonical-waypoints.ts'
import { resolveStagePauseSettings } from '../analysis/waypoint-timeline.ts'
import { buildTerrainProfileSeries } from '../route/terrain-profile.ts'
import type { RouteProfilePosition, TerrainProfilePoint } from '../route/types.ts'
import { addCivilDays, isIsoDate } from '../trip-core/validation/primitives.ts'
import { validateTripBundle } from '../trip-core/index.ts'
import type { IsoDate, RideStage, Route, TripBundle, TripId } from '../trip-core/index.ts'
import { createTripRepository, TripValidationError } from '../storage/indexeddb/trip-repository.ts'

function asIsoDate(value: string): IsoDate {
  return value as IsoDate
}

// --- input / validation (CDC section 5/9/36) --------------------------------

const NAME_MAX_LENGTH = 200
export const TRIP_REFERENCE_SPEED_MIN_KPH = 8
export const TRIP_REFERENCE_SPEED_MAX_KPH = 40

export interface TripPreferencesUpdate {
  /** Trimmed before validation/storage — Unicode preserved verbatim (CDC section 5: "conserver Unicode"). Field absent (`undefined`) leaves the name untouched. */
  readonly name?: string
  /** "YYYY-MM-DD" from a native `<input type="date">`. Absent leaves the calendar untouched; only meaningful for an already-dated trip (CDC section 6 — dating a still-undated trip is out of this milestone's scope). */
  readonly startDate?: string
  readonly referenceSpeedKph?: number
  /** `undefined` — leave untouched. `null` — clear back to automatic (CDC section 15's "Automatique"). A `boolean` forces `settings.global.mountainMode` explicitly. */
  readonly terrainOverride?: boolean | null
}

export interface TripPreferencesFieldError {
  readonly field: 'name' | 'startDate' | 'referenceSpeedKph'
  readonly message: string
}

/** Pure — never throws, never touches storage. Accumulates every issue rather than stopping at the first (CDC section 36: "afficher validation inline"). */
export function validateTripPreferencesUpdate(update: TripPreferencesUpdate): readonly TripPreferencesFieldError[] {
  const errors: TripPreferencesFieldError[] = []
  if (update.name !== undefined) {
    const trimmed = update.name.trim()
    if (trimmed === '') errors.push({ field: 'name', message: 'Le nom du voyage ne peut pas être vide.' })
    else if (trimmed.length > NAME_MAX_LENGTH) errors.push({ field: 'name', message: `Le nom du voyage doit rester sous ${NAME_MAX_LENGTH} caractères.` })
  }
  if (update.startDate !== undefined && !isIsoDate(update.startDate)) {
    errors.push({ field: 'startDate', message: 'Date de départ invalide.' })
  }
  if (update.referenceSpeedKph !== undefined) {
    const speed = update.referenceSpeedKph
    if (!Number.isFinite(speed) || speed < TRIP_REFERENCE_SPEED_MIN_KPH || speed > TRIP_REFERENCE_SPEED_MAX_KPH) {
      errors.push({ field: 'referenceSpeedKph', message: `La vitesse de référence doit être comprise entre ${TRIP_REFERENCE_SPEED_MIN_KPH} et ${TRIP_REFERENCE_SPEED_MAX_KPH} km/h.` })
    }
  }
  return errors
}

/** CDC section 29: a real no-op — every provided field already matches the bundle's current value. The caller must skip validation/save/invalidation entirely when this is `true`, never just skip the UI spinner. */
export function tripPreferencesUpdateIsNoop(bundle: TripBundle, update: TripPreferencesUpdate): boolean {
  if (update.name !== undefined && update.name.trim() !== bundle.metadata.name) return false
  if (update.startDate !== undefined && update.startDate !== bundle.calendar.startDate) return false
  if (update.referenceSpeedKph !== undefined && update.referenceSpeedKph !== bundle.settings.global.referenceSpeedKph) return false
  if (update.terrainOverride !== undefined) {
    const currentOverride = bundle.settings.global.mountainMode ?? null
    if (update.terrainOverride !== currentOverride) return false
  }
  return true
}

// --- date shift (CDC section 6-8) -------------------------------------------

/**
 * Every `TripDay.date` is always exactly `calendar.startDate + day.index`
 * civil days (`validateTripBundle`'s own invariant — see `trip-calendar.ts`'s
 * doc comment) — `TransferTiming` (`dedicated`/`after_previous`/`before_next`)
 * is a purely narrative label about a transfer's position WITHIN its own
 * day, never a mechanism for two days to literally share one calendar date.
 * Shifting the start therefore never needs a "delta" or any transfer-timing
 * awareness at all (CDC section 7) — every day's date is simply
 * recomputed from its own already-correct `index`, exactly the same
 * `addCivilDays` the validator itself checks against.
 *
 * A no-op for a still-undated trip (`calendar.startDate === null`) — dating
 * a trip for the first time (also choosing its timezone) is out of this
 * milestone's scope (CDC section 6 only ever describes shifting an existing
 * date).
 */
export function shiftTripStartDate(bundle: TripBundle, newStartDate: IsoDate): TripBundle {
  if (bundle.calendar.startDate === null || bundle.calendar.startDate === newStartDate) return bundle
  const endDate = bundle.days.length === 0 ? newStartDate : asIsoDate(addCivilDays(newStartDate, bundle.days.length - 1))
  const days = bundle.days.map((day) => (day.date === null ? day : { ...day, date: asIsoDate(addCivilDays(newStartDate, day.index)) }))
  return {
    ...bundle,
    calendar: { ...bundle.calendar, startDate: newStartDate, endDate },
    metadata: { ...bundle.metadata, startDate: newStartDate, endDate },
    days,
    // CDC section 8/26: every existing forecast now describes the WRONG
    // date — never kept "close enough". The next screen that needs weather
    // asks `WeatherCoordinator` for the new dates itself; this editor never
    // fetches anything.
    weather: [],
    stages: bundle.stages.map((stage) => (stage.weatherRecordIds.length === 0 ? stage : { ...stage, weatherRecordIds: [] })),
  }
}

// --- speed-driven timing recompute (CDC section 9-11) -----------------------

/** `null` when the route has no usable geometry OR too few points to build a real profile — `computeStageTiming` itself already falls back to the flat-terrain model in that case, exactly like at import time. */
function buildTerrainProfileForRoute(route: Route): readonly TerrainProfilePoint[] | null {
  const geometryWithDistances = routeGeometryWithDistances(route)
  if (geometryWithDistances === null) return null
  const { geometry, distances } = geometryWithDistances
  const source: RouteProfilePosition[] = geometry.map((point, index) => ({
    latitude: point.latitude,
    longitude: point.longitude,
    sourceFileNumber: 1,
    sourceFileName: 'route.gpx',
    distanceKm: distances[index] ?? 0,
    elevationGainM: 0,
    elevationLossM: 0,
    altitudeM: point.altitudeM,
    localSlopePercent: 0,
    speedMultiplier: 1,
    weightedDistanceKm: distances[index] ?? 0,
  }))
  const series = buildTerrainProfileSeries(source)
  return series.length < 2 ? null : series
}

/**
 * Recomputes exactly the four aggregate `RideStage` timing fields at a new
 * reference speed — the same `computeStageTiming` engine `import/gpx/route-analysis.ts`
 * uses at import time, never a second timing model (CDC section 9-10).
 *
 * Automatic mode (CDC section 11): the pause BUDGET itself can change too —
 * `estimateAutomaticBreakBudget` depends on moving duration, which depends
 * on speed — so this re-runs the exact same two-pass pattern
 * (`route-analysis.ts`'s own: a zero-budget pass to learn moving duration,
 * then the real budget, then the final timing) rather than reusing the old
 * budget at a new speed.
 *
 * Custom mode: `pauseDurationSeconds` is the user's own total and is left
 * completely untouched (CDC section 11 — "NE PAS modifier les pauses
 * custom") — only moving/total duration and average speed are recomputed,
 * folding that unchanged pause total in at the new pace.
 */
function recomputeStageTiming(bundle: TripBundle, stage: RideStage, newSpeedKph: number): RideStage {
  const route = bundle.routes.find((candidate) => candidate.id === stage.sourceRouteId)
  const distanceKm = stage.distanceKm
  if (route === undefined || distanceKm === null || !(distanceKm > 0)) return stage

  const terrainProfile = buildTerrainProfileForRoute(route)
  const daySettings = bundle.settings.days.find((candidate) => candidate.dayId === stage.dayId)
  const departureTime = daySettings?.departureTime ?? '08:00'
  const stageSettings = bundle.settings.stages.find((candidate) => candidate.stageId === stage.id)
  const pauseResolution = resolveStagePauseSettings(bundle.settings.global.pausePlanMode, stageSettings)

  if (pauseResolution.mode === 'custom') {
    const totalBreakMinutes = (stage.pauseDurationSeconds ?? 0) / 60
    const timing = computeStageTiming(terrainProfile, distanceKm, { referenceSpeedKph: newSpeedKph, departureTime, totalBreakMinutes })
    return {
      ...stage,
      movingDurationSeconds: timing.movingDurationSeconds,
      totalDurationSeconds: timing.movingDurationSeconds + (stage.pauseDurationSeconds ?? 0),
      estimatedAverageSpeedKph: timing.estimatedAverageSpeedKph,
    }
  }

  const learningPass = computeStageTiming(terrainProfile, distanceKm, { referenceSpeedKph: newSpeedKph, departureTime, totalBreakMinutes: 0 })
  const totalBreakMinutes = estimateAutomaticBreakBudget(distanceKm, learningPass.movingDurationSeconds / 60, stage.elevationGainM)
  const timing = computeStageTiming(terrainProfile, distanceKm, { referenceSpeedKph: newSpeedKph, departureTime, totalBreakMinutes })
  return {
    ...stage,
    movingDurationSeconds: timing.movingDurationSeconds,
    pauseDurationSeconds: timing.pauseDurationSeconds,
    totalDurationSeconds: timing.totalDurationSeconds,
    estimatedAverageSpeedKph: timing.estimatedAverageSpeedKph,
  }
}

function applyReferenceSpeed(bundle: TripBundle, referenceSpeedKph: number): TripBundle {
  const stages = bundle.stages.map((stage) => recomputeStageTiming(bundle, stage, referenceSpeedKph))
  // `TripDaySettings.totalBreakSeconds` mirrors `RideStage.pauseDurationSeconds`
  // at import time (never read back by the live timing engine, which only
  // ever consults the stage field) — kept in sync anyway for consistency.
  const stageByDayId = new Map(stages.map((stage) => [stage.dayId, stage]))
  const days = bundle.settings.days.map((entry) => {
    const stage = stageByDayId.get(entry.dayId)
    return stage === undefined ? entry : { ...entry, totalBreakSeconds: stage.pauseDurationSeconds }
  })
  return {
    ...bundle,
    settings: { ...bundle.settings, global: { ...bundle.settings.global, referenceSpeedKph }, days },
    stages,
  }
}

// --- pure mutation (CDC section 17) -----------------------------------------

/** Pure — `bundle` in, updated `bundle` out, no IO. `updatedTimestamp` is only actually applied when something really changed (the caller checks `tripPreferencesUpdateIsNoop` first). */
export function applyTripPreferences(bundle: TripBundle, update: TripPreferencesUpdate, updatedTimestamp: string): TripBundle {
  let next = bundle

  if (update.name !== undefined) {
    const name = update.name.trim()
    next = { ...next, metadata: { ...next.metadata, name } }
  }

  if (update.startDate !== undefined && isIsoDate(update.startDate)) {
    next = shiftTripStartDate(next, update.startDate)
  }

  if (update.referenceSpeedKph !== undefined) {
    next = applyReferenceSpeed(next, update.referenceSpeedKph)
  }

  if (update.terrainOverride !== undefined) {
    const mountainMode = update.terrainOverride === null ? undefined : update.terrainOverride
    next = { ...next, settings: { ...next.settings, global: { ...next.settings.global, mountainMode } } }
  }

  if (next === bundle) return bundle
  return { ...next, metadata: { ...next.metadata, updatedAt: updatedTimestamp } }
}

// --- invalidation report (CDC section 18) -----------------------------------

export interface TripPreferenceInvalidation {
  readonly metadataChanged: boolean
  readonly calendarChanged: boolean
  readonly timingChanged: boolean
  /** Always mirrors `timingChanged || calendarChanged` — C3's own scoring depends on both the stage's timing (ETA) and the day's weekday (opening hours). */
  readonly pauseRecommendationsChanged: boolean
  readonly weatherChanged: boolean
  /** Always `false` — D3.1 preferences never touch GPX/Postpass/POI (CDC section 8/10/12). */
  readonly postpassChanged: false
}

/** Pure diff between two bundle snapshots — lets a caller log/assert precisely what a preferences save actually touched, without re-deriving it ad hoc. */
export function deriveTripPreferenceInvalidation(previous: TripBundle, next: TripBundle): TripPreferenceInvalidation {
  const metadataChanged = previous.metadata.name !== next.metadata.name
    || previous.metadata.startDate !== next.metadata.startDate
    || previous.metadata.endDate !== next.metadata.endDate
  const calendarChanged = previous.calendar.startDate !== next.calendar.startDate || previous.calendar.endDate !== next.calendar.endDate
  const timingChanged = previous.settings.global.referenceSpeedKph !== next.settings.global.referenceSpeedKph
    || previous.stages.some((stage, index) => {
      const nextStage = next.stages[index]
      return nextStage === undefined
        || stage.movingDurationSeconds !== nextStage.movingDurationSeconds
        || stage.pauseDurationSeconds !== nextStage.pauseDurationSeconds
        || stage.totalDurationSeconds !== nextStage.totalDurationSeconds
    })
  const weatherChanged = previous.weather.length !== next.weather.length
  return {
    metadataChanged,
    calendarChanged,
    timingChanged,
    pauseRecommendationsChanged: timingChanged || calendarChanged,
    weatherChanged,
    postpassChanged: false,
  }
}

// --- orchestration (CDC section 17/19/29) -----------------------------------

export interface UpdateTripPreferencesInput {
  readonly database: IDBDatabase
  readonly tripId: TripId
  readonly update: TripPreferencesUpdate
  readonly now: () => string
}

export type UpdateTripPreferencesResult =
  | { readonly ok: true; readonly bundle: TripBundle; readonly noop: boolean; readonly invalidation: TripPreferenceInvalidation | null }
  | { readonly ok: false; readonly code: 'not-found' | 'invalid-input' | 'storage-error'; readonly message: string; readonly errors?: readonly TripPreferencesFieldError[] }

/**
 * The one light save path (CDC section 17/19): load → pure mutation →
 * validate → ONE atomic `saveTripBundle` → return. Never calls
 * `buildGpxTrip`/`editGpxTrip` — no GPX re-parse, no Postpass, no second
 * save pass. A genuine no-op update (CDC section 29) skips validation and
 * storage entirely — `updatedAt` never moves, nothing is invalidated.
 */
export async function updateTripPreferences(input: UpdateTripPreferencesInput): Promise<UpdateTripPreferencesResult> {
  const fieldErrors = validateTripPreferencesUpdate(input.update)
  if (fieldErrors.length > 0) {
    return { ok: false, code: 'invalid-input', message: fieldErrors[0]?.message ?? 'Préférences invalides.', errors: fieldErrors }
  }

  const tripRepository = createTripRepository(input.database)
  const existing = await tripRepository.loadTripBundle(input.tripId)
  if (existing === null) return { ok: false, code: 'not-found', message: 'Voyage introuvable.' }

  // `shiftTripStartDate` silently no-ops on a still-undated trip (dating one
  // for the first time needs a timezone choice too — out of this
  // milestone's scope, CDC section 6) — surfaced here as a real error
  // rather than a save that quietly did nothing.
  if (input.update.startDate !== undefined && existing.calendar.startDate === null) {
    return { ok: false, code: 'invalid-input', message: 'Ce voyage n’a pas encore de calendrier — la date de départ ne peut pas être modifiée ici.', errors: [{ field: 'startDate', message: 'Voyage non daté.' }] }
  }

  if (tripPreferencesUpdateIsNoop(existing, input.update)) {
    return { ok: true, bundle: existing, noop: true, invalidation: null }
  }

  const next = applyTripPreferences(existing, input.update, input.now())
  const validation = validateTripBundle(next)
  if (!validation.ok) {
    const message = validation.issues[0]?.message ?? 'Voyage modifié invalide.'
    return { ok: false, code: 'invalid-input', message }
  }

  try {
    await tripRepository.saveTripBundle(validation.value)
  } catch (error) {
    const message = error instanceof TripValidationError ? error.message : `Échec de l’enregistrement : ${error instanceof Error ? error.message : 'erreur inconnue'}.`
    return { ok: false, code: 'storage-error', message }
  }

  return { ok: true, bundle: validation.value, noop: false, invalidation: deriveTripPreferenceInvalidation(existing, validation.value) }
}
