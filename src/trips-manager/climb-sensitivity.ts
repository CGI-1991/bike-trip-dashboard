/**
 * Re-running climb detection on an already-imported trip, when the
 * trip-wide sensitivity setting changes.
 *
 * The slider has to act on the DETECTION, not on a display filter, so
 * changing it genuinely re-derives `TripBundle.climbs`. It does so from the
 * route geometry already stored in the bundle, through the exact same chain
 * the import pipeline uses (`buildDistanceIndexedSeries` → `smoothElevation`
 * → `buildTerrainSlopeProfile` → `detectClimbs`) — never a second detection
 * model, never a GPX re-parse, and never a change to distance/D+ or to the
 * GPX files themselves.
 *
 * Names are the one thing worth carrying across: a climb that OSM or the
 * traveller has already named keeps that name when the recomputed climb
 * summits at the same place. Manually-created climbs are preserved verbatim,
 * exactly like `mergeEditedTripBundle` does for a structural edit.
 *
 * Pure: bundle + idFactory in, bundle out. No storage, no network.
 */

import { buildDistanceIndexedSeries } from '../analysis/elevation-profile.ts'
import { buildTravelTerrainProfile } from '../analysis/travel-timing.ts'
import { detectClimbs } from '../analysis/climb-detection.ts'
import { retainsClimbCategory } from '../analysis/climb-category.ts'
import { buildCanonicalWaypoints } from '../analysis/canonical-waypoints.ts'
import { routeGeometry } from '../route-enrichment/route-fingerprint.ts'
import { isSegmentMarkerClimbName } from '../analysis/gpx-marker-names.ts'
import { DEFAULT_CLIMB_DETECTION_SENSITIVITY, selectTravelMode } from '../trip-core/index.ts'
import type { Climb, ClimbDetectionSensitivity, RouteId, TripBundle } from '../trip-core/index.ts'

const ENGINE_VERSION = 'climb-sensitivity@2'

/** How far a recomputed summit may sit from a previously-named one and still be considered the same climb. */
const NAME_TRANSFER_TOLERANCE_KM = 0.5

/** The trip's effective sensitivity — the historical calibration for every bundle saved before the setting existed. */
export function resolveClimbDetectionSensitivity(bundle: TripBundle): ClimbDetectionSensitivity {
  return bundle.settings.global.climbDetectionSensitivity ?? DEFAULT_CLIMB_DETECTION_SENSITIVITY
}

function isManual(climb: Climb): boolean {
  return climb.provenance.sourceType === 'user' || climb.provenance.manuallyOverridden
}

/**
 * A name worth keeping: one that came from somewhere real — not the
 * `Montée N` placeholder detection itself produces, and not a GPX segment
 * boundary marker, which is an annotation about the route rather than a name
 * for the place (`analysis/gpx-marker-names.ts`).
 */
function hasRealName(climb: Climb): boolean {
  return climb.name !== null && !/^Montée \d+$/u.test(climb.name) && !isSegmentMarkerClimbName(climb.name)
}

/**
 * Recomputes every route's climbs at `sensitivity` and rebuilds each
 * stage's `climbIds` around them. A route with no usable geometry keeps its
 * existing climbs untouched — there is nothing to recompute from, and
 * silently dropping them would be worse than leaving them.
 */
export function recomputeTripClimbs(bundle: TripBundle, sensitivity: ClimbDetectionSensitivity, idFactory: () => string): TripBundle {
  const climbsByRouteId = new Map<RouteId, Climb[]>()
  let changed = false

  for (const route of bundle.routes) {
    const previousForRoute = bundle.climbs.filter((climb) => climb.routeId === route.id)
    const geometry = routeGeometry(route)
    if (geometry === null) {
      climbsByRouteId.set(route.id, [...previousForRoute])
      continue
    }
    const series = buildDistanceIndexedSeries(geometry.map((point) => ({ latitude: point.latitude, longitude: point.longitude, elevationM: point.altitudeM })))
    const profile = buildTravelTerrainProfile(series, selectTravelMode(bundle))
    if (profile === null) {
      climbsByRouteId.set(route.id, [...previousForRoute])
      continue
    }

    // The GPX `<wpt>` list survives in the bundle as this route's own
    // GPX-provenance `RoutePoint`s, marker type included — so a recomputation
    // names climbs by exactly the same rule the import did, rather than
    // starting from nothing. Real names already attached (OSM, or a manual
    // one) are re-applied right below.
    const namingCandidates = bundle.routePoints
      .filter((point) => point.routeId === route.id && point.provenance.sourceType === 'gpx')
      .map((point) => ({ name: point.name, latitude: point.latitude, longitude: point.longitude, markerType: point.gpxMarkerType ?? null }))
    const detected = detectClimbs(profile, namingCandidates, route.id, idFactory, ENGINE_VERSION, sensitivity, selectTravelMode(bundle))
    const named = detected.map((climb) => {
      const identities = previousForRoute.filter(candidate => !isManual(candidate)
        && Math.abs(candidate.startDistanceKm - climb.startDistanceKm) <= 0.05
        && Math.abs(candidate.endDistanceKm - climb.endDistanceKm) <= 0.05)
      const identified = identities.length === 1 ? { ...climb, id: identities[0]!.id } : climb
      const source = previousForRoute
        .filter((candidate) => hasRealName(candidate) && Math.abs(candidate.endDistanceKm - climb.endDistanceKm) <= NAME_TRANSFER_TOLERANCE_KM)
        .sort((left, right) => Math.abs(left.endDistanceKm - climb.endDistanceKm) - Math.abs(right.endDistanceKm - climb.endDistanceKm))[0]
      return source === undefined ? identified : { ...identified, name: source.name, confidence: source.confidence, provenance: source.provenance }
    })
    const manual = previousForRoute.filter(isManual)
    const next = [...named, ...manual.filter((climb) => !named.some((candidate) => candidate.id === climb.id))]
    climbsByRouteId.set(route.id, next)
    if (next.length !== previousForRoute.length) changed = true
    else if (next.some((climb, index) => {
      const before = previousForRoute[index]
      return before === undefined || before.startDistanceKm !== climb.startDistanceKm || before.endDistanceKm !== climb.endDistanceKm || before.maxGradientPercent !== climb.maxGradientPercent || before.averageGradientPercent !== climb.averageGradientPercent || before.elevationGainM !== climb.elevationGainM
    })) changed = true
  }

  if (!changed) return projectClimbCategories(bundle)

  const climbs = bundle.routes.flatMap((route) => climbsByRouteId.get(route.id) ?? [])
  const climbIds = new Set<string>(climbs.map((climb) => climb.id))
  const stages = bundle.stages.map((stage) => ({
    ...stage,
    climbIds: (climbsByRouteId.get(stage.sourceRouteId) ?? []).map((climb) => climb.id),
  }))
  // An override pointing at a climb that no longer exists would fail
  // validation — dropped here exactly like `mergeEditedTripBundle` drops
  // overrides whose target a structural edit removed.
  const overrides = bundle.overrides.filter((override) => override.targetType !== 'climb' || climbIds.has(override.targetId))

  return projectClimbCategories({ ...bundle, climbs, stages, overrides })
}

