import { calculateHaversineDistanceKm } from '../gpx/parser.ts'
import type { GpxAnalysisSuccess, GpxTrackPoint } from '../gpx/types.ts'
import { routeEngineConfig } from './config.ts'
import type { RouteEngineConfig } from './config.ts'
import { buildTerrainProfileSeries, createNormalizedTerrainTiming, interpolateTerrainTiming } from './terrain-profile.ts'
import type { NormalizedTerrainTiming } from './terrain-profile.ts'
import type {
  RouteEngineSettings,
  RoutePause,
  RouteProfile,
  RouteProfilePauseAnchor,
  RouteProfilePosition,
  RouteProfileSegment,
  RouteProfileWaypointSeed,
  RouteProgress,
  RouteSegment,
  RouteTimeline,
  RouteWaypoint,
  RouteWaypointType,
} from './types.ts'

const comparisonEpsilon = 1e-9

interface PreparedPoint {
  readonly point: GpxTrackPoint
  readonly edgeDistanceKm: number
  readonly edgeElevationGainM: number
  readonly edgeElevationLossM: number
  readonly segmentDistanceKm: number
  readonly localSlopePercent: number
  readonly speedMultiplier: number
}

interface RawRoutePoint extends RouteProfilePosition {
  readonly sequence: number
}

interface RawProfileSegment {
  readonly profile: RouteProfileSegment
  readonly points: readonly RawRoutePoint[]
}

interface FeatureCandidate {
  readonly type: 'summit' | 'valley' | 'slope-change'
  readonly position: RawRoutePoint
  readonly score: number
}

interface ScheduledPause {
  readonly anchor: RouteProfilePauseAnchor
  readonly durationMinutes: number
  readonly precedingPauseMinutes: number
}

function validateConfig(config: RouteEngineConfig): void {
  const positiveValues = [
    config.slopeWindowKm,
    config.slopeClampPercent,
    config.timeMarkerReferenceSpeedKph,
    config.timeMarkerIntervalMinutes,
    config.featureSampleDistanceKm,
    config.featureLookaroundKm,
    config.featureProminenceM,
    config.featureMinimumSpacingKm,
    config.slopeChangeMinimumDeltaPercent,
    config.slopeChangeMinimumBandJump,
    config.slopeChangeMinimumSpacingKm,
    config.continuityToleranceKm,
  ]

  if (
    positiveValues.some((value) => !Number.isFinite(value) || value <= 0) ||
    !Number.isFinite(config.timeMarkerDedupeMinutes) ||
    config.timeMarkerDedupeMinutes < 0
  ) {
    throw new Error('Configuration numérique du moteur invalide.')
  }

  if (config.slopeSpeedBands.length === 0) {
    throw new Error('Aucune bande de vitesse par pente n’est configurée.')
  }

  config.slopeSpeedBands.forEach((band, index) => {
    const previousBand = config.slopeSpeedBands[index - 1]
    const isLastBand = index === config.slopeSpeedBands.length - 1

    if (
      !Number.isFinite(band.speedMultiplier) ||
      band.speedMultiplier <= 0 ||
      (!isLastBand && !Number.isFinite(band.maximumSlopePercent)) ||
      (isLastBand && band.maximumSlopePercent !== Number.POSITIVE_INFINITY) ||
      (previousBand !== undefined &&
        band.maximumSlopePercent <= previousBand.maximumSlopePercent)
    ) {
      throw new Error('Bandes de vitesse par pente invalides ou non triées.')
    }
  })

  const pauseIds = new Set<string>()

  for (const rule of config.pauseRules) {
    if (
      rule.id.length === 0 ||
      pauseIds.has(rule.id) ||
      !Number.isFinite(rule.routeFraction) ||
      rule.routeFraction <= 0 ||
      rule.routeFraction >= 1 ||
      !Number.isFinite(rule.durationShare) ||
      rule.durationShare <= 0
    ) {
      throw new Error('Configuration des pauses invalide.')
    }

    pauseIds.add(rule.id)
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function findFirstIndexAtOrAfter(distances: readonly number[], target: number): number {
  let lower = 0
  let upper = distances.length

  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2)

    if ((distances[middle] ?? Number.POSITIVE_INFINITY) < target) {
      lower = middle + 1
    } else {
      upper = middle
    }
  }

  return Math.min(lower, distances.length - 1)
}

function findElevationIndex(
  points: readonly GpxTrackPoint[],
  startIndex: number,
  direction: -1 | 1,
): number | null {
  for (
    let index = startIndex;
    index >= 0 && index < points.length;
    index += direction
  ) {
    if (points[index]?.elevationM !== null) {
      return index
    }
  }

  return null
}

function calculateLocalSlopes(
  points: readonly GpxTrackPoint[],
  distances: readonly number[],
  config: RouteEngineConfig,
): readonly number[] {
  const halfWindowKm = config.slopeWindowKm / 2

  return points.map((_point, index) => {
    const currentDistanceKm = distances[index] ?? 0
    const leftTargetKm = Math.max(0, currentDistanceKm - halfWindowKm)
    const rightTargetKm = Math.min(
      distances[distances.length - 1] ?? 0,
      currentDistanceKm + halfWindowKm,
    )
    const leftCandidateIndex = findFirstIndexAtOrAfter(distances, leftTargetKm)
    const rightCandidateIndex = findFirstIndexAtOrAfter(distances, rightTargetKm)
    const leftIndex = findElevationIndex(points, leftCandidateIndex, 1)
    const rightIndex = findElevationIndex(points, rightCandidateIndex, -1)

    if (leftIndex === null || rightIndex === null || rightIndex <= leftIndex) {
      return 0
    }

    const distanceDeltaKm = (distances[rightIndex] ?? 0) - (distances[leftIndex] ?? 0)
    const leftElevationM = points[leftIndex]?.elevationM
    const rightElevationM = points[rightIndex]?.elevationM

    if (
      distanceDeltaKm < Math.min(0.05, config.slopeWindowKm / 4) ||
      leftElevationM === null ||
      leftElevationM === undefined ||
      rightElevationM === null ||
      rightElevationM === undefined
    ) {
      return 0
    }

    const slopePercent = ((rightElevationM - leftElevationM) / (distanceDeltaKm * 1000)) * 100
    return clamp(slopePercent, -config.slopeClampPercent, config.slopeClampPercent)
  })
}

