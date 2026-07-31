import type { Kilometers, LatitudeDegrees, LongitudeDegrees, Meters, ParsingStatus, Percent } from './common.ts'
import type { RouteId, SourceFileId } from './ids.ts'
import type { DataProvenance } from './provenance.ts'

/**
 * One track/segment inside a route, described only by its summary statistics
 * — never by duplicating its points here (those live, when kept, in
 * `RouteGeometry`). Mirrors the "one GPX = one segment by default" rule from
 * CDC section 7.2 without hardcoding it.
 */
export interface RouteSegmentDescriptor {
  readonly index: number
  readonly name: string | null
  readonly distanceKm: Kilometers | null
  readonly elevationGainM: Meters | null
  readonly elevationLossM: Meters | null
}

export interface RouteGeometryPoint {
  readonly latitude: LatitudeDegrees
  readonly longitude: LongitudeDegrees
  readonly altitudeM: Meters | null
}

/**
 * Full and simplified geometries are stored side by side only when actually
 * produced — both may be `null` in phase 2, since no GPX parser runs here
 * (CDC section 10: "no new GPX parser is developed in this phase").
 */
export interface RouteGeometry {
  readonly full: readonly RouteGeometryPoint[] | null
  readonly simplified: readonly RouteGeometryPoint[] | null
}

export interface RouteElevationProfilePoint {
  readonly distanceKm: Kilometers
  readonly elevationM: Meters | null
  readonly gradePercent: Percent | null
}

export interface RouteElevationProfile {
  readonly resampleIntervalMeters: Meters
  readonly points: readonly RouteElevationProfilePoint[]
}

/**
 * A route, referencing its source file and holding whatever geometry/profile
 * has been produced for it. `sourceFileId` is `null` only for a route with no
 * originating source file on record (e.g. migrated data with the source
 * file dropped) — a route created from an import always sets it.
 */
export interface Route {
  readonly id: RouteId
  readonly sourceFileId: SourceFileId | null
  readonly segments: readonly RouteSegmentDescriptor[]
  readonly geometry: RouteGeometry | null
  readonly profile: RouteElevationProfile | null
  readonly parsingStatus: ParsingStatus
  readonly parsingErrors: readonly string[]
  readonly provenance: DataProvenance
}
