import type {
  GpxAnalysisSuccess,
  GpxSegment,
  GpxSource,
  GpxTrackPoint,
} from './types.ts'

const earthRadiusKm = 6371.0088

function getDirectChildren(element: Element, localName: string): readonly Element[] {
  return Array.from(element.children).filter((child) => child.localName === localName)
}

function getDirectChildText(element: Element, localName: string): string | null {
  const child = getDirectChildren(element, localName)[0]
  const text = child?.textContent?.trim()
  return text === undefined || text.length === 0 ? null : text
}

function parseCoordinate(
  pointElement: Element,
  attributeName: 'lat' | 'lon',
  minimum: number,
  maximum: number,
  context: string,
): number {
  const rawValue = pointElement.getAttribute(attributeName)

  if (rawValue === null || rawValue.trim().length === 0) {
    throw new Error(`Coordonnée ${attributeName} absente (${context}).`)
  }

  const value = Number(rawValue)

  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`Coordonnée ${attributeName} invalide (${context}).`)
  }

  return value
}

function parseElevation(pointElement: Element): number | null {
  const rawElevation = getDirectChildText(pointElement, 'ele')

  if (rawElevation === null) {
    return null
  }

  const elevation = Number(rawElevation)
  return Number.isFinite(elevation) ? elevation : null
}

function parseTrackPoint(pointElement: Element, context: string): GpxTrackPoint {
  return {
    latitude: parseCoordinate(pointElement, 'lat', -90, 90, context),
    longitude: parseCoordinate(pointElement, 'lon', -180, 180, context),
    elevationM: parseElevation(pointElement),
  }
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180
}

export function calculateHaversineDistanceKm(
  from: GpxTrackPoint,
  to: GpxTrackPoint,
): number {
  const latitudeDelta = toRadians(to.latitude - from.latitude)
  const longitudeDelta = toRadians(to.longitude - from.longitude)
  const fromLatitude = toRadians(from.latitude)
  const toLatitude = toRadians(to.latitude)
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(fromLatitude) * Math.cos(toLatitude) * Math.sin(longitudeDelta / 2) ** 2
  const boundedHaversine = Math.min(1, Math.max(0, haversine))
  const centralAngle =
    2 * Math.atan2(Math.sqrt(boundedHaversine), Math.sqrt(1 - boundedHaversine))
  return earthRadiusKm * centralAngle
}

export function calculateSegmentMetrics(
  points: readonly GpxTrackPoint[],
): Pick<GpxSegment, 'distanceKm' | 'elevationGainM' | 'elevationLossM'> {
  let distanceKm = 0
  let elevationGainM = 0
  let elevationLossM = 0
  let elevationComparisonCount = 0
  let previousPoint: GpxTrackPoint | null = null
  let previousElevationM: number | null = null

  for (const point of points) {
    if (previousPoint !== null) {
      distanceKm += calculateHaversineDistanceKm(previousPoint, point)
    }

    if (point.elevationM !== null) {
      if (previousElevationM !== null) {
        const elevationDelta = point.elevationM - previousElevationM
        elevationComparisonCount++

        if (elevationDelta > 0) {
          elevationGainM += elevationDelta
        } else {
          elevationLossM += Math.abs(elevationDelta)
        }
      }

      previousElevationM = point.elevationM
    }

    previousPoint = point
  }

  return {
    distanceKm,
    elevationGainM: elevationComparisonCount > 0 ? elevationGainM : null,
    elevationLossM: elevationComparisonCount > 0 ? elevationLossM : null,
  }
}

function parseSegment(
  segmentElement: Element,
  fileName: string,
  segmentIndex: number,
): GpxSegment {
  const pointElements = getDirectChildren(segmentElement, 'trkpt')
  const points = pointElements.map((pointElement, pointIndex) =>
    parseTrackPoint(pointElement, `${fileName}, segment ${segmentIndex + 1}, point ${pointIndex + 1}`),
  )

  return {
    points,
    ...calculateSegmentMetrics(points),
  }
}

function containsParserError(document: XMLDocument): boolean {
  return (
    document.documentElement?.localName === 'parsererror' ||
    document.getElementsByTagName('parsererror').length > 0 ||
    document.getElementsByTagNameNS('*', 'parsererror').length > 0
  )
}

export function parseGpxDocument(xmlText: string, source: GpxSource): GpxAnalysisSuccess {
  const document = new DOMParser().parseFromString(xmlText, 'application/xml')

  if (containsParserError(document)) {
    throw new Error('Le document XML est invalide.')
  }

  const root = document.documentElement

  if (root === null || root.localName !== 'gpx') {
    throw new Error('La racine GPX est absente ou invalide.')
  }

  const tracks = getDirectChildren(root, 'trk')

  if (tracks.length === 0) {
    throw new Error('Aucune balise trk trouvée.')
  }

  const trackName =
    tracks
      .map((track) => getDirectChildText(track, 'name'))
      .find((name): name is string => name !== null) ?? null
  const segmentElements = tracks.flatMap((track) => getDirectChildren(track, 'trkseg'))

  if (segmentElements.length === 0) {
    throw new Error('Aucune balise trkseg trouvée.')
  }

  const segments = segmentElements.map((segmentElement, segmentIndex) =>
    parseSegment(segmentElement, source.fileName, segmentIndex),
  )
  const populatedSegments = segments.filter((segment) => segment.points.length > 0)
  const firstSegment = populatedSegments[0]
  const lastSegment = populatedSegments[populatedSegments.length - 1]
  const firstPoint = firstSegment?.points[0]
  const lastPoint = lastSegment?.points[lastSegment.points.length - 1]

  if (firstPoint === undefined || lastPoint === undefined) {
    throw new Error('Aucun point trkpt exploitable trouvé.')
  }

  const allPoints = segments.flatMap((segment) => segment.points)
  const elevations = allPoints
    .map((point) => point.elevationM)
    .filter((elevation): elevation is number => elevation !== null)
  const segmentGains = segments
    .map((segment) => segment.elevationGainM)
    .filter((gain): gain is number => gain !== null)
  const segmentLosses = segments
    .map((segment) => segment.elevationLossM)
    .filter((loss): loss is number => loss !== null)
  const minElevationM =
    elevations.length > 0
      ? elevations.reduce((minimum, elevation) => Math.min(minimum, elevation))
      : null
  const maxElevationM =
    elevations.length > 0
      ? elevations.reduce((maximum, elevation) => Math.max(maximum, elevation))
      : null

  return {
    status: 'success',
    source,
    segments,
    summary: {
      fileNumber: source.fileNumber,
      fileName: source.fileName,
      trackName,
      startName: source.startName,
      endName: source.endName,
      firstPoint,
      lastPoint,
      totalPoints: allPoints.length,
      distanceKm: segments.reduce((total, segment) => total + segment.distanceKm, 0),
      elevationGainM:
        segmentGains.length > 0 ? segmentGains.reduce((total, gain) => total + gain, 0) : null,
      elevationLossM:
        segmentLosses.length > 0 ? segmentLosses.reduce((total, loss) => total + loss, 0) : null,
      minElevationM,
      maxElevationM,
      segmentCount: segments.length,
      hasMultipleSegments: segments.length > 1,
      isVariant: source.isVariant,
    },
  }
}
