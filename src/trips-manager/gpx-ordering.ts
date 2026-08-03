/**
 * Generic, pure GPX ordering proposal (annexe fonctionnelle section 3,
 * CDC phase 6C1 section 10). Never mutates the input array; always returns
 * a proposed order for the caller to display and let the user confirm or
 * correct — never silently applied.
 *
 * Strategy, hierarchical:
 * 1. an explicit, consistent numeric prefix in every file name (`01_`, `02-`, ...);
 * 2. failing that, the chain of files minimizing the total geographic gap
 *    between one file's end point and the next file's start point.
 */

import { calculateHaversineDistanceKm } from '../gpx/parser.ts'

export interface GpxOrderingCandidate {
  readonly fileName: string
  readonly startLatitude: number
  readonly startLongitude: number
  readonly endLatitude: number
  readonly endLongitude: number
}

export type GpxOrderingMethod = 'filename-numeric' | 'geographic' | 'single-file'

export interface GpxOrderingResult {
  /** Indices into the original input array, in the proposed order. */
  readonly order: readonly number[]
  readonly method: GpxOrderingMethod
  /** Sum of the geographic gaps between consecutive files in `order` — 0 for a single file. */
  readonly totalGapKm: number
  /** True when the proposed chain's start and end are close enough that it reads as a loop (no obviously-first file). */
  readonly isLoop: boolean
}

/** Threshold below which the proposed chain's two ends are considered "the same place" (a loop). CDC section 10.2 / annexe 3.2. */
export const LOOP_DETECTION_THRESHOLD_KM = 2

const LEADING_NUMBER_PATTERN = /^\D*(\d+)/

export function extractLeadingNumber(fileName: string): number | null {
  const match = LEADING_NUMBER_PATTERN.exec(fileName)
  if (match?.[1] === undefined) return null
  const value = Number(match[1])
  return Number.isSafeInteger(value) ? value : null
}

/** Proposes an order purely from each file name's leading number — only when every file has one and they are pairwise distinct. Returns `null` otherwise (ambiguous, falls back to geographic scoring). */
export function proposeNumericOrder(files: readonly GpxOrderingCandidate[]): readonly number[] | null {
  const numbers = files.map((file) => extractLeadingNumber(file.fileName))
  if (numbers.some((value) => value === null)) return null
  if (new Set(numbers).size !== numbers.length) return null

  return files
    .map((_file, index) => index)
    .sort((left, right) => (numbers[left] as number) - (numbers[right] as number))
}

function point(latitude: number, longitude: number): { readonly latitude: number; readonly longitude: number; readonly elevationM: null } {
  return { latitude, longitude, elevationM: null }
}

/** Great-circle distance from one file's end point to another's start point — the "join gap" CDC section 10 scores chains on. */
export function computeJoinGapKm(from: GpxOrderingCandidate, to: GpxOrderingCandidate): number {
  return calculateHaversineDistanceKm(point(from.endLatitude, from.endLongitude), point(to.startLatitude, to.startLongitude))
}

function chainTotalGapKm(files: readonly GpxOrderingCandidate[], order: readonly number[]): number {
  let total = 0
  for (let i = 1; i < order.length; i++) {
    const previous = files[order[i - 1] as number]
    const current = files[order[i] as number]
    if (previous !== undefined && current !== undefined) total += computeJoinGapKm(previous, current)
  }
  return total
}

/**
 * Greedy nearest-neighbor chain construction from every possible starting
 * file, keeping whichever full chain has the smallest total gap — a
 * deterministic, cheap (O(n^3)) heuristic appropriate for the handful of
 * GPX files a trip realistically has, not an exhaustive TSP solver.
 */
