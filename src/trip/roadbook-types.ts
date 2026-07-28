import type {
  OffDayId,
  OffDayNumber,
  RideDayId,
  RideDayNumber,
  TripDayId,
} from './types.ts'

export type RoadbookPointType =
  | 'start'
  | 'end'
  | 'col'
  | 'summit'
  | 'village'
  | 'passage'
  | 'resupply'
  | 'pause'
  | 'shelter'
  | 'lodging'
  | 'poi'

export type RoadbookPointStatus =
  | 'matched'
  | 'needs-review'
  | 'unmatched'

/**
 * Editorial classification layered on top of `RoadbookPointStatus`. Status is the
 * matching engine's geometric verdict against the GPX; resolution is the product
 * decision about how (or whether) a point should surface as an active waypoint.
 */
export type RoadbookResolution =
  | 'matched'
  | 'informational'
  | 'excluded'
  | 'user-decision-required'

export type RoadbookMatchMethod =
  | 'endpoint'
  | 'named-gpx-point'
  | 'nearest-track-point'
  | 'profile-altitude-order-candidate'
  | 'manual-confirmed-profile-candidate'
  | 'manual-anchor-projected-to-track'
  | 'manual-track-loop-confirmation'
  | 'manual-anchor-reprojected-current-gpx'
  | 'manual'

export type RoadbookPointSubtype =
  | 'strategic-passage'
  | 'scenic-high-point'
  | 'optional-passage'

export interface RoadbookEditorialStats {
  readonly distanceKm: number
  readonly elevationGainM: number
  readonly elevationLossM: number
}

export interface RoadbookClimb {
  readonly id: string
  readonly name: string
  readonly elevationM: number
  readonly distanceKm: number
  readonly elevationGainM: number
  readonly averageGradientPercent: number
}

export interface RoadbookLabel {
  readonly id: string
  readonly label: string
}

export interface RoadbookExplicitPause {
  readonly id: string
  readonly title: string
}

export interface RoadbookOption {
  readonly id: string
  readonly title: string
  readonly elevationM?: number
  readonly distanceKm?: number
  readonly elevationGainM?: number
  readonly averageGradientPercent?: number
}

export interface RoadbookDescription {
  readonly id: string
  readonly description: string
}

export interface RoadbookRideDay {
  readonly id: RideDayId
  readonly dayNumber: RideDayNumber
  readonly type: 'ride'
  readonly title: string
  readonly startName: string
  readonly endName: string
  readonly ambiance: string
  readonly editorialStats: RoadbookEditorialStats
  readonly cols: readonly RoadbookClimb[]
  readonly resupplyPassages: readonly RoadbookLabel[]
  readonly explicitPauses: readonly RoadbookExplicitPause[]
  readonly notes: readonly string[]
  readonly variant: string | null
  readonly options: readonly RoadbookOption[]
  readonly lodgings: readonly RoadbookDescription[]
}

export interface RoadbookOffDay {
  readonly id: OffDayId
  readonly dayNumber: OffDayNumber
  readonly type: 'off'
  readonly title: string
  readonly locationName: string
  readonly ambiance: string
  readonly logistics: readonly RoadbookDescription[]
  readonly activities: readonly RoadbookDescription[]
  readonly recovery: readonly RoadbookDescription[]
  readonly lodgings: readonly RoadbookDescription[]
  readonly notes: readonly string[]
  readonly nextRideDayId: RideDayId
}

export type RoadbookDay = RoadbookRideDay | RoadbookOffDay

export interface RoadbookDocument {
  readonly version: 1
  readonly tripId: 'rga-2026'
  readonly sourceFile: 'docs/sources/roadbook-rga-2026.md'
  readonly days: readonly RoadbookDay[]
}

export interface RoadbookPoint {
  readonly id: string
  readonly dayId: RideDayId
  readonly type: RoadbookPointType
  readonly subtype?: RoadbookPointSubtype
  readonly name: string
  readonly elevationM?: number
  readonly sourceLatitude?: number
  readonly sourceLongitude?: number
  readonly matchedLatitude?: number
  readonly matchedLongitude?: number
  readonly matchedTrackDistanceKm?: number
  readonly matchedElevationM?: number
  readonly matchDistanceM?: number
  readonly elevationDifferenceM?: number
  readonly matchedSegmentIndex?: number
  readonly matchedPointIndex?: number
  readonly matchMethod?: RoadbookMatchMethod
  readonly status: RoadbookPointStatus
  readonly notes?: string
  readonly isPauseCandidate?: boolean
  readonly isResupplyCandidate?: boolean
}

export interface RoadbookSourceAnchor {
  readonly latitude: number
  readonly longitude: number
}

export interface RoadbookGpxProjection {
  readonly latitude: number
  readonly longitude: number
  readonly trackDistanceKm: number
  readonly segmentIndex: number
  readonly pointIndex: number
  readonly nextPointIndex: number
  readonly segmentFraction: number
  readonly elevationM: number
}

export interface RoadbookPointOverride {
  readonly pointId: string
  readonly dayId: RideDayId
  readonly approvedStatus: RoadbookPointStatus
  readonly sourceAnchor: RoadbookSourceAnchor
  readonly gpxProjection: RoadbookGpxProjection
  readonly anchorDistanceM: number
  readonly matchMethod: Extract<
    RoadbookMatchMethod,
    | 'manual-confirmed-profile-candidate'
    | 'manual-anchor-projected-to-track'
    | 'manual-track-loop-confirmation'
    | 'manual-anchor-reprojected-current-gpx'
  >
  readonly comment: string
  readonly validationSource: string
  readonly displayName?: string
  readonly pointType?: RoadbookPointType
  readonly pointSubtype?: RoadbookPointSubtype
}

/**
 * An override entry that failed per-entry validation and was skipped so the rest
 * of the document keeps loading. The underlying roadbook point falls back to its
 * other matching strategies (named GPX point, profile candidate, raw point) — see
 * `matchDayPoints` in `roadbook-match.ts`.
 */
export interface RoadbookOverrideDiagnostic {
  readonly pointId?: string
  readonly issues: readonly RoadbookValidationIssue[]
}

export interface RoadbookOverridesDocument {
  readonly version: 1
  readonly tripId: 'rga-2026'
  readonly overrides: readonly RoadbookPointOverride[]
  readonly skippedOverrides: readonly RoadbookOverrideDiagnostic[]
}

export interface RoadbookResources {
  readonly roadbook: RoadbookDocument
  readonly overrides: RoadbookOverridesDocument
}

export interface RoadbookValidationIssue {
  readonly path: string
  readonly message: string
  readonly dayId?: TripDayId
}
