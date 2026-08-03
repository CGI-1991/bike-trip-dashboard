/**
 * Duration/ETA engine (CDC section 17.1): "vitesse locale = vitesse de
 * référence × facteur de terrain, temps local = distance locale / vitesse
 * locale" — never distance divided by an imposed average speed. Reuses the
 * historical engine's own speed-from-grade/time-integration core
 * (`createTerrainTiming`/`interpolateTerrainTiming`,
 * `src/route/terrain-profile.ts`) unchanged, fed by this phase's own
 * generic terrain profile (`terrain-profile.ts`) instead of the RGA-shaped
 * `RouteProfilePosition`. Automatic pauses come from `pauses.ts` (POI-free,
 * per CDC section 9/18). Every stage is computed independently — no shared
 * state carries over between two `RideStage`s (CDC section 10: "une étape
 * suivante repart toujours de sa propre heure de départ").
 *
 * The full per-point timeline is intentionally never persisted (see
 * `climb-profile.ts`'s note on the same pattern) — only the aggregate
 * `RideStage` fields (`movingDurationSeconds`/`pauseDurationSeconds`/
 * `totalDurationSeconds`/`estimatedAverageSpeedKph`) are.
 */

import { createTerrainTiming, interpolateTerrainTiming } from '../route/terrain-profile.ts'
import type { TerrainProfilePoint } from '../route/types.ts'
import { createRouteClockTime } from '../route/time.ts'
import type { RouteClockTime } from '../route/types.ts'
import { distributeAutomaticPauses } from './pauses.ts'
import type { PauseAnchor } from './pauses.ts'

export interface TimingSettings {
  readonly referenceSpeedKph: number
  readonly departureTime: string
  readonly totalBreakMinutes: number
}

export interface TimelinePoint {
  readonly distanceKm: number
  readonly elevationM: number | null
  readonly movingElapsedMinutes: number
  readonly elapsedMinutes: number
  readonly clockTime: RouteClockTime
}

export interface StageTimingResult {
  readonly movingDurationSeconds: number
  readonly pauseDurationSeconds: number
  readonly totalDurationSeconds: number
  readonly estimatedAverageSpeedKph: number
  readonly pauses: readonly PauseAnchor[]
  readonly timeline: readonly TimelinePoint[]
}

function parseClockToMinutes(value: string): number {
  const match = /^(?<hours>[01]\d|2[0-3]):(?<minutes>[0-5]\d)$/.exec(value)
  if (match?.groups === undefined) {
    throw new Error(`Heure de départ invalide : ${value}.`)
  }
  return Number(match.groups.hours) * 60 + Number(match.groups.minutes)
}

function pauseMinutesBefore(distanceKm: number, pauses: readonly PauseAnchor[]): number {
  return pauses.reduce((total, pause) => (pause.distanceKm < distanceKm - 1e-9 ? total + pause.durationMinutes : total), 0)
}

function buildTimeline(
  points: readonly { readonly distanceKm: number; readonly elevationM: number | null; readonly movingElapsedMinutes: number }[],
  pauses: readonly PauseAnchor[],
  departureMinutes: number,
): readonly TimelinePoint[] {
  return points.map((point) => {
    const elapsedMinutes = point.movingElapsedMinutes + pauseMinutesBefore(point.distanceKm, pauses)
    return {
      distanceKm: point.distanceKm,
      elevationM: point.elevationM,
      movingElapsedMinutes: point.movingElapsedMinutes,
      elapsedMinutes,
      clockTime: createRouteClockTime(departureMinutes, elapsedMinutes),
    }
  })
}

/**
 * Flat-terrain fallback (CDC section 4: "si l'altitude est insuffisante...
 * timings possibles uniquement selon les informations réellement
 * disponibles") — still the same `distance / vitesse` model, just with a
 * neutral (1×) terrain factor everywhere since no usable slope exists. Only
 * a 2-point timeline is produced: with no reliable slope, any intermediate
 * point would be manufactured precision this module does not have grounds
 * to claim.
 */
function computeFlatTiming(totalDistanceKm: number, settings: TimingSettings, departureMinutes: number): StageTimingResult {
  const movingDurationMinutes = (totalDistanceKm / settings.referenceSpeedKph) * 60
  const pauses = distributeAutomaticPauses(totalDistanceKm, settings.totalBreakMinutes)
  const timeline = buildTimeline(
    [
      { distanceKm: 0, elevationM: null, movingElapsedMinutes: 0 },
      { distanceKm: totalDistanceKm, elevationM: null, movingElapsedMinutes: movingDurationMinutes },
    ],
    pauses,
    departureMinutes,
  )

  const movingDurationSeconds = Math.round(movingDurationMinutes * 60)
  const pauseDurationSeconds = Math.round(settings.totalBreakMinutes * 60)

  return {
    movingDurationSeconds,
    pauseDurationSeconds,
    totalDurationSeconds: movingDurationSeconds + pauseDurationSeconds,
    estimatedAverageSpeedKph: totalDistanceKm / (movingDurationMinutes / 60),
    pauses,
    timeline,
  }
}

/**
 * Grade-aware timing over a sufficiently-altituded terrain profile
 * (`terrain-profile.ts`). Pass `terrainProfile: null` (from an
 * insufficiently-altituded file) to fall back to the flat-terrain model
 * instead.
 */
export function computeStageTiming(
  terrainProfile: readonly TerrainProfilePoint[] | null,
  totalDistanceKm: number,
  settings: TimingSettings,
): StageTimingResult {
  if (!(settings.referenceSpeedKph > 0)) {
    throw new Error('referenceSpeedKph doit être strictement positif.')
  }
  const departureMinutes = parseClockToMinutes(settings.departureTime)

  if (terrainProfile === null || terrainProfile.length < 2 || !(totalDistanceKm > 0)) {
    return computeFlatTiming(totalDistanceKm, settings, departureMinutes)
  }

  const timing = createTerrainTiming(terrainProfile, totalDistanceKm, settings.referenceSpeedKph)
  const pauses = distributeAutomaticPauses(totalDistanceKm, settings.totalBreakMinutes)
  const timeline = buildTimeline(
    timing.points.map((point) => ({ distanceKm: point.distanceKm, elevationM: point.elevationM, movingElapsedMinutes: point.movingElapsedMinutes })),
    pauses,
    departureMinutes,
  )

  const movingDurationSeconds = Math.round(timing.totalMovingMinutes * 60)
  const pauseDurationSeconds = Math.round(settings.totalBreakMinutes * 60)

  return {
    movingDurationSeconds,
    pauseDurationSeconds,
    totalDurationSeconds: movingDurationSeconds + pauseDurationSeconds,
    estimatedAverageSpeedKph: totalDistanceKm / (timing.totalMovingMinutes / 60),
    pauses,
    timeline,
  }
}

export { interpolateTerrainTiming }