export function proposeGeographicOrder(files: readonly GpxOrderingCandidate[]): { readonly order: readonly number[]; readonly totalGapKm: number } {
  if (files.length <= 1) {
    return { order: files.map((_file, index) => index), totalGapKm: 0 }
  }

  let best: { readonly order: readonly number[]; readonly totalGapKm: number } | null = null

  for (let startIndex = 0; startIndex < files.length; startIndex++) {
    const remaining = new Set(files.map((_file, index) => index))
    remaining.delete(startIndex)
    const order = [startIndex]
    let current = startIndex

    while (remaining.size > 0) {
      let nearest: number | null = null
      let nearestGapKm = Number.POSITIVE_INFINITY
      for (const candidateIndex of remaining) {
        const from = files[current]
        const to = files[candidateIndex]
        if (from === undefined || to === undefined) continue
        const gapKm = computeJoinGapKm(from, to)
        if (gapKm < nearestGapKm) {
          nearestGapKm = gapKm
          nearest = candidateIndex
        }
      }
      if (nearest === null) break
      order.push(nearest)
      remaining.delete(nearest)
      current = nearest
    }

    const totalGapKm = chainTotalGapKm(files, order)
    if (best === null || totalGapKm < best.totalGapKm) {
      best = { order, totalGapKm }
    }
  }

  return best ?? { order: files.map((_file, index) => index), totalGapKm: 0 }
}

export function isLikelyLoop(
  files: readonly GpxOrderingCandidate[],
  order: readonly number[],
  thresholdKm = LOOP_DETECTION_THRESHOLD_KM,
): boolean {
  if (order.length < 2) return false
  const first = files[order[0] as number]
  const last = files[order[order.length - 1] as number]
  if (first === undefined || last === undefined) return false
  const closureGapKm = calculateHaversineDistanceKm(point(first.startLatitude, first.startLongitude), point(last.endLatitude, last.endLongitude))
  return closureGapKm <= thresholdKm
}

/** The single entry point: proposes an order, never applied silently — the caller always shows it for confirmation (CDC section 10). */
export function proposeGpxOrder(files: readonly GpxOrderingCandidate[]): GpxOrderingResult {
  if (files.length <= 1) {
    return { order: files.map((_file, index) => index), method: 'single-file', totalGapKm: 0, isLoop: false }
  }

  const numericOrder = proposeNumericOrder(files)
  if (numericOrder !== null) {
    return { order: numericOrder, method: 'filename-numeric', totalGapKm: chainTotalGapKm(files, numericOrder), isLoop: isLikelyLoop(files, numericOrder) }
  }

  const geographic = proposeGeographicOrder(files)
  return { order: geographic.order, method: 'geographic', totalGapKm: geographic.totalGapKm, isLoop: isLikelyLoop(files, geographic.order) }
}

/**
 * Recomputes the cyclic order once the user picks the actual first stage of
 * a loop (CDC section 10.2/annexe 3.2): rotates the same cycle to start
 * there, trying both directions around it and keeping whichever has the
 * smaller total gap — never a fresh, unrelated re-scoring of the whole set.
 */
export function rotateLoopOrder(
  files: readonly GpxOrderingCandidate[],
  order: readonly number[],
  firstFileIndex: number,
): readonly number[] {
  const position = order.indexOf(firstFileIndex)
  if (position === -1) return order

  const forward = [...order.slice(position), ...order.slice(0, position)]
  const reversedCycle = [...order].reverse()
  const reversedPosition = reversedCycle.indexOf(firstFileIndex)
  const backward = reversedPosition === -1 ? forward : [...reversedCycle.slice(reversedPosition), ...reversedCycle.slice(0, reversedPosition)]

  const forwardGapKm = chainTotalGapKm(files, forward)
  const backwardGapKm = chainTotalGapKm(files, backward)
  return backwardGapKm < forwardGapKm ? backward : forward
}

export function moveOrderEntry(order: readonly number[], fromPosition: number, direction: -1 | 1): readonly number[] {
  const toPosition = fromPosition + direction
  if (fromPosition < 0 || fromPosition >= order.length || toPosition < 0 || toPosition >= order.length) return order
  const next = [...order]
  const [moved] = next.splice(fromPosition, 1)
  if (moved === undefined) return order
  next.splice(toPosition, 0, moved)
  return next
}
