/**
 * Repairs climbs that a GPX segment marker named, on trips imported before
 * that stopped being allowed (`analysis/gpx-marker-names.ts`).
 *
 * Why a stored trip needs this at all, and not just new imports:
 *
 *  - `route-enrichment/enrichment.ts::enrichClimbs` only ever renames a
 *    climb whose name is still GENERIC. A climb called "Fin grimpeur" is not
 *    generic, so the nearby OSM col never got to rename it;
 *  - `canonical-waypoints.ts` then merges a col into its climb by NAME. With
 *    the two names permanently different the merge could not happen, and the
 *    col — which is only ever surfaced through that merge — disappeared from
 *    the stage entirely. That is what made the Aperçu "Détail" layer show
 *    the points of some stages and not others.
 *
 * The repair is local, offline and idempotent: no re-detection, no network,
 * no geometry work. A climb whose summit sits next to a col the trip has
 * already enriched adopts that col's real name (which restores the merge);
 * any other one falls back to the generic `Montée N`, which is what
 * detection itself would have produced and what lets a later enrichment pass
 * name it properly.
 *
 * Manual climbs and climbs already named from OSM are never touched.
 */

import { isSegmentMarkerClimbName } from '../analysis/gpx-marker-names.ts'
import type { Climb, RouteId, TripBundle } from '../trip-core/index.ts'

/** Same tolerance `canonical-waypoints.ts` uses to merge a col into its climb — deliberately the same number, so a repair can only ever produce a name that merge will accept. */
const COL_MATCH_TOLERANCE_KM = 1

function isEditable(climb: Climb): boolean {
  return climb.provenance.sourceType !== 'osm'
    && climb.provenance.sourceType !== 'user'
    && !climb.provenance.manuallyOverridden
}

/**
 * Returns the bundle unchanged (same reference) when nothing needs
 * repairing, so callers can skip a pointless save.
 */
export function repairSegmentMarkerClimbNames(bundle: TripBundle): TripBundle {
  if (!bundle.climbs.some((climb) => isEditable(climb) && isSegmentMarkerClimbName(climb.name))) return bundle

  const sequenceByRouteId = new Map<RouteId, number>()
  const rankByClimbId = new Map<string, number>()
  for (const route of bundle.routes) {
    const ordered = bundle.climbs
      .filter((climb) => climb.routeId === route.id)
      .slice()
      .sort((left, right) => left.endDistanceKm - right.endDistanceKm)
    ordered.forEach((climb, index) => rankByClimbId.set(climb.id, index + 1))
    sequenceByRouteId.set(route.id, ordered.length)
  }

  const climbs = bundle.climbs.map((climb) => {
    if (!isEditable(climb) || !isSegmentMarkerClimbName(climb.name)) return climb
    const col = bundle.routePoints
      .filter((point) => point.routeId === climb.routeId
        && (point.osmFeatureType === 'mountain-pass' || point.osmFeatureType === 'saddle')
        && point.trackDistanceKm !== null && point.trackDistanceKm !== undefined
        && Math.abs((point.trackDistanceKm as number) - climb.endDistanceKm) <= COL_MATCH_TOLERANCE_KM)
      .sort((left, right) => Math.abs((left.trackDistanceKm as number) - climb.endDistanceKm) - Math.abs((right.trackDistanceKm as number) - climb.endDistanceKm))[0]
    if (col !== undefined) {
      // The col the trip already knows about IS the pertinent name, and
      // matching it is exactly what lets the canonical merge surface the col
      // again on the map and in the Parcours list.
      return {
        ...climb,
        name: col.name,
        confidence: 'confirmed' as const,
        provenance: { ...climb.provenance, sourceType: 'osm' as const, engineVersion: 'climb-name-repair@1', confidence: 'high' as const },
      }
    }
    return {
      ...climb,
      name: `Montée ${rankByClimbId.get(climb.id) ?? 1}`,
      confidence: 'probable' as const,
      provenance: { ...climb.provenance, confidence: 'medium' as const },
    }
  })

  return { ...bundle, climbs }
}
