import { createSerialRateLimiter } from '../geocoding/rate-limiter.ts'
import type { ClimbFeatureType, ClimbNameCandidate, ClimbNameProvider, ClimbSummitSearch } from './types.ts'

const DEFAULT_BASE_URL = 'https://overpass-api.de/api/interpreter'
const DEFAULT_MINIMUM_INTERVAL_MS = 1_100

interface OverpassElement {
  readonly type?: unknown
  readonly id?: unknown
  readonly lat?: unknown
  readonly lon?: unknown
  readonly tags?: unknown
}

interface OverpassPayload {
  readonly elements?: unknown
}

export interface OverpassClimbNameProviderOptions {
  readonly baseUrl?: string
  readonly language?: string
  readonly minimumIntervalMs?: number
  readonly fetchFn?: typeof fetch
  readonly nowMs?: () => number
  readonly sleep?: (milliseconds: number) => Promise<void>
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function featureType(tags: Record<string, unknown>): ClimbFeatureType | null {
  if (nonEmptyString(tags.mountain_pass) !== null) return 'mountain-pass'
  if (tags.natural === 'saddle') return 'saddle'
  if (tags.natural === 'peak') return 'peak'
  return null
}

function elevation(tags: Record<string, unknown>): number | null {
  const raw = nonEmptyString(tags.ele)
  if (raw === null) return null
  const parsed = Number.parseFloat(raw.replaceAll(' ', '').replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

function parseCandidate(element: OverpassElement, language: string): ClimbNameCandidate | null {
  if (element.tags === null || typeof element.tags !== 'object') return null
  const tags = element.tags as Record<string, unknown>
  const kind = featureType(tags)
  const name = nonEmptyString(tags[`name:${language}`]) ?? nonEmptyString(tags.name)
  if (kind === null || name === null || typeof element.lat !== 'number' || typeof element.lon !== 'number') return null
  const elementType = nonEmptyString(element.type)
  const elementId = typeof element.id === 'number' || typeof element.id === 'string' ? String(element.id) : null
  if (elementType === null || elementId === null) return null
  return {
    name,
    featureType: kind,
    sourceId: `overpass-osm:${kind}:${elementType}:${elementId}`,
    coordinates: { latitude: element.lat, longitude: element.lon },
    elevationM: elevation(tags),
  }
}

export function buildOverpassClimbQuery(search: ClimbSummitSearch): string {
  const radius = Math.max(50, Math.min(1_000, Math.round(search.radiusMeters)))
  const location = `${radius},${search.coordinates.latitude},${search.coordinates.longitude}`
  return `[out:json][timeout:15];(node(around:${location})[name][mountain_pass];node(around:${location})[name][natural=saddle];node(around:${location})[name][natural=peak];);out body;`
}

export function createOverpassClimbNameProvider(options: OverpassClimbNameProviderOptions = {}): ClimbNameProvider {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL
  const language = options.language ?? 'fr'
  const fetchFn = options.fetchFn ?? fetch
  const limiter = createSerialRateLimiter({
    minimumIntervalMs: options.minimumIntervalMs ?? DEFAULT_MINIMUM_INTERVAL_MS,
    nowMs: options.nowMs,
    sleep: options.sleep,
  })

  return {
    id: 'overpass-osm-climb-names',
    sourceType: 'osm',
    attribution: '© OpenStreetMap contributors',
    findCandidates(search, signal) {
      return limiter.run(async () => {
        const body = new URLSearchParams({ data: buildOverpassClimbQuery(search) })
        const response = await fetchFn(baseUrl, {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
          body,
          signal,
        })
        if (!response.ok) throw new Error(`Overpass a répondu avec le statut HTTP ${response.status}.`)
        const payload = await response.json() as OverpassPayload
        if (!Array.isArray(payload.elements)) throw new Error('Réponse Overpass invalide.')
        return payload.elements
          .map((element) => parseCandidate(element as OverpassElement, language))
          .filter((candidate): candidate is ClimbNameCandidate => candidate !== null)
      })
    },
  }
}
