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
 * Single significance policy shared by the map, profile, and Parcours list
 * (CDC Jalon B4.3 sections 26-29/40): normal view shows départ/arrivée,
 * pauses, and significant relief (mountain-pass/saddle, and every detected
 * climb) — an ordinary city/town/village is never shown unless it carries a
 * pause, whatever its own kind. Pause is an absolute priority (CDC section
 * 27): checked FIRST, before any kind-based rule. The full city/town/
 * village list stays available to the manual pause editor
 * (`PAUSE_ANCHOR_KINDS` in `day-detail-view.ts`) — a separate, wider need
 * this policy must never be conflated with (CDC section 40).
 *
 * There used to be a second, display-level filter here: the Normal/Montagne
 * mode re-classified a detected climb as "secondaire" and hid it. Deciding
 * which climbs exist is now the job of the trip's 5-step detection
 * sensitivity (`climb-detection.ts`), which acts on the detection itself —
 * so a climb that survives detection is shown, and no saved preference can
 * silently hide one any more.
 */
export function isSignificantWaypoint(waypoint: CanonicalWaypoint): boolean {
  if (waypoint.pauseDurationMinutes !== null) return true
  return waypoint.visibleByDefault
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
  // City/town stay out of the normal view by default (CDC Jalon B4.3
  // sections 26/28: "une ville qui n'est ni départ, ni arrivée, ni pause...
  // ne doit PAS apparaître") — `importance` stays 'major' (they are
  // inherently significant places, e.g. when they double as start/end or
  // gain a pause), only the always-shown default changed since Jalon B4.2.
  city: { importance: 'major', visibleByDefault: false },
  town: { importance: 'major', visibleByDefault: false },
  // Every detected climb is shown: the trip's detection sensitivity already
  // decided which climbs exist at all.
  climb: { importance: 'major', visibleByDefault: true },
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
    // A climb cannot summit after the stage has ended. `Climb.endDistanceKm`
    // is measured on the haversine-accumulated terrain profile
    // (`elevation-profile.ts`), while `totalDistanceKm` here comes from
    // `cumulativeGeometryDistances`, which uses an equirectangular
    // approximation: over a long stage the two disagree by a few
    // centimetres, so a climb topping out on the very last track point
    // landed a hair PAST the arrival and sorted after it — the montée block
    // then read as part of the arrival instead of leading into it. Clamping
    // restores the invariant, and the equal distances then let the
    // start-first/end-last tiebreak below do its job.
    const summitDistanceKm = Math.min(climb.endDistanceKm, totalDistanceKm)
    waypoints.push({
      id: climb.id, kind: 'climb', ...KIND_PRESENTATION.climb, name: climb.name ?? 'Montée', trackDistanceKm: summitDistanceKm,
      latitude: at.latitude, longitude: at.longitude, elevationM: climb.endAltitudeM,
      climbId: climb.id, pauseDurationMinutes: null, elapsedMinutes: null, clockTime: null,
    })
  }

  for (const point of stageRoutePoints) {
    if (mergedPointIds.has(point.id) || point.trackDistanceKm === null) continue
    // R2.1 section 24-25 — firm product rule: a col (mountain-pass/saddle)
    // never reaching the merge above (no detected `Climb` matched it by
    // name+distance, `isLandmarkForClimbMerge`) is a col with no associated
    // montée — it must not appear in ANY user-facing surface (timeline,
    // pauses, map/profile, Aperçu). The single point of truth is here:
    // simply never materialize it as a `CanonicalWaypoint` at all, rather
    // than patching every consumer's own filter separately. The underlying
    // `RoutePoint` stays in `bundle.routePoints` untouched for
    // enrichment/debug — only its surfaced *waypoint* disappears. A city/
    // town/village is never affected — only a col genuinely requires an
    // associated climb to be shown at all.
    if (isLandmarkForClimbMerge(point)) continue
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

  return [...deduplicated].sort((left, right) =>
    left.trackDistanceKm - right.trackDistanceKm
    || endpointOrdinal(left.kind) - endpointOrdinal(right.kind)
    || canonicalWaypointPriority(left.kind) - canonicalWaypointPriority(right.kind))
}

/**
 * Départ always first and arrivée always last among waypoints sharing the
 * same distance — checked before `KIND_PRIORITY`, which ranks by
 * significance and (both endpoints being `0`) would otherwise put the
 * arrival ahead of everything at the finish line.
 *
 * This is what a climb summiting exactly AT the arrival needs: it stays its
 * own block, with its own length/D+/gradient and its own mini-profile, and
 * it reads before the arrival it leads to instead of after it. Neither
 * absorbs the other — they are two different facts about the same point
 * (the last ascent, and the end of the stage), and the merge/dedup rules
 * above never touch either: `dropStartEndDuplicateLocalities` only ever
 * removes a repeated city/town/village, and a climb merges at most once,
 * with a named col, into a single waypoint.
 */
function endpointOrdinal(kind: CanonicalWaypointKind): number {
  return kind === 'start' ? -1 : kind === 'end' ? 1 : 0
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
