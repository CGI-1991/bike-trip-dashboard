/**
 * Continuity check between two consecutive stages (annexe fonctionnelle
 * section 5.1, CDC phase 6C1 section 13). Always a warning, never a
 * blocker — a real gap may be a deliberate transfer, not a mistake.
 */

import { calculateHaversineDistanceKm } from '../gpx/parser.ts'

/** Centralized threshold (CDC section 23: "seuil de rupture de continuité"). */
export const CONTINUITY_GAP_WARNING_KM = 1

export interface ContinuityCheckResult {
  readonly gapKm: number
  readonly hasWarning: boolean
}

export function checkStageContinuity(
  previousEndLatitude: number,
  previousEndLongitude: number,
  nextStartLatitude: number,
  nextStartLongitude: number,
  thresholdKm = CONTINUITY_GAP_WARNING_KM,
): ContinuityCheckResult {
  const gapKm = calculateHaversineDistanceKm(
    { latitude: previousEndLatitude, longitude: previousEndLongitude, elevationM: null },
    { latitude: nextStartLatitude, longitude: nextStartLongitude, elevationM: null },
  )
  return { gapKm, hasWarning: gapKm > thresholdKm }
}

export interface ContinuitySegment {
  readonly fileName: string
  readonly startLatitude: number
  readonly startLongitude: number
  readonly endLatitude: number
  readonly endLongitude: number
}

export interface ContinuityWarning extends ContinuityCheckResult {
  readonly fromFileName: string
  readonly toFileName: string
}

/** Runs the continuity check across an entire ordered chain of ride stages — off/transfer days are not stages and are never part of this list. */
export function checkChainContinuity(orderedSegments: readonly ContinuitySegment[], thresholdKm = CONTINUITY_GAP_WARNING_KM): readonly ContinuityWarning[] {
  const warnings: ContinuityWarning[] = []
  for (let i = 1; i < orderedSegments.length; i++) {
    const previous = orderedSegments[i - 1]
    const current = orderedSegments[i]
    if (previous === undefined || current === undefined) continue
    const result = checkStageContinuity(previous.endLatitude, previous.endLongitude, current.startLatitude, current.startLongitude, thresholdKm)
    if (result.hasWarning) warnings.push({ ...result, fromFileName: previous.fileName, toFileName: current.fileName })
  }
  return warnings
}
