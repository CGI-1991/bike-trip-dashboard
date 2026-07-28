import { calculateHaversineDistanceKm } from '../gpx/parser.ts'
import type {
  GpxAnalysisResult,
  GpxAnalysisSuccess,
  GpxInternalInspection,
  GpxNamedPoint,
  GpxTrackPoint,
} from '../gpx/types.ts'
import { createRouteClockTime } from '../route/time.ts'
import type {
  RouteClockTime,
  RouteProgress,
  RouteTimeline,
  RouteWaypoint,
} from '../route/types.ts'
import { roadbookMatchConfig } from './roadbook-config.ts'
import type { RoadbookMatchConfig } from './roadbook-config.ts'
import { getRoadbookResolutionEntry, resolveRoadbookResolution } from './roadbook-resolutions.ts'
import { roadbookSuppressions, suppressedDocumentedPointIds } from './roadbook-suppressions.ts'
import type {
  RoadbookDay,
  RoadbookDescription,
  RoadbookDocument,
  RoadbookGpxProjection,
  RoadbookOffDay,
  RoadbookOverridesDocument,
  RoadbookPoint,
  RoadbookPointOverride,
  RoadbookPointStatus,
  RoadbookPointType,
  RoadbookResolution,
  RoadbookRideDay,
  RoadbookValidationIssue,
} from './roadbook-types.ts'
import type {
  RideDay,
  RideDayId,
  TripDayId,
  TripPlan,
  TripTimeline,
} from './types.ts'

export type RoadbookPointSourceKind =
  | 'endpoint'
  | 'col'
  | 'passage-group'
  | 'pause'
  | 'option'

export interface RoadbookMatchAlternative {
  readonly waypointId: string
  readonly latitude: number
  readonly longitude: number
  readonly trackDistanceKm: number
  readonly altitudeM: number | null
  readonly elevationDifferenceM: number | null
  readonly eta: RouteClockTime
  readonly preferredAltitude: boolean
}

export interface RoadbookPointMatch extends RoadbookPoint {
  readonly sourceKind: RoadbookPointSourceKind
  readonly eta?: RouteClockTime
  readonly alternatives: readonly RoadbookMatchAlternative[]
  readonly overrideApplied: boolean
  readonly matchedNextPointIndex?: number
  readonly matchedSegmentFraction?: number
  readonly linkedWaypointId?: string
  readonly standaloneWaypoint: boolean
  readonly resolution: RoadbookResolution
  readonly resolutionJustification?: string
}

export interface RoadbookWaypointLink {
  readonly dayId: RideDayId
  readonly waypointId: string
  readonly roadbookPointIds: readonly string[]
  readonly primaryRoadbookPointId: string
  readonly displayName: string
  readonly maximumTrackDistanceDifferenceKm: number
}

export interface RoadbookStandaloneWaypoint {
  readonly dayId: RideDayId
  readonly roadbookPointId: string
  readonly roadbookPointIds: readonly string[]
  readonly type: RoadbookPointType
  readonly name: string
  readonly latitude: number
  readonly longitude: number
  readonly trackDistanceKm: number
  readonly altitudeM: number | null
  readonly eta: RouteClockTime
}

export interface RoadbookTheoreticalPause {
  readonly id: string
  readonly name: string
  readonly durationMinutes: number
  readonly trackDistanceKm: number
  readonly latitude: number
  readonly longitude: number
  readonly altitudeM: number | null
  readonly startEta: RouteClockTime
  readonly endEta: RouteClockTime
  readonly source: 'route-engine'
}

export interface RoadbookStatsValues {
  readonly distanceKm: number
  readonly elevationGainM: number | null
  readonly elevationLossM: number | null
}

export interface RoadbookStatsDelta {
  readonly distanceKm: number
  readonly elevationGainM: number | null
  readonly elevationLossM: number | null
}

export interface RoadbookDayStatsComparison {
  readonly dayId: RideDayId
  readonly gpx: RoadbookStatsValues | null
  readonly roadbook: RoadbookStatsValues
  readonly deltaGpxMinusRoadbook: RoadbookStatsDelta | null
}

export interface RoadbookStatsReport {
  readonly days: readonly RoadbookDayStatsComparison[]
  readonly comparedDayCount: number
  readonly gpxTotals: RoadbookStatsValues
  readonly roadbookTotals: RoadbookStatsValues
  readonly deltaGpxMinusRoadbook: RoadbookStatsDelta
}

export interface RoadbookRideDayMatchReport {
  readonly dayId: RideDayId
  readonly dayNumber: number
  readonly type: 'ride'
  readonly status: 'ready' | 'unavailable'
  readonly roadbook: RoadbookRideDay
  readonly points: readonly RoadbookPointMatch[]
  readonly theoreticalPauses: readonly RoadbookTheoreticalPause[]
  readonly lodgings: readonly RoadbookDescription[]
  readonly stats: RoadbookDayStatsComparison
  readonly error?: string
}

export interface RoadbookOffDayMatchReport {
  readonly dayId: Extract<TripDayId, 'J5' | 'J8'>
  readonly dayNumber: number
  readonly type: 'off'
  readonly status: 'ready'
  readonly roadbook: RoadbookOffDay
  readonly points: readonly []
  readonly theoreticalPauses: readonly []
  readonly lodgings: readonly RoadbookDescription[]
}

export type RoadbookDayMatchReport =
  | RoadbookRideDayMatchReport
  | RoadbookOffDayMatchReport

export interface RoadbookInternalGpxInspectionEntry {
  readonly fileNumber: number
  readonly fileName: string
  readonly status: 'success' | 'error'
  readonly inspection: GpxInternalInspection | null
  readonly namedPoints: readonly GpxNamedPoint[]
  readonly error?: string
}

export interface RoadbookInternalGpxInspectionSummary {
  readonly files: readonly RoadbookInternalGpxInspectionEntry[]
  readonly waypointCount: number
  readonly routePointCount: number
  readonly namedPointCount: number
  readonly nameElementCount: number
  readonly descriptionElementCount: number
  readonly symbolElementCount: number
  readonly extensionElementCount: number
  readonly textualMatchAttemptCount: number
  readonly textualMatchCount: number
}

export interface RoadbookMatchSummary {
  readonly dayCount: number
  readonly rideDayCount: number
  readonly offDayCount: number
  readonly readyRideDayCount: number
  readonly unavailableRideDayCount: number
  readonly pointCount: number
  readonly matchedPointCount: number
  readonly needsReviewPointCount: number
  readonly unmatchedPointCount: number
  readonly activePointCount: number
  readonly informationalPointCount: number
  readonly excludedPointCount: number
  readonly userDecisionRequiredPointCount: number
  readonly linkedWaypointCount: number
  readonly standaloneWaypointCount: number
  readonly theoreticalPauseCount: number
  readonly matchedRoadbookPauseCount: number
  /** Documented points permanently removed by user decision — see roadbook-suppressions.ts. */
  readonly suppressedPointCount: number
}

export interface RoadbookMatchValidationReport {
  readonly isValid: boolean
  readonly issues: readonly RoadbookValidationIssue[]
}

export interface RoadbookMatchReport {
  readonly tripId: 'rga-2026'
  readonly days: readonly RoadbookDayMatchReport[]
  readonly allPointMatches: readonly RoadbookPointMatch[]
  readonly summary: RoadbookMatchSummary
  readonly stats: RoadbookStatsReport
  readonly waypointLinks: readonly RoadbookWaypointLink[]
  readonly standaloneWaypoints: readonly RoadbookStandaloneWaypoint[]
  readonly internalGpxInspection: RoadbookInternalGpxInspectionSummary
  readonly validation: RoadbookMatchValidationReport
}

interface TrackVertex extends GpxTrackPoint {
  readonly segmentIndex: number
  readonly pointIndex: number
  readonly trackDistanceKm: number
}

interface TrackProjection extends TrackVertex {
  readonly nextPointIndex: number
  readonly segmentFraction: number
  readonly distanceFromSourceM: number
}

interface DayContext {
  readonly planDay: RideDay
  readonly roadbookDay: RoadbookRideDay
  readonly gpx: GpxAnalysisSuccess
  readonly route: RouteTimeline
  readonly vertices: readonly TrackVertex[]
}

