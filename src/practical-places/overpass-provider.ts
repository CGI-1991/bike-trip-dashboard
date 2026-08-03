import { createSerialRateLimiter } from '../geocoding/rate-limiter.ts'
import { expandedRouteBoundingBox, formatOverpassBoundingBox } from '../route-enrichment/overpass-bbox.ts'
import type { PracticalPlaceCandidate, PracticalPlacesProvider, PracticalPlacesSearch } from './types.ts'

const DEFAULT_BASE_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
] as const
const DEFAULT_MINIMUM_INTERVAL_MS = 1_100

interface OverpassElement {
  readonly type?: unknown
  readonly id?: unknown
  readonly lat?: unknown
  readonly lon?: unknown
  readonly center?: unknown
  readonly tags?: unknown
}

interface OverpassPayload {
  readonly elements?: unknown
}

export interface OverpassPracticalPlacesProviderOptions {
  readonly baseUrl?: string
  readonly baseUrls?: readonly string[]
  readonly language?: string
  readonly minimumIntervalMs?: number
  readonly fetchFn?: typeof fetch
  readonly nowMs?: () => number
  readonly sleep?: (milliseconds: number) => Promise<void>
  readonly retryBackoffMs?: number
  readonly requestTimeoutMs?: number
  readonly onDiagnostic?: (diagnostic: OverpassPracticalPlacesDiagnostic) => void
}

export interface OverpassPracticalPlacesDiagnostic {
  readonly stage: 'request' | 'response' | 'retry' | 'parsed' | 'error'
  readonly endpoint: string
  readonly query: string
  readonly queryLength: number
  readonly attempt: number
  readonly httpStatus: number | null
  readonly rawElementCount: number | null
  readonly parsedCandidateCount: number | null
  readonly message: string | null
}

class OverpassResponseError extends Error {
  readonly status: number
  constructor(status: number) {
    super(`Overpass a répondu avec le statut HTTP ${status}.`)
    this.status = status
  }
}

function isTransient(error: unknown): boolean {
  if (error instanceof OverpassResponseError) return [429, 502, 503, 504].includes(error.status)
  if (error instanceof DOMException && error.name === 'AbortError') return true
  return error instanceof TypeError
}

const USEFUL_TAG_KEYS = new Set([
  'amenity', 'shop', 'opening_hours', 'access', 'fee', 'drinking_water', 'operator', 'brand',
  'cuisine', 'wheelchair', 'toilets:wheelchair', 'self_service', 'service:bicycle:repair',
  'service:bicycle:pump', 'phone', 'contact:phone', 'website', 'contact:website',
])

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

export function buildOverpassPracticalPlacesQuery(search: PracticalPlacesSearch): string {
  const radius = Math.max(100, Math.min(500, Math.round(search.radiusMeters)))
  const bbox = formatOverpassBoundingBox(expandedRouteBoundingBox(search.geometry, radius))
  return `[out:json][timeout:10];(`
    + `nwr(${bbox})[amenity~"^(drinking_water|restaurant|fast_food|shelter|toilets|bicycle_repair_station)$"];`
    + `nwr(${bbox})[shop~"^(bakery|supermarket|convenience|grocery|greengrocer|deli|bicycle|sports)$"];`
    // `tags` omits node coordinates; `body center` keeps node lat/lon and
    // adds a center for ways/relations, which the parser needs for every POI.
    + ');out body center;'
}

function category(tags: Record<string, unknown>): PracticalPlaceCandidate['category'] | null {
  if (tags.amenity === 'drinking_water') return 'water'
  if (tags.amenity === 'toilets') return 'toilet'
  if (tags.amenity === 'bicycle_repair_station' || tags.shop === 'bicycle') return 'bike-service'
  if (tags.amenity === 'shelter') return 'shelter'
  if (tags.shop === 'bakery') return 'bakery'
  if (tags.amenity === 'restaurant' || tags.amenity === 'fast_food') return 'fast-food'
  if (tags.shop === 'sports') return 'sports'
  if (['supermarket', 'convenience', 'grocery', 'greengrocer', 'deli'].includes(String(tags.shop))) return 'supermarket'
  return null
}

function coordinates(element: OverpassElement): { readonly latitude: number; readonly longitude: number } | null {
  if (typeof element.lat === 'number' && typeof element.lon === 'number') {
    return { latitude: element.lat, longitude: element.lon }
  }
  if (element.center !== null && typeof element.center === 'object') {
    const center = element.center as { readonly lat?: unknown; readonly lon?: unknown }
    if (typeof center.lat === 'number' && typeof center.lon === 'number') {
      return { latitude: center.lat, longitude: center.lon }
    }
  }
  return null
}

