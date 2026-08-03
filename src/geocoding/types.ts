export interface GeocodingCoordinates {
  readonly latitude: number
  readonly longitude: number
}

export interface ReverseGeocodingResult {
  readonly name: string
  readonly sourceId: string | null
}

/** Provider boundary kept independent from GPX parsing and route analysis. */
export interface GeocodingProvider {
  readonly id: string
  readonly sourceType: 'osm'
  readonly attribution: string
  reverse(coordinates: GeocodingCoordinates, signal?: AbortSignal): Promise<ReverseGeocodingResult | null>
}
