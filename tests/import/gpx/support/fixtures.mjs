// Small, declarative GPX XML builder for phase 6 import tests. Deliberately
// not a copy of any RGA GPX file — every fixture here is synthetic and tiny.

function point(tag, { lat, lon, ele, time }) {
  const inner = [ele === undefined ? '' : `<ele>${ele}</ele>`, time === undefined ? '' : `<time>${time}</time>`].join('')
  return `<${tag} lat="${lat}" lon="${lon}">${inner}</${tag}>`
}

function track({ name, segments }, prefix) {
  const p = prefix ? `${prefix}:` : ''
  const nameXml = name === undefined ? '' : `<${p}name>${name}</${p}name>`
  const segmentsXml = segments
    .map((points) => `<${p}trkseg>${points.map((pt) => point(`${p}trkpt`, pt)).join('')}</${p}trkseg>`)
    .join('')
  return `<${p}trk>${nameXml}${segmentsXml}</${p}trk>`
}

function route({ name, points }, prefix) {
  const p = prefix ? `${prefix}:` : ''
  const nameXml = name === undefined ? '' : `<${p}name>${name}</${p}name>`
  return `<${p}rte>${nameXml}${points.map((pt) => point(`${p}rtept`, pt)).join('')}</${p}rte>`
}

function waypoint({ name, desc, lat, lon, ele }, prefix) {
  const p = prefix ? `${prefix}:` : ''
  const inner = [
    name === undefined ? '' : `<${p}name>${name}</${p}name>`,
    desc === undefined ? '' : `<${p}desc>${desc}</${p}desc>`,
    ele === undefined ? '' : `<${p}ele>${ele}</${p}ele>`,
  ].join('')
  return `<${p}wpt lat="${lat}" lon="${lon}">${inner}</${p}wpt>`
}

/**
 * Builds a minimal, well-formed GPX document. `namespacePrefix` exercises
 * "namespaces variables" (CDC section 11.1) by prefixing every element
 * (`<gpx:gpx xmlns:gpx="...">`) instead of relying on a bare default
 * namespace.
 */
export function buildGpxXml({
  version = '1.1',
  namespaceUri = 'http://www.topografix.com/GPX/1/1',
  namespacePrefix = null,
  metadataName,
  tracks = [],
  routes = [],
  waypoints = [],
} = {}) {
  const p = namespacePrefix ? `${namespacePrefix}:` : ''
  const xmlnsAttr = namespacePrefix ? `xmlns:${namespacePrefix}="${namespaceUri}"` : `xmlns="${namespaceUri}"`
  const metadataXml = metadataName === undefined ? '' : `<${p}metadata><${p}name>${metadataName}</${p}name></${p}metadata>`
  const tracksXml = tracks.map((t) => track(t, namespacePrefix)).join('')
  const routesXml = routes.map((r) => route(r, namespacePrefix)).join('')
  const waypointsXml = waypoints.map((w) => waypoint(w, namespacePrefix)).join('')

  return `<?xml version="1.0" encoding="UTF-8"?><${p}gpx version="${version}" ${xmlnsAttr}>${metadataXml}${waypointsXml}${tracksXml}${routesXml}</${p}gpx>`
}

/** A straight, three-point synthetic climb: +0.002 lat/lon per step, +50 m elevation per step. */
export function simpleClimbTrack(name = 'Synthetic climb') {
  return {
    name,
    segments: [
      [
        { lat: 45.0, lon: 6.0, ele: 1000 },
        { lat: 45.002, lon: 6.002, ele: 1050 },
        { lat: 45.004, lon: 6.004, ele: 1100 },
      ],
    ],
  }
}

export function toGpxImportFile(xmlText, name = 'stage.gpx', overrides = {}) {
  const bytes = new TextEncoder().encode(xmlText).buffer
  return {
    name,
    mimeType: 'application/gpx+xml',
    sizeBytes: bytes.byteLength,
    lastModifiedAt: null,
    bytes,
    ...overrides,
  }
}
