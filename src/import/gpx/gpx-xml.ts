/**
 * Generic GPX XML traversal — the structural half of parsing, kept separate
 * from business validation (`analyze-gpx.ts`). Deliberately not a second GPX
 * parser: it reuses the same DOM-traversal shape as the historical
 * `src/gpx/parser.ts` (namespace-blind `localName` matching via `DOMParser`,
 * exactly like that module) but drops the RGA-specific `GpxSource` contract
 * (`startName`/`endName`/`fileNumber`/`url`/manifest-derived `isVariant`),
 * which a generic user-supplied file never has. Numeric parsing here never
 * throws and never drops a point — it reports whatever it finds (including
 * out-of-range or missing coordinates as `Number.NaN`); validating and
 * discarding invalid points is `analyze-gpx.ts`'s job, not this one's, so
 * every problem still surfaces as an explicit `ImportIssue` rather than a
 * silent parse-time correction.
 */

export interface GpxXmlPoint {
  readonly latitude: number
  readonly longitude: number
  readonly elevationM: number | null
  readonly timestamp: string | null
}

export interface GpxXmlSegment {
  readonly points: readonly GpxXmlPoint[]
}

export interface GpxXmlTrack {
  readonly name: string | null
  readonly segments: readonly GpxXmlSegment[]
}

export interface GpxXmlRoute {
  readonly name: string | null
  readonly points: readonly GpxXmlPoint[]
}

export interface GpxXmlWaypoint {
  readonly name: string | null
  readonly description: string | null
  readonly latitude: number
  readonly longitude: number
  readonly elevationM: number | null
}

export interface GpxXmlDocument {
  readonly metadataName: string | null
  readonly tracks: readonly GpxXmlTrack[]
  readonly routes: readonly GpxXmlRoute[]
  readonly waypoints: readonly GpxXmlWaypoint[]
}

export class GpxXmlParseError extends Error {}

function getDirectChildren(element: Element, localName: string): readonly Element[] {
  return Array.from(element.children).filter((child) => child.localName === localName)
}

function getDirectChildText(element: Element, localName: string): string | null {
  const child = getDirectChildren(element, localName)[0]
  const text = child?.textContent?.trim()
  return text === undefined || text.length === 0 ? null : text
}

function parseCoordinateAttribute(pointElement: Element, attributeName: 'lat' | 'lon'): number {
  const rawValue = pointElement.getAttribute(attributeName)
  if (rawValue === null || rawValue.trim().length === 0) {
    return Number.NaN
  }
  return Number(rawValue)
}

function parseElevation(pointElement: Element): number | null {
  const rawElevation = getDirectChildText(pointElement, 'ele')
  if (rawElevation === null) return null
  const elevation = Number(rawElevation)
  return Number.isFinite(elevation) ? elevation : null
}

function parseTimestamp(pointElement: Element): string | null {
  return getDirectChildText(pointElement, 'time')
}

function parsePoint(pointElement: Element): GpxXmlPoint {
  return {
    latitude: parseCoordinateAttribute(pointElement, 'lat'),
    longitude: parseCoordinateAttribute(pointElement, 'lon'),
    elevationM: parseElevation(pointElement),
    timestamp: parseTimestamp(pointElement),
  }
}

function parseTrack(trackElement: Element): GpxXmlTrack {
  const segments = getDirectChildren(trackElement, 'trkseg').map((segmentElement) => ({
    points: getDirectChildren(segmentElement, 'trkpt').map(parsePoint),
  }))
  return { name: getDirectChildText(trackElement, 'name'), segments }
}

function parseRoute(routeElement: Element): GpxXmlRoute {
  return {
    name: getDirectChildText(routeElement, 'name'),
    points: getDirectChildren(routeElement, 'rtept').map(parsePoint),
  }
}

function parseWaypoint(waypointElement: Element): GpxXmlWaypoint {
  return {
    name: getDirectChildText(waypointElement, 'name'),
    description: getDirectChildText(waypointElement, 'desc'),
    latitude: parseCoordinateAttribute(waypointElement, 'lat'),
    longitude: parseCoordinateAttribute(waypointElement, 'lon'),
    elevationM: parseElevation(waypointElement),
  }
}

function containsParserError(document: XMLDocument): boolean {
  return (
    document.documentElement?.localName === 'parsererror' ||
    document.getElementsByTagName('parsererror').length > 0 ||
    document.getElementsByTagNameNS('*', 'parsererror').length > 0
  )
}

/**
 * Parses a GPX 1.0/1.1 document (namespace-blind, so any prefix or default
 * namespace works). Throws `GpxXmlParseError` only for structurally invalid
 * XML or a missing/wrong root element — never for a missing track, route or
 * point, which are business conditions `analyze-gpx.ts` turns into
 * `ImportIssue`s instead.
 */
export function parseGpxXml(xmlText: string): GpxXmlDocument {
  const document = new DOMParser().parseFromString(xmlText, 'application/xml')

  if (containsParserError(document)) {
    throw new GpxXmlParseError('Le document XML est invalide.')
  }

  const root = document.documentElement
  if (root === null || root.localName !== 'gpx') {
    throw new GpxXmlParseError('La racine GPX est absente ou invalide.')
  }

  const metadata = getDirectChildren(root, 'metadata')[0]

  return {
    metadataName: metadata === undefined ? null : getDirectChildText(metadata, 'name'),
    tracks: getDirectChildren(root, 'trk').map(parseTrack),
    routes: getDirectChildren(root, 'rte').map(parseRoute),
    waypoints: getDirectChildren(root, 'wpt').map(parseWaypoint),
  }
}
