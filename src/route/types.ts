export type RouteWaypointType =
  | 'route-start'
  | 'route-end'
  | 'gpx-start'
  | 'gpx-end'
  | 'summit'
  | 'valley'
  | 'slope-change'
  | 'time-marker'
  | 'pause-start'
  | 'pause-end'

export interface RouteEngineSettings {
  readonly referenceSpeedKph: number
  readonly departureTime: string
  readonly totalBreakMinutes: number
}

export interface RouteClockTime {
  readonly totalMinutesFromDeparture: number
  readonly clockMinutes: number
  readonly dayOffset: number
}

export interface RouteProgress {
  readonly distanceKm: number
  readonly elevationGainM: number
  readonly elevationLossM: number
  readonly altitudeM: number | null
  readonly localSlopePercent: number
  readonly estimatedSpeedKph: number
  readonly movingElapsedMinutes: number
  readonly elapsedMinutes: number
  readonly theoreticalTimeMinutes: number
}

export interface RouteWaypoint {
  readonly id: string
  readonly type: RouteWaypointType
  readonly name: string
  readonly latitude: number
  readonly longitude: number
  readonly sourceFileNumber: number
  readonly sourceFileName: string
  readonly progress: RouteProgress
}

export interface RoutePause {
  readonly id: string
  readonly name: string
  readonly durationMinutes: number
  readonly sourceFileNumber: number
  readonly sourceFileName: string
  readonly latitude: number
  readonly longitude: number
  readonly distanceKm: number
  readonly altitudeM: number | null
  readonly startElapsedMinutes: number
  readonly endElapsedMinutes: number
  readonly startTimeMinutes: number
  readonly endTimeMinutes: number
  readonly startWaypointId: string
  readonly endWaypointId: string
  /**
   * The roadbook point this pause is attached to, when it originates from one
   * (automatic or custom mode both resolve to a documented point — see
   * `pause-plan.ts`). Display code must match a pause to its point by this id,
   * never by nearest-waypoint proximity, so the pause never renders at a
   * position slightly offset from the point's own marker.
   */
  readonly pointId?: string
}

export interface RouteSegment {
  readonly sourceFileNumber: number
  readonly sourceFileName: string
  readonly name: string
  readonly startName: string
  readonly endName: string
  readonly pointCount: number
  readonly trackSegmentCount: number
  readonly distanceKm: number
  readonly elevationGainM: number
  readonly elevationLossM: number
  readonly minAltitudeM: number | null
  readonly maxAltitudeM: number | null
  readonly startDistanceKm: number
  readonly endDistanceKm: number
  readonly startElapsedMinutes: number
  readonly endElapsedMinutes: number
  readonly startTimeMinutes: number
  readonly endTimeMinutes: number
  readonly startProgress: RouteProgress
  readonly endProgress: RouteProgress
  readonly waypointIds: readonly string[]
}

export interface RouteSummary {
  readonly sourceGpxCount: number
  readonly sourceTrackSegmentCount: number
  readonly sourcePointCount: number
  readonly waypointCount: number
  readonly distanceKm: number
  readonly elevationGainM: number
  readonly elevationLossM: number
  readonly minAltitudeM: number | null
  readonly maxAltitudeM: number | null
  readonly movingDurationMinutes: number
  readonly estimatedAverageSpeedKph: number
  readonly pauseDurationMinutes: number
  readonly totalDurationMinutes: number
  readonly departureTimeMinutes: number
  readonly arrivalTimeMinutes: number
  readonly isContinuous: boolean
  readonly maximumBoundaryGapKm: number
  readonly firstSourceFileNumber: number
  readonly lastSourceFileNumber: number
}

export interface RouteTimeline {
  readonly settings: RouteEngineSettings
  readonly segments: readonly RouteSegment[]
  readonly waypoints: readonly RouteWaypoint[]
  readonly pauses: readonly RoutePause[]
  /** Shared normalized moving-time series used by roadbook ETA interpolation. */
  readonly terrainTiming?: readonly TerrainTimingPoint[]
  readonly summary: RouteSummary
}

export interface RouteProfilePosition {
  readonly latitude: number
  readonly longitude: number
  readonly sourceFileNumber: number
  readonly sourceFileName: string
  readonly distanceKm: number
  readonly elevationGainM: number
  readonly elevationLossM: number
  readonly altitudeM: number | null
  readonly localSlopePercent: number
  readonly speedMultiplier: number
  readonly weightedDistanceKm: number
}

export interface RouteProfileWaypointSeed {
  readonly id: string
  readonly type: Exclude<RouteWaypointType, 'pause-start' | 'pause-end'>
  readonly name: string
  readonly position: RouteProfilePosition
}

export interface RouteProfilePauseAnchor {
  readonly id: string
  readonly name: string
  readonly durationShare: number
  readonly position: RouteProfilePosition
  /** The roadbook point this anchor was resolved from, if any — see `RoutePause.pointId`. */
  readonly pointId?: string
}

export interface RouteProfileSegment {
  readonly sourceFileNumber: number
  readonly sourceFileName: string
  readonly name: string
  readonly startName: string
  readonly endName: string
  readonly pointCount: number
  readonly trackSegmentCount: number
  readonly distanceKm: number
  readonly elevationGainM: number
  readonly elevationLossM: number
  readonly minAltitudeM: number | null
  readonly maxAltitudeM: number | null
  readonly startPosition: RouteProfilePosition
  readonly endPosition: RouteProfilePosition
}

export interface RouteProfileSummary {
  readonly sourceGpxCount: number
  readonly sourceTrackSegmentCount: number
  readonly sourcePointCount: number
  readonly distanceKm: number
  readonly elevationGainM: number
  readonly elevationLossM: number
  readonly minAltitudeM: number | null
  readonly maxAltitudeM: number | null
  readonly weightedDistanceKm: number
  readonly isContinuous: boolean
  readonly maximumBoundaryGapKm: number
  readonly firstSourceFileNumber: number
  readonly lastSourceFileNumber: number
}

export interface TerrainProfilePoint {
  readonly distanceKm: number
  readonly elevationM: number
  readonly smoothedGradePercent: number
  readonly latitude: number
  readonly longitude: number
}

export interface TerrainTimingPoint extends TerrainProfilePoint {
  readonly movingElapsedMinutes: number
  readonly localSpeedKph: number
}

export interface RouteProfile {
  readonly segments: readonly RouteProfileSegment[]
  readonly waypointSeeds: readonly RouteProfileWaypointSeed[]
  readonly pauseAnchors: readonly RouteProfilePauseAnchor[]
  readonly terrainSeries?: readonly TerrainProfilePoint[]
  readonly summary: RouteProfileSummary
}