/** Keep the complete detected pool (ids, names and overrides) in the bundle.
 * Stage membership projects the chosen category consistently to every view. */
function projectClimbCategories(bundle: TripBundle): TripBundle {
  const minimum = bundle.settings.global.climbCategoryMinimum ?? 0
  let changed = false
  const stages = bundle.stages.map(stage => {
    const pauses = bundle.settings.stages.find(setting => setting.stageId === stage.id)?.pauses ?? []
    const candidates = bundle.climbs.filter(climb => climb.routeId === stage.sourceRouteId)
    const protectedIds = new Set<string>()
    const route = bundle.routes.find(route => route.id === stage.sourceRouteId)
    if (minimum > 0 && route !== undefined && pauses.some(pause => pause.active)) {
      const waypoints = buildCanonicalWaypoints({ stage: { ...stage, climbIds: candidates.map(climb => climb.id) }, route, routePoints: bundle.routePoints, climbs: bundle.climbs })
      for (const waypoint of waypoints) if (waypoint.climbId !== null && pauses.some(pause => pause.active && pause.routePointId?.toString() === waypoint.id)) protectedIds.add(waypoint.climbId)
    }
    const ids = candidates.filter(climb => retainsClimbCategory(climb, minimum, selectTravelMode(bundle)) || protectedIds.has(climb.id)).map(climb => climb.id)
    if (ids.length === stage.climbIds.length && ids.every((id, index) => id === stage.climbIds[index])) return stage
    changed = true
    return { ...stage, climbIds: ids }
  })
  return changed ? { ...bundle, stages } : bundle
}

/**
 * Applies a new sensitivity setting and recomputes the climbs it governs.
 * A no-op (same reference back) when the setting already has that value, so
 * callers can skip a pointless save.
 */
export function applyClimbDetectionSensitivity(bundle: TripBundle, sensitivity: ClimbDetectionSensitivity, idFactory: () => string): TripBundle {
  return applyClimbDetectionSettings(bundle, sensitivity, bundle.settings.global.climbCategoryMinimum ?? 0, idFactory)
}

export function applyClimbDetectionSettings(bundle: TripBundle, sensitivity: ClimbDetectionSensitivity, minimum: import('../trip-core/index.ts').ClimbCategoryMinimum, idFactory: () => string, force = false): TripBundle {
  if (!force && resolveClimbDetectionSensitivity(bundle) === sensitivity && (bundle.settings.global.climbCategoryMinimum ?? 0) === minimum) return bundle
  const withSetting: TripBundle = {
    ...bundle,
    settings: { ...bundle.settings, global: { ...bundle.settings.global, climbDetectionSensitivity: sensitivity, climbCategoryMinimum: minimum } },
    enrichmentMetadata: {
      ...bundle.enrichmentMetadata,
      // A persisted automatic pause plan was scored partly on this trip's
      // climbs ("après une montée majeure" — `pause-recommendation.ts`).
      // Once the climbs themselves are re-derived, the plan is a snapshot of
      // a terrain reading that no longer exists, so it is dropped and
      // recomputed rather than pinned to stale anchors. Provider caches and
      // enrichment jobs are keyed by route geometry, which this never
      // touches, so they stay valid.
      automaticPausePlans: [],
    },
  }
  return force || resolveClimbDetectionSensitivity(bundle) !== sensitivity
    ? recomputeTripClimbs(withSetting, sensitivity, idFactory) : projectClimbCategories(withSetting)
}
