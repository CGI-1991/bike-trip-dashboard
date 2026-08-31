/**
 * C2's automatic runtime source for practical POI (CDC C2 sections 2/11-13):
 * one Postpass query per stage, combining two independent strategies in a
 * single request — never one request per anchor, never a second parallel
 * HTTP subsystem alongside `route-enrichment/postpass-provider.ts`. Reuses
 * that module's own validated conventions verbatim: `buildPostpassLineString`
 * (coordinate validation/formatting), the same endpoint/timeout/diagnostic
 * shape, the same GeoJSON FeatureCollection response parsing style.
 *
 * Two independent WHERE branches inside one `candidates` CTE (CDC section 10):
 * - corridor categories (Eau/Abris/Toilette) — `ST_DWithin` against the whole
 *   route line, `corridorRadiusMeters` laterally;
 * - anchor categories (Vélo/Supermarché/Boulangerie) — `ST_DWithin` against a
 *   `MULTIPOINT` of départ/arrivée/localités retenues/pauses,
 *   `anchorRadiusMeters` around the nearest one.
 */

import { DEFAULT_POSTPASS_TIMEOUT_MS, DEFAULT_POSTPASS_URL, buildPostpassLineString } from '../route-enrichment/postpass-provider.ts'
import type { PracticalPlaceCategory } from '../trip-core/index.ts'
import type { PracticalPlaceAnchor, PracticalPlaceCandidate, PracticalPlacesProvider, PracticalPlacesResult, PracticalPlacesSearch } from './types.ts'

export { DEFAULT_POSTPASS_TIMEOUT_MS, DEFAULT_POSTPASS_URL }

/**
 * Bbox pre-filter margin (CDC section 11 — keeps the query index-friendly
 * before the precise `ST_DWithin` check), wide enough at any latitude to
 * cover the wider of the two radii below with real margin (mirrors
 * `route-enrichment/postpass-provider.ts`'s own bbox-vs-radius safety test:
 * even at 60° latitude, 0.02° ≈ 1.1 km of longitude — comfortably over the
 * 800 m anchor radius).
 */
export const POSTPASS_PRACTICAL_PLACES_BBOX_EXPAND_DEGREES = 0.02

/** CDC section 10.A: continuous corridor along the whole stage. */
export const PRACTICAL_PLACES_CORRIDOR_RADIUS_METERS = 500
/** CDC section 10.B: fixed radius around each anchor (départ/arrivée/localité retenue/pause). */
export const PRACTICAL_PLACES_ANCHOR_RADIUS_METERS = 800

interface GeoJsonFeature {
  readonly type?: unknown
  readonly geometry?: unknown
  readonly properties?: unknown
}

interface GeoJsonFeatureCollection {
  readonly type?: unknown
  readonly features?: unknown
}

export interface PracticalPlacesPostpassDiagnostic {
  readonly stage: 'request' | 'response' | 'parsed' | 'error'
  readonly stageId: string
  readonly routeFingerprint: string
  readonly anchorCount: number
  readonly payloadBytes: number
  readonly startedAt: string
  readonly finishedAt: string | null
  readonly durationMs: number | null
  readonly httpStatus: number | null
  readonly rawCandidateCount: number | null
  readonly message: string | null
}

