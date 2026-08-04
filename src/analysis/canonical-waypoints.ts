/**
 * Canonical, ordered, deduplicated waypoints for one stage (CDC Jalon B,
 * sections 4-5: "points de passage canoniques"). A pure view-model computed
 * on demand, like every other `src/analysis/*` module — never persisted
 * into `TripBundle` (a derived view is simpler than yet another stored
 * collection, per the resume brief's own instruction).
 *
 * Sources merged: the stage's own start/end locations, its structural
 * `RoutePoint`s (city/town/village/mountain-pass/saddle — V1 final scope,
 * stability/UX hardening 2026-08-04: `hamlet`/`peak` are never surfaced
 * here even if an older `TripBundle` still has one on disk — read
 * compatibility only, see `trip-core/model/route-point.ts::
 * OsmRouteFeatureType`), and its detected `Climb`s. Pauses are
 * intentionally NOT attached here — that is `pause-placement.ts`'s job,
 * layered on top of this module's output.
 */

import { cumulativeGeometryDistances } from '../route-enrichment/chunking.ts'
import { normalizeName } from '../route-enrichment/enrichment.ts'
import { routeGeometry } from '../route-enrichment/route-fingerprint.ts'
import type { Climb, ClimbId, RideStage, Route, RouteGeometryPoint, RoutePoint } from '../trip-core/index.ts'

export type CanonicalWaypointKind = 'start' | 'end' | 'city' | 'town' | 'village' | 'mountain-pass' | 'saddle' | 'climb' | 'pause'
export type CanonicalWaypointImportance = 'major' | 'secondary' | 'minor'

/** The only `RoutePoint.osmFeatureType` values the generic pipeline still surfaces (V1 final scope). */
const SURFACED_STRUCTURAL_TYPES: ReadonlySet<string> = new Set(['city', 'town', 'village', 'mountain-pass', 'saddle'])

export interface CanonicalWaypoint {
  readonly id: string
  readonly kind: CanonicalWaypointKind
  readonly importance: CanonicalWaypointImportance
  readonly visibleByDefault: boolean
  readonly name: string
  readonly trackDistanceKm: number
  readonly latitude: number
  readonly longitude: number
  readonly elevationM: number | null
  /** Set when this waypoint carries (merged into, or stands in for) a detected climb. */
  readonly climbId: ClimbId | null
  /** Filled by `pause-placement.ts` — always `null` from this module's own output. */
  readonly pauseDurationMinutes: number | null
  /** Filled by `waypoint-timeline.ts` — always `null` from this module's own output. */
  readonly elapsedMinutes: number | null
  readonly clockTime: string | null
}

export interface BuildCanonicalWaypointsInput {
  readonly stage: RideStage
  readonly route: Route
  readonly routePoints: readonly RoutePoint[]
  readonly climbs: readonly Climb[]
}

/**
 * Priority hierarchy (CDC section 5): lower value sorts/wins first when two
 * waypoints would otherwise tie or visually collide.
 */
const KIND_PRIORITY: Readonly<Record<CanonicalWaypointKind, number>> = {
  start: 0,
  end: 0,
  'mountain-pass': 1,
  saddle: 2,
  city: 3,
  town: 4,
  climb: 5,
  village: 6,
  pause: 7,
}

const KIND_PRESENTATION: Readonly<Record<CanonicalWaypointKind, { readonly importance: CanonicalWaypointImportance; readonly visibleByDefault: boolean }>> = {
  start: { importance: 'major', visibleByDefault: true },
  end: { importance: 'major', visibleByDefault: true },
  'mountain-pass': { importance: 'major', visibleByDefault: true },
  saddle: { importance: 'major', visibleByDefault: true },
  city: { importance: 'major', visibleByDefault: true },
  town: { importance: 'major', visibleByDefault: true },
  climb: { importance: 'secondary', visibleByDefault: true },
  // Villages stay out of the compact map/profile by default (CDC section 19/21)
  // but are not "minor/hidden" in the waypoint list the way hamlets used to be.
  village: { importance: 'secondary', visibleByDefault: false },
  pause: { importance: 'minor', visibleByDefault: true },
}

export function canonicalWaypointPriority(kind: CanonicalWaypointKind): number {
  return KIND_PRIORITY[kind]
}

/** A landmark may rename/merge into a climb exactly like `enrichment.ts::matchingLandmark` — same ~1 km tolerance, same name-based rule, kept in sync deliberately. */
const CLIMB_MERGE_TOLERANCE_KM = 1

