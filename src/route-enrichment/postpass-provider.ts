import type {
  OsmElementType,
  OsmRouteFeatureCandidate,
  RouteEnrichmentProvider,
  RouteFeatureType,
  StructuralRouteFeatureSearch,
} from './types.ts'

export const DEFAULT_POSTPASS_URL = 'https://postpass.geofabrik.de/api/interpreter'
// Real-browser smoke testing observed requests being aborted around 15.0s
// (right at the previous 15_000 ms ceiling) even though earlier benchmarks
// suggested ~10s was typical — real-world latency (server load, network
// conditions) leaves too little margin at 15s. Widened to 30s; enrichment
// runs asynchronously and never blocks the UI, so a slower request is not
// user-visible beyond its own stage's progress indicator.
export const DEFAULT_POSTPASS_TIMEOUT_MS = 30_000
export const POSTPASS_LOCALITY_BBOX_EXPAND_DEGREES = 0.04
export const POSTPASS_LANDMARK_BBOX_EXPAND_DEGREES = 0.01

interface GeoJsonFeature {
  readonly type?: unknown
  readonly geometry?: unknown
  readonly properties?: unknown
}

interface GeoJsonFeatureCollection {
  readonly type?: unknown
  readonly features?: unknown
}

export interface PostpassRouteDiagnostic {
  readonly stage: 'request' | 'response' | 'parsed' | 'error'
  readonly stageId: string
  readonly routeFingerprint: string
  readonly sentPointCount: number
  readonly routeLengthKm: number | null
  readonly payloadBytes: number
  readonly startedAt: string
  readonly finishedAt: string | null
  readonly durationMs: number | null
  readonly httpStatus: number | null
  readonly rawCandidateCount: number | null
  readonly counts: Readonly<Record<RouteFeatureType, number>> | null
  readonly message: string | null
}

export interface PostpassRouteProviderOptions {
  readonly baseUrl?: string
  readonly requestTimeoutMs?: number
  readonly fetchFn?: typeof fetch
  readonly now?: () => string
  readonly nowMs?: () => number
  readonly onDiagnostic?: (diagnostic: PostpassRouteDiagnostic) => void
}

class PostpassHttpError extends Error {
  readonly status: number
  constructor(status: number) {
    super(`Postpass a répondu avec le statut HTTP ${status}.`)
    this.status = status
  }
}

function validCoordinate(value: number, limit: number): boolean {
  return Number.isFinite(value) && Math.abs(value) <= limit
}

function coordinate(value: number): string {
  const rounded = Number(value.toFixed(6))
  return Object.is(rounded, -0) ? '0' : String(rounded)
}

export function buildPostpassLineString(geometry: StructuralRouteFeatureSearch['geometry']): string {
  if (geometry.length < 2) throw new Error('Postpass requiert au moins deux points de route.')
  return `LINESTRING(${geometry.map((point) => {
    if (!validCoordinate(point.latitude, 90) || !validCoordinate(point.longitude, 180)) {
      throw new Error('Coordonnée GPX invalide pour Postpass.')
    }
    return `${coordinate(point.longitude)} ${coordinate(point.latitude)}`
  }).join(',')})`
}

