import { createSerialRateLimiter } from '../geocoding/rate-limiter.ts'
import { expandedRouteBoundingBox, formatOverpassBoundingBox } from './overpass-bbox.ts'
import type { OsmRouteFeatureCandidate, RouteEnrichmentKind, RouteEnrichmentProvider, RouteFeatureSearch, RouteFeatureType } from './types.ts'

const DEFAULT_BASE_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
] as const
const TRANSIENT_HTTP_STATUSES = new Set([429, 502, 503, 504])

interface OverpassElement {
  readonly type?: unknown
  readonly id?: unknown
  readonly lat?: unknown
  readonly lon?: unknown
  readonly center?: unknown
  readonly tags?: unknown
}

export interface OverpassRouteDiagnostic {
  readonly stage: 'request' | 'response' | 'retry' | 'parsed' | 'error'
  readonly endpoint: string
  readonly kind: RouteEnrichmentKind
  readonly query: string
  readonly attempt: number
  readonly httpStatus: number | null
  readonly rawElementCount: number | null
  readonly parsedCandidateCount: number | null
  readonly message: string | null
}

export interface OverpassRouteProviderOptions {
  readonly baseUrl?: string
  readonly baseUrls?: readonly string[]
  readonly language?: string
  readonly minimumIntervalMs?: number
  readonly retryBackoffMs?: number
  readonly requestTimeoutMs?: number
  readonly fetchFn?: typeof fetch
  readonly nowMs?: () => number
  readonly sleep?: (milliseconds: number) => Promise<void>
  readonly onDiagnostic?: (diagnostic: OverpassRouteDiagnostic) => void
}