export function getSlopeSpeedMultiplier(
  slopePercent: number,
  config: RouteEngineConfig = routeEngineConfig,
): number {
  const band = config.slopeSpeedBands.find(
    ({ maximumSlopePercent }) => slopePercent <= maximumSlopePercent,
  )

  if (band === undefined || !Number.isFinite(band.speedMultiplier) || band.speedMultiplier <= 0) {
    throw new Error('Configuration des coefficients de pente invalide.')
  }

  return band.speedMultiplier
}

function prepareTrackSegment(
  points: readonly GpxTrackPoint[],
  config: RouteEngineConfig,
): readonly PreparedPoint[] {
  const distances: number[] = []
  const edgeDistances: number[] = []
  const edgeElevationGains: number[] = []
  const edgeElevationLosses: number[] = []
  let cumulativeDistanceKm = 0
  let previousPoint: GpxTrackPoint | null = null
  let previousElevationM: number | null = null

  for (const point of points) {
    const edgeDistanceKm =
      previousPoint === null ? 0 : calculateHaversineDistanceKm(previousPoint, point)
    let edgeElevationGainM = 0
    let edgeElevationLossM = 0

    cumulativeDistanceKm += edgeDistanceKm

    if (point.elevationM !== null) {
      if (previousElevationM !== null) {
        const elevationDeltaM = point.elevationM - previousElevationM

        if (elevationDeltaM > 0) {
          edgeElevationGainM = elevationDeltaM
        } else {
          edgeElevationLossM = Math.abs(elevationDeltaM)
        }
      }

      previousElevationM = point.elevationM
    }

    distances.push(cumulativeDistanceKm)
    edgeDistances.push(edgeDistanceKm)
    edgeElevationGains.push(edgeElevationGainM)
    edgeElevationLosses.push(edgeElevationLossM)
    previousPoint = point
  }

  const localSlopes = calculateLocalSlopes(points, distances, config)

  return points.map((point, index) => {
    const localSlopePercent = localSlopes[index] ?? 0
    const previousSlopePercent = localSlopes[Math.max(0, index - 1)] ?? localSlopePercent
    const edgeSlopePercent = (previousSlopePercent + localSlopePercent) / 2

    return {
      point,
      edgeDistanceKm: edgeDistances[index] ?? 0,
      edgeElevationGainM: edgeElevationGains[index] ?? 0,
      edgeElevationLossM: edgeElevationLosses[index] ?? 0,
      segmentDistanceKm: distances[index] ?? 0,
      localSlopePercent,
      speedMultiplier: getSlopeSpeedMultiplier(edgeSlopePercent, config),
    }
  })
}

function clonePosition(position: RouteProfilePosition): RouteProfilePosition {
  return {
    latitude: position.latitude,
    longitude: position.longitude,
    sourceFileNumber: position.sourceFileNumber,
    sourceFileName: position.sourceFileName,
    distanceKm: position.distanceKm,
    elevationGainM: position.elevationGainM,
    elevationLossM: position.elevationLossM,
    altitudeM: position.altitudeM,
    localSlopePercent: position.localSlopePercent,
    speedMultiplier: position.speedMultiplier,
    weightedDistanceKm: position.weightedDistanceKm,
  }
}

function findNearestPosition(
  points: readonly RawRoutePoint[],
  target: number,
  property: 'distanceKm' | 'weightedDistanceKm',
): RawRoutePoint {
  if (points.length === 0) {
    throw new Error('Aucun point disponible pour positionner un repère.')
  }

  let lower = 0
  let upper = points.length

  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2)
    const value = points[middle]?.[property] ?? Number.POSITIVE_INFINITY

    if (value < target) {
      lower = middle + 1
    } else {
      upper = middle
    }
  }

  const after = points[Math.min(lower, points.length - 1)]
  const before = points[Math.max(0, lower - 1)]

  if (after === undefined || before === undefined) {
    throw new Error('Position de repère GPX introuvable.')
  }

  return Math.abs(after[property] - target) < Math.abs(before[property] - target)
    ? after
    : before
}

