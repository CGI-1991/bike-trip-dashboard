export interface RoadbookMatchConfig {
  readonly coordinateMatchedMaximumDistanceM: number
  readonly coordinateReviewMaximumDistanceM: number
  readonly profileMaximumElevationDifferenceM: number
  readonly profilePreferredElevationDifferenceM: number
  readonly profileMinimumSeparationKm: number
  readonly summitWaypointLinkMaximumTrackDistanceKm: number
  readonly waypointLinkMaximumTrackDistanceKm: number
  readonly overrideCoordinateToleranceM: number
  readonly overrideTrackDistanceToleranceKm: number
  readonly overrideElevationToleranceM: number
  readonly overrideAnchorDistanceToleranceM: number
  readonly overrideSegmentFractionTolerance: number
  readonly projectionEarthRadiusKm: number
  readonly comparisonEpsilon: number
}

export const roadbookMatchConfig: RoadbookMatchConfig = {
  coordinateMatchedMaximumDistanceM: 250,
  coordinateReviewMaximumDistanceM: 1000,
  profileMaximumElevationDifferenceM: 200,
  profilePreferredElevationDifferenceM: 100,
  profileMinimumSeparationKm: 2,
  summitWaypointLinkMaximumTrackDistanceKm: 0.5,
  waypointLinkMaximumTrackDistanceKm: 0.75,
  overrideCoordinateToleranceM: 15,
  overrideTrackDistanceToleranceKm: 0.015,
  overrideElevationToleranceM: 5,
  overrideAnchorDistanceToleranceM: 15,
  overrideSegmentFractionTolerance: 0.02,
  projectionEarthRadiusKm: 6371.0088,
  comparisonEpsilon: 1e-9,
}