export function buildPostpassStructuralQuery(search: StructuralRouteFeatureSearch): string {
  const lineString = buildPostpassLineString(search.geometry)
  return `WITH route AS (
  SELECT ST_GeomFromText('${lineString}', 4326) AS geom
), candidates AS (
  SELECT
    source.osm_type,
    source.osm_id,
    source.tags,
    CASE
      WHEN GeometryType(source.geom) IN ('POLYGON', 'MULTIPOLYGON') THEN ST_PointOnSurface(source.geom)
      ELSE source.geom
    END AS geom,
    CASE
      WHEN source.tags->>'place' = 'city' THEN 'city'
      WHEN source.tags->>'place' = 'town' THEN 'town'
      WHEN source.tags->>'place' = 'village' THEN 'village'
      WHEN source.tags->>'mountain_pass' = 'yes' THEN 'mountain-pass'
      WHEN source.tags->>'natural' = 'saddle' THEN 'saddle'
    END AS feature_type
  FROM postpass_pointpolygon AS source
  CROSS JOIN route
  WHERE source.tags->>'name' IS NOT NULL
    AND btrim(source.tags->>'name') <> ''
    AND (
      (
        source.tags->>'place' IN ('city', 'town', 'village')
        AND source.geom && ST_Expand(route.geom, ${POSTPASS_LOCALITY_BBOX_EXPAND_DEGREES})
        AND ST_DWithin(source.geom::geography, route.geom::geography, ${search.localityCollectionRadiusMeters})
      )
      OR
      (
        (source.tags->>'mountain_pass' = 'yes' OR source.tags->>'natural' = 'saddle')
        AND source.geom && ST_Expand(route.geom, ${POSTPASS_LANDMARK_BBOX_EXPAND_DEGREES})
        AND ST_DWithin(source.geom::geography, route.geom::geography, ${search.landmarkCollectionRadiusMeters})
      )
    )
)
SELECT osm_type, osm_id, tags->>'name' AS name, tags->>'ele' AS elevation, feature_type, geom
FROM candidates`
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

function osmType(value: unknown): OsmElementType | null {
  if (value === 'N') return 'node'
  if (value === 'W') return 'way'
  if (value === 'R') return 'relation'
  return null
}

const ROUTE_FEATURE_TYPES: readonly RouteFeatureType[] = ['city', 'town', 'village', 'mountain-pass', 'saddle']

function featureType(value: unknown): RouteFeatureType | null {
  return typeof value === 'string' && (ROUTE_FEATURE_TYPES as readonly string[]).includes(value) ? (value as RouteFeatureType) : null
}

function elevation(value: unknown): number | null {
  const text = typeof value === 'number' ? String(value) : nonEmptyString(value)
  if (text === null) return null
  const parsed = Number.parseFloat(text.replaceAll(' ', '').replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

function parseFeature(value: unknown): OsmRouteFeatureCandidate | null {
  if (value === null || typeof value !== 'object') return null
  const feature = value as GeoJsonFeature
  if (feature.type !== 'Feature' || feature.geometry === null || typeof feature.geometry !== 'object' || feature.properties === null || typeof feature.properties !== 'object') return null
  const geometry = feature.geometry as { readonly type?: unknown; readonly coordinates?: unknown }
  const properties = feature.properties as Record<string, unknown>
  if (geometry.type !== 'Point' || !Array.isArray(geometry.coordinates)) return null
  const longitude = geometry.coordinates[0]
  const latitude = geometry.coordinates[1]
  const type = featureType(properties.feature_type)
  const elementType = osmType(properties.osm_type)
  const id = typeof properties.osm_id === 'number' || typeof properties.osm_id === 'string' ? String(properties.osm_id) : null
  const name = nonEmptyString(properties.name)
  if (!validCoordinate(latitude as number, 90) || !validCoordinate(longitude as number, 180) || type === null || elementType === null || id === null || name === null) return null
  const usefulTags: Record<string, string> = type === 'city' || type === 'town' || type === 'village'
    ? { place: type }
    : type === 'mountain-pass' ? { mountain_pass: 'yes' } : { natural: 'saddle' }
  const elevationM = elevation(properties.elevation)
  return { osmType: elementType, osmId: id, featureType: type, name, latitude, longitude, elevationM, usefulTags: elevationM === null ? usefulTags : { ...usefulTags, ele: String(properties.elevation) } }
}

export function parsePostpassFeatureCollection(value: unknown): { readonly candidates: readonly OsmRouteFeatureCandidate[]; readonly rawCandidateCount: number } {
  if (value === null || typeof value !== 'object') throw new Error('Réponse GeoJSON Postpass invalide.')
  const collection = value as GeoJsonFeatureCollection
  if (collection.type !== 'FeatureCollection' || !Array.isArray(collection.features)) throw new Error('Réponse GeoJSON Postpass invalide.')
  return {
    candidates: collection.features.map(parseFeature).filter((candidate): candidate is OsmRouteFeatureCandidate => candidate !== null),
    rawCandidateCount: collection.features.length,
  }
}

function counts(candidates: readonly OsmRouteFeatureCandidate[]): Readonly<Record<RouteFeatureType, number>> {
  const result = {} as Record<RouteFeatureType, number>
  for (const type of ROUTE_FEATURE_TYPES) {
    result[type] = candidates.filter((candidate) => candidate.featureType === type).length
  }
  return result
}

export function createPostpassRouteEnrichmentProvider(options: PostpassRouteProviderOptions = {}): RouteEnrichmentProvider {
  const endpoint = options.baseUrl ?? DEFAULT_POSTPASS_URL
  const fetchFn = options.fetchFn ?? fetch
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_POSTPASS_TIMEOUT_MS
  const now = options.now ?? (() => new Date().toISOString())
  const nowMs = options.nowMs ?? (() => performance.now())
  const emit = options.onDiagnostic ?? (() => undefined)

  return {
    id: 'postpass-osm-structural-points',
    sourceType: 'osm',
    attribution: '© OpenStreetMap contributors · Postpass/Geofabrik',
    async findStructuralCandidates(search, externalSignal) {
      const sql = buildPostpassStructuralQuery(search)
      const payloadBytes = new TextEncoder().encode(sql).byteLength
      const startedAt = now()
      const startedMs = nowMs()
      let status: number | null = null
      const baseDiagnostic = {
        stageId: search.stageId,
        routeFingerprint: search.routeFingerprint,
        sentPointCount: search.geometry.length,
        routeLengthKm: search.routeLengthKm,
        payloadBytes,
        startedAt,
      }
      emit({ stage: 'request', ...baseDiagnostic, finishedAt: null, durationMs: null, httpStatus: null, rawCandidateCount: null, counts: null, message: null })
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), requestTimeoutMs)
      const abort = () => controller.abort()
      externalSignal?.addEventListener('abort', abort, { once: true })
      try {
        const response = await fetchFn(endpoint, {
          method: 'POST',
          headers: { Accept: 'application/geo+json, application/json' },
          body: new URLSearchParams({ data: sql }),
          signal: controller.signal,
        })
        status = response.status
        const responseAt = now()
        const responseDuration = Math.max(0, nowMs() - startedMs)
        emit({ stage: 'response', ...baseDiagnostic, finishedAt: responseAt, durationMs: responseDuration, httpStatus: status, rawCandidateCount: null, counts: null, message: null })
        if (!response.ok) throw new PostpassHttpError(response.status)
        const parsed = parsePostpassFeatureCollection(await response.json())
        const finishedAt = now()
        const durationMs = Math.max(0, nowMs() - startedMs)
        emit({ stage: 'parsed', ...baseDiagnostic, finishedAt, durationMs, httpStatus: status, rawCandidateCount: parsed.rawCandidateCount, counts: counts(parsed.candidates), message: null })
        return { ...parsed, durationMs, httpStatus: status, payloadBytes, startedAt, finishedAt }
      } catch (error) {
        const timedOut = controller.signal.aborted && !externalSignal?.aborted
        const finalError = timedOut ? new Error(`Postpass n’a pas répondu dans le délai de ${requestTimeoutMs} ms.`) : error
        emit({
          stage: 'error', ...baseDiagnostic, finishedAt: now(), durationMs: Math.max(0, nowMs() - startedMs), httpStatus: status,
          rawCandidateCount: null, counts: null, message: finalError instanceof Error ? finalError.message : String(finalError),
        })
        throw finalError
      } finally {
        clearTimeout(timeout)
        externalSignal?.removeEventListener('abort', abort)
      }
    },
  }
}