/** Reusable route-position interpolation, shared with `pause-placement.ts` for placing synthetic pauses. */
export function routeGeometryWithDistances(route: Route): { readonly geometry: readonly RouteGeometryPoint[]; readonly distances: readonly number[] } | null {
  const geometry = routeGeometry(route)
  return geometry === null ? null : { geometry, distances: cumulativeGeometryDistances(geometry) }
}

export function pointAtDistance(geometry: readonly RouteGeometryPoint[], distances: readonly number[], targetKm: number): RouteGeometryPoint {
  for (let index = 1; index < geometry.length; index++) {
    const before = geometry[index - 1]
    const after = geometry[index]
    const beforeDistance = distances[index - 1] ?? 0
    const afterDistance = distances[index] ?? beforeDistance
    if (before === undefined || after === undefined) continue
    if (targetKm > afterDistance && index < geometry.length - 1) continue
    const ratio = afterDistance <= beforeDistance ? 0 : Math.max(0, Math.min(1, (targetKm - beforeDistance) / (afterDistance - beforeDistance)))
    const altitudeM = before.altitudeM === null || after.altitudeM === null ? after.altitudeM ?? before.altitudeM : before.altitudeM + (after.altitudeM - before.altitudeM) * ratio
    return { latitude: before.latitude + (after.latitude - before.latitude) * ratio, longitude: before.longitude + (after.longitude - before.longitude) * ratio, altitudeM }
  }
  return geometry[geometry.length - 1] ?? { latitude: 0, longitude: 0, altitudeM: null }
}

function isLandmarkForClimbMerge(point: RoutePoint): boolean {
  return point.osmFeatureType === 'mountain-pass' || point.osmFeatureType === 'saddle'
}

/**
 * Builds the ordered, deduplicated canonical waypoints for one stage.
 * Returns `[]` when the route has no usable geometry — there is nothing
 * meaningful to place on a map/profile without it.
 */