function interpolateWeightedPosition(
  points: readonly RawRoutePoint[],
  targetWeightedDistanceKm: number,
): RouteProfilePosition {
  if (points.length === 0) {
    throw new Error('Aucun point disponible pour interpoler un repère.')
  }

  let lower = 0
  let upper = points.length

  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2)
    const value = points[middle]?.weightedDistanceKm ?? Number.POSITIVE_INFINITY

    if (value < targetWeightedDistanceKm) {
      lower = middle + 1
    } else {
      upper = middle
    }
  }

  const after = points[Math.min(lower, points.length - 1)]
  const before = points[Math.max(0, lower - 1)]

  if (after === undefined || before === undefined) {
    throw new Error('Bornes d’interpolation du repère introuvables.')
  }

  const weightedDeltaKm = after.weightedDistanceKm - before.weightedDistanceKm

  if (weightedDeltaKm <= comparisonEpsilon) {
    return clonePosition(after)
  }

  const ratio = clamp(
    (targetWeightedDistanceKm - before.weightedDistanceKm) / weightedDeltaKm,
    0,
    1,
  )
  const source = ratio < 0.5 ? before : after
  const interpolate = (from: number, to: number): number => from + (to - from) * ratio
  const altitudeM =
    before.altitudeM !== null && after.altitudeM !== null
      ? interpolate(before.altitudeM, after.altitudeM)
      : (before.altitudeM ?? after.altitudeM)

  return {
    latitude: interpolate(before.latitude, after.latitude),
    longitude: interpolate(before.longitude, after.longitude),
    sourceFileNumber: source.sourceFileNumber,
    sourceFileName: source.sourceFileName,
    distanceKm: interpolate(before.distanceKm, after.distanceKm),
    elevationGainM: interpolate(before.elevationGainM, after.elevationGainM),
    elevationLossM: interpolate(before.elevationLossM, after.elevationLossM),
    altitudeM,
    localSlopePercent: interpolate(
      before.localSlopePercent,
      after.localSlopePercent,
    ),
    speedMultiplier: interpolate(before.speedMultiplier, after.speedMultiplier),
    weightedDistanceKm: targetWeightedDistanceKm,
  }
}

function sampleByDistance(
  points: readonly RawRoutePoint[],
  intervalKm: number,
): readonly RawRoutePoint[] {
  const firstPoint = points[0]
  const lastPoint = points[points.length - 1]

  if (firstPoint === undefined || lastPoint === undefined) {
    return []
  }

  const sampledPoints: RawRoutePoint[] = [firstPoint]

  for (
    let targetKm = firstPoint.distanceKm + intervalKm;
    targetKm < lastPoint.distanceKm - comparisonEpsilon;
    targetKm += intervalKm
  ) {
    const point = findNearestPosition(points, targetKm, 'distanceKm')

    if (sampledPoints[sampledPoints.length - 1]?.sequence !== point.sequence) {
      sampledPoints.push(point)
    }
  }

  if (sampledPoints[sampledPoints.length - 1]?.sequence !== lastPoint.sequence) {
    sampledPoints.push(lastPoint)
  }

  return sampledPoints
}

function selectSpacedCandidates(
  candidates: readonly FeatureCandidate[],
  minimumSpacingKm: number,
): readonly FeatureCandidate[] {
  const selected = [...candidates]
    .sort((left, right) => right.score - left.score)
    .reduce<FeatureCandidate[]>((kept, candidate) => {
      const isSeparated = kept.every(
        (existing) =>
          Math.abs(existing.position.distanceKm - candidate.position.distanceKm) >=
          minimumSpacingKm,
      )

      if (isSeparated) {
        kept.push(candidate)
      }

      return kept
    }, [])

  return selected.sort(
    (left, right) => left.position.distanceKm - right.position.distanceKm,
  )
}

function detectExtrema(
  sampledPoints: readonly RawRoutePoint[],
  config: RouteEngineConfig,
): readonly FeatureCandidate[] {
  const lookaroundCount = Math.max(
    1,
    Math.round(config.featureLookaroundKm / config.featureSampleDistanceKm),
  )
  const candidates: FeatureCandidate[] = []

  for (let index = lookaroundCount; index < sampledPoints.length - lookaroundCount; index++) {
    const point = sampledPoints[index]

    if (point?.altitudeM === null || point === undefined) {
      continue
    }

    const leftAltitudes = sampledPoints
      .slice(index - lookaroundCount, index)
      .map(({ altitudeM }) => altitudeM)
      .filter((altitude): altitude is number => altitude !== null)
    const rightAltitudes = sampledPoints
      .slice(index + 1, index + lookaroundCount + 1)
      .map(({ altitudeM }) => altitudeM)
      .filter((altitude): altitude is number => altitude !== null)

    if (leftAltitudes.length === 0 || rightAltitudes.length === 0) {
      continue
    }

    const leftMinimum = Math.min(...leftAltitudes)
    const rightMinimum = Math.min(...rightAltitudes)
    const leftMaximum = Math.max(...leftAltitudes)
    const rightMaximum = Math.max(...rightAltitudes)
    const summitProminenceM = Math.min(
      point.altitudeM - leftMinimum,
      point.altitudeM - rightMinimum,
    )
    const valleyProminenceM = Math.min(
      leftMaximum - point.altitudeM,
      rightMaximum - point.altitudeM,
    )
    const isLocalMaximum =
      leftAltitudes.every((altitude) => point.altitudeM !== null && point.altitudeM >= altitude) &&
      rightAltitudes.every((altitude) => point.altitudeM !== null && point.altitudeM >= altitude)
    const isLocalMinimum =
      leftAltitudes.every((altitude) => point.altitudeM !== null && point.altitudeM <= altitude) &&
      rightAltitudes.every((altitude) => point.altitudeM !== null && point.altitudeM <= altitude)

    if (isLocalMaximum && summitProminenceM >= config.featureProminenceM) {
      candidates.push({ type: 'summit', position: point, score: summitProminenceM })
    } else if (isLocalMinimum && valleyProminenceM >= config.featureProminenceM) {
      candidates.push({ type: 'valley', position: point, score: valleyProminenceM })
    }
  }

  return selectSpacedCandidates(candidates, config.featureMinimumSpacingKm)
}

