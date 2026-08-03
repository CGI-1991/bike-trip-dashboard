/**
 * Turns a parsed GPX document (`gpx-xml.ts`) into distance/elevation/profile
 * metrics and route-worthy geometry. Reuses the exact historical algorithms
 * for distance and D+/D- — `calculateHaversineDistanceKm` and
 * `calculateSegmentMetrics` from `src/gpx/parser.ts` — rather than
 * reimplementing them, so a generic import produces the same numbers the
 * RGA's own pipeline would for the same points (see the RGA compatibility
 * test). Nothing here computes ETA, ranks climbs, or reads the real clock.
 */

import { calculateHaversineDistanceKm, calculateSegmentMetrics } from '../../gpx/parser.ts'
import { isLatitude, isLongitude } from '../../trip-core/validation/primitives.ts'
import type { GpxXmlDocument, GpxXmlPoint, GpxXmlWaypoint } from './gpx-xml.ts'
import { GpxImportError, importIssue } from './types.ts'
import type { ImportIssue } from './types.ts'

/** The continuity tolerance the historical route engine already uses between GPX boundaries (CDC section 7: "signaler les discontinuités"). */
const CONTINUITY_TOLERANCE_KM = 0.1

const DEFAULT_RESAMPLE_INTERVAL_METERS = 50

export interface AnalyzedPoint {
  readonly latitude: number
  readonly longitude: number
  readonly elevationM: number | null
}

export interface AnalyzedWaypoint {
  readonly name: string | null
  readonly description: string | null
  readonly latitude: number
  readonly longitude: number
  readonly elevationM: number | null
}

export interface RouteProfilePoint {
  readonly distanceKm: number
  readonly elevationM: number | null
  readonly gradePercent: number | null
}

export interface RouteProfileResult {
  readonly resampleIntervalMeters: number
  readonly points: readonly RouteProfilePoint[]
}

export interface GpxAnalysis {
  readonly name: string | null
  readonly points: readonly AnalyzedPoint[]
  readonly distanceKm: number
  readonly elevationGainM: number | null
  readonly elevationLossM: number | null
  readonly minAltitudeM: number | null
  readonly maxAltitudeM: number | null
  readonly trackCount: number
  readonly segmentCount: number
  readonly hasAltitude: boolean
  readonly profile: RouteProfileResult | null
  readonly waypoints: readonly AnalyzedWaypoint[]
  readonly issues: readonly ImportIssue[]
}

function isValidCoordinatePoint(point: { readonly latitude: number; readonly longitude: number }): boolean {
  return isLatitude(point.latitude) && isLongitude(point.longitude)
}

interface RawSegment {
  readonly points: readonly GpxXmlPoint[]
}

function collectGeometrySource(document: GpxXmlDocument): {
  readonly trackCount: number
  readonly segmentCount: number
  readonly name: string | null
  readonly rawSegments: readonly RawSegment[]
} {
  if (document.tracks.length > 0) {
    const rawSegments = document.tracks.flatMap((track) => track.segments)
    const name = document.tracks.map((track) => track.name).find((trackName): trackName is string => trackName !== null) ?? document.metadataName
    return { trackCount: document.tracks.length, segmentCount: rawSegments.length, name, rawSegments }
  }

  if (document.routes.length > 0) {
    const name = document.routes.map((route) => route.name).find((routeName): routeName is string => routeName !== null) ?? document.metadataName
    return {
      trackCount: document.routes.length,
      segmentCount: document.routes.length,
      name,
      rawSegments: document.routes.map((route) => ({ points: route.points })),
    }
  }

  return { trackCount: 0, segmentCount: 0, name: document.metadataName, rawSegments: [] }
}

function parseTimestampMs(timestamp: string | null): number | null {
  if (timestamp === null) return null
  const parsed = Date.parse(timestamp)
  return Number.isFinite(parsed) ? parsed : null
}

function buildCumulativeDistancesKm(points: readonly AnalyzedPoint[]): readonly number[] {
  const distances: number[] = [0]
  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1]
    const current = points[index]
    if (previous === undefined || current === undefined) continue
    distances.push((distances[index - 1] ?? 0) + calculateHaversineDistanceKm(previous, current))
  }
  return distances
}

