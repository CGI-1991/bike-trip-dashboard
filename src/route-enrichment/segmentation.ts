/**
 * DER-DES-DER sections 41-49 — spatial segmentation of a long stage's
 * Postpass search.
 *
 * A 200 km+ stage used to be sent as ONE query covering its whole bounding
 * area, which is what made "temps de recherche Postpass dépassé" so easy to
 * hit: the area grows roughly with the square of the stage length, while the
 * timeout stays fixed. Splitting the search along the route's own cumulative
 * distance keeps every individual query to a bounded, predictable size.
 *
 * Deterministic by construction (section 43): the boundaries come from the
 * GPX's cumulative distance alone — never a bounding box, a wall-clock
 * budget, or anything that varies between runs — so the same route always
 * produces exactly the same segments, and therefore the same cache keys.
 */

import type { RouteGeometryPoint } from '../trip-core/index.ts'
import { cumulativeGeometryDistances } from './chunking.ts'

/** Section 42: no single Postpass query ever covers more than this much route. */
export const MAX_POSTPASS_SEGMENT_KM = 60

/**
 * Section 44: consecutive segments overlap by this much so a village, col or
 * POI sitting right on a boundary is collected by both neighbours rather than
 * falling through the gap between them. The duplicates this creates are
 * removed downstream by the existing `locateAndDeduplicate` pass, which
 * already keys on `osmType:osmId`.
 */
export const POSTPASS_SEGMENT_OVERLAP_KM = 5

/**
 * Section 49: the length a manual "Réessayer" falls back to for a stage whose
 * 60 km segments timed out — half the size rather than the same slow query
 * again ("ne pas envoyer indéfiniment la même requête lente").
 */
export const RETRY_POSTPASS_SEGMENT_KM = 30

export interface RouteSegment {
  readonly index: number
  /** Stable within a route: two runs over the same geometry produce the same key, so it can safely enter a cache identity. */
  readonly key: string
  readonly startDistanceKm: number
  readonly endDistanceKm: number
  readonly geometry: readonly RouteGeometryPoint[]
}

function sliceByDistance(
  geometry: readonly RouteGeometryPoint[],
  distances: readonly number[],
  startKm: number,
  endKm: number,
): readonly RouteGeometryPoint[] {
  const points = geometry.filter((_point, index) => {
    const distance = distances[index] ?? 0
    return distance >= startKm && distance <= endKm
  })
  // A segment must always describe a line, never a single point: fall back to
  // the two nearest points if the filter was too tight (possible on a very
  // sparse geometry).
  if (points.length >= 2) return points
  return geometry.slice(0, 2)
}

/**
 * Splits a route's geometry into overlapping segments of at most
 * `maxSegmentKm`, advancing by `maxSegmentKm - overlapKm` each time.
 *
 * Section 42's worked example — a 205 km stage at 60/5 — yields
 * 0–60, 55–115, 110–170, 165–205. A route at or under the limit yields a
 * single segment covering the whole thing, so a normal stage's behaviour is
 * byte-for-byte what it was before segmentation existed (sections 45-46: only
 * genuinely long stages change).
 */
export function buildRouteSegments(
  geometry: readonly RouteGeometryPoint[],
  maxSegmentKm: number = MAX_POSTPASS_SEGMENT_KM,
  overlapKm: number = POSTPASS_SEGMENT_OVERLAP_KM,
): readonly RouteSegment[] {
  if (geometry.length < 2) return []
  const distances = cumulativeGeometryDistances(geometry)
  const totalKm = distances[distances.length - 1] ?? 0
  const segment = (index: number, startDistanceKm: number, endDistanceKm: number): RouteSegment => ({
    index,
    key: `seg:${startDistanceKm.toFixed(3)}-${endDistanceKm.toFixed(3)}`,
    startDistanceKm,
    endDistanceKm,
    geometry: sliceByDistance(geometry, distances, startDistanceKm, endDistanceKm),
  })

  if (!(maxSegmentKm > 0) || totalKm <= maxSegmentKm) return [segment(0, 0, totalKm)]

  const step = Math.max(1, maxSegmentKm - Math.max(0, overlapKm))
  const segments: RouteSegment[] = []
  for (let startKm = 0; startKm < totalKm; startKm += step) {
    const endKm = Math.min(totalKm, startKm + maxSegmentKm)
    segments.push(segment(segments.length, startKm, endKm))
    if (endKm >= totalKm) break
  }
  return segments
}
