/**
 * The relief tier of a stretch of road, from its elevation gain per
 * kilometre.
 *
 * This is the whole of what survives of the old "Terrain" concept. The
 * Normal/Montagne selector that used to sit on top of it is gone: it was a
 * display-level re-classification that hid detected climbs, and deciding
 * which climbs exist is now the job of the trip's 5-step detection
 * sensitivity (`climb-detection.ts::CLIMB_SENSITIVITY_TUNINGS`), which acts
 * on the detection itself.
 *
 * What remains is used by detection alone, to adapt the dip-merge tolerance
 * to the relief a stage actually has — never to hide anything.
 */

export type TripTerrainLabel = 'rolling' | 'mixed' | 'mountain'

/**
 * A local, honestly-approximate rolling/mixed/alpine boundary, not a precise
 * classification.
 */
const MOUNTAIN_THRESHOLD_M_PER_KM = 18
const MIXED_THRESHOLD_M_PER_KM = 10

export function deriveTerrainLabelFromElevationGainPerKm(elevationGainPerKm: number): TripTerrainLabel {
  if (elevationGainPerKm >= MOUNTAIN_THRESHOLD_M_PER_KM) return 'mountain'
  if (elevationGainPerKm >= MIXED_THRESHOLD_M_PER_KM) return 'mixed'
  return 'rolling'
}