function getSlopeBandIndex(slopePercent: number, config: RouteEngineConfig): number {
  const index = config.slopeSpeedBands.findIndex(
    ({ maximumSlopePercent }) => slopePercent <= maximumSlopePercent,
  )
  return index < 0 ? config.slopeSpeedBands.length - 1 : index
}

function detectSlopeChanges(
  sampledPoints: readonly RawRoutePoint[],
  config: RouteEngineConfig,
): readonly FeatureCandidate[] {
  const candidates: FeatureCandidate[] = []

  for (let index = 1; index < sampledPoints.length; index++) {
    const previousPoint = sampledPoints[index - 1]
    const point = sampledPoints[index]

    if (previousPoint === undefined || point === undefined) {
      continue
    }

    const slopeDelta = Math.abs(point.localSlopePercent - previousPoint.localSlopePercent)
    const bandJump = Math.abs(
      getSlopeBandIndex(point.localSlopePercent, config) -
        getSlopeBandIndex(previousPoint.localSlopePercent, config),
    )

    if (
      slopeDelta >= config.slopeChangeMinimumDeltaPercent &&
      bandJump >= config.slopeChangeMinimumBandJump
    ) {
      candidates.push({
        type: 'slope-change',
        position: point,
        score: slopeDelta + bandJump,
      })
    }
  }

  return selectSpacedCandidates(candidates, config.slopeChangeMinimumSpacingKm)
}

function createFeatureName(type: FeatureCandidate['type'], index: number): string {
  switch (type) {
    case 'summit':
      return `Sommet local ${index}`
    case 'valley':
      return `Vallée locale ${index}`
    case 'slope-change':
      return `Changement de pente ${index}`
  }
}

function createFeatureSeeds(
  rawSegments: readonly RawProfileSegment[],
  config: RouteEngineConfig,
): readonly RouteProfileWaypointSeed[] {
  const seeds: RouteProfileWaypointSeed[] = []
  let featureIndex = 0

  rawSegments.forEach(({ profile, points }, segmentIndex) => {
    const firstPoint = points[0]
    const lastPoint = points[points.length - 1]

    if (firstPoint === undefined || lastPoint === undefined) {
      return
    }

    const isFirstSegment = segmentIndex === 0
    const isLastSegment = segmentIndex === rawSegments.length - 1
    seeds.push({
      id: isFirstSegment
        ? `route-start-${profile.sourceFileNumber}`
        : `gpx-start-${profile.sourceFileNumber}`,
      type: isFirstSegment ? 'route-start' : 'gpx-start',
      name: profile.startName,
      position: clonePosition(firstPoint),
    })

    const sampledPoints = sampleByDistance(points, config.featureSampleDistanceKm)
    const features = [
      ...detectExtrema(sampledPoints, config),
      ...detectSlopeChanges(sampledPoints, config),
    ].sort((left, right) => left.position.distanceKm - right.position.distanceKm)

    for (const feature of features) {
      const distanceFromStartKm = feature.position.distanceKm - firstPoint.distanceKm
      const distanceFromEndKm = lastPoint.distanceKm - feature.position.distanceKm

      if (
        distanceFromStartKm < config.featureMinimumSpacingKm ||
        distanceFromEndKm < config.featureMinimumSpacingKm
      ) {
        continue
      }

      featureIndex++
      seeds.push({
        id: `${feature.type}-${profile.sourceFileNumber}-${featureIndex}`,
        type: feature.type,
        name: createFeatureName(feature.type, featureIndex),
        position: clonePosition(feature.position),
      })
    }

    seeds.push({
      id: isLastSegment
        ? `route-end-${profile.sourceFileNumber}`
        : `gpx-end-${profile.sourceFileNumber}`,
      type: isLastSegment ? 'route-end' : 'gpx-end',
      name: profile.endName,
      position: clonePosition(lastPoint),
    })
  })

  return seeds
}

function addTimeMarkerSeeds(
  seeds: readonly RouteProfileWaypointSeed[],
  allPoints: readonly RawRoutePoint[],
  totalWeightedDistanceKm: number,
  config: RouteEngineConfig,
): readonly RouteProfileWaypointSeed[] {
  const markers: RouteProfileWaypointSeed[] = []
  const referenceSpeedKph = config.timeMarkerReferenceSpeedKph
  const totalReferenceMinutes = (totalWeightedDistanceKm / referenceSpeedKph) * 60

  for (
    let targetMinutes = config.timeMarkerIntervalMinutes;
    targetMinutes < totalReferenceMinutes;
    targetMinutes += config.timeMarkerIntervalMinutes
  ) {
    const targetWeightedDistanceKm = (targetMinutes / 60) * referenceSpeedKph
    const point = interpolateWeightedPosition(
      allPoints,
      targetWeightedDistanceKm,
    )
    const isNearFeature = seeds.some((seed) => {
      const featureMinutes = (seed.position.weightedDistanceKm / referenceSpeedKph) * 60
      return (
        Math.abs(seed.position.weightedDistanceKm - point.weightedDistanceKm) <=
          comparisonEpsilon ||
        (config.timeMarkerDedupeMinutes > 0 &&
          Math.abs(featureMinutes - targetMinutes) <= config.timeMarkerDedupeMinutes)
      )
    })

    if (isNearFeature) {
      continue
    }

    markers.push({
      id: `time-marker-${markers.length + 1}`,
      type: 'time-marker',
      name: `Repère de progression ${markers.length + 1}`,
      position: clonePosition(point),
    })
  }

  return [...seeds, ...markers].sort(
    (left, right) =>
      left.position.weightedDistanceKm - right.position.weightedDistanceKm ||
      left.position.distanceKm - right.position.distanceKm ||
      left.id.localeCompare(right.id),
  )
}