export interface PostpassPracticalPlacesProviderOptions {
  readonly baseUrl?: string
  readonly requestTimeoutMs?: number
  readonly fetchFn?: typeof fetch
  readonly now?: () => string
  readonly nowMs?: () => number
  readonly onDiagnostic?: (diagnostic: PracticalPlacesPostpassDiagnostic) => void
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

/** Same coordinate validation/formatting discipline as `buildPostpassLineString`, for the anchors' own `MULTIPOINT`. */
export function buildPostpassMultiPoint(anchors: readonly PracticalPlaceAnchor[]): string {
  if (anchors.length === 0) throw new Error('Postpass requiert au moins une ancre pour un MULTIPOINT.')
  return `MULTIPOINT(${anchors.map((anchor) => {
    if (!validCoordinate(anchor.latitude, 90) || !validCoordinate(anchor.longitude, 180)) {
      throw new Error('Coordonnée d’ancre invalide pour Postpass.')
    }
    return `${coordinate(anchor.longitude)} ${coordinate(anchor.latitude)}`
  }).join(',')})`
}

/**
 * One `candidates` CTE, at most two independent `ST_DWithin` branches
 * (corridor / anchors) combined with `OR` — never a query per anchor (CDC
 * section 11). `search.anchors` empty simply drops the anchor branch
 * entirely (corridor-only categories still get their real query) rather
 * than emitting an invalid empty `MULTIPOINT()`.
 */
export function buildPostpassPracticalPlacesQuery(search: PracticalPlacesSearch): string {
  const lineString = buildPostpassLineString(search.geometry)
  const hasAnchors = search.anchors.length > 0
  const anchorsCte = hasAnchors ? `, anchors AS (\n  SELECT ST_GeomFromText('${buildPostpassMultiPoint(search.anchors)}', 4326) AS geom\n)` : ''
  const anchorJoin = hasAnchors ? '\n  CROSS JOIN anchors' : ''
  const corridorBranch = `(
      (source.tags->>'amenity' IN ('drinking_water', 'shelter', 'toilets')
        OR (source.tags->>'amenity' = 'fountain' AND source.tags->>'drinking_water' = 'yes'))
      AND ST_DWithin(source.geom::geography, route.geom::geography, ${PRACTICAL_PLACES_CORRIDOR_RADIUS_METERS})
    )`
  const anchorBranch = hasAnchors
    ? `
    OR (
      (source.tags->>'shop' = 'bicycle' OR source.tags->>'amenity' = 'bicycle_repair_station'
        OR source.tags->>'shop' IN ('supermarket', 'convenience', 'grocery') OR source.tags->>'shop' = 'bakery')
      AND ST_DWithin(source.geom::geography, anchors.geom::geography, ${PRACTICAL_PLACES_ANCHOR_RADIUS_METERS})
    )`
    : ''
  return `WITH route AS (
  SELECT ST_GeomFromText('${lineString}', 4326) AS geom
)${anchorsCte}, candidates AS (
  SELECT
    source.osm_type,
    source.osm_id,
    source.tags,
    CASE
      WHEN GeometryType(source.geom) IN ('POLYGON', 'MULTIPOLYGON') THEN ST_PointOnSurface(source.geom)
      ELSE source.geom
    END AS geom
  FROM postpass_pointpolygon AS source
  CROSS JOIN route${anchorJoin}
  WHERE source.geom && ST_Expand(route.geom, ${POSTPASS_PRACTICAL_PLACES_BBOX_EXPAND_DEGREES})
    AND (
    ${corridorBranch}${anchorBranch}
    )
)
SELECT
  osm_type, osm_id,
  tags->>'name' AS name,
  tags->>'amenity' AS amenity,
  tags->>'shop' AS shop,
  tags->>'opening_hours' AS opening_hours,
  tags->>'access' AS access,
  tags->>'fee' AS fee,
  tags->>'operator' AS operator,
  tags->>'brand' AS brand,
  tags->>'website' AS website,
  tags->>'contact:website' AS contact_website,
  tags->>'phone' AS phone,
  tags->>'contact:phone' AS contact_phone,
  tags->>'drinking_water' AS drinking_water,
  tags->>'wheelchair' AS wheelchair,
  tags->>'service:bicycle:repair' AS service_bicycle_repair,
  tags->>'service:bicycle:pump' AS service_bicycle_pump,
  geom
FROM candidates`
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

function osmType(value: unknown): PracticalPlaceCandidate['osmType'] | null {
  if (value === 'N') return 'node'
  if (value === 'W') return 'way'
  if (value === 'R') return 'relation'
  return null
}

/**
 * Client-side categorisation (CDC C2 sections 4-9) — the SQL query above
 * already narrows to just the tag combinations C2 cares about, so this only
 * ever needs to pick the right bucket, plus the one exclusion the query
 * cannot express cleanly in SQL: a toilet explicitly marked private/no
 * access (test M) is dropped outright, never merely hidden.
 */
function category(properties: Record<string, unknown>): PracticalPlaceCategory | null {
  const amenity = nonEmptyString(properties.amenity)
  const shop = nonEmptyString(properties.shop)
  if (amenity === 'drinking_water') return 'water'
  if (amenity === 'fountain' && nonEmptyString(properties.drinking_water) === 'yes') return 'water'
  if (amenity === 'shelter') return 'shelter'
  if (amenity === 'toilets') {
    const access = nonEmptyString(properties.access)
    return access === 'private' || access === 'no' ? null : 'toilet'
  }
  if (amenity === 'bicycle_repair_station' || shop === 'bicycle') return 'bike-service'
  if (shop === 'bakery') return 'bakery'
  if (shop === 'supermarket' || shop === 'convenience' || shop === 'grocery') return 'supermarket'
  return null
}

const USEFUL_TAG_COLUMNS: ReadonlyMap<string, string> = new Map([
  ['opening_hours', 'opening_hours'],
  ['access', 'access'],
  ['fee', 'fee'],
  ['operator', 'operator'],
  ['brand', 'brand'],
  ['website', 'website'],
  ['contact_website', 'contact:website'],
  ['phone', 'phone'],
  ['contact_phone', 'contact:phone'],
  ['drinking_water', 'drinking_water'],
  ['wheelchair', 'wheelchair'],
  ['service_bicycle_repair', 'service:bicycle:repair'],
  ['service_bicycle_pump', 'service:bicycle:pump'],
])

function parseFeature(value: unknown): PracticalPlaceCandidate | null {
  if (value === null || typeof value !== 'object') return null
  const feature = value as GeoJsonFeature
  if (feature.type !== 'Feature' || feature.geometry === null || typeof feature.geometry !== 'object' || feature.properties === null || typeof feature.properties !== 'object') return null
  const geometry = feature.geometry as { readonly type?: unknown; readonly coordinates?: unknown }
  const properties = feature.properties as Record<string, unknown>
  if (geometry.type !== 'Point' || !Array.isArray(geometry.coordinates)) return null
  const longitude = geometry.coordinates[0]
  const latitude = geometry.coordinates[1]
  const normalizedCategory = category(properties)
  const elementType = osmType(properties.osm_type)
  const id = typeof properties.osm_id === 'number' || typeof properties.osm_id === 'string' ? String(properties.osm_id) : null
  if (typeof latitude !== 'number' || typeof longitude !== 'number' || !validCoordinate(latitude, 90) || !validCoordinate(longitude, 180)
    || normalizedCategory === null || elementType === null || id === null) return null

  const usefulTags: Record<string, string> = {}
  for (const [column, tagKey] of USEFUL_TAG_COLUMNS) {
    const raw = nonEmptyString(properties[column])
    if (raw !== null) usefulTags[tagKey] = raw
  }

  return {
    osmType: elementType,
    osmId: id,
    category: normalizedCategory,
    name: nonEmptyString(properties.name),
    latitude,
    longitude,
    usefulTags,
  }
}

export function parsePostpassPracticalPlacesFeatureCollection(value: unknown): { readonly candidates: readonly PracticalPlaceCandidate[]; readonly rawCandidateCount: number } {
  if (value === null || typeof value !== 'object') throw new Error('Réponse GeoJSON Postpass invalide.')
  const collection = value as GeoJsonFeatureCollection
  if (collection.type !== 'FeatureCollection' || !Array.isArray(collection.features)) throw new Error('Réponse GeoJSON Postpass invalide.')
  return {
    candidates: collection.features.map(parseFeature).filter((candidate): candidate is PracticalPlaceCandidate => candidate !== null),
    rawCandidateCount: collection.features.length,
  }
}

/**
 * C2's automatic runtime provider (CDC section 2: Postpass only, never
 * Overpass) — one HTTP request per stage regardless of anchor count.
 */
export function createPostpassPracticalPlacesProvider(options: PostpassPracticalPlacesProviderOptions = {}): PracticalPlacesProvider {
  const endpoint = options.baseUrl ?? DEFAULT_POSTPASS_URL
  const fetchFn = options.fetchFn ?? fetch
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_POSTPASS_TIMEOUT_MS
  const now = options.now ?? (() => new Date().toISOString())
  const nowMs = options.nowMs ?? (() => performance.now())
  const emit = options.onDiagnostic ?? (() => undefined)

  return {
    id: 'postpass-practical-places',
    sourceType: 'osm',
    attribution: '© OpenStreetMap contributors · Postpass/Geofabrik',
    async findCandidates(search, externalSignal): Promise<PracticalPlacesResult> {
      const sql = buildPostpassPracticalPlacesQuery(search)
      const payloadBytes = new TextEncoder().encode(sql).byteLength
      const startedAt = now()
      const startedMs = nowMs()
      let status: number | null = null
      const baseDiagnostic = { stageId: search.stageId, routeFingerprint: search.routeFingerprint, anchorCount: search.anchors.length, payloadBytes, startedAt }
      emit({ stage: 'request', ...baseDiagnostic, finishedAt: null, durationMs: null, httpStatus: null, rawCandidateCount: null, message: null })
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
        emit({ stage: 'response', ...baseDiagnostic, finishedAt: responseAt, durationMs: Math.max(0, nowMs() - startedMs), httpStatus: status, rawCandidateCount: null, message: null })
        if (!response.ok) throw new PostpassHttpError(response.status)
        const parsed = parsePostpassPracticalPlacesFeatureCollection(await response.json())
        const finishedAt = now()
        const durationMs = Math.max(0, nowMs() - startedMs)
        emit({ stage: 'parsed', ...baseDiagnostic, finishedAt, durationMs, httpStatus: status, rawCandidateCount: parsed.rawCandidateCount, message: null })
        return { ...parsed, durationMs, httpStatus: status, payloadBytes, startedAt, finishedAt }
      } catch (error) {
        const timedOut = controller.signal.aborted && !externalSignal?.aborted
        const finalError = timedOut ? new Error(`Postpass n’a pas répondu dans le délai de ${requestTimeoutMs} ms.`) : error
        emit({
          stage: 'error', ...baseDiagnostic, finishedAt: now(), durationMs: Math.max(0, nowMs() - startedMs), httpStatus: status,
          rawCandidateCount: null, message: finalError instanceof Error ? finalError.message : String(finalError),
        })
        throw finalError
      } finally {
        clearTimeout(timeout)
        externalSignal?.removeEventListener('abort', abort)
      }
    },
  }
}
