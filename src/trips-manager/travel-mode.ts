import type { TravelMode } from '../trip-core/index.ts'

/** Reference pace on level, regular ground; terrain is applied afterwards. */
export const TRAVEL_MODE_SETTINGS = {
  cycling: { label: 'Vélo', referenceSpeedKph: 18, minimumSpeedKph: 8, maximumSpeedKph: 40 },
  walking: { label: 'Randonnée', referenceSpeedKph: 4.5, minimumSpeedKph: 2, maximumSpeedKph: 7 },
} as const

export function isTravelMode(value: unknown): value is TravelMode { return value === 'cycling' || value === 'walking' }