export interface SourcePoint {
  readonly point: RoadbookPointMatch
  readonly sourceOrder: number
}

interface AlignmentScore {
  readonly assignments: ReadonlyMap<string, RouteWaypoint>
  readonly matchCount: number
  readonly preferredCount: number
  readonly totalElevationDifferenceM: number
}

function fail(message: string): never {
  throw new Error(`Rapport roadbook invalide : ${message}`)
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Erreur roadbook inconnue.'
}

function isFiniteCoordinate(latitude: number, longitude: number): boolean {
  return (
    Number.isFinite(latitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    Number.isFinite(longitude) &&
    longitude >= -180 &&
    longitude <= 180
  )
}

function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('fr-FR')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function createUnmatchedPoint(
  id: string,
  dayId: RideDayId,
  type: RoadbookPointType,
  name: string,
  sourceKind: RoadbookPointSourceKind,
  options: {
    readonly elevationM?: number
    readonly notes?: string
    readonly isPauseCandidate?: boolean
    readonly isResupplyCandidate?: boolean
  } = {},
): RoadbookPointMatch {
  return {
    id,
    dayId,
    type,
    name,
    ...(options.elevationM === undefined ? {} : { elevationM: options.elevationM }),
    ...(options.notes === undefined ? {} : { notes: options.notes }),
    ...(options.isPauseCandidate === undefined
      ? {}
      : { isPauseCandidate: options.isPauseCandidate }),
    ...(options.isResupplyCandidate === undefined
      ? {}
      : { isResupplyCandidate: options.isResupplyCandidate }),
    status: 'unmatched',
    resolution: resolveRoadbookResolution(id, 'unmatched'),
    sourceKind,
    alternatives: [],
    overrideApplied: false,
    standaloneWaypoint: false,
  }
}

function buildTrackVertices(gpx: GpxAnalysisSuccess): readonly TrackVertex[] {
  const vertices: TrackVertex[] = []
  let trackDistanceKm = 0

  gpx.segments.forEach((segment, segmentIndex) => {
    let previousPoint: GpxTrackPoint | null = null

    segment.points.forEach((point, pointIndex) => {
      if (previousPoint !== null) {
        trackDistanceKm += calculateHaversineDistanceKm(previousPoint, point)
      }

      vertices.push({
        ...point,
        segmentIndex,
        pointIndex,
        trackDistanceKm,
      })
      previousPoint = point
    })
  })

  return vertices
}

function interpolateNullable(
  from: number | null,
  to: number | null,
  fraction: number,
): number | null {
  if (from === null && to === null) {
    return null
  }

  if (from === null) {
    return to
  }

  if (to === null) {
    return from
  }

  return from + (to - from) * fraction
}

function projectCoordinatesOnTrack(
  latitude: number,
  longitude: number,
  gpx: GpxAnalysisSuccess,
  vertices: readonly TrackVertex[],
  config: RoadbookMatchConfig,
): TrackProjection | null {
  if (!isFiniteCoordinate(latitude, longitude) || vertices.length === 0) {
    return null
  }

  const referenceLatitudeRadians = (latitude * Math.PI) / 180
  const kilometresPerRadian = config.projectionEarthRadiusKm
  let best: TrackProjection | null = null

  const considerProjection = (
    from: TrackVertex,
    to: TrackVertex,
    fraction: number,
  ): void => {
    const projectedLatitude = from.latitude + (to.latitude - from.latitude) * fraction
    const projectedLongitude = from.longitude + (to.longitude - from.longitude) * fraction
    const distanceFromSourceM =
      calculateHaversineDistanceKm(
        { latitude, longitude, elevationM: null },
        { latitude: projectedLatitude, longitude: projectedLongitude, elevationM: null },
      ) * 1000
    const edgeDistanceKm = Math.max(0, to.trackDistanceKm - from.trackDistanceKm)
    const projection: TrackProjection = {
      latitude: projectedLatitude,
      longitude: projectedLongitude,
      elevationM: interpolateNullable(from.elevationM, to.elevationM, fraction),
      segmentIndex: from.segmentIndex,
      pointIndex: from.pointIndex,
      nextPointIndex: to.pointIndex,
      segmentFraction: fraction,
      trackDistanceKm: from.trackDistanceKm + edgeDistanceKm * fraction,
      distanceFromSourceM,
    }

    if (
      best === null ||
      projection.distanceFromSourceM < best.distanceFromSourceM - config.comparisonEpsilon ||
      (Math.abs(projection.distanceFromSourceM - best.distanceFromSourceM) <=
        config.comparisonEpsilon &&
        projection.trackDistanceKm < best.trackDistanceKm)
    ) {
      best = projection
    }
  }

  for (const segment of gpx.segments) {
    const segmentVertices = vertices.filter(
      ({ segmentIndex }) => segmentIndex === gpx.segments.indexOf(segment),
    )

    if (segmentVertices.length === 1) {
      const only = segmentVertices[0]
      if (only !== undefined) {
        considerProjection(only, only, 0)
      }
      continue
    }

    for (let index = 1; index < segmentVertices.length; index++) {
      const from = segmentVertices[index - 1]
      const to = segmentVertices[index]

      if (from === undefined || to === undefined) {
        continue
      }

      const fromX =
        ((from.longitude - longitude) * Math.PI) / 180 *
        Math.cos(referenceLatitudeRadians) *
        kilometresPerRadian
      const fromY =
        ((from.latitude - latitude) * Math.PI) / 180 * kilometresPerRadian
      const toX =
        ((to.longitude - longitude) * Math.PI) / 180 *
        Math.cos(referenceLatitudeRadians) *
        kilometresPerRadian
      const toY = ((to.latitude - latitude) * Math.PI) / 180 * kilometresPerRadian
      const deltaX = toX - fromX
      const deltaY = toY - fromY
      const squaredLength = deltaX * deltaX + deltaY * deltaY
      const fraction =
        squaredLength <= config.comparisonEpsilon
          ? 0
          : Math.min(
              1,
              Math.max(0, -(fromX * deltaX + fromY * deltaY) / squaredLength),
            )
      considerProjection(from, to, fraction)
    }
  }

  return best
}

function createRouteProgressAtDistance(
  route: RouteTimeline,
  trackDistanceKm: number,
): RouteProgress {
  const samples = route.waypoints
    .filter(({ type }) => type !== 'pause-start' && type !== 'pause-end')
    .sort((left, right) => left.progress.distanceKm - right.progress.distanceKm)
  const afterIndex = samples.findIndex(
    ({ progress }) => progress.distanceKm >= trackDistanceKm,
  )
  const after = samples[afterIndex < 0 ? samples.length - 1 : afterIndex]
  const before = samples[Math.max(0, (afterIndex < 0 ? samples.length - 1 : afterIndex) - 1)]

  if (before === undefined || after === undefined) {
    fail('aucun waypoint ne permet d’interpoler une ETA.')
  }

  const distanceDeltaKm = after.progress.distanceKm - before.progress.distanceKm
  const fraction =
    distanceDeltaKm <= roadbookMatchConfig.comparisonEpsilon
      ? 0
      : Math.min(
          1,
          Math.max(0, (trackDistanceKm - before.progress.distanceKm) / distanceDeltaKm),
        )
  const interpolate = (from: number, to: number): number => from + (to - from) * fraction
  const movingElapsedMinutes = interpolate(
    before.progress.movingElapsedMinutes,
    after.progress.movingElapsedMinutes,
  )
  const pauseMinutes = route.pauses.reduce(
    (total, pause) =>
      pause.distanceKm < trackDistanceKm - roadbookMatchConfig.comparisonEpsilon
        ? total + pause.durationMinutes
        : total,
    0,
  )
  const elapsedMinutes = movingElapsedMinutes + pauseMinutes

  return {
    distanceKm: trackDistanceKm,
    elevationGainM: interpolate(
      before.progress.elevationGainM,
      after.progress.elevationGainM,
    ),
    elevationLossM: interpolate(
      before.progress.elevationLossM,
      after.progress.elevationLossM,
    ),
    altitudeM: interpolateNullable(
      before.progress.altitudeM,
      after.progress.altitudeM,
      fraction,
    ),
    localSlopePercent: interpolate(
      before.progress.localSlopePercent,
      after.progress.localSlopePercent,
    ),
    estimatedSpeedKph: interpolate(
      before.progress.estimatedSpeedKph,
      after.progress.estimatedSpeedKph,
    ),
    movingElapsedMinutes,
    elapsedMinutes,
    theoreticalTimeMinutes: route.summary.departureTimeMinutes + elapsedMinutes,
  }
}

function createEta(route: RouteTimeline, trackDistanceKm: number): RouteClockTime {
  const progress = createRouteProgressAtDistance(route, trackDistanceKm)
  return createRouteClockTime(route.summary.departureTimeMinutes, progress.elapsedMinutes)
}

function createProjectionFields(
  point: RoadbookPointMatch,
  projection: TrackProjection,
  route: RouteTimeline,
  status: RoadbookPointStatus,
): RoadbookPointMatch {
  const elevationDifferenceM =
    point.elevationM === undefined || projection.elevationM === null
      ? undefined
      : Math.abs(point.elevationM - projection.elevationM)

  return {
    ...point,
    matchedLatitude: projection.latitude,
    matchedLongitude: projection.longitude,
    matchedTrackDistanceKm: projection.trackDistanceKm,
    ...(projection.elevationM === null
      ? {}
      : { matchedElevationM: projection.elevationM }),
    matchDistanceM: projection.distanceFromSourceM,
    ...(elevationDifferenceM === undefined ? {} : { elevationDifferenceM }),
    matchedSegmentIndex: projection.segmentIndex,
    matchedPointIndex: projection.pointIndex,
    matchedNextPointIndex: projection.nextPointIndex,
    matchedSegmentFraction: projection.segmentFraction,
    status,
    ...(status === 'unmatched' ? {} : { eta: createEta(route, projection.trackDistanceKm) }),
  }
}

/**
 * Builds the per-day list of roadbook points before any GPX matching. This is
 * the earliest choke point in the pipeline and where permanently suppressed
 * points (roadbook-suppressions.ts) are filtered out — exported so that
 * filtering can be tested directly without fixturing a full match report.
 */
export function createSourcePoints(day: RoadbookRideDay): readonly SourcePoint[] {
  const dayPrefix = `j${String(day.dayNumber).padStart(2, '0')}`
  const points: SourcePoint[] = []
  let sourceOrder = 0
  const add = (point: RoadbookPointMatch): void => {
    // Permanently suppressed points (see roadbook-suppressions.ts) never enter the
    // operational model at all — not merely hidden, but absent from every
    // downstream consumer (matching, weather sampling, map, profile, pauses).
    if (suppressedDocumentedPointIds.has(point.id)) return
    points.push({ point, sourceOrder })
    sourceOrder++
  }

  add(createUnmatchedPoint(`${dayPrefix}-start`, day.id, 'start', day.startName, 'endpoint'))

  for (const col of day.cols) {
    add(
      createUnmatchedPoint(col.id, day.id, 'col', col.name, 'col', {
        elevationM: col.elevationM,
        notes: `Col issu du roadbook ; longueur éditoriale ${col.distanceKm} km, D+ ${col.elevationGainM} m, pente moyenne ${col.averageGradientPercent} %.`,
      }),
    )
  }

  for (const passage of day.resupplyPassages) {
    add(
      createUnmatchedPoint(
        passage.id,
        day.id,
        'passage',
        passage.label,
        'passage-group',
        {
          notes:
            'Source roadbook : groupe passages / ravitaillements ; aucun commerce ou point d’eau n’est garanti.',
          isPauseCandidate: true,
          isResupplyCandidate: true,
        },
      ),
    )
  }

  for (const pause of day.explicitPauses) {
    add(
      createUnmatchedPoint(pause.id, day.id, 'pause', pause.title, 'pause', {
        notes:
          'Pause explicite du roadbook sans choix de localité : les passages correspondants restent candidats et les pauses 25/50/25 ne sont pas déplacées.',
        isPauseCandidate: true,
      }),
    )
  }

  for (const option of day.options) {
    add(
      createUnmatchedPoint(
        option.id,
        day.id,
        option.elevationM === undefined ? 'poi' : 'summit',
        option.title,
        'option',
        {
          ...(option.elevationM === undefined ? {} : { elevationM: option.elevationM }),
          notes: 'Option issue du roadbook ; inclusion dans le tracé non présumée.',
        },
      ),
    )
  }

  add(createUnmatchedPoint(`${dayPrefix}-end`, day.id, 'end', day.endName, 'endpoint'))
  return points
}

function getCoordinateStatus(
  distanceM: number,
  config: RoadbookMatchConfig,
): RoadbookPointStatus {
  if (distanceM <= config.coordinateMatchedMaximumDistanceM) {
    return 'matched'
  }

  if (distanceM <= config.coordinateReviewMaximumDistanceM) {
    return 'needs-review'
  }

  return 'unmatched'
}

function reconstructOverrideProjection(
  snapshot: RoadbookGpxProjection,
  vertices: readonly TrackVertex[],
  config: RoadbookMatchConfig,
): TrackProjection | null {
  const from = vertices.find(
    (candidate) =>
      candidate.segmentIndex === snapshot.segmentIndex &&
      candidate.pointIndex === snapshot.pointIndex,
  )

  if (from === undefined) {
    return null
  }

  if (
    snapshot.nextPointIndex === snapshot.pointIndex &&
    snapshot.segmentFraction <= config.comparisonEpsilon
  ) {
    return {
      ...from,
      nextPointIndex: from.pointIndex,
      segmentFraction: 0,
      distanceFromSourceM: 0,
    }
  }

  const to = vertices.find(
    (candidate) =>
      candidate.segmentIndex === snapshot.segmentIndex &&
      candidate.pointIndex === snapshot.nextPointIndex,
  )

  if (
    to === undefined ||
    to.pointIndex !== from.pointIndex + 1 ||
    snapshot.segmentFraction < 0 ||
    snapshot.segmentFraction > 1
  ) {
    return null
  }

  const fraction = snapshot.segmentFraction
  const edgeDistanceKm = Math.max(0, to.trackDistanceKm - from.trackDistanceKm)
  return {
    latitude: from.latitude + (to.latitude - from.latitude) * fraction,
    longitude: from.longitude + (to.longitude - from.longitude) * fraction,
    elevationM: interpolateNullable(from.elevationM, to.elevationM, fraction),
    segmentIndex: from.segmentIndex,
    pointIndex: from.pointIndex,
    nextPointIndex: to.pointIndex,
    segmentFraction: fraction,
    trackDistanceKm: from.trackDistanceKm + edgeDistanceKm * fraction,
    distanceFromSourceM: 0,
  }
}

function applyOverride(
  point: RoadbookPointMatch,
  override: RoadbookPointOverride,
  context: DayContext,
  issues: RoadbookValidationIssue[],
  config: RoadbookMatchConfig,
): RoadbookPointMatch | null {
  const path = `overrides.${override.pointId}`
  const projection = reconstructOverrideProjection(
    override.gpxProjection,
    context.vertices,
    config,
  )

  if (projection === null) {
    issues.push({
      path,
      dayId: point.dayId,
      message: 'Projection manuelle introuvable dans le GPX courant.',
    })
    return null
  }

  const snapshot = override.gpxProjection
  const coordinateDifferenceM =
    calculateHaversineDistanceKm(
      { latitude: snapshot.latitude, longitude: snapshot.longitude, elevationM: null },
      { latitude: projection.latitude, longitude: projection.longitude, elevationM: null },
    ) * 1000
  const anchorDistanceM =
    calculateHaversineDistanceKm(
      {
        latitude: override.sourceAnchor.latitude,
        longitude: override.sourceAnchor.longitude,
        elevationM: null,
      },
      { latitude: projection.latitude, longitude: projection.longitude, elevationM: null },
    ) * 1000
  const elevationDifferenceM =
    projection.elevationM === null
      ? Number.POSITIVE_INFINITY
      : Math.abs(projection.elevationM - snapshot.elevationM)
  const inconsistencies = [
    coordinateDifferenceM > config.overrideCoordinateToleranceM
      ? `coordonnées décalées de ${coordinateDifferenceM.toFixed(1)} m`
      : null,
    Math.abs(projection.trackDistanceKm - snapshot.trackDistanceKm) >
    config.overrideTrackDistanceToleranceKm
      ? 'distance cumulée différente'
      : null,
    elevationDifferenceM > config.overrideElevationToleranceM
      ? 'altitude différente'
      : null,
    Math.abs(anchorDistanceM - override.anchorDistanceM) >
    config.overrideAnchorDistanceToleranceM
      ? 'distance à l’ancre différente'
      : null,
    Math.abs(projection.segmentFraction - snapshot.segmentFraction) >
    config.overrideSegmentFractionTolerance
      ? 'fraction de segment différente'
      : null,
  ].filter((value): value is string => value !== null)

  if (inconsistencies.length > 0) {
    issues.push({
      path,
      dayId: point.dayId,
      message: `Override ignoré : le GPX a divergé (${inconsistencies.join(', ')}).`,
    })
    return null
  }

  const approvedPoint: RoadbookPointMatch = {
    ...point,
    name: override.displayName ?? point.name,
    type: override.pointType ?? point.type,
    ...(override.pointSubtype === undefined
      ? {}
      : { subtype: override.pointSubtype }),
  }
  const projectedPoint = createProjectionFields(
    approvedPoint,
    { ...projection, distanceFromSourceM: anchorDistanceM },
    context.route,
    override.approvedStatus,
  )
  return {
    ...projectedPoint,
    sourceLatitude: override.sourceAnchor.latitude,
    sourceLongitude: override.sourceAnchor.longitude,
    matchMethod: override.matchMethod,
    notes: [point.notes, override.comment, `Validation : ${override.validationSource}`]
      .filter((value): value is string => value !== undefined && value.trim() !== '')
      .join(' '),
    overrideApplied: true,
  }
}

function findNamedGpxPoint(
  point: RoadbookPointMatch,
  context: DayContext,
): GpxNamedPoint | null {
  const normalizedPointName = normalizeName(point.name)
  if (normalizedPointName.length === 0) {
    return null
  }

  const matches = context.gpx.namedPoints.filter((candidate) => {
    const names = [candidate.name, candidate.description]
      .filter((value): value is string => value !== null)
      .map(normalizeName)
    return names.includes(normalizedPointName)
  })

  return matches.length === 1 ? (matches[0] ?? null) : null
}

function applyNamedGpxPoint(
  point: RoadbookPointMatch,
  namedPoint: GpxNamedPoint,
  context: DayContext,
  config: RoadbookMatchConfig,
): RoadbookPointMatch {
  const projection = projectCoordinatesOnTrack(
    namedPoint.latitude,
    namedPoint.longitude,
    context.gpx,
    context.vertices,
    config,
  )

  if (projection === null) {
    return point
  }

  const status = getCoordinateStatus(projection.distanceFromSourceM, config)
  return {
    ...createProjectionFields(point, projection, context.route, status),
    sourceLatitude: namedPoint.latitude,
    sourceLongitude: namedPoint.longitude,
    matchMethod: 'named-gpx-point',
    notes: [
      point.notes,
      `Point GPX nommé ${namedPoint.sourceType} : ${namedPoint.id}.`,
    ]
      .filter((value): value is string => value !== undefined)
      .join(' '),
  }
}

function compareAlignmentScores(
  left: AlignmentScore,
  right: AlignmentScore,
): number {
  return (
    left.matchCount - right.matchCount ||
    left.preferredCount - right.preferredCount ||
    right.totalElevationDifferenceM - left.totalElevationDifferenceM
  )
}

function alignProfileCandidates(
  points: readonly RoadbookPointMatch[],
  summitWaypoints: readonly RouteWaypoint[],
  config: RoadbookMatchConfig,
): ReadonlyMap<string, RouteWaypoint> {
  const eligiblePoints = points.filter(
    (point) =>
      (point.type === 'col' || point.type === 'summit') &&
      !point.overrideApplied &&
      point.matchMethod === undefined &&
      point.elevationM !== undefined,
  )
  const fixedPositions = points.flatMap((point, pointIndex) =>
    (point.type === 'col' || point.type === 'summit') &&
    point.matchMethod !== undefined &&
    point.status !== 'unmatched' &&
    point.matchedTrackDistanceKm !== undefined
      ? [{ pointIndex, trackDistanceKm: point.matchedTrackDistanceKm }]
      : [],
  )
  const candidates = [...summitWaypoints]
    .filter(({ progress }) => progress.altitudeM !== null)
    .sort((left, right) => left.progress.distanceKm - right.progress.distanceKm)
    .filter(
      (candidate, index, sorted) =>
        index === 0 ||
        candidate.progress.distanceKm -
          (sorted[index - 1]?.progress.distanceKm ?? Number.NEGATIVE_INFINITY) >=
          config.profileMinimumSeparationKm - config.comparisonEpsilon,
    )
    .filter((candidate) =>
      fixedPositions.every(
        ({ trackDistanceKm }) =>
          Math.abs(candidate.progress.distanceKm - trackDistanceKm) >=
          config.profileMinimumSeparationKm - config.comparisonEpsilon,
      ),
    )
  const memo = new Map<string, AlignmentScore>()

  const solve = (pointIndex: number, candidateIndex: number): AlignmentScore => {
    const key = `${pointIndex}:${candidateIndex}`
    const existing = memo.get(key)
    if (existing !== undefined) {
      return existing
    }

    if (pointIndex >= eligiblePoints.length || candidateIndex >= candidates.length) {
      const empty: AlignmentScore = {
        assignments: new Map(),
        matchCount: 0,
        preferredCount: 0,
        totalElevationDifferenceM: 0,
      }
      memo.set(key, empty)
      return empty
    }

    const point = eligiblePoints[pointIndex]
    const candidate = candidates[candidateIndex]

    if (point === undefined || candidate === undefined || point.elevationM === undefined) {
      return solve(pointIndex + 1, candidateIndex + 1)
    }

    const choices = [solve(pointIndex + 1, candidateIndex), solve(pointIndex, candidateIndex + 1)]
    const candidateAltitudeM = candidate.progress.altitudeM

    if (candidateAltitudeM !== null) {
      const elevationDifferenceM = Math.abs(point.elevationM - candidateAltitudeM)
      const sourcePointIndex = points.findIndex(({ id }) => id === point.id)
      const previousFixed = [...fixedPositions]
        .reverse()
        .find(({ pointIndex: fixedIndex }) => fixedIndex < sourcePointIndex)
      const nextFixed = fixedPositions.find(
        ({ pointIndex: fixedIndex }) => fixedIndex > sourcePointIndex,
      )
      const respectsFixedOrder =
        (previousFixed === undefined ||
          candidate.progress.distanceKm >=
            previousFixed.trackDistanceKm + config.profileMinimumSeparationKm -
              config.comparisonEpsilon) &&
        (nextFixed === undefined ||
          candidate.progress.distanceKm <=
            nextFixed.trackDistanceKm - config.profileMinimumSeparationKm +
              config.comparisonEpsilon)

      if (
        respectsFixedOrder &&
        elevationDifferenceM <= config.profileMaximumElevationDifferenceM
      ) {
        const remaining = solve(pointIndex + 1, candidateIndex + 1)
        const assignments = new Map(remaining.assignments)
        assignments.set(point.id, candidate)
        choices.push({
          assignments,
          matchCount: remaining.matchCount + 1,
          preferredCount:
            remaining.preferredCount +
            Number(elevationDifferenceM <= config.profilePreferredElevationDifferenceM),
          totalElevationDifferenceM:
            remaining.totalElevationDifferenceM + elevationDifferenceM,
        })
      }
    }

    const best = choices.reduce((current, choice) =>
      compareAlignmentScores(choice, current) > 0 ? choice : current,
    )
    memo.set(key, best)
    return best
  }

  return solve(0, 0).assignments
}

function createProfileAlternatives(
  point: RoadbookPointMatch,
  summitWaypoints: readonly RouteWaypoint[],
  route: RouteTimeline,
  primaryWaypointId: string | null,
  config: RoadbookMatchConfig,
): readonly RoadbookMatchAlternative[] {
  if (point.elevationM === undefined) {
    return []
  }

  const sourceElevationM = point.elevationM

  return summitWaypoints
    .filter(({ id }) => id !== primaryWaypointId)
    .flatMap((waypoint): RoadbookMatchAlternative[] => {
      const altitudeM = waypoint.progress.altitudeM
      if (altitudeM === null) {
        return []
      }

      const elevationDifferenceM = Math.abs(sourceElevationM - altitudeM)
      if (elevationDifferenceM > config.profileMaximumElevationDifferenceM) {
        return []
      }

      return [
        {
          waypointId: waypoint.id,
          latitude: waypoint.latitude,
          longitude: waypoint.longitude,
          trackDistanceKm: waypoint.progress.distanceKm,
          altitudeM,
          elevationDifferenceM,
          eta: createRouteClockTime(
            route.summary.departureTimeMinutes,
            waypoint.progress.elapsedMinutes,
          ),
          preferredAltitude:
            elevationDifferenceM <= config.profilePreferredElevationDifferenceM,
        },
      ]
    })
    .sort(
      (left, right) =>
        Number(right.preferredAltitude) - Number(left.preferredAltitude) ||
        (left.elevationDifferenceM ?? Number.POSITIVE_INFINITY) -
          (right.elevationDifferenceM ?? Number.POSITIVE_INFINITY) ||
        left.trackDistanceKm - right.trackDistanceKm,
    )
}

function applyProfileCandidates(
  points: readonly RoadbookPointMatch[],
  context: DayContext,
  config: RoadbookMatchConfig,
): readonly RoadbookPointMatch[] {
  const summitWaypoints = context.route.waypoints
    .filter(({ type }) => type === 'summit')
    .sort((left, right) => left.progress.distanceKm - right.progress.distanceKm)
  const assignments = alignProfileCandidates(points, summitWaypoints, config)

  return points.map((point) => {
    if (point.type !== 'col' && point.type !== 'summit') {
      return point
    }

    const assigned = assignments.get(point.id)
    const alternatives = createProfileAlternatives(
      point,
      summitWaypoints,
      context.route,
      assigned?.id ?? null,
      config,
    )

    if (assigned === undefined || assigned.progress.altitudeM === null) {
      return { ...point, alternatives }
    }

    const elevationDifferenceM =
      point.elevationM === undefined
        ? undefined
        : Math.abs(point.elevationM - assigned.progress.altitudeM)
    return {
      ...point,
      matchedLatitude: assigned.latitude,
      matchedLongitude: assigned.longitude,
      matchedTrackDistanceKm: assigned.progress.distanceKm,
      matchedElevationM: assigned.progress.altitudeM,
      ...(elevationDifferenceM === undefined ? {} : { elevationDifferenceM }),
      matchMethod: 'profile-altitude-order-candidate',
      status: 'needs-review',
      eta: createRouteClockTime(
        context.route.summary.departureTimeMinutes,
        assigned.progress.elapsedMinutes,
      ),
      alternatives,
    }
  })
}

function createEndpointMatch(
  point: RoadbookPointMatch,
  kind: 'start' | 'end',
  context: DayContext,
): RoadbookPointMatch {
  const vertex =
    kind === 'start'
      ? context.vertices[0]
      : context.vertices[context.vertices.length - 1]
  const waypoint =
    kind === 'start'
      ? context.route.waypoints.find(({ type }) => type === 'route-start')
      : [...context.route.waypoints].reverse().find(({ type }) => type === 'route-end')

  if (vertex === undefined || waypoint === undefined) {
    fail(`borne ${kind} absente pour ${context.planDay.id}.`)
  }

  return {
    ...point,
    matchedLatitude: vertex.latitude,
    matchedLongitude: vertex.longitude,
    matchedTrackDistanceKm: vertex.trackDistanceKm,
    ...(vertex.elevationM === null ? {} : { matchedElevationM: vertex.elevationM }),
    matchDistanceM: 0,
    matchedSegmentIndex: vertex.segmentIndex,
    matchedPointIndex: vertex.pointIndex,
    matchedNextPointIndex: vertex.pointIndex,
    matchedSegmentFraction: 0,
    matchMethod: 'endpoint',
    status: 'matched',
    eta: createRouteClockTime(
      context.route.summary.departureTimeMinutes,
      waypoint.progress.elapsedMinutes,
    ),
    linkedWaypointId: waypoint.id,
  }
}

function matchDayPoints(
  context: DayContext,
  overridesByPointId: ReadonlyMap<string, RoadbookPointOverride>,
  issues: RoadbookValidationIssue[],
  inspectionCounters: { textualAttempts: number; textualMatches: number },
  config: RoadbookMatchConfig,
): readonly RoadbookPointMatch[] {
  const sourcePoints = createSourcePoints(context.roadbookDay)
  const matchedBeforeProfile = sourcePoints.map(({ point }) => {
    if (point.type === 'start') {
      return createEndpointMatch(point, 'start', context)
    }

    if (point.type === 'end') {
      return createEndpointMatch(point, 'end', context)
    }

    const override = overridesByPointId.get(point.id)
    if (override !== undefined) {
      const overridden = applyOverride(point, override, context, issues, config)
      if (overridden !== null) {
        return overridden
      }
    }

    if (context.gpx.namedPoints.length > 0) {
      inspectionCounters.textualAttempts++
      const namedPoint = findNamedGpxPoint(point, context)
      if (namedPoint !== null) {
        inspectionCounters.textualMatches++
        return applyNamedGpxPoint(point, namedPoint, context, config)
      }
    }

    return point
  })

  return [...applyProfileCandidates(matchedBeforeProfile, context, config)].sort(
    (left, right) => {
      const leftOrder =
        sourcePoints.find(({ point }) => point.id === left.id)?.sourceOrder ?? 0
      const rightOrder =
        sourcePoints.find(({ point }) => point.id === right.id)?.sourceOrder ?? 0
      return leftOrder - rightOrder
    },
  )
}

function getPointLinkPriority(point: RoadbookPointMatch): number {
  if (point.type === 'start' || point.type === 'end') {
    return 0
  }

  return point.overrideApplied ? 1 : 2
}

function getPointLinkMaximumTrackDistanceKm(
  point: RoadbookPointMatch,
  config: RoadbookMatchConfig,
): number {
  return point.type === 'col' || point.type === 'summit'
    ? config.summitWaypointLinkMaximumTrackDistanceKm
    : config.waypointLinkMaximumTrackDistanceKm
}

/**
 * Applies the editorial resolution layer (`roadbook-resolutions.ts`) to a
 * matched point: the active/informational/excluded/user-decision-required
 * verdict, its justification, and — where curated — a display-only rename
 * (e.g. the Tignes / Val d'Isère pause becoming "Val-d'Isère" once Tignes is
 * suppressed). Exported so this final rename step is directly testable.
 */
export function applyPointResolution(point: RoadbookPointMatch): RoadbookPointMatch {
  const entry = getRoadbookResolutionEntry(point.id)
  return {
    ...point,
    resolution: resolveRoadbookResolution(point.id, point.status),
    ...(entry === null ? {} : { resolutionJustification: entry.justification }),
    ...(entry?.displayName === undefined ? {} : { name: entry.displayName }),
  }
}

function linkMatchedPoints(
  dayId: RideDayId,
  points: readonly RoadbookPointMatch[],
  route: RouteTimeline,
  config: RoadbookMatchConfig,
): {
  readonly points: readonly RoadbookPointMatch[]
  readonly links: readonly RoadbookWaypointLink[]
  readonly standaloneWaypoints: readonly RoadbookStandaloneWaypoint[]
} {
  const linkedWaypointByPointId = new Map<string, string>()

  for (const point of points) {
    if (point.status !== 'matched' || point.matchedTrackDistanceKm === undefined) {
      continue
    }

    if (point.linkedWaypointId !== undefined) {
      linkedWaypointByPointId.set(point.id, point.linkedWaypointId)
      continue
    }

    const nearest = route.waypoints.reduce<{
      readonly waypoint: RouteWaypoint
      readonly differenceKm: number
    } | null>((best, waypoint) => {
      const differenceKm = Math.abs(
        waypoint.progress.distanceKm - (point.matchedTrackDistanceKm ?? 0),
      )
      return best === null || differenceKm < best.differenceKm
        ? { waypoint, differenceKm }
        : best
    }, null)

    if (
      nearest !== null &&
      nearest.differenceKm <=
        getPointLinkMaximumTrackDistanceKm(point, config) + config.comparisonEpsilon
    ) {
      linkedWaypointByPointId.set(point.id, nearest.waypoint.id)
    }
  }

  const linkedPoints = points.map((point) => {
    const waypointId = linkedWaypointByPointId.get(point.id)
    return waypointId === undefined
      ? point
      : { ...point, linkedWaypointId: waypointId, standaloneWaypoint: false }
  })
  const groups = new Map<string, RoadbookPointMatch[]>()

  for (const point of linkedPoints) {
    if (point.linkedWaypointId === undefined) {
      continue
    }

    const group = groups.get(point.linkedWaypointId) ?? []
    group.push(point)
    groups.set(point.linkedWaypointId, group)
  }

  const links = [...groups.entries()].map(([waypointId, group]): RoadbookWaypointLink => {
    const waypoint = route.waypoints.find(({ id }) => id === waypointId)
    if (waypoint === undefined) {
      fail(`waypoint lié introuvable : ${waypointId}.`)
    }

    const sortedGroup = [...group].sort(
      (left, right) =>
        getPointLinkPriority(left) - getPointLinkPriority(right) ||
        Math.abs(
          (left.matchedTrackDistanceKm ?? waypoint.progress.distanceKm) -
            waypoint.progress.distanceKm,
        ) -
          Math.abs(
            (right.matchedTrackDistanceKm ?? waypoint.progress.distanceKm) -
              waypoint.progress.distanceKm,
          ) ||
        left.id.localeCompare(right.id),
    )
    const primary = sortedGroup[0]
    if (primary === undefined) {
      fail(`groupe de liaison vide : ${waypointId}.`)
    }

    return {
      dayId,
      waypointId,
      roadbookPointIds: sortedGroup.map(({ id }) => id),
      primaryRoadbookPointId: primary.id,
      displayName: primary.name,
      maximumTrackDistanceDifferenceKm: Math.max(
        ...sortedGroup.map((point) =>
          Math.abs(
            (point.matchedTrackDistanceKm ?? waypoint.progress.distanceKm) -
              waypoint.progress.distanceKm,
          ),
        ),
      ),
    }
  })
  const standaloneCandidates = linkedPoints
    .filter(
      (point) =>
        point.status === 'matched' &&
        point.linkedWaypointId === undefined &&
        point.matchedLatitude !== undefined &&
        point.matchedLongitude !== undefined &&
        point.matchedTrackDistanceKm !== undefined &&
        point.eta !== undefined,
    )
    .sort(
      (left, right) =>
        (left.matchedTrackDistanceKm ?? 0) -
          (right.matchedTrackDistanceKm ?? 0) ||
        left.id.localeCompare(right.id),
    )
  const standaloneGroups: RoadbookPointMatch[][] = []

  for (const point of standaloneCandidates) {
    const matchingGroup = standaloneGroups.find((group) =>
      group.some((candidate) => {
        const leftDistance = point.matchedTrackDistanceKm
        const rightDistance = candidate.matchedTrackDistanceKm
        return (
          leftDistance !== undefined &&
          rightDistance !== undefined &&
          Math.abs(leftDistance - rightDistance) <=
            Math.min(
              getPointLinkMaximumTrackDistanceKm(point, config),
              getPointLinkMaximumTrackDistanceKm(candidate, config),
            ) +
              config.comparisonEpsilon
        )
      }),
    )

    if (matchingGroup === undefined) {
      standaloneGroups.push([point])
    } else {
      matchingGroup.push(point)
    }
  }

  const standaloneWaypoints: RoadbookStandaloneWaypoint[] = standaloneGroups.map(
    (group) => {
      const primary = [...group].sort(
        (left, right) =>
          getPointLinkPriority(left) - getPointLinkPriority(right) ||
          left.id.localeCompare(right.id),
      )[0]

      if (
        primary === undefined ||
        primary.matchedLatitude === undefined ||
        primary.matchedLongitude === undefined ||
        primary.matchedTrackDistanceKm === undefined ||
        primary.eta === undefined
      ) {
        fail('groupe de waypoint roadbook autonome incomplet.')
      }

      return {
        dayId,
        roadbookPointId: primary.id,
        roadbookPointIds: group.map(({ id }) => id),
        type: primary.type,
        name: primary.name,
        latitude: primary.matchedLatitude,
        longitude: primary.matchedLongitude,
        trackDistanceKm: primary.matchedTrackDistanceKm,
        altitudeM: primary.matchedElevationM ?? null,
        eta: primary.eta,
      }
    },
  )
  const standalonePointIds = new Set(
    standaloneGroups.flatMap((group) => group.map(({ id }) => id)),
  )
  const finalPoints = linkedPoints.map((point) =>
    standalonePointIds.has(point.id)
      ? { ...point, standaloneWaypoint: true }
      : point,
  )

  return { points: finalPoints, links, standaloneWaypoints }
}

function createTheoreticalPauses(route: RouteTimeline): readonly RoadbookTheoreticalPause[] {
  return route.pauses
    .map((pause) => ({
      id: pause.id,
      name: pause.name,
      durationMinutes: pause.durationMinutes,
      trackDistanceKm: pause.distanceKm,
      latitude: pause.latitude,
      longitude: pause.longitude,
      altitudeM: pause.altitudeM,
      startEta: createRouteClockTime(
        route.summary.departureTimeMinutes,
        pause.startElapsedMinutes,
      ),
      endEta: createRouteClockTime(
        route.summary.departureTimeMinutes,
        pause.endElapsedMinutes,
      ),
      source: 'route-engine' as const,
    }))
    .sort((left, right) => left.trackDistanceKm - right.trackDistanceKm)
}

function createDayStats(
  day: RoadbookRideDay,
  gpx: GpxAnalysisSuccess | null,
): RoadbookDayStatsComparison {
  const roadbook: RoadbookStatsValues = {
    distanceKm: day.editorialStats.distanceKm,
    elevationGainM: day.editorialStats.elevationGainM,
    elevationLossM: day.editorialStats.elevationLossM,
  }
  const gpxStats: RoadbookStatsValues | null =
    gpx === null
      ? null
      : {
          distanceKm: gpx.summary.distanceKm,
          elevationGainM: gpx.summary.elevationGainM,
          elevationLossM: gpx.summary.elevationLossM,
        }
  const deltaGpxMinusRoadbook: RoadbookStatsDelta | null =
    gpxStats === null
      ? null
      : {
          distanceKm: gpxStats.distanceKm - roadbook.distanceKm,
          elevationGainM:
            gpxStats.elevationGainM === null
              ? null
              : gpxStats.elevationGainM - day.editorialStats.elevationGainM,
          elevationLossM:
            gpxStats.elevationLossM === null
              ? null
              : gpxStats.elevationLossM - day.editorialStats.elevationLossM,
        }
  return { dayId: day.id, gpx: gpxStats, roadbook, deltaGpxMinusRoadbook }
}

function sumNullable(values: readonly (number | null)[]): number | null {
  return values.some((value) => value === null)
    ? null
    : values.reduce<number>((total, value) => total + (value ?? 0), 0)
}

function createStatsReport(
  days: readonly RoadbookDayStatsComparison[],
): RoadbookStatsReport {
  const comparable = days.filter(
    (day): day is RoadbookDayStatsComparison & { readonly gpx: RoadbookStatsValues } =>
      day.gpx !== null,
  )
  const gpxTotals: RoadbookStatsValues = {
    distanceKm: comparable.reduce((total, day) => total + day.gpx.distanceKm, 0),
    elevationGainM: sumNullable(comparable.map((day) => day.gpx.elevationGainM)),
    elevationLossM: sumNullable(comparable.map((day) => day.gpx.elevationLossM)),
  }
  const roadbookTotals: RoadbookStatsValues = {
    distanceKm: days.reduce((total, day) => total + day.roadbook.distanceKm, 0),
    elevationGainM: days.reduce(
      (total, day) => total + (day.roadbook.elevationGainM ?? 0),
      0,
    ),
    elevationLossM: days.reduce(
      (total, day) => total + (day.roadbook.elevationLossM ?? 0),
      0,
    ),
  }
  return {
    days,
    comparedDayCount: comparable.length,
    gpxTotals,
    roadbookTotals,
    deltaGpxMinusRoadbook: {
      distanceKm: gpxTotals.distanceKm - roadbookTotals.distanceKm,
      elevationGainM:
        gpxTotals.elevationGainM === null || roadbookTotals.elevationGainM === null
          ? null
          : gpxTotals.elevationGainM - roadbookTotals.elevationGainM,
      elevationLossM:
        gpxTotals.elevationLossM === null || roadbookTotals.elevationLossM === null
          ? null
          : gpxTotals.elevationLossM - roadbookTotals.elevationLossM,
    },
  }
}

function createInternalInspection(
  results: readonly GpxAnalysisResult[],
  textualAttempts: number,
  textualMatches: number,
): RoadbookInternalGpxInspectionSummary {
  const files = results
    .map((result): RoadbookInternalGpxInspectionEntry =>
      result.status === 'success'
        ? {
            fileNumber: result.source.fileNumber,
            fileName: result.source.fileName,
            status: 'success',
            inspection: result.internalInspection,
            namedPoints: result.namedPoints,
          }
        : {
            fileNumber: result.source.fileNumber,
            fileName: result.source.fileName,
            status: 'error',
            inspection: null,
            namedPoints: [],
            error: result.message,
          },
    )
    .sort((left, right) => left.fileNumber - right.fileNumber)
  const inspections = files.flatMap(({ inspection }) =>
    inspection === null ? [] : [inspection],
  )
  return {
    files,
    waypointCount: inspections.reduce((total, item) => total + item.waypointCount, 0),
    routePointCount: inspections.reduce((total, item) => total + item.routePointCount, 0),
    namedPointCount: inspections.reduce((total, item) => total + item.namedPointCount, 0),
    nameElementCount: inspections.reduce((total, item) => total + item.nameElementCount, 0),
    descriptionElementCount: inspections.reduce(
      (total, item) => total + item.descriptionElementCount,
      0,
    ),
    symbolElementCount: inspections.reduce((total, item) => total + item.symbolElementCount, 0),
    extensionElementCount: inspections.reduce(
      (total, item) => total + item.extensionElementCount,
      0,
    ),
    textualMatchAttemptCount: textualAttempts,
    textualMatchCount: textualMatches,
  }
}

export function validateRoadbookMatchInputs(
  document: RoadbookDocument,
  overrides: RoadbookOverridesDocument,
  plan: TripPlan,
  gpxResults: readonly GpxAnalysisResult[],
  timeline: TripTimeline,
): RoadbookMatchValidationReport {
  const issues: RoadbookValidationIssue[] = []

  if (
    document.tripId !== plan.id ||
    overrides.tripId !== plan.id ||
    timeline.tripId !== plan.id
  ) {
    issues.push({ path: 'tripId', message: 'Les identifiants de voyage ne concordent pas.' })
  }

  if (document.version !== 1 || overrides.version !== 1) {
    issues.push({ path: 'version', message: 'Version roadbook ou overrides non prise en charge.' })
  }

  if (document.days.length !== plan.days.length || timeline.days.length !== plan.days.length) {
    issues.push({ path: 'days', message: 'Le rapport doit couvrir exactement les 12 jours.' })
  }

  plan.days.forEach((planDay, index) => {
    const roadbookDay = document.days[index]
    const timelineDay = timeline.days[index]

    if (
      roadbookDay?.id !== planDay.id ||
      roadbookDay.dayNumber !== planDay.dayNumber ||
      roadbookDay.type !== planDay.type
    ) {
      issues.push({
        path: `days.${index}`,
        dayId: planDay.id,
        message: 'Le jour roadbook ne correspond pas au TripPlan.',
      })
    }

    if (
      timelineDay?.day.id !== planDay.id ||
      timelineDay.day.dayNumber !== planDay.dayNumber ||
      timelineDay.type !== planDay.type
    ) {
      issues.push({
        path: `timeline.days.${index}`,
        dayId: planDay.id,
        message: 'La chronologie ne correspond pas au TripPlan.',
      })
    }
  })

  const resultNumbers = new Set<number>()
  for (const result of gpxResults) {
    if (resultNumbers.has(result.source.fileNumber)) {
      issues.push({
        path: 'gpxResults',
        message: `Numéro GPX dupliqué : ${result.source.fileNumber}.`,
      })
    }
    resultNumbers.add(result.source.fileNumber)
  }

  const overrideIds = new Set<string>()
  for (const override of overrides.overrides) {
    if (overrideIds.has(override.pointId)) {
      issues.push({
        path: `overrides.${override.pointId}`,
        message: 'Override dupliqué.',
      })
    }
    overrideIds.add(override.pointId)
  }

  return { isValid: issues.length === 0, issues }
}

function createOverridesMap(
  overrides: RoadbookOverridesDocument,
  issues: RoadbookValidationIssue[],
): ReadonlyMap<string, RoadbookPointOverride> {
  const map = new Map<string, RoadbookPointOverride>()

  for (const override of overrides.overrides) {
    if (map.has(override.pointId)) {
      issues.push({
        path: `overrides.${override.pointId}`,
        message: 'Override dupliqué ignoré.',
      })
      continue
    }
    map.set(override.pointId, override)
  }

  return map
}

function createUnavailableRideDayReport(
  day: RoadbookRideDay,
  gpx: GpxAnalysisSuccess | null,
  error: string,
): RoadbookRideDayMatchReport {
  return {
    dayId: day.id,
    dayNumber: day.dayNumber,
    type: 'ride',
    status: 'unavailable',
    roadbook: day,
    points: createSourcePoints(day).map(({ point }) => point),
    theoreticalPauses: [],
    lodgings: day.lodgings,
    stats: createDayStats(day, gpx),
    error,
  }
}

function buildSummary(
  days: readonly RoadbookDayMatchReport[],
  points: readonly RoadbookPointMatch[],
  links: readonly RoadbookWaypointLink[],
  standaloneWaypoints: readonly RoadbookStandaloneWaypoint[],
): RoadbookMatchSummary {
  const rideDays = days.filter((day) => day.type === 'ride')
  return {
    dayCount: days.length,
    rideDayCount: rideDays.length,
    offDayCount: days.filter((day) => day.type === 'off').length,
    readyRideDayCount: rideDays.filter((day) => day.status === 'ready').length,
    unavailableRideDayCount: rideDays.filter((day) => day.status === 'unavailable').length,
    pointCount: points.length,
    matchedPointCount: points.filter(({ status }) => status === 'matched').length,
    needsReviewPointCount: points.filter(({ status }) => status === 'needs-review').length,
    unmatchedPointCount: points.filter(({ status }) => status === 'unmatched').length,
    activePointCount: points.filter(({ resolution }) => resolution === 'matched').length,
    informationalPointCount: points.filter(
      ({ resolution }) => resolution === 'informational',
    ).length,
    excludedPointCount: points.filter(({ resolution }) => resolution === 'excluded').length,
    userDecisionRequiredPointCount: points.filter(
      ({ resolution }) => resolution === 'user-decision-required',
    ).length,
    linkedWaypointCount: links.length,
    standaloneWaypointCount: standaloneWaypoints.length,
    theoreticalPauseCount: days.reduce(
      (total, day) => total + day.theoreticalPauses.length,
      0,
    ),
    matchedRoadbookPauseCount: points.filter(
      ({ type, status }) => type === 'pause' && status === 'matched',
    ).length,
    suppressedPointCount: roadbookSuppressions.length,
  }
}

export function assertRoadbookMatchReport(report: RoadbookMatchReport): void {
  const flattenedPoints = report.days.flatMap((day) => day.points)
  const ids = new Set(flattenedPoints.map(({ id }) => id))
  const statusTotal =
    report.summary.matchedPointCount +
    report.summary.needsReviewPointCount +
    report.summary.unmatchedPointCount
  const resolutionTotal =
    report.summary.activePointCount +
    report.summary.informationalPointCount +
    report.summary.excludedPointCount +
    report.summary.userDecisionRequiredPointCount

  if (
    report.tripId !== 'rga-2026' ||
    report.days.length !== 12 ||
    report.summary.dayCount !== 12 ||
    report.summary.rideDayCount !== 10 ||
    report.summary.offDayCount !== 2 ||
    report.allPointMatches.length !== flattenedPoints.length ||
    report.summary.pointCount !== flattenedPoints.length ||
    ids.size !== flattenedPoints.length ||
    statusTotal !== flattenedPoints.length ||
    resolutionTotal !== flattenedPoints.length
  ) {
    fail('totaux, ordre ou identifiants incohérents.')
  }

  for (const point of flattenedPoints) {
    if (point.resolution === 'matched' && point.status !== 'matched') {
      fail(`résolution matched incohérente avec le statut : ${point.id}.`)
    }
  }

  report.days.forEach((day, index) => {
    if (day.dayNumber !== index + 1 || day.dayId !== `J${index + 1}`) {
      fail(`ordre incorrect pour ${day.dayId}.`)
    }

    if (
      day.type === 'off' &&
      (day.points.length !== 0 || day.theoreticalPauses.length !== 0)
    ) {
      fail(`${day.dayId} OFF contient des données cyclistes.`)
    }
  })

  for (const point of flattenedPoints) {
    if (
      point.status === 'matched' &&
      (point.matchedLatitude === undefined ||
        point.matchedLongitude === undefined ||
        point.matchedTrackDistanceKm === undefined ||
        point.matchedElevationM === undefined ||
        point.eta === undefined)
    ) {
      fail(`point matched incomplet : ${point.id}.`)
    }

    if (
      point.matchMethod === 'profile-altitude-order-candidate' &&
      point.status !== 'needs-review'
    ) {
      fail(`un candidat de profil ne peut pas être matched : ${point.id}.`)
    }
  }

  for (const day of report.days) {
    if (day.type !== 'ride' || day.status !== 'ready') {
      continue
    }
    const start = day.points.find(({ type }) => type === 'start')
    const end = day.points.find(({ type }) => type === 'end')
    if (
      start?.status !== 'matched' ||
      start.matchMethod !== 'endpoint' ||
      !start.linkedWaypointId?.startsWith('route-start-') ||
      end?.status !== 'matched' ||
      end.matchMethod !== 'endpoint' ||
      !end.linkedWaypointId?.startsWith('route-end-')
    ) {
      fail(`bornes roadbook invalides pour ${day.dayId}.`)
    }
  }
}

export function buildRoadbookMatchReport(
  document: RoadbookDocument,
  overrides: RoadbookOverridesDocument,
  plan: TripPlan,
  gpxResults: readonly GpxAnalysisResult[],
  timeline: TripTimeline,
  config: RoadbookMatchConfig = roadbookMatchConfig,
): RoadbookMatchReport {
  // Suppressed points (see roadbook-suppressions.ts) are filtered out of the
  // overrides too, before any validation or matching runs — otherwise the
  // known-point cross-check below would flag them as "override without a
  // matching roadbook point" once their source point disappears from
  // `createSourcePoints`, surfacing a user-confirmed removal as an error.
  const operationalOverrides: RoadbookOverridesDocument = {
    ...overrides,
    overrides: overrides.overrides.filter(
      (override) => !suppressedDocumentedPointIds.has(override.pointId),
    ),
  }

  const initialValidation = validateRoadbookMatchInputs(
    document,
    operationalOverrides,
    plan,
    gpxResults,
    timeline,
  )
  const fatalIssues = initialValidation.issues.filter(
    ({ path }) => !path.startsWith('overrides.'),
  )
  if (fatalIssues.length > 0) {
    fail(fatalIssues.map(({ message }) => message).join(' '))
  }

  const issues = [...initialValidation.issues]

  for (const skipped of operationalOverrides.skippedOverrides) {
    const label = skipped.pointId ?? 'inconnu'
    for (const issue of skipped.issues) {
      issues.push({
        path: `overrides.${label}`,
        dayId: issue.dayId,
        message: `Override ignoré localement (projection à confirmer) : ${issue.message}`,
      })
    }
  }

  const overridesByPointId = createOverridesMap(operationalOverrides, issues)
  const inspectionCounters = { textualAttempts: 0, textualMatches: 0 }
  const links: RoadbookWaypointLink[] = []
  const standaloneWaypoints: RoadbookStandaloneWaypoint[] = []
  const knownPointIds = new Set(
    document.days.flatMap((day) =>
      day.type === 'ride'
        ? createSourcePoints(day).map(({ point }) => point.id)
        : [],
    ),
  )
  const resultByNumber = new Map(
    gpxResults.map((result) => [result.source.fileNumber, result] as const),
  )
  const timelineByDayId = new Map(
    timeline.days.map((day) => [day.day.id, day] as const),
  )
  const planByDayId = new Map(plan.days.map((day) => [day.id, day] as const))
  const days: RoadbookDayMatchReport[] = document.days.map((roadbookDay: RoadbookDay) => {
    if (roadbookDay.type === 'off') {
      const report: RoadbookOffDayMatchReport = {
        dayId: roadbookDay.id,
        dayNumber: roadbookDay.dayNumber,
        type: 'off',
        status: 'ready',
        roadbook: roadbookDay,
        points: [],
        theoreticalPauses: [],
        lodgings: roadbookDay.lodgings,
      }
      return report
    }

    const planDay = planByDayId.get(roadbookDay.id)
    const gpxResult =
      planDay?.type === 'ride' ? resultByNumber.get(planDay.gpxNumber) : undefined
    const gpx = gpxResult?.status === 'success' ? gpxResult : null
    const timelineDay = timelineByDayId.get(roadbookDay.id)

    if (planDay?.type !== 'ride') {
      return createUnavailableRideDayReport(roadbookDay, gpx, 'Jour absent du TripPlan.')
    }

    if (gpxResult === undefined || gpxResult.status === 'error') {
      return createUnavailableRideDayReport(
        roadbookDay,
        null,
        gpxResult?.status === 'error' ? gpxResult.message : 'GPX absent.',
      )
    }

    if (
      timelineDay === undefined ||
      timelineDay.type !== 'ride' ||
      timelineDay.status === 'unavailable'
    ) {
      return createUnavailableRideDayReport(
        roadbookDay,
        gpxResult,
        timelineDay?.type === 'ride' && timelineDay.status === 'unavailable'
          ? timelineDay.message
          : 'Chronologie indisponible.',
      )
    }

    try {
      const context: DayContext = {
        planDay,
        roadbookDay,
        gpx: gpxResult,
        route: timelineDay.route,
        vertices: buildTrackVertices(gpxResult),
      }
      const dayPoints = matchDayPoints(
        context,
        overridesByPointId,
        issues,
        inspectionCounters,
        config,
      )
      const linked = linkMatchedPoints(
        roadbookDay.id,
        dayPoints,
        timelineDay.route,
        config,
      )
      links.push(...linked.links)
      standaloneWaypoints.push(...linked.standaloneWaypoints)
      return {
        dayId: roadbookDay.id,
        dayNumber: roadbookDay.dayNumber,
        type: 'ride',
        status: 'ready',
        roadbook: roadbookDay,
        points: linked.points.map(applyPointResolution),
        theoreticalPauses: createTheoreticalPauses(timelineDay.route),
        lodgings: roadbookDay.lodgings,
        stats: createDayStats(roadbookDay, gpxResult),
      }
    } catch (error) {
      issues.push({
        path: `days.${roadbookDay.id}`,
        dayId: roadbookDay.id,
        message: getErrorMessage(error),
      })
      return createUnavailableRideDayReport(
        roadbookDay,
        gpxResult,
        getErrorMessage(error),
      )
    }
  })

  for (const override of operationalOverrides.overrides) {
    if (!knownPointIds.has(override.pointId)) {
      issues.push({
        path: `overrides.${override.pointId}`,
        message: 'Override sans point roadbook correspondant.',
      })
    }
  }

  const allPointMatches = days.flatMap((day) => day.points)
  const stats = createStatsReport(
    days.flatMap((day) => (day.type === 'ride' ? [day.stats] : [])),
  )
  const report: RoadbookMatchReport = {
    tripId: 'rga-2026',
    days,
    allPointMatches,
    summary: buildSummary(days, allPointMatches, links, standaloneWaypoints),
    stats,
    waypointLinks: links,
    standaloneWaypoints,
    internalGpxInspection: createInternalInspection(
      gpxResults,
      inspectionCounters.textualAttempts,
      inspectionCounters.textualMatches,
    ),
    validation: { isValid: issues.length === 0, issues },
  }

  assertRoadbookMatchReport(report)
  return report
}
