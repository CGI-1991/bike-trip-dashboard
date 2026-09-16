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

import { buildDistanceIndexedSeries, smoothElevation } from '../analysis/elevation-profile.ts'
import { buildTerrainSlopeProfile } from '../analysis/terrain-profile.ts'
import { detectClimbs } from '../analysis/climb-detection.ts'
import { routeGeometry } from '../route-enrichment/route-fingerprint.ts'
import { DEFAULT_CLIMB_DETECTION_SENSITIVITY } from '../trip-core/index.ts'
import type { Climb, ClimbDetectionSensitivity, RouteId, TripBundle } from '../trip-core/index.ts'

const ENGINE_VERSION = 'climb-sensitivity@1'

/** How far a recomputed summit may sit from a previously-named one and still be considered the same climb. */
const NAME_TRANSFER_TOLERANCE_KM = 0.5

/** The trip's effective sensitivity — the historical calibration for every bundle saved before the setting existed. */
export function resolveClimbDetectionSensitivity(bundle: TripBundle): ClimbDetectionSensitivity {
  return bundle.settings.global.climbDetectionSensitivity ?? DEFAULT_CLIMB_DETECTION_SENSITIVITY
}

function isManual(climb: Climb): boolean {
  return climb.provenance.sourceType === 'user' || climb.provenance.manuallyOverridden
}

/** A name worth keeping: one that came from somewhere real, not the `Montée N` placeholder detection itself produces. */
function hasRealName(climb: Climb): boolean {
  return climb.name !== null && !/^Montée \d+$/u.test(climb.name)
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
    const profile = buildTerrainSlopeProfile(smoothElevation(series))
    if (profile === null) {
      climbsByRouteId.set(route.id, [...previousForRoute])
      continue
    }

    // No GPX waypoint list survives in the bundle, so detection names every
    // climb `Montée N` here; the real names are re-attached right below from
    // the climbs that already carried one.
    const detected = detectClimbs(profile, [], route.id, idFactory, ENGINE_VERSION, sensitivity)
    const named = detected.map((climb) => {
      const source = previousForRoute
        .filter((candidate) => hasRealName(candidate) && Math.abs(candidate.endDistanceKm - climb.endDistanceKm) <= NAME_TRANSFER_TOLERANCE_KM)
        .sort((left, right) => Math.abs(left.endDistanceKm - climb.endDistanceKm) - Math.abs(right.endDistanceKm - climb.endDistanceKm))[0]
      return source === undefined ? climb : { ...climb, name: source.name, confidence: source.confidence, provenance: source.provenance }
    })
    const manual = previousForRoute.filter(isManual)
    const next = [...named, ...manual.filter((climb) => !named.some((candidate) => candidate.id === climb.id))]
    climbsByRouteId.set(route.id, next)
    if (next.length !== previousForRoute.length) changed = true
    else if (next.some((climb, index) => {
      const before = previousForRoute[index]
      return before === undefined || before.startDistanceKm !== climb.startDistanceKm || before.endDistanceKm !== climb.endDistanceKm
    })) changed = true
  }

  if (!changed) return bundle

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

  return { ...bundle, climbs, stages, overrides }
}

/**
 * Applies a new sensitivity setting and recomputes the climbs it governs.
 * A no-op (same reference back) when the setting already has that value, so
 * callers can skip a pointless save.
 */
export function applyClimbDetectionSensitivity(bundle: TripBundle, sensitivity: ClimbDetectionSensitivity, idFactory: () => string): TripBundle {
  if (resolveClimbDetectionSensitivity(bundle) === sensitivity) return bundle
  const withSetting: TripBundle = {
    ...bundle,
    settings: { ...bundle.settings, global: { ...bundle.settings.global, climbDetectionSensitivity: sensitivity } },
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
  return recomputeTripClimbs(withSetting, sensitivity, idFactory)
}
