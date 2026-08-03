import { createSerialRateLimiter } from '../geocoding/rate-limiter.ts'
import type { PracticalPlaceCandidate, PracticalPlacesProvider, PracticalPlacesSearch } from './types.ts'

const DEFAULT_BASE_URL = 'https://overpass-api.de/api/interpreter'
const DEFAULT_MINIMUM_INTERVAL_MS = 1_100
const MAX_QUERY_POINTS = 80

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
  readonly language?: string
  readonly minimumIntervalMs?: number
  readonly fetchFn?: typeof fetch
  readonly nowMs?: () => number
  readonly sleep?: (milliseconds: number) => Promise<void>
  readonly onDiagnostic?: (diagnostic: OverpassPracticalPlacesDiagnostic) => void
}

export interface OverpassPracticalPlacesDiagnostic {
  readonly stage: 'request' | 'response' | 'parsed' | 'error'
  readonly endpoint: string
  readonly query: string
  readonly queryLength: number
  readonly httpStatus: number | null
  readonly rawElementCount: number | null
  readonly parsedCandidateCount: number | null
  readonly message: string | null
}

const USEFUL_TAG_KEYS = new Set([
  'amenity', 'shop', 'opening_hours', 'access', 'fee', 'drinking_water', 'operator', 'brand',
  'cuisine', 'wheelchair', 'toilets:wheelchair', 'self_service', 'service:bicycle:repair',
  'service:bicycle:pump', 'phone', 'contact:phone', 'website', 'contact:website',
])

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function sampleGeometry(search: PracticalPlacesSearch): readonly PracticalPlacesSearch['geometry'][number][] {
  if (search.geometry.length <= MAX_QUERY_POINTS) return search.geometry
  const result = []
  for (let index = 0; index < MAX_QUERY_POINTS; index++) {
    const sourceIndex = Math.round(index * (search.geometry.length - 1) / (MAX_QUERY_POINTS - 1))
    const point = search.geometry[sourceIndex]
    if (point !== undefined) result.push(point)
  }
  return result
}

export function buildOverpassPracticalPlacesQuery(search: PracticalPlacesSearch): string {
  const radius = Math.max(100, Math.min(500, Math.round(search.radiusMeters)))
  const polyline = sampleGeometry(search).map((point) => `${point.latitude},${point.longitude}`).join(',')
  const around = `${radius},${polyline}`
  return `[out:json][timeout:25];(`
    + `nwr(around:${around})[amenity~"^(drinking_water|cafe|restaurant|fast_food|toilets|bicycle_repair_station)$"];`
    + `nwr(around:${around})[shop~"^(bakery|supermarket|convenience|grocery|greengrocer|deli|bicycle)$"];`
    // `tags` omits node coordinates; `body center` keeps node lat/lon and
    // adds a center for ways/relations, which the parser needs for every POI.
    + ');out body center;'
}

function category(tags: Record<string, unknown>): PracticalPlaceCandidate['category'] | null {
  if (tags.amenity === 'drinking_water') return 'water'
  if (tags.amenity === 'toilets') return 'toilet'
  if (tags.amenity === 'bicycle_repair_station' || tags.shop === 'bicycle') return 'bike-service'
  if (tags.shop === 'bakery') return 'bakery'
  if (tags.amenity === 'cafe') return 'cafe-or-ice-cream'
  if (tags.amenity === 'restaurant' || tags.amenity === 'fast_food') return 'fast-food'
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
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL
  const language = options.language ?? 'fr'
  const fetchFn = options.fetchFn ?? fetch
  const emitDiagnostic = options.onDiagnostic ?? (() => undefined)
  const limiter = createSerialRateLimiter({
    minimumIntervalMs: options.minimumIntervalMs ?? DEFAULT_MINIMUM_INTERVAL_MS,
    nowMs: options.nowMs,
    sleep: options.sleep,
  })

  return {
    id: 'overpass-osm-practical-places',
    sourceType: 'osm',
    attribution: '© OpenStreetMap contributors',
    findCandidates(search, signal) {
      return limiter.run(async () => {
        const query = buildOverpassPracticalPlacesQuery(search)
        const diagnosticBase = { endpoint: baseUrl, query, queryLength: query.length }
        let httpStatus: number | null = null
        emitDiagnostic({ stage: 'request', ...diagnosticBase, httpStatus: null, rawElementCount: null, parsedCandidateCount: null, message: null })
        try {
          const body = new URLSearchParams({ data: query })
          const response = await fetchFn(baseUrl, {
            method: 'POST',
            headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
            body,
            signal,
          })
          httpStatus = response.status
          emitDiagnostic({ stage: 'response', ...diagnosticBase, httpStatus: response.status, rawElementCount: null, parsedCandidateCount: null, message: null })
          if (!response.ok) throw new Error(`Overpass a répondu avec le statut HTTP ${response.status}.`)
          const payload = await response.json() as OverpassPayload
          if (!Array.isArray(payload.elements)) throw new Error('Réponse Overpass invalide.')
          const candidates = payload.elements
            .map((element) => parseCandidate(element as OverpassElement, language))
            .filter((candidate): candidate is PracticalPlaceCandidate => candidate !== null)
          emitDiagnostic({ stage: 'parsed', ...diagnosticBase, httpStatus: response.status, rawElementCount: payload.elements.length, parsedCandidateCount: candidates.length, message: null })
          return candidates
        } catch (error) {
          emitDiagnostic({ stage: 'error', ...diagnosticBase, httpStatus, rawElementCount: null, parsedCandidateCount: null, message: error instanceof Error ? error.message : String(error) })
          throw error
        }
      })
    },
  }
}
