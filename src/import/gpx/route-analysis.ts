/**
 * Bridges one file's `GpxAnalysis` (`analyze-gpx.ts`) into the generic
 * route-analysis engine (`src/analysis/`): terrain/slope profile, climb
 * detection, and duration/ETA timing — CDC phase 6B. Computed independently
 * per file/stage; nothing here carries state from one stage to the next
 * (CDC section 10: "une étape suivante repart toujours de sa propre heure
 * de départ").
 */

import { assessAltitudeQuality, buildDistanceIndexedSeries, smoothElevation } from '../../analysis/elevation-profile.ts'
import { detectClimbs } from '../../analysis/climb-detection.ts'
import { estimateAutomaticBreakBudget } from '../../analysis/pause-budget.ts'
import { buildTerrainSlopeProfile } from '../../analysis/terrain-profile.ts'
import { computeStageTiming } from '../../analysis/timing.ts'
import type { StageTimingResult } from '../../analysis/timing.ts'
import type { Climb, RouteId } from '../../trip-core/index.ts'
import type { TerrainProfilePoint } from '../../route/types.ts'
import type { GpxAnalysis } from './analyze-gpx.ts'
import type { ImportIssue } from './types.ts'
import { importIssue } from './types.ts'

export interface RouteTimingOptions {
  readonly referenceSpeedKph: number
  readonly departureTime: string
  /**
   * A fixed budget in minutes, or `'adaptive'` to use
   * `estimateAutomaticBreakBudget` (annexe fonctionnelle section 12.2, CDC
   * phase 6C1 section 22) — computed per stage from that stage's own
   * distance/moving-duration/D+, never one flat value shared by every
   * stage. Moving duration does not depend on pauses, so this only needs a
   * first timing pass (with a zero budget) to learn it before estimating
   * the real one and re-timing.
   */
  readonly totalBreakMinutes: number | 'adaptive'
}

export interface RouteAnalysisResult {
  readonly terrainProfile: readonly TerrainProfilePoint[] | null
  readonly climbs: readonly Climb[]
  readonly timing: StageTimingResult
  readonly issues: readonly ImportIssue[]
}

export function analyzeRouteTerrainClimbsAndTiming(
  analysis: GpxAnalysis,
  routeIdValue: RouteId,
  idFactory: () => string,
  engineVersion: string,
  timingOptions: RouteTimingOptions,
  fileName: string,
): RouteAnalysisResult {
  const distanceIndexed = buildDistanceIndexedSeries(analysis.points)
  const altitudeQuality = assessAltitudeQuality(distanceIndexed)
  const issues: ImportIssue[] = []

  let terrainProfile: readonly TerrainProfilePoint[] | null = null
  if (altitudeQuality.isSufficient) {
    terrainProfile = buildTerrainSlopeProfile(smoothElevation(distanceIndexed))
  } else if (altitudeQuality.pointsWithAltitude > 0) {
    // Some altitude exists (analyze-gpx.ts's own broader `missing-altitude`
    // issue does not fire here) but not enough to trust a slope model —
    // still a non-blocking condition (CDC section 4: "import toujours
    // valide"), just no climbs and a flat-terrain timing fallback.
    issues.push(
      importIssue(
        'insufficient-altitude',
        'warning',
        `${fileName} : couverture altimétrique insuffisante (${Math.round(altitudeQuality.coverageRatio * 100)}%) pour détecter les montées ou calculer une pente fiable ; ETA basée sur une vitesse constante.`,
        { fileName },
      ),
    )
  }

  const climbs = terrainProfile === null ? [] : detectClimbs(terrainProfile, analysis.waypoints, routeIdValue, idFactory, engineVersion)

  const resolvedBreakMinutes =
    timingOptions.totalBreakMinutes === 'adaptive'
      ? estimateAutomaticBreakBudget(
          analysis.distanceKm,
          computeStageTiming(terrainProfile, analysis.distanceKm, { ...timingOptions, totalBreakMinutes: 0 }).movingDurationSeconds / 60,
          analysis.elevationGainM,
        )
      : timingOptions.totalBreakMinutes
  const timing = computeStageTiming(terrainProfile, analysis.distanceKm, { ...timingOptions, totalBreakMinutes: resolvedBreakMinutes })

  return { terrainProfile, climbs, timing, issues }
}