function interpolateElevationAtKm(
  points: readonly AnalyzedPoint[],
  distancesKm: readonly number[],
  targetKm: number,
): number | null {
  let afterIndex = distancesKm.findIndex((distanceKm) => distanceKm >= targetKm)
  if (afterIndex === -1) afterIndex = distancesKm.length - 1
  const beforeIndex = Math.max(0, afterIndex - 1)
  const afterPoint = points[afterIndex]
  const beforePoint = points[beforeIndex]
  const afterElevation = afterPoint?.elevationM ?? null
  const beforeElevation = beforePoint?.elevationM ?? null

  if (beforeElevation === null) return afterElevation
  if (afterElevation === null) return beforeElevation

  const beforeDistanceKm = distancesKm[beforeIndex] ?? 0
  const afterDistanceKm = distancesKm[afterIndex] ?? 0
  const spanKm = afterDistanceKm - beforeDistanceKm
  if (spanKm <= 0) return afterElevation

  const ratio = (targetKm - beforeDistanceKm) / spanKm
  return beforeElevation + (afterElevation - beforeElevation) * ratio
}

/**
 * Resamples the route's elevation at a fixed interval (CDC section 11.4: 50 m
 * recommended step). Grade is left `null` — computing it belongs to the
 * route-timing engine (`src/route/terrain-profile.ts`), a distinct concern
 * this generic elevation profile does not need to duplicate.
 */
function buildElevationProfile(
  points: readonly AnalyzedPoint[],
  resampleIntervalMeters = DEFAULT_RESAMPLE_INTERVAL_METERS,
): RouteProfileResult {
  const distancesKm = buildCumulativeDistancesKm(points)
  const totalDistanceKm = distancesKm[distancesKm.length - 1] ?? 0
  const intervalKm = resampleIntervalMeters / 1000
  const profilePoints: RouteProfilePoint[] = []

  for (let targetKm = 0; targetKm < totalDistanceKm; targetKm += intervalKm) {
    profilePoints.push({ distanceKm: targetKm, elevationM: interpolateElevationAtKm(points, distancesKm, targetKm), gradePercent: null })
  }

  const lastPushed = profilePoints[profilePoints.length - 1]
  if (lastPushed === undefined || lastPushed.distanceKm < totalDistanceKm) {
    profilePoints.push({ distanceKm: totalDistanceKm, elevationM: interpolateElevationAtKm(points, distancesKm, totalDistanceKm), gradePercent: null })
  }

  return { resampleIntervalMeters, points: profilePoints }
}

/**
 * Validates and analyzes one already-parsed GPX document. Throws
 * `GpxImportError` (`unsupported-content` / `no-route-points`) for the
 * conditions that make the whole file unusable; every other problem
 * (a discontinuity, missing altitude, an out-of-range point, a
 * non-monotonic timestamp) becomes a non-blocking `ImportIssue` instead —
 * the file is still imported, per CDC section 10's "import toujours valide".
 */