function parseCandidate(element: OverpassElement, language: string): PracticalPlaceCandidate | null {
  if (element.tags === null || typeof element.tags !== 'object') return null
  const tags = element.tags as Record<string, unknown>
  const normalizedCategory = category(tags)
  const position = coordinates(element)
  const osmType = element.type
  const osmId = typeof element.id === 'number' || typeof element.id === 'string' ? String(element.id) : null
  if ((osmType !== 'node' && osmType !== 'way' && osmType !== 'relation') || osmId === null || normalizedCategory === null || position === null) return null

  const usefulTags = Object.fromEntries(Object.entries(tags)
    .filter(([key, value]) => USEFUL_TAG_KEYS.has(key) && nonEmptyString(value) !== null)
    .map(([key, value]) => [key, nonEmptyString(value) as string]))
  return {
    osmType,
    osmId,
    category: normalizedCategory,
    name: nonEmptyString(tags[`name:${language}`]) ?? nonEmptyString(tags.name) ?? nonEmptyString(tags.brand),
    ...position,
    usefulTags,
  }
}

export function createOverpassPracticalPlacesProvider(options: OverpassPracticalPlacesProviderOptions = {}): PracticalPlacesProvider {
  const endpoints = [...new Set([
    ...(options.baseUrl === undefined ? [] : [options.baseUrl]),
    ...(options.baseUrls ?? DEFAULT_BASE_URLS),
  ].filter((endpoint) => endpoint.trim() !== ''))].slice(0, 2)
  if (endpoints.length === 0) throw new Error('Aucun endpoint Overpass configuré.')
  const language = options.language ?? 'fr'
  const fetchFn = options.fetchFn ?? fetch
  const emitDiagnostic = options.onDiagnostic ?? (() => undefined)
  const sleep = options.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)))
  const retryBackoffMs = options.retryBackoffMs ?? 750
  const requestTimeoutMs = options.requestTimeoutMs ?? 13_000
  const limiter = createSerialRateLimiter({
    minimumIntervalMs: options.minimumIntervalMs ?? DEFAULT_MINIMUM_INTERVAL_MS,
    nowMs: options.nowMs,
    sleep,
  })

  return {
    id: 'overpass-osm-practical-places',
    sourceType: 'osm',
    attribution: '© OpenStreetMap contributors',
    async findCandidates(search, signal) {
      const query = buildOverpassPracticalPlacesQuery(search)
      for (let attempt = 0; attempt < endpoints.length; attempt++) {
        const endpoint = endpoints[attempt] as string
        const diagnosticBase = { endpoint, query, queryLength: query.length, attempt }
        let httpStatus: number | null = null
        try {
          const response = await limiter.run(async () => {
            emitDiagnostic({ stage: 'request', ...diagnosticBase, httpStatus: null, rawElementCount: null, parsedCandidateCount: null, message: null })
            const controller = new AbortController()
            const timeout = setTimeout(() => controller.abort(), requestTimeoutMs)
            const abort = () => controller.abort()
            signal?.addEventListener('abort', abort, { once: true })
            try {
              return await fetchFn(endpoint, {
                method: 'POST',
                headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
                body: new URLSearchParams({ data: query }),
                signal: controller.signal,
              })
            } finally {
              clearTimeout(timeout)
              signal?.removeEventListener('abort', abort)
            }
          })
          httpStatus = response.status
          emitDiagnostic({ stage: 'response', ...diagnosticBase, httpStatus: response.status, rawElementCount: null, parsedCandidateCount: null, message: null })
          if (!response.ok) throw new OverpassResponseError(response.status)
          const payload = await response.json() as OverpassPayload
          if (!Array.isArray(payload.elements)) throw new Error('Réponse Overpass invalide.')
          const candidates = payload.elements
            .map((element) => parseCandidate(element as OverpassElement, language))
            .filter((candidate): candidate is PracticalPlaceCandidate => candidate !== null)
          emitDiagnostic({ stage: 'parsed', ...diagnosticBase, httpStatus: response.status, rawElementCount: payload.elements.length, parsedCandidateCount: candidates.length, message: null })
          return candidates
        } catch (error) {
          if (!signal?.aborted && attempt + 1 < endpoints.length && isTransient(error)) {
            emitDiagnostic({ stage: 'retry', ...diagnosticBase, httpStatus, rawElementCount: null, parsedCandidateCount: null, message: error instanceof Error ? error.message : String(error) })
            await sleep(retryBackoffMs * (attempt + 1))
            continue
          }
          emitDiagnostic({ stage: 'error', ...diagnosticBase, httpStatus, rawElementCount: null, parsedCandidateCount: null, message: error instanceof Error ? error.message : String(error) })
          throw error
        }
      }
      return []
    },
  }
}
