import { createHash } from 'node:crypto'

export const PRACTICAL_DISTANCE_LIMIT_KM = 6
export const RIDE_DAY_IDS = Object.freeze([
  'J1',
  'J2',
  'J3',
  'J4',
  'J6',
  'J7',
  'J9',
  'J10',
  'J11',
  'J12',
])

const excludedLayerNames = new Set(['itineraire', 'etapes'])
const geometryNames = new Set(['Point', 'LineString', 'Polygon', 'LinearRing', 'MultiGeometry'])
const technicalDescriptionPatterns = [
  /^type\s*:/i,
  /^distance\s+par\s+rapport\s+[àa]\s+l['’]itin[eé]raire\s*:/i,
  /^kilom[eè]tre\s+d['’]itin[eé]raire\s*:/i,
]

function decodeXmlEntities(value) {
  return value.replace(
    /&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi,
    (match, entity) => {
      const normalized = entity.toLowerCase()
      if (normalized === 'amp') return '&'
      if (normalized === 'lt') return '<'
      if (normalized === 'gt') return '>'
      if (normalized === 'quot') return '"'
      if (normalized === 'apos') return "'"
      const radix = normalized.startsWith('#x') ? 16 : 10
      const digits = normalized.startsWith('#x') ? normalized.slice(2) : normalized.slice(1)
      const codePoint = Number.parseInt(digits, radix)
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match
    },
  )
}

function localName(value) {
  return value.includes(':') ? value.slice(value.lastIndexOf(':') + 1) : value
}

function parseAttributes(source) {
  const attributes = {}
  const pattern = /([:\w-]+)\s*=\s*(["'])([\s\S]*?)\2/g
  for (const match of source.matchAll(pattern)) {
    attributes[localName(match[1])] = decodeXmlEntities(match[3])
  }
  return attributes
}

export function parseXmlDocument(source) {
  if (typeof source !== 'string' || source.trim() === '') {
    throw new Error('Le document XML est vide.')
  }

  const documentNode = { name: '#document', attributes: {}, text: '', children: [] }
  const stack = [documentNode]
  const tokenPattern =
    /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[\s\S]*?>|<\/\s*([^>\s]+)[^>]*>|<\s*([^>\s/]+)([^>]*)>|([^<]+)/g

  for (const match of source.matchAll(tokenPattern)) {
    const current = stack.at(-1)
    if (match[1] !== undefined) {
      current.text += match[1]
      continue
    }
    if (match[2] !== undefined) {
      const closingName = localName(match[2])
      if (stack.length === 1 || stack.at(-1).name !== closingName) {
        throw new Error(`Balise XML fermante inattendue : ${closingName}.`)
      }
      stack.pop()
      continue
    }
    if (match[3] !== undefined) {
      const rawAttributes = match[4] ?? ''
      const selfClosing = /\/\s*$/.test(rawAttributes)
      const node = {
        name: localName(match[3]),
        attributes: parseAttributes(rawAttributes),
        text: '',
        children: [],
      }
      current.children.push(node)
      if (!selfClosing) stack.push(node)
      continue
    }
    if (match[5] !== undefined) current.text += decodeXmlEntities(match[5])
  }

  if (stack.length !== 1) {
    throw new Error(`Document XML incomplet : balise ${stack.at(-1).name} non fermée.`)
  }
  if (documentNode.children.length !== 1) {
    throw new Error('Le document XML doit contenir une racine unique.')
  }
  return documentNode.children[0]
}

function elementText(node) {
  return `${node.text}${node.children.map(elementText).join('')}`
}

function child(node, name) {
  return node.children.find((candidate) => candidate.name === name) ?? null
}

function descendants(node, name) {
  const matches = []
  for (const candidate of node.children) {
    if (candidate.name === name) matches.push(candidate)
    matches.push(...descendants(candidate, name))
  }
  return matches
}

export function cleanLayerName(value) {
  return decodeXmlEntities(String(value))
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim()
}

export function normalizeLayerComparison(value) {
  return cleanLayerName(value)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('fr')
    .replace(/\s+/g, ' ')
    .trim()
}

function layerIdFromName(value) {
  return normalizeLayerComparison(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'pratique'
}

function cleanName(value, fallback) {
  const text = decodeXmlEntities(String(value))
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text === '' ? fallback : text
}

export function cleanDescription(value, pointName, layerName) {
  const withoutDangerousBlocks = String(value)
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li)\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
  const normalizedPointName = normalizeLayerComparison(pointName)
  const normalizedLayerName = normalizeLayerComparison(layerName)
  const seen = new Set()
  const usefulLines = []

  for (const rawLine of decodeXmlEntities(withoutDangerousBlocks).split(/\r?\n/)) {
    const line = rawLine.replace(/\s+/g, ' ').trim()
    if (line === '' || technicalDescriptionPatterns.some((pattern) => pattern.test(line))) continue
    const comparison = normalizeLayerComparison(line)
    if (
      comparison === normalizedPointName ||
      comparison === normalizedLayerName ||
      seen.has(comparison)
    ) continue
    seen.add(comparison)
    usefulLines.push(line)
  }

  const description = usefulLines.join(' · ')
  return description === '' ? null : description.slice(0, 280)
}

function iconKeyForLayer(layerName) {
  const comparison = normalizeLayerComparison(layerName)
  if (comparison.includes('toilette')) return 'toilet'
  if (comparison.includes('abri')) return 'shelter'
  if (comparison.includes('boulanger')) return 'bakery'
  if (comparison.includes('cafe') || comparison.includes('glace')) return 'cafe'
  if (comparison.includes('eau') || comparison.includes('boisson')) return 'water'
  if (comparison.includes('restauration')) return 'food'
  if (comparison.includes('velo')) return 'bicycle'
  if (comparison.includes('supermarche')) return 'grocery'
  return 'generic'
}

function kmlColorToHex(value) {
  const normalized = String(value).trim().replace(/^#/, '')
  if (!/^[\da-f]{8}$/i.test(normalized)) return null
  return `#${normalized.slice(6, 8)}${normalized.slice(4, 6)}${normalized.slice(2, 4)}`.toUpperCase()
}

function buildStyles(root) {
  const styles = new Map()
  for (const style of descendants(root, 'Style')) {
    const id = style.attributes.id
    if (typeof id !== 'string' || id === '') continue
    const colorElement = descendants(style, 'color')[0]
    const hrefElement = descendants(style, 'href')[0]
    styles.set(id, {
      color: colorElement === undefined ? null : kmlColorToHex(elementText(colorElement)),
      remoteIconUrl: hrefElement === undefined ? null : elementText(hrefElement).trim(),
    })
  }

  const styleMaps = new Map()
  for (const styleMap of descendants(root, 'StyleMap')) {
    const id = styleMap.attributes.id
    if (typeof id !== 'string' || id === '') continue
    const pairs = descendants(styleMap, 'Pair')
    const normalPair = pairs.find((pair) => elementText(child(pair, 'key') ?? pair).trim() === 'normal')
    const selectedPair = normalPair ?? pairs[0]
    const reference = selectedPair === undefined ? null : child(selectedPair, 'styleUrl')
    if (reference !== null) styleMaps.set(id, elementText(reference).trim().replace(/^#/, ''))
  }

  return { styles, styleMaps }
}

function resolveStyle(styleUrl, styleData) {
  const sourceStyleId = String(styleUrl).trim().replace(/^#/, '')
  const styleId = styleData.styleMaps.get(sourceStyleId) ?? sourceStyleId
  const style = styleData.styles.get(styleId)
  return {
    sourceStyleId,
    color: style?.color ?? '#475569',
    usedRemoteIconHint: /^https?:\/\//i.test(style?.remoteIconUrl ?? ''),
  }
}

function parseCoordinateTuple(value) {
  const [longitudeText, latitudeText] = String(value).trim().split(/\s+/)[0]?.split(',') ?? []
  const latitude = Number(latitudeText)
  const longitude = Number(longitudeText)
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) return null
  return { latitude, longitude }
}

function allDescendants(node) {
  return node.children.flatMap((candidate) => [candidate, ...allDescendants(candidate)])
}

function geometryCounts(placemark) {
  const counts = {}
  for (const node of allDescendants(placemark)) {
    if (geometryNames.has(node.name)) counts[node.name] = (counts[node.name] ?? 0) + 1
  }
  return counts
}

export function parseKmlPracticalPoints(kmlText) {
  const root = parseXmlDocument(kmlText)
  if (root.name !== 'kml') throw new Error(`Racine KML invalide : ${root.name}.`)
  const styleData = buildStyles(root)
  const rawPoints = []
  const folderNames = new Set()
  const excludedFolders = new Set()
  const sourceGeometryCounts = {}
  const ignoredNonPointGeometryCounts = {}
  let placemarkCount = 0
  let excludedPointCount = 0

  function visitContainer(container, folderPath) {
    for (const node of container.children) {
      if (node.name === 'Document') {
        visitContainer(node, folderPath)
        continue
      }
      if (node.name === 'Folder') {
        const nameElement = child(node, 'name')
        const folderName = cleanLayerName(nameElement === null ? '' : elementText(nameElement))
        if (folderName !== '') folderNames.add(folderName)
        visitContainer(node, folderName === '' ? folderPath : [...folderPath, folderName])
        continue
      }
      if (node.name !== 'Placemark') continue
      placemarkCount += 1
      const counts = geometryCounts(node)
      for (const [geometry, count] of Object.entries(counts)) {
        sourceGeometryCounts[geometry] = (sourceGeometryCounts[geometry] ?? 0) + count
        if (geometry !== 'Point' && geometry !== 'MultiGeometry') {
          ignoredNonPointGeometryCounts[geometry] =
            (ignoredNonPointGeometryCounts[geometry] ?? 0) + count
        }
      }

      const isExcluded = folderPath.some((name) =>
        excludedLayerNames.has(normalizeLayerComparison(name)),
      )
      if (isExcluded) {
        for (const name of folderPath) {
          if (excludedLayerNames.has(normalizeLayerComparison(name))) excludedFolders.add(name)
        }
        excludedPointCount += counts.Point ?? 0
        continue
      }

      const layerName = folderPath.at(-1) ?? 'Sans calque'
      const layerId = layerIdFromName(layerName)
      const nameElement = child(node, 'name')
      const pointName = cleanName(nameElement === null ? '' : elementText(nameElement), layerName)
      const descriptionElement = child(node, 'description')
      const description = cleanDescription(
        descriptionElement === null ? '' : elementText(descriptionElement),
        pointName,
        layerName,
      )
      const styleUrlElement = child(node, 'styleUrl')
      const style = resolveStyle(
        styleUrlElement === null ? '' : elementText(styleUrlElement),
        styleData,
      )
      const points = descendants(node, 'Point')
      for (const point of points) {
        const coordinatesElement = descendants(point, 'coordinates')[0]
        const coordinate = coordinatesElement === undefined
          ? null
          : parseCoordinateTuple(elementText(coordinatesElement))
        if (coordinate === null) continue
        rawPoints.push({
          layerId,
          layerName,
          name: pointName,
          description,
          latitude: coordinate.latitude,
          longitude: coordinate.longitude,
          sourceStyleId: style.sourceStyleId,
          color: style.color,
          iconKey: iconKeyForLayer(layerName),
          usedRemoteIconHint: style.usedRemoteIconHint,
        })
      }
    }
  }

  visitContainer(root, [])
  return {
    rawPoints,
    summary: {
      placemarkCount,
      folderNames: [...folderNames].sort(),
      excludedFolders: [...excludedFolders].sort(),
      sourceGeometryCounts,
      ignoredNonPointGeometryCounts,
      excludedPointCount,
      styleCount: styleData.styles.size,
      styleMapCount: styleData.styleMaps.size,
    },
  }
}

function projectCoordinate(origin, coordinate) {
  const latitudeRadians = (origin.latitude * Math.PI) / 180
  return {
    x: (coordinate.longitude - origin.longitude) * 111.32 * Math.cos(latitudeRadians),
    y: (coordinate.latitude - origin.latitude) * 110.574,
  }
}

function pointToSegmentDistanceKm(point, start, end) {
  const a = projectCoordinate(point, start)
  const b = projectCoordinate(point, end)
  const dx = b.x - a.x
  const dy = b.y - a.y
  if (dx === 0 && dy === 0) return Math.hypot(a.x, a.y)
  const projection = Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / (dx * dx + dy * dy)))
  return Math.hypot(a.x + projection * dx, a.y + projection * dy)
}

export function minimumDistanceToTrackKm(point, trackSegments) {
  let minimum = Number.POSITIVE_INFINITY
  for (const segment of trackSegments) {
    if (segment.length === 1) {
      minimum = Math.min(minimum, pointToSegmentDistanceKm(point, segment[0], segment[0]))
      continue
    }
    for (let index = 1; index < segment.length; index += 1) {
      const start = segment[index - 1]
      const end = segment[index]
      const latitudeMargin = PRACTICAL_DISTANCE_LIMIT_KM / 110.574
      const longitudeMargin =
        PRACTICAL_DISTANCE_LIMIT_KM /
        Math.max(20, 111.32 * Math.cos((point.latitude * Math.PI) / 180))
      if (
        point.latitude < Math.min(start.latitude, end.latitude) - latitudeMargin ||
        point.latitude > Math.max(start.latitude, end.latitude) + latitudeMargin ||
        point.longitude < Math.min(start.longitude, end.longitude) - longitudeMargin ||
        point.longitude > Math.max(start.longitude, end.longitude) + longitudeMargin
      ) continue
      minimum = Math.min(minimum, pointToSegmentDistanceKm(point, start, end))
      if (minimum === 0) return 0
    }
  }
  return minimum
}

export function parseGpxTrackSegments(gpxText) {
  const root = parseXmlDocument(gpxText)
  if (root.name !== 'gpx') throw new Error(`Racine GPX invalide : ${root.name}.`)
  const segments = descendants(root, 'trkseg').map((segment) =>
    segment.children
      .filter((point) => point.name === 'trkpt')
      .map((point) => ({
        latitude: Number(point.attributes.lat),
        longitude: Number(point.attributes.lon),
      }))
      .filter(
        ({ latitude, longitude }) =>
          Number.isFinite(latitude) &&
          Number.isFinite(longitude) &&
          latitude >= -90 &&
          latitude <= 90 &&
          longitude >= -180 &&
          longitude <= 180,
      ),
  ).filter((segment) => segment.length > 0)
  if (segments.length === 0) throw new Error('Le GPX ne contient aucun segment exploitable.')
  return segments
}

function trackBounds(segments) {
  const points = segments.flat()
  return {
    minLatitude: Math.min(...points.map(({ latitude }) => latitude)),
    maxLatitude: Math.max(...points.map(({ latitude }) => latitude)),
    minLongitude: Math.min(...points.map(({ longitude }) => longitude)),
    maxLongitude: Math.max(...points.map(({ longitude }) => longitude)),
  }
}

function isNearTrackBounds(point, bounds) {
  const latitudeMargin = PRACTICAL_DISTANCE_LIMIT_KM / 110.574
  const longitudeMargin =
    PRACTICAL_DISTANCE_LIMIT_KM /
    Math.max(20, 111.32 * Math.cos((point.latitude * Math.PI) / 180))
  return (
    point.latitude >= bounds.minLatitude - latitudeMargin &&
    point.latitude <= bounds.maxLatitude + latitudeMargin &&
    point.longitude >= bounds.minLongitude - longitudeMargin &&
    point.longitude <= bounds.maxLongitude + longitudeMargin
  )
}

function stablePointId(point) {
  const identity = [
    point.layerId,
    normalizeLayerComparison(point.name),
    point.latitude.toFixed(7),
    point.longitude.toFixed(7),
  ].join('|')
  return `practical-${createHash('sha256').update(identity).digest('hex').slice(0, 14)}`
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

export function buildPracticalData({ kmlText, gpxSources }) {
  if (!Array.isArray(gpxSources) || gpxSources.length !== RIDE_DAY_IDS.length) {
    throw new Error(`Dix GPX sont requis pour générer les données pratiques.`)
  }
  const parsed = parseKmlPracticalPoints(kmlText)
  const tracks = gpxSources.map((source, index) => {
    const dayId = source.dayId ?? RIDE_DAY_IDS[index]
    if (dayId !== RIDE_DAY_IDS[index]) {
      throw new Error(`Ordre GPX inattendu : ${dayId} à la position ${index + 1}.`)
    }
    const segments = parseGpxTrackSegments(source.gpxText)
    return { dayId, segments, bounds: trackBounds(segments) }
  })

  const duplicateIds = new Map()
  const points = parsed.rawPoints
    .map((point) => {
      const baseId = stablePointId(point)
      const occurrence = duplicateIds.get(baseId) ?? 0
      duplicateIds.set(baseId, occurrence + 1)
      const id = occurrence === 0 ? baseId : `${baseId}-${occurrence + 1}`
      const dayIds = tracks.flatMap((track) => {
        if (!isNearTrackBounds(point, track.bounds)) return []
        const distanceKm = minimumDistanceToTrackKm(point, track.segments)
        return distanceKm <= PRACTICAL_DISTANCE_LIMIT_KM ? [track.dayId] : []
      })
      return {
        id,
        name: point.name,
        layerId: point.layerId,
        latitude: point.latitude,
        longitude: point.longitude,
        ...(point.description === null ? {} : { description: point.description }),
        dayIds,
      }
    })
    .sort((left, right) => compareText(left.id, right.id))

  const pointsByLayer = new Map()
  for (const point of parsed.rawPoints) {
    const current = pointsByLayer.get(point.layerId) ?? []
    current.push(point)
    pointsByLayer.set(point.layerId, current)
  }
  const layers = [...pointsByLayer.entries()]
    .map(([id, layerPoints]) => {
      const first = layerPoints[0]
      return {
        id,
        name: first.layerName,
        color: first.color,
        iconKey: first.iconKey,
        pointCount: layerPoints.length,
        sourceStyleIds: [...new Set(layerPoints.map(({ sourceStyleId }) => sourceStyleId))]
          .filter((value) => value !== '')
          .sort(compareText),
      }
    })
    .sort((left, right) => compareText(left.name, right.name))

  const dayPointCounts = Object.fromEntries(
    RIDE_DAY_IDS.map((dayId) => [
      dayId,
      points.filter((point) => point.dayIds.includes(dayId)).length,
    ]),
  )

  return {
    schemaVersion: 1,
    distanceLimitKm: PRACTICAL_DISTANCE_LIMIT_KM,
    source: {
      fileName: 'rga-practical-points.kml',
      ...parsed.summary,
      retainedPointCount: points.length,
      remoteIconHintsIgnored: parsed.rawPoints.filter(({ usedRemoteIconHint }) => usedRemoteIconHint).length,
    },
    layers,
    points,
    dayPointCounts,
  }
}

export function serializePracticalData(data) {
  return `${JSON.stringify(data, null, 2)}\n`
}
