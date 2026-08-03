/**
 * Duplicate detection for the import wizard (annexe fonctionnelle section
 * 5.2/5.3, CDC phase 6C1 section 12). Two distinct tiers, deliberately not
 * merged: a byte-identical hash match always blocks, a geometric
 * similarity is always just a warning. All thresholds centralized here —
 * never scattered constants.
 */

import { calculateHaversineDistanceKm } from '../gpx/parser.ts'

export const SIMILARITY_THRESHOLDS = {
  /** Start points within this distance of each other. */
  startProximityKm: 0.3,
  /** End points within this distance of each other. */
  endProximityKm: 0.3,
  /** Relative difference in total distance, e.g. 0.05 = 5 %. */
  distanceRelativeTolerance: 0.05,
  /** How close two sampled points must be to count as "matching". */
  sampledPointToleranceKm: 0.3,
  /** Share of sampled points that must match for the traces to be flagged similar. */
  minimumSampledMatchRatio: 0.8,
} as const

export interface DuplicateCandidate {
  readonly fileName: string
  readonly sha256: string | null
  readonly startLatitude: number
  readonly startLongitude: number
  readonly endLatitude: number
  readonly endLongitude: number
  readonly distanceKm: number
  /** A handful of evenly-spaced points along the trace — never the full point list (CDC section 12: "ne crée pas un algorithme lourd"). */
  readonly sampledPoints: readonly { readonly latitude: number; readonly longitude: number }[]
}

export interface StrictDuplicateGroup {
  readonly sha256: string
  readonly fileNames: readonly string[]
}

export interface SimilarTracePair {
  readonly fileNameA: string
  readonly fileNameB: string
  readonly startGapKm: number
  readonly endGapKm: number
  readonly distanceRelativeDiff: number
  readonly sampledMatchRatio: number
}

/** Byte-identical files (same SHA-256) — always blocking until resolved by the caller. Files with no hash yet are never grouped. */
export function detectStrictDuplicates(files: readonly DuplicateCandidate[]): readonly StrictDuplicateGroup[] {
  const byHash = new Map<string, string[]>()
  for (const file of files) {
    if (file.sha256 === null) continue
    const group = byHash.get(file.sha256) ?? []
    group.push(file.fileName)
    byHash.set(file.sha256, group)
  }
  return [...byHash.entries()]
    .filter(([, fileNames]) => fileNames.length > 1)
    .map(([sha256, fileNames]) => ({ sha256, fileNames }))
}

function point(latitude: number, longitude: number): { readonly latitude: number; readonly longitude: number; readonly elevationM: null } {
  return { latitude, longitude, elevationM: null }
}

function sampledMatchRatio(
  a: readonly { readonly latitude: number; readonly longitude: number }[],
  b: readonly { readonly latitude: number; readonly longitude: number }[],
  toleranceKm: number,
): number {
  if (a.length === 0) return 0
  const matches = a.filter((pointA) =>
    b.some((pointB) => calculateHaversineDistanceKm(point(pointA.latitude, pointA.longitude), point(pointB.latitude, pointB.longitude)) <= toleranceKm),
  )
  return matches.length / a.length
}

/**
 * Two different files that plausibly represent nearly the same trace —
 * always a non-blocking warning (CDC section 12.2: "warning non
 * bloquant"). Deliberately simple: proximity of both endpoints, distance
 * within tolerance, and a majority of sampled points matching.
 */
export function detectSimilarTraces(
  files: readonly DuplicateCandidate[],
  thresholds: typeof SIMILARITY_THRESHOLDS = SIMILARITY_THRESHOLDS,
): readonly SimilarTracePair[] {
  const pairs: SimilarTracePair[] = []

  for (let i = 0; i < files.length; i++) {
    for (let j = i + 1; j < files.length; j++) {
      const a = files[i]
      const b = files[j]
      if (a === undefined || b === undefined) continue

      const startGapKm = calculateHaversineDistanceKm(point(a.startLatitude, a.startLongitude), point(b.startLatitude, b.startLongitude))
      const endGapKm = calculateHaversineDistanceKm(point(a.endLatitude, a.endLongitude), point(b.endLatitude, b.endLongitude))
      const largerDistanceKm = Math.max(a.distanceKm, b.distanceKm)
      const distanceRelativeDiff = largerDistanceKm <= 0 ? 0 : Math.abs(a.distanceKm - b.distanceKm) / largerDistanceKm
      const matchRatioAtoB = sampledMatchRatio(a.sampledPoints, b.sampledPoints, thresholds.sampledPointToleranceKm)
      const matchRatioBtoA = sampledMatchRatio(b.sampledPoints, a.sampledPoints, thresholds.sampledPointToleranceKm)
      const sampledMatchRatioValue = Math.min(matchRatioAtoB, matchRatioBtoA)

      if (
        startGapKm <= thresholds.startProximityKm &&
        endGapKm <= thresholds.endProximityKm &&
        distanceRelativeDiff <= thresholds.distanceRelativeTolerance &&
        sampledMatchRatioValue >= thresholds.minimumSampledMatchRatio
      ) {
        pairs.push({ fileNameA: a.fileName, fileNameB: b.fileName, startGapKm, endGapKm, distanceRelativeDiff, sampledMatchRatio: sampledMatchRatioValue })
      }
    }
  }

  return pairs
}

/** Evenly-spaced sample of a point list (never the full trace) for the similarity check above. */
export function sampleTracePoints<T extends { readonly latitude: number; readonly longitude: number }>(
  points: readonly T[],
  sampleCount = 5,
): readonly { readonly latitude: number; readonly longitude: number }[] {
  if (points.length === 0) return []
  if (points.length <= sampleCount) return points.map((point) => ({ latitude: point.latitude, longitude: point.longitude }))

  const samples: { readonly latitude: number; readonly longitude: number }[] = []
  for (let i = 0; i < sampleCount; i++) {
    const index = Math.round((i / (sampleCount - 1)) * (points.length - 1))
    const source = points[index]
    if (source !== undefined) samples.push({ latitude: source.latitude, longitude: source.longitude })
  }
  return samples
}