export function analyzeGpxDocument(document: GpxXmlDocument, fileName: string): GpxAnalysis {
  const issues: ImportIssue[] = []

  if (document.tracks.length === 0 && document.routes.length === 0 && document.waypoints.length === 0) {
    throw new GpxImportError(
      'unsupported-content',
      `${fileName} : aucun contenu géographique exploitable (ni trace, ni route, ni waypoint).`,
    )
  }

  const { trackCount, segmentCount, name, rawSegments } = collectGeometrySource(document)

  if (rawSegments.length === 0) {
    throw new GpxImportError('no-route-points', `${fileName} : aucune balise trk ou rte exploitable, seuls des waypoints sont présents.`)
  }

  const populatedSegments = rawSegments.filter((segment) => segment.points.length > 0)
  const validSegments: AnalyzedPoint[][] = []

  populatedSegments.forEach((segment, segmentIndex) => {
    const validPoints: AnalyzedPoint[] = []
    segment.points.forEach((point, pointIndex) => {
      if (isValidCoordinatePoint(point)) {
        validPoints.push({ latitude: point.latitude, longitude: point.longitude, elevationM: point.elevationM })
      } else {
        issues.push(
          importIssue('invalid-coordinate', 'warning', `${fileName} : coordonnée invalide ignorée (segment ${segmentIndex + 1}, point ${pointIndex + 1}).`, {
            fileName,
            context: { segmentIndex, pointIndex, latitude: point.latitude, longitude: point.longitude },
          }),
        )
      }
    })
    if (validPoints.length > 0) validSegments.push(validPoints)
  })

  // Non-monotonic timestamps (CDC section 11.2) — reported once, against the
  // original per-segment point order, before timestamps are dropped below.
  let previousTimestampMs: number | null = null
  outer: for (const segment of populatedSegments) {
    for (const point of segment.points) {
      const timestampMs = parseTimestampMs(point.timestamp)
      if (timestampMs === null) continue
      if (previousTimestampMs !== null && timestampMs < previousTimestampMs) {
        issues.push(importIssue('non-monotonic-timestamp', 'warning', `${fileName} : horodatages GPX non monotones détectés.`, { fileName }))
        break outer
      }
      previousTimestampMs = timestampMs
    }
  }

  // Boundary discontinuities between concatenated tracks/segments — never
  // silently merged, always surfaced (CDC section 7's "un GPX = une étape").
  for (let index = 1; index < validSegments.length; index++) {
    const previousSegment = validSegments[index - 1]
    const currentSegment = validSegments[index]
    const previousLastPoint = previousSegment?.[previousSegment.length - 1]
    const currentFirstPoint = currentSegment?.[0]
    if (previousLastPoint === undefined || currentFirstPoint === undefined) continue
    const gapKm = calculateHaversineDistanceKm(previousLastPoint, currentFirstPoint)
    if (gapKm > CONTINUITY_TOLERANCE_KM) {
      issues.push(
        importIssue('gpx-discontinuity', 'warning', `${fileName} : discontinuité de ${gapKm.toFixed(3)} km entre deux segments/tracks concaténés.`, {
          fileName,
          context: { segmentIndex: index, gapKm },
        }),
      )
    }
  }

  const points = validSegments.flat()

  if (points.length < 2) {
    throw new GpxImportError('no-route-points', `${fileName} : moins de 2 points valides après filtrage des coordonnées invalides.`)
  }

  const { distanceKm, elevationGainM, elevationLossM } = calculateSegmentMetrics(points)
  const elevations = points.map((point) => point.elevationM).filter((elevation): elevation is number => elevation !== null)
  const hasAltitude = elevations.length > 0

  if (!hasAltitude) {
    issues.push(importIssue('missing-altitude', 'warning', `${fileName} : aucune altitude exploitable, D+/D-/min/max resteront null.`, { fileName }))
  }

  const minAltitudeM = hasAltitude ? elevations.reduce((minimum, elevation) => Math.min(minimum, elevation)) : null
  const maxAltitudeM = hasAltitude ? elevations.reduce((maximum, elevation) => Math.max(maximum, elevation)) : null

  const waypoints: AnalyzedWaypoint[] = []
  document.waypoints.forEach((waypoint: GpxXmlWaypoint, waypointIndex) => {
    if (isValidCoordinatePoint(waypoint)) {
      waypoints.push({ name: waypoint.name, description: waypoint.description, latitude: waypoint.latitude, longitude: waypoint.longitude, elevationM: waypoint.elevationM })
    } else {
      issues.push(
        importIssue('invalid-coordinate', 'warning', `${fileName} : waypoint ${waypointIndex + 1} ignoré (coordonnée invalide).`, {
          fileName,
          context: { waypointIndex },
        }),
      )
    }
  })

  return {
    name,
    points,
    distanceKm,
    elevationGainM,
    elevationLossM,
    minAltitudeM,
    maxAltitudeM,
    trackCount,
    segmentCount,
    hasAltitude,
    profile: hasAltitude ? buildElevationProfile(points) : null,
    waypoints,
    issues,
  }
}