function createPauseAnchors(
  allPoints: readonly RawRoutePoint[],
  totalWeightedDistanceKm: number,
  config: RouteEngineConfig,
): readonly RouteProfilePauseAnchor[] {
  return config.pauseRules.map((rule) => ({
    id: rule.id,
    name: rule.name,
    durationShare: rule.durationShare,
    position: interpolateWeightedPosition(
      allPoints,
      totalWeightedDistanceKm * rule.routeFraction,
    ),
  }))
}

function getMinimum(values: readonly (number | null)[]): number | null {
  const availableValues = values.filter((value): value is number => value !== null)
  return availableValues.length === 0 ? null : Math.min(...availableValues)
}

function getMaximum(values: readonly (number | null)[]): number | null {
  const availableValues = values.filter((value): value is number => value !== null)
  return availableValues.length === 0 ? null : Math.max(...availableValues)
}

export function buildRouteProfile(
  analyses: readonly GpxAnalysisSuccess[],
  config: RouteEngineConfig = routeEngineConfig,
): RouteProfile {
  validateConfig(config)

  if (analyses.length === 0) {
    throw new Error('Aucune trace GPX analysée ne permet de construire le moteur.')
  }

  const sortedAnalyses = [...analyses].sort(
    (left, right) =>
      left.summary.fileNumber - right.summary.fileNumber ||
      left.summary.fileName.localeCompare(right.summary.fileName, 'fr-FR', { numeric: true }),
  )
  const uniqueFileNumbers = new Set(sortedAnalyses.map(({ summary }) => summary.fileNumber))
  const hasSequentialSources = sortedAnalyses.every(
    (analysis, index) =>
      index === 0 ||
      analysis.summary.fileNumber ===
        (sortedAnalyses[index - 1]?.summary.fileNumber ?? 0) + 1,
  )

  if (uniqueFileNumbers.size !== sortedAnalyses.length) {
    throw new Error('Plusieurs traces GPX portent le même numéro.')
  }

  const allPoints: RawRoutePoint[] = []
  const rawSegments: RawProfileSegment[] = []
  let cumulativeDistanceKm = 0
  let cumulativeElevationGainM = 0
  let cumulativeElevationLossM = 0
  let cumulativeWeightedDistanceKm = 0
  let sequence = 0
  let previousTrackSegmentLastPoint: GpxTrackPoint | null = null
  let maximumBoundaryGapKm = 0
  let sourceTrackSegmentCount = 0
  let sourcePointCount = 0

  for (const analysis of sortedAnalyses) {
    const gpxPoints: RawRoutePoint[] = []
    const gpxStartDistanceKm = cumulativeDistanceKm
    const gpxStartElevationGainM = cumulativeElevationGainM
    const gpxStartElevationLossM = cumulativeElevationLossM
    const populatedSegments = analysis.segments.filter((segment) => segment.points.length > 0)

    for (const segment of populatedSegments) {
      const preparedPoints = prepareTrackSegment(segment.points, config)
      const firstPreparedPoint = preparedPoints[0]

      if (firstPreparedPoint !== undefined && previousTrackSegmentLastPoint !== null) {
        maximumBoundaryGapKm = Math.max(
          maximumBoundaryGapKm,
          calculateHaversineDistanceKm(previousTrackSegmentLastPoint, firstPreparedPoint.point),
        )
      }

      for (const preparedPoint of preparedPoints) {
        cumulativeDistanceKm += preparedPoint.edgeDistanceKm
        cumulativeElevationGainM += preparedPoint.edgeElevationGainM
        cumulativeElevationLossM += preparedPoint.edgeElevationLossM
        cumulativeWeightedDistanceKm +=
          preparedPoint.speedMultiplier > 0
            ? preparedPoint.edgeDistanceKm / preparedPoint.speedMultiplier
            : 0
        sequence++

        const rawPoint: RawRoutePoint = {
          sequence,
          latitude: preparedPoint.point.latitude,
          longitude: preparedPoint.point.longitude,
          sourceFileNumber: analysis.summary.fileNumber,
          sourceFileName: analysis.summary.fileName,
          distanceKm: cumulativeDistanceKm,
          elevationGainM: cumulativeElevationGainM,
          elevationLossM: cumulativeElevationLossM,
          altitudeM: preparedPoint.point.elevationM,
          localSlopePercent: preparedPoint.localSlopePercent,
          speedMultiplier: getSlopeSpeedMultiplier(preparedPoint.localSlopePercent, config),
          weightedDistanceKm: cumulativeWeightedDistanceKm,
        }
        gpxPoints.push(rawPoint)
        allPoints.push(rawPoint)
      }

      previousTrackSegmentLastPoint = segment.points[segment.points.length - 1] ?? null
      sourceTrackSegmentCount++
      sourcePointCount += segment.points.length
    }

    const firstPoint = gpxPoints[0]
    const lastPoint = gpxPoints[gpxPoints.length - 1]

    if (firstPoint === undefined || lastPoint === undefined) {
      throw new Error(`La trace ${analysis.summary.fileName} ne contient aucun point exploitable.`)
    }

    const profile: RouteProfileSegment = {
      sourceFileNumber: analysis.summary.fileNumber,
      sourceFileName: analysis.summary.fileName,
      name: analysis.summary.trackName ?? `${analysis.summary.startName} → ${analysis.summary.endName}`,
      startName: analysis.summary.startName,
      endName: analysis.summary.endName,
      pointCount: gpxPoints.length,
      trackSegmentCount: populatedSegments.length,
      distanceKm: cumulativeDistanceKm - gpxStartDistanceKm,
      elevationGainM: cumulativeElevationGainM - gpxStartElevationGainM,
      elevationLossM: cumulativeElevationLossM - gpxStartElevationLossM,
      minAltitudeM: analysis.summary.minElevationM,
      maxAltitudeM: analysis.summary.maxElevationM,
      startPosition: clonePosition(firstPoint),
      endPosition: clonePosition(lastPoint),
    }
    rawSegments.push({ profile, points: gpxPoints })
  }

  const firstAnalysis = sortedAnalyses[0]
  const lastAnalysis = sortedAnalyses[sortedAnalyses.length - 1]

  if (firstAnalysis === undefined || lastAnalysis === undefined) {
    throw new Error('Bornes de la chronologie GPX introuvables.')
  }

  if (cumulativeWeightedDistanceKm <= comparisonEpsilon) {
    throw new Error('La distance roulable de la chronologie doit être strictement positive.')
  }

  const featureSeeds = createFeatureSeeds(rawSegments, config)
  const waypointSeeds = addTimeMarkerSeeds(
    featureSeeds,
    allPoints,
    cumulativeWeightedDistanceKm,
    config,
  )
  const pauseAnchors = createPauseAnchors(
    allPoints,
    cumulativeWeightedDistanceKm,
    config,
  )

  return {
    segments: rawSegments.map(({ profile }) => profile),
    waypointSeeds,
    pauseAnchors,
    terrainSeries: buildTerrainProfileSeries(allPoints),
    summary: {
      sourceGpxCount: rawSegments.length,
      sourceTrackSegmentCount,
      sourcePointCount,
      distanceKm: cumulativeDistanceKm,
      elevationGainM: cumulativeElevationGainM,
      elevationLossM: cumulativeElevationLossM,
      minAltitudeM: getMinimum(rawSegments.map(({ profile }) => profile.minAltitudeM)),
      maxAltitudeM: getMaximum(rawSegments.map(({ profile }) => profile.maxAltitudeM)),
      weightedDistanceKm: cumulativeWeightedDistanceKm,
      isContinuous:
        hasSequentialSources && maximumBoundaryGapKm <= config.continuityToleranceKm,
      maximumBoundaryGapKm,
      firstSourceFileNumber: firstAnalysis.summary.fileNumber,
      lastSourceFileNumber: lastAnalysis.summary.fileNumber,
    },
  }
}

