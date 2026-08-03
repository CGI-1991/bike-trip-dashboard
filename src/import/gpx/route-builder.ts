/**
 * Builds a `Route` and its `RoutePoint`s (from GPX waypoints) out of one
 * file's `GpxAnalysis`. One file always produces exactly one `Route` with
 * exactly one `RouteSegmentDescriptor` (`index: 0`) — CDC section 7.2's
 * "one GPX = one segment by default" — even when the file itself concatenated
 * several internal tracks/segments; the number of tracks/segments actually
 * found stays visible only via the (non-blocking) `ImportIssue`s
 * `analyze-gpx.ts` already produced, not as a second, redundant field here.
 */

import type { DataProvenance, Route, RoutePoint, SourceFileId } from '../../trip-core/index.ts'
import { routeId as toRouteId, routePointId } from '../../trip-core/index.ts'
import type { AnalyzedWaypoint, GpxAnalysis } from './analyze-gpx.ts'
import type { ImportIssue } from './types.ts'

function gpxProvenance(sourceFileId: SourceFileId, engineVersion: string): DataProvenance {
  return {
    sourceType: 'gpx',
    sourceId: sourceFileId,
    fetchedAt: null,
    engineVersion,
    confidence: 'high',
    manuallyOverridden: false,
  }
}

/** Degraded (but still valid — CDC section 10) only when points were actually dropped or segments don't line up; missing altitude alone is not a degradation. */
function parsingStatusFor(issues: readonly ImportIssue[]): 'success' | 'partial' {
  return issues.some((issue) => issue.code === 'invalid-coordinate' || issue.code === 'gpx-discontinuity') ? 'partial' : 'success'
}

export interface BuiltRoute {
  readonly route: Route
  readonly routePoints: readonly RoutePoint[]
}

function buildWaypointRoutePoint(
  waypoint: AnalyzedWaypoint,
  index: number,
  routeIdValue: ReturnType<typeof toRouteId>,
  sourceFileId: SourceFileId,
  engineVersion: string,
  idFactory: () => string,
): RoutePoint {
  return {
    id: routePointId(idFactory()),
    routeId: routeIdValue,
    // Generic bucket only — CDC section 12 forbids guessing a more specific
    // category (col/lodging/resupply/pause) without explicit GPX data.
    type: 'poi',
    name: waypoint.name ?? `Point d'intérêt ${index + 1}`,
    latitude: waypoint.latitude,
    longitude: waypoint.longitude,
    elevationM: waypoint.elevationM,
    // Not resolved to a position along the route in this phase — no
    // nearest-point matching is implemented here.
    trackDistanceKm: null,
    provenance: gpxProvenance(sourceFileId, engineVersion),
  }
}

export function buildRouteFromAnalysis(
  analysis: GpxAnalysis,
  sourceFileId: SourceFileId,
  routeIdValue: string,
  engineVersion: string,
  idFactory: () => string,
): BuiltRoute {
  const parsingStatus = parsingStatusFor(analysis.issues)
  const parsingErrors = analysis.issues.map((issue) => issue.message)
  const routeIdBranded = toRouteId(routeIdValue)

  const route: Route = {
    id: routeIdBranded,
    sourceFileId,
    segments: [
      {
        index: 0,
        name: analysis.name,
        distanceKm: analysis.distanceKm,
        elevationGainM: analysis.elevationGainM,
        elevationLossM: analysis.elevationLossM,
      },
    ],
    geometry: {
      full: analysis.points.map((point) => ({ latitude: point.latitude, longitude: point.longitude, altitudeM: point.elevationM })),
      simplified: null,
    },
    profile: analysis.profile === null ? null : { resampleIntervalMeters: analysis.profile.resampleIntervalMeters, points: analysis.profile.points },
    parsingStatus,
    parsingErrors,
    provenance: gpxProvenance(sourceFileId, engineVersion),
  }

  const routePoints = analysis.waypoints.map((waypoint, index) =>
    buildWaypointRoutePoint(waypoint, index, routeIdBranded, sourceFileId, engineVersion, idFactory),
  )

  return { route, routePoints }
}