class OverpassResponseError extends Error {
  readonly status: number
  constructor(status: number) {
    super(`Overpass a répondu avec le statut HTTP ${status}.`)
    this.status = status
  }
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

function featureType(tags: Record<string, unknown>): RouteFeatureType | null {
  if (tags.mountain_pass === 'yes') return 'mountain-pass'
  if (tags.natural === 'saddle') return 'saddle'
  if (tags.natural === 'peak') return 'peak'
  if (tags.place === 'city' || tags.place === 'town' || tags.place === 'village') return tags.place
  return null
}

function coordinates(element: OverpassElement): { readonly latitude: number; readonly longitude: number } | null {
  if (typeof element.lat === 'number' && typeof element.lon === 'number') return { latitude: element.lat, longitude: element.lon }
  if (element.center !== null && typeof element.center === 'object') {
    const center = element.center as { readonly lat?: unknown; readonly lon?: unknown }
    if (typeof center.lat === 'number' && typeof center.lon === 'number') return { latitude: center.lat, longitude: center.lon }
  }
  return null
}

function parseElevation(value: unknown): number | null {
  const text = nonEmptyString(value)
  if (text === null) return null
  const result = Number.parseFloat(text.replaceAll(' ', '').replace(',', '.'))
  return Number.isFinite(result) ? result : null
}

function parseCandidate(element: OverpassElement, language: string): OsmRouteFeatureCandidate | null {
  if (element.tags === null || typeof element.tags !== 'object') return null
  const tags = element.tags as Record<string, unknown>
  const type = featureType(tags)
  const position = coordinates(element)
  const osmType = element.type
  const osmId = typeof element.id === 'number' || typeof element.id === 'string' ? String(element.id) : null
  if (type === null || position === null || osmId === null || (osmType !== 'node' && osmType !== 'way' && osmType !== 'relation')) return null
  const usefulTags = Object.fromEntries(['mountain_pass', 'natural', 'place', 'ele'].flatMap((key) => {
    const value = nonEmptyString(tags[key])
    return value === null ? [] : [[key, value]]
  }))
  return {
    osmType,
    osmId,
    featureType: type,
    name: nonEmptyString(tags[`name:${language}`]) ?? nonEmptyString(tags.name),
    ...position,
    elevationM: parseElevation(tags.ele),
    usefulTags,
  }
}

export function buildOverpassRouteQuery(search: RouteFeatureSearch): string {
  const radius = Math.max(100, Math.min(2_000, Math.round(search.radiusMeters)))
  const bbox = formatOverpassBoundingBox(expandedRouteBoundingBox(search.geometry, radius))
  const filters = search.kind === 'localities'
    ? `nwr(${bbox})[place~"^(city|town|village)$"];`
    : `nwr(${bbox})[mountain_pass=yes];nwr(${bbox})[natural=saddle];nwr(${bbox})[natural=peak];`
  return `[out:json][timeout:10];(${filters});out body center;`
}

function transient(error: unknown): boolean {
  if (error instanceof OverpassResponseError) return TRANSIENT_HTTP_STATUSES.has(error.status)
  if (error instanceof DOMException && error.name === 'AbortError') return true
  return error instanceof TypeError
}

export function createOverpassRouteEnrichmentProvider(options: OverpassRouteProviderOptions = {}): RouteEnrichmentProvider {
  const endpoints = [...new Set([
    ...(options.baseUrl === undefined ? [] : [options.baseUrl]),
    ...(options.baseUrls ?? DEFAULT_BASE_URLS),
  ].filter((endpoint) => endpoint.trim() !== ''))].slice(0, 2)
  if (endpoints.length === 0) throw new Error('Aucun endpoint Overpass configuré.')
  const fetchFn = options.fetchFn ?? fetch
  const language = options.language ?? 'fr'
  const sleep = options.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)))
  const backoffMs = options.retryBackoffMs ?? 750
  const requestTimeoutMs = options.requestTimeoutMs ?? 13_000
  const emit = options.onDiagnostic ?? (() => undefined)
  const limiter = createSerialRateLimiter({ minimumIntervalMs: options.minimumIntervalMs ?? 1_100, nowMs: options.nowMs, sleep })

  return {
    id: 'overpass-osm-route-enrichment',
    sourceType: 'osm',
    attribution: '© OpenStreetMap contributors',
    async findCandidates(search, externalSignal) {
      const query = buildOverpassRouteQuery(search)
      for (let attempt = 0; attempt < endpoints.length; attempt++) {
        const endpoint = endpoints[attempt] as string
        let status: number | null = null
        try {
          const elements = await limiter.run(async () => {
            emit({ stage: 'request', endpoint, kind: search.kind, query, attempt, httpStatus: null, rawElementCount: null, parsedCandidateCount: null, message: null })
            const controller = new AbortController()
            const timeout = setTimeout(() => controller.abort(), requestTimeoutMs)
            const abort = () => controller.abort()
            externalSignal?.addEventListener('abort', abort, { once: true })
            try {
              const response = await fetchFn(endpoint, {
                method: 'POST',
                headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
                body: new URLSearchParams({ data: query }),
                signal: controller.signal,
              })
              status = response.status
              emit({ stage: 'response', endpoint, kind: search.kind, query, attempt, httpStatus: status, rawElementCount: null, parsedCandidateCount: null, message: null })
              if (!response.ok) throw new OverpassResponseError(response.status)
              const payload = await response.json() as { readonly elements?: unknown }
              if (!Array.isArray(payload.elements)) throw new Error('Réponse Overpass invalide.')
              return payload.elements as readonly OverpassElement[]
            } finally {
              clearTimeout(timeout)
              externalSignal?.removeEventListener('abort', abort)
            }
          })
          const candidates = elements.map((element) => parseCandidate(element, language)).filter((candidate): candidate is OsmRouteFeatureCandidate => candidate !== null)
          emit({ stage: 'parsed', endpoint, kind: search.kind, query, attempt, httpStatus: status, rawElementCount: elements.length, parsedCandidateCount: candidates.length, message: null })
          return candidates
        } catch (error) {
          if (externalSignal?.aborted) throw error
          if (attempt + 1 < endpoints.length && transient(error)) {
            emit({ stage: 'retry', endpoint, kind: search.kind, query, attempt, httpStatus: status, rawElementCount: null, parsedCandidateCount: null, message: error instanceof Error ? error.message : String(error) })
            await sleep(backoffMs * (attempt + 1))
            continue
          }
          emit({ stage: 'error', endpoint, kind: search.kind, query, attempt, httpStatus: status, rawElementCount: null, parsedCandidateCount: null, message: error instanceof Error ? error.message : String(error) })
          throw error
        }
      }
      return []
    },
  }
}