function parseDepartureTime(value: string): number {
  const match = /^(?<hours>[01]\d|2[0-3]):(?<minutes>[0-5]\d)$/.exec(value)

  if (match?.groups === undefined) {
    throw new Error('Heure de départ invalide.')
  }

  return Number(match.groups.hours) * 60 + Number(match.groups.minutes)
}

function validateSettings(settings: RouteEngineSettings): void {
  if (!Number.isFinite(settings.averageSpeedKph) || settings.averageSpeedKph <= 0) {
    throw new Error('La vitesse moyenne doit être strictement positive.')
  }

  if (
    !Number.isSafeInteger(settings.totalBreakMinutes) ||
    settings.totalBreakMinutes < 0
  ) {
    throw new Error('La durée totale des pauses est invalide.')
  }

  parseDepartureTime(settings.departureTime)
}

function allocatePauseDurations(
  totalMinutes: number,
  anchors: readonly RouteProfilePauseAnchor[],
): readonly number[] {
  if (anchors.length === 0) {
    return []
  }

  const totalShare = anchors.reduce((total, anchor) => total + anchor.durationShare, 0)

  if (!Number.isFinite(totalShare) || totalShare <= 0) {
    throw new Error('Répartition des pauses invalide.')
  }

  const exactDurations = anchors.map(
    (anchor) => (totalMinutes * anchor.durationShare) / totalShare,
  )
  const durations = exactDurations.map(Math.floor)
  let remainingMinutes = totalMinutes - durations.reduce((total, duration) => total + duration, 0)
  const indexesByRemainder = exactDurations
    .map((duration, index) => ({ index, remainder: duration - Math.floor(duration) }))
    .sort(
      (left, right) =>
        right.remainder - left.remainder || left.index - right.index,
    )

  for (const { index } of indexesByRemainder) {
    if (remainingMinutes <= 0) {
      break
    }

    durations[index] = (durations[index] ?? 0) + 1
    remainingMinutes--
  }

  return durations
}

function createScheduledPauses(
  profile: RouteProfile,
  totalBreakMinutes: number,
): readonly ScheduledPause[] {
  // Anchors must be in increasing-distance order before the cumulative
  // `precedingPauseMinutes` sum is computed below — automatic-mode anchors
  // already come out this way, but custom-mode anchors are user-ordered
  // (`PausePlanItem.order`) and may not match the anchors' actual position on
  // the track. Sorting here, not just the final `RoutePause[]` output, keeps
  // every later pause's ETA offset correct regardless of input order.
  const orderedAnchors = [...profile.pauseAnchors].sort(
    (left, right) => left.position.distanceKm - right.position.distanceKm,
  )
  const durations = allocatePauseDurations(totalBreakMinutes, orderedAnchors)
  let precedingPauseMinutes = 0

  return orderedAnchors
    .map((anchor, index): ScheduledPause => {
      const durationMinutes = durations[index] ?? 0
      const scheduledPause = { anchor, durationMinutes, precedingPauseMinutes }
      precedingPauseMinutes += durationMinutes
      return scheduledPause
    })
    .filter(({ durationMinutes }) => durationMinutes > 0)
}