export function buildCanonicalWaypoints(input: BuildCanonicalWaypointsInput): readonly CanonicalWaypoint[] {
  const { stage, route, routePoints, climbs } = input
  const geometry = routeGeometry(route)
  if (geometry === null) return []
  const distances = cumulativeGeometryDistances(geometry)
  const totalDistanceKm = distances.at(-1) ?? 0
  const startPoint = geometry[0]
  const endPoint = geometry[geometry.length - 1]
  if (startPoint === undefined || endPoint === undefined) return []

  const stageRoutePoints = stage.routePointIds
    .map((id) => routePoints.find((point) => point.id === id))
    .filter((point): point is RoutePoint => point !== undefined && point.osmFeatureType !== null && point.osmFeatureType !== undefined && SURFACED_STRUCTURAL_TYPES.has(point.osmFeatureType))
  const stageClimbs = stage.climbIds.map((id) => climbs.find((climb) => climb.id === id)).filter((climb): climb is Climb => climb !== undefined)

  /**
   * Never fabricate an altitude of 0 (CDC hardening section 18): when the
   * external source (OSM `ele`) has no elevation for a point projected on
   * the route, interpolate the GPX-derived profile at that point's own
   * `trackDistanceKm` instead — `null` only survives if the route itself
   * has no altitude data at all to interpolate from.
   */
  const resolvedElevationM = (externalElevationM: number | null, trackDistanceKm: number): number | null => {
    if (externalElevationM !== null) return externalElevationM
    return pointAtDistance(geometry, distances, trackDistanceKm).altitudeM
  }

  const mergedPointIds = new Set<string>()
  const waypoints: CanonicalWaypoint[] = []

  waypoints.push({
    id: `${stage.id}:start`, kind: 'start', ...KIND_PRESENTATION.start, name: stage.startLocationName ?? 'Départ',
    trackDistanceKm: 0, latitude: startPoint.latitude, longitude: startPoint.longitude, elevationM: startPoint.altitudeM,
    climbId: null, pauseDurationMinutes: null, elapsedMinutes: null, clockTime: null,
  })

  for (const climb of stageClimbs.slice().sort((left, right) => left.endDistanceKm - right.endDistanceKm)) {
    const landmark = stageRoutePoints
      .filter((point) => isLandmarkForClimbMerge(point) && !mergedPointIds.has(point.id) && point.trackDistanceKm !== null)
      .filter((point) => normalizeName(point.name) !== null && normalizeName(point.name) === normalizeName(climb.name))
      .filter((point) => Math.abs((point.trackDistanceKm as number) - climb.endDistanceKm) <= CLIMB_MERGE_TOLERANCE_KM)
      .sort((left, right) => (left.osmFeatureType === 'mountain-pass' ? 0 : 1) - (right.osmFeatureType === 'mountain-pass' ? 0 : 1)
        || Math.abs((left.trackDistanceKm as number) - climb.endDistanceKm) - Math.abs((right.trackDistanceKm as number) - climb.endDistanceKm))[0]
    if (landmark !== undefined) {
      mergedPointIds.add(landmark.id)
      const kind = landmark.osmFeatureType as CanonicalWaypointKind
      waypoints.push({
        id: landmark.id, kind, ...KIND_PRESENTATION[kind], name: landmark.name, trackDistanceKm: landmark.trackDistanceKm as number,
        latitude: landmark.latitude, longitude: landmark.longitude, elevationM: resolvedElevationM(landmark.elevationM, landmark.trackDistanceKm as number),
        climbId: climb.id, pauseDurationMinutes: null, elapsedMinutes: null, clockTime: null,
      })
      continue
    }
    const at = pointAtDistance(geometry, distances, climb.endDistanceKm)
    waypoints.push({
      id: climb.id, kind: 'climb', ...KIND_PRESENTATION.climb, name: climb.name ?? 'Montée', trackDistanceKm: climb.endDistanceKm,
      latitude: at.latitude, longitude: at.longitude, elevationM: climb.endAltitudeM,
      climbId: climb.id, pauseDurationMinutes: null, elapsedMinutes: null, clockTime: null,
    })
  }

  for (const point of stageRoutePoints) {
    if (mergedPointIds.has(point.id) || point.trackDistanceKm === null) continue
    const kind = point.osmFeatureType as CanonicalWaypointKind
    waypoints.push({
      id: point.id, kind, ...KIND_PRESENTATION[kind], name: point.name, trackDistanceKm: point.trackDistanceKm,
      latitude: point.latitude, longitude: point.longitude, elevationM: resolvedElevationM(point.elevationM, point.trackDistanceKm),
      climbId: null, pauseDurationMinutes: null, elapsedMinutes: null, clockTime: null,
    })
  }

  waypoints.push({
    id: `${stage.id}:end`, kind: 'end', ...KIND_PRESENTATION.end, name: stage.endLocationName ?? 'Arrivée',
    trackDistanceKm: totalDistanceKm, latitude: endPoint.latitude, longitude: endPoint.longitude, elevationM: endPoint.altitudeM,
    climbId: null, pauseDurationMinutes: null, elapsedMinutes: null, clockTime: null,
  })

  const deduplicated = dropStartEndDuplicateLocalities(waypoints, stage.startLocationName, stage.endLocationName, totalDistanceKm)

  return [...deduplicated].sort((left, right) => left.trackDistanceKm - right.trackDistanceKm || canonicalWaypointPriority(left.kind) - canonicalWaypointPriority(right.kind))
}

/** No locality is ever repeated within ~2 km of a start/end it already names (CDC hardening section 7) — a genuinely distinct nearby place is never hidden, only an exact/near-exact name match against the endpoint it is next to. */
const START_END_LOCALITY_DEDUP_DISTANCE_KM = 2

function dropStartEndDuplicateLocalities(
  waypoints: readonly CanonicalWaypoint[],
  startLocationName: string | null,
  endLocationName: string | null,
  totalDistanceKm: number,
): readonly CanonicalWaypoint[] {
  const startName = normalizeName(startLocationName)
  const endName = normalizeName(endLocationName)
  if (startName === null && endName === null) return waypoints

  return waypoints.filter((waypoint) => {
    if (waypoint.kind !== 'city' && waypoint.kind !== 'town' && waypoint.kind !== 'village') return true
    const name = normalizeName(waypoint.name)
    if (name === null) return true
    if (startName !== null && name === startName && waypoint.trackDistanceKm <= START_END_LOCALITY_DEDUP_DISTANCE_KM) return false
    if (endName !== null && name === endName && waypoint.trackDistanceKm >= totalDistanceKm - START_END_LOCALITY_DEDUP_DISTANCE_KM) return false
    return true
  })
}
