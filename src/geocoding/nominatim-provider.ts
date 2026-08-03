import type { GeocodingCoordinates, GeocodingProvider, ReverseGeocodingResult } from './types.ts'
import { createSerialRateLimiter } from './rate-limiter.ts'

const DEFAULT_BASE_URL = 'https://nominatim.openstreetmap.org/reverse'
const DEFAULT_MINIMUM_INTERVAL_MS = 1_100

interface NominatimAddress {
  readonly city?: unknown
  readonly town?: unknown
  readonly village?: unknown
  readonly municipality?: unknown
  readonly hamlet?: unknown
  readonly suburb?: unknown
  readonly neighbourhood?: unknown
  readonly road?: unknown
  readonly county?: unknown
  readonly country?: unknown
}

interface NominatimResponse {
  readonly place_id?: unknown
  readonly osm_type?: unknown
  readonly osm_id?: unknown
  readonly name?: unknown
  readonly display_name?: unknown
  readonly address?: unknown
}

export interface NominatimProviderOptions {
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

function addressPart(address: NominatimAddress, keys: readonly (keyof NominatimAddress)[]): string | null {
  for (const key of keys) {
    const value = nonEmptyString(address[key])
    if (value !== null) return value
  }
  return null
}

/** Turns Nominatim's verbose address into a short stage endpoint label. */
export function shortNominatimName(payload: NominatimResponse): string | null {
  const address = payload.address !== null && typeof payload.address === 'object' ? payload.address as NominatimAddress : {}
  const locality = addressPart(address, ['city', 'town', 'village', 'municipality', 'hamlet', 'suburb', 'neighbourhood'])
  if (locality !== null) return locality

  const road = addressPart(address, ['road'])
  const area = addressPart(address, ['county', 'country'])
  if (road !== null && area !== null && road !== area) return `${road}, ${area}`
  if (road !== null) return road

  const explicitName = nonEmptyString(payload.name)
  if (explicitName !== null) return explicitName
  if (area !== null) return area

  const displayParts = nonEmptyString(payload.display_name)?.split(',').map((part) => part.trim()).filter(Boolean) ?? []
  return displayParts.length === 0 ? null : displayParts.slice(0, 2).join(', ')
}

function sourceId(payload: NominatimResponse): string | null {
  const osmType = nonEmptyString(payload.osm_type)
  const osmId = typeof payload.osm_id === 'string' || typeof payload.osm_id === 'number' ? String(payload.osm_id) : null
  if (osmType !== null && osmId !== null) return `nominatim:${osmType}:${osmId}`
  const placeId = typeof payload.place_id === 'string' || typeof payload.place_id === 'number' ? String(payload.place_id) : null
  return placeId === null ? null : `nominatim:place:${placeId}`
}

export function createNominatimGeocodingProvider(options: NominatimProviderOptions = {}): GeocodingProvider {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL
  const language = options.language ?? 'fr'
  const minimumIntervalMs = Math.max(0, options.minimumIntervalMs ?? DEFAULT_MINIMUM_INTERVAL_MS)
  const fetchFn = options.fetchFn ?? fetch
  const limiter = createSerialRateLimiter({
    minimumIntervalMs,
    nowMs: options.nowMs,
    sleep: options.sleep,
  })

  async function reverseOnce(coordinates: GeocodingCoordinates, signal?: AbortSignal): Promise<ReverseGeocodingResult | null> {
    const url = new URL(baseUrl)
    url.searchParams.set('format', 'jsonv2')
    url.searchParams.set('addressdetails', '1')
    url.searchParams.set('layer', 'address')
    url.searchParams.set('zoom', '15')
    url.searchParams.set('accept-language', language)
    url.searchParams.set('lat', String(coordinates.latitude))
    url.searchParams.set('lon', String(coordinates.longitude))

    const response = await fetchFn(url, { headers: { Accept: 'application/json' }, signal })
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`Nominatim a répondu avec le statut HTTP ${response.status}.`)

    const payload = await response.json() as NominatimResponse
    const name = shortNominatimName(payload)
    return name === null ? null : { name, sourceId: sourceId(payload) }
  }

  return {
    id: 'nominatim',
    sourceType: 'osm',
    attribution: '© OpenStreetMap contributors',
    reverse(coordinates, signal) {
      return limiter.run(() => reverseOnce(coordinates, signal))
    },
  }
}