function getPauseMinutesBefore(
  distanceKm: number,
  scheduledPauses: readonly ScheduledPause[],
): number {
  return scheduledPauses.reduce(
    (total, pause) =>
      pause.anchor.position.distanceKm < distanceKm - comparisonEpsilon
        ? total + pause.durationMinutes
        : total,
    0,
  )
}

function createProgress(
  position: RouteProfilePosition,
  departureTimeMinutes: number,
  scheduledPauses: readonly ScheduledPause[],
  timing: NormalizedTerrainTiming,
): RouteProgress {
  const terrain = interpolateTerrainTiming(timing, position.distanceKm)
  const movingElapsedMinutes = terrain.movingElapsedMinutes
  const elapsedMinutes =
    movingElapsedMinutes +
    getPauseMinutesBefore(position.distanceKm, scheduledPauses)

  return {
    distanceKm: position.distanceKm,
    elevationGainM: position.elevationGainM,
    elevationLossM: position.elevationLossM,
    altitudeM: position.altitudeM,
    localSlopePercent: terrain.smoothedGradePercent,
    estimatedSpeedKph: terrain.localSpeedKph,
    movingElapsedMinutes,
    elapsedMinutes,
    theoreticalTimeMinutes: departureTimeMinutes + elapsedMinutes,
  }
}

function getWaypointTypeOrder(type: RouteWaypointType): number {
  switch (type) {
    case 'route-start':
      return 0
    case 'gpx-end':
      return 1
    case 'gpx-start':
      return 2
    case 'summit':
    case 'valley':
    case 'slope-change':
    case 'time-marker':
      return 3
    case 'pause-start':
      return 4
    case 'pause-end':
      return 5
    case 'route-end':
      return 6
  }
}

function assertTimeline(timeline: RouteTimeline): void {
  const { waypoints, summary } = timeline
  const waypointIds = new Set(waypoints.map(({ id }) => id))

  if (waypointIds.size !== waypoints.length) {
    throw new Error('La chronologie contient des identifiants de waypoint dupliqués.')
  }

  for (let index = 1; index < waypoints.length; index++) {
    const previous = waypoints[index - 1]
    const current = waypoints[index]

    if (
      previous === undefined ||
      current === undefined ||
      current.progress.elapsedMinutes + comparisonEpsilon <
        previous.progress.elapsedMinutes ||
      current.progress.distanceKm + comparisonEpsilon < previous.progress.distanceKm
    ) {
      throw new Error('Les waypoints du moteur ne sont pas ordonnés.')
    }
  }

  for (const waypoint of waypoints) {
    const metrics = [
      waypoint.latitude,
      waypoint.longitude,
      waypoint.progress.distanceKm,
      waypoint.progress.elevationGainM,
      waypoint.progress.elevationLossM,
      waypoint.progress.localSlopePercent,
      waypoint.progress.estimatedSpeedKph,
      waypoint.progress.movingElapsedMinutes,
      waypoint.progress.elapsedMinutes,
      waypoint.progress.theoreticalTimeMinutes,
    ]

    if (metrics.some((value) => !Number.isFinite(value))) {
      throw new Error(`Métrique non finie détectée sur le waypoint ${waypoint.id}.`)
    }
  }

  const pauseDurationMinutes = timeline.pauses.reduce(
    (total, pause) => total + pause.durationMinutes,
    0,
  )

  if (
    pauseDurationMinutes !== timeline.settings.totalBreakMinutes ||
    Math.abs(
      summary.totalDurationMinutes -
        summary.movingDurationMinutes -
        summary.pauseDurationMinutes,
    ) > comparisonEpsilon
  ) {
    throw new Error('Le décalage horaire des pauses est incohérent.')
  }

  if (
    timeline.segments.length !== summary.sourceGpxCount ||
    timeline.segments[0]?.sourceFileNumber !== summary.firstSourceFileNumber ||
    timeline.segments[timeline.segments.length - 1]?.sourceFileNumber !==
      summary.lastSourceFileNumber
  ) {
    throw new Error('La chronologie ne couvre pas toutes les traces GPX.')
  }

  if (waypoints[0]?.type !== 'route-start' || waypoints[waypoints.length - 1]?.type !== 'route-end') {
    throw new Error('Les bornes de départ ou d’arrivée de la chronologie sont invalides.')
  }

  for (let index = 1; index < timeline.segments.length; index++) {
    const previousSegment = timeline.segments[index - 1]
    const segment = timeline.segments[index]

    if (
      previousSegment === undefined ||
      segment === undefined ||
      Math.abs(previousSegment.endDistanceKm - segment.startDistanceKm) > comparisonEpsilon ||
      Math.abs(previousSegment.endElapsedMinutes - segment.startElapsedMinutes) >
        comparisonEpsilon
    ) {
      throw new Error('Les segments GPX ne forment pas une chronologie continue.')
    }
  }
}

export function scheduleRouteTimeline(
  profile: RouteProfile,
  settings: RouteEngineSettings,
): RouteTimeline {
  validateSettings(settings)

  const departureTimeMinutes = parseDepartureTime(settings.departureTime)
  const fallbackSeries = profile.waypointSeeds.map(({ position }) => ({ distanceKm: position.distanceKm, elevationM: position.altitudeM ?? 0, smoothedGradePercent: position.localSlopePercent, latitude: position.latitude, longitude: position.longitude })).sort((a, b) => a.distanceKm - b.distanceKm)
  const timing = createNormalizedTerrainTiming(profile.terrainSeries?.length ? profile.terrainSeries : fallbackSeries, profile.summary.distanceKm, settings.averageSpeedKph)
  const scheduledPauses = createScheduledPauses(profile, settings.totalBreakMinutes)
  const standardWaypoints: RouteWaypoint[] = profile.waypointSeeds.map((seed) => ({
    id: seed.id,
    type: seed.type,
    name: seed.name,
    latitude: seed.position.latitude,
    longitude: seed.position.longitude,
    sourceFileNumber: seed.position.sourceFileNumber,
    sourceFileName: seed.position.sourceFileName,
    progress: createProgress(
      seed.position,
      departureTimeMinutes,
      scheduledPauses,
      timing,
    ),
  }))
  const pauses: RoutePause[] = []
  for (const pause of scheduledPauses) {
    const movingElapsedMinutes = interpolateTerrainTiming(timing, pause.anchor.position.distanceKm).movingElapsedMinutes
    const startElapsedMinutes = movingElapsedMinutes + pause.precedingPauseMinutes
    const endElapsedMinutes = startElapsedMinutes + pause.durationMinutes
    const startWaypointId = `pause-${pause.anchor.id}-start`
    const endWaypointId = `pause-${pause.anchor.id}-end`
    pauses.push({
      id: `pause-${pause.anchor.id}`,
      name: pause.anchor.name,
      durationMinutes: pause.durationMinutes,
      sourceFileNumber: pause.anchor.position.sourceFileNumber,
      sourceFileName: pause.anchor.position.sourceFileName,
      latitude: pause.anchor.position.latitude,
      longitude: pause.anchor.position.longitude,
      distanceKm: pause.anchor.position.distanceKm,
      altitudeM: pause.anchor.position.altitudeM,
      startElapsedMinutes,
      endElapsedMinutes,
      startTimeMinutes: departureTimeMinutes + startElapsedMinutes,
      endTimeMinutes: departureTimeMinutes + endElapsedMinutes,
      startWaypointId,
      endWaypointId,
      ...(pause.anchor.pointId === undefined ? {} : { pointId: pause.anchor.pointId }),
    })
  }

  const waypoints = [...standardWaypoints].sort(
    (left, right) =>
      left.progress.elapsedMinutes - right.progress.elapsedMinutes ||
      left.progress.distanceKm - right.progress.distanceKm ||
      getWaypointTypeOrder(left.type) - getWaypointTypeOrder(right.type) ||
      left.id.localeCompare(right.id),
  )
  const segments: RouteSegment[] = profile.segments.map((segment) => {
    const startProgress = createProgress(
      segment.startPosition,
      departureTimeMinutes,
      scheduledPauses,
      timing,
    )
    const endProgress = createProgress(
      segment.endPosition,
      departureTimeMinutes,
      scheduledPauses,
      timing,
    )

    return {
      sourceFileNumber: segment.sourceFileNumber,
      sourceFileName: segment.sourceFileName,
      name: segment.name,
      startName: segment.startName,
      endName: segment.endName,
      pointCount: segment.pointCount,
      trackSegmentCount: segment.trackSegmentCount,
      distanceKm: segment.distanceKm,
      elevationGainM: segment.elevationGainM,
      elevationLossM: segment.elevationLossM,
      minAltitudeM: segment.minAltitudeM,
      maxAltitudeM: segment.maxAltitudeM,
      startDistanceKm: segment.startPosition.distanceKm,
      endDistanceKm: segment.endPosition.distanceKm,
      startElapsedMinutes: startProgress.elapsedMinutes,
      endElapsedMinutes: endProgress.elapsedMinutes,
      startTimeMinutes: startProgress.theoreticalTimeMinutes,
      endTimeMinutes: endProgress.theoreticalTimeMinutes,
      startProgress,
      endProgress,
      waypointIds: waypoints
        .filter(({ sourceFileNumber }) => sourceFileNumber === segment.sourceFileNumber)
        .map(({ id }) => id),
    }
  })
  const movingDurationMinutes = timing.totalMovingMinutes
  const totalDurationMinutes = movingDurationMinutes + settings.totalBreakMinutes
  const timeline: RouteTimeline = {
    settings: { ...settings },
    segments,
    waypoints,
    pauses,
    terrainTiming: timing.points,
    summary: {
      sourceGpxCount: profile.summary.sourceGpxCount,
      sourceTrackSegmentCount: profile.summary.sourceTrackSegmentCount,
      sourcePointCount: profile.summary.sourcePointCount,
      waypointCount: waypoints.length,
      distanceKm: profile.summary.distanceKm,
      elevationGainM: profile.summary.elevationGainM,
      elevationLossM: profile.summary.elevationLossM,
      minAltitudeM: profile.summary.minAltitudeM,
      maxAltitudeM: profile.summary.maxAltitudeM,
      movingDurationMinutes,
      pauseDurationMinutes: settings.totalBreakMinutes,
      totalDurationMinutes,
      departureTimeMinutes,
      arrivalTimeMinutes: departureTimeMinutes + totalDurationMinutes,
      isContinuous: profile.summary.isContinuous,
      maximumBoundaryGapKm: profile.summary.maximumBoundaryGapKm,
      firstSourceFileNumber: profile.summary.firstSourceFileNumber,
      lastSourceFileNumber: profile.summary.lastSourceFileNumber,
    },
  }

  assertTimeline(timeline)
  return timeline
}

export function createRouteTimeline(
  analyses: readonly GpxAnalysisSuccess[],
  settings: RouteEngineSettings,
  config: RouteEngineConfig = routeEngineConfig,
): RouteTimeline {
  return scheduleRouteTimeline(buildRouteProfile(analyses, config), settings)
}
