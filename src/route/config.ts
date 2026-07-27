export interface SlopeSpeedBand {
  readonly maximumSlopePercent: number
  readonly speedMultiplier: number
}

export interface PauseRule {
  readonly id: string
  readonly name: string
  readonly routeFraction: number
  readonly durationShare: number
}

export interface RouteEngineConfig {
  readonly slopeWindowKm: number
  readonly slopeClampPercent: number
  readonly slopeSpeedBands: readonly SlopeSpeedBand[]
  readonly timeMarkerReferenceSpeedKph: number
  readonly timeMarkerIntervalMinutes: number
  readonly timeMarkerDedupeMinutes: number
  readonly featureSampleDistanceKm: number
  readonly featureLookaroundKm: number
  readonly featureProminenceM: number
  readonly featureMinimumSpacingKm: number
  readonly slopeChangeMinimumDeltaPercent: number
  readonly slopeChangeMinimumBandJump: number
  readonly slopeChangeMinimumSpacingKm: number
  readonly continuityToleranceKm: number
  readonly pauseRules: readonly PauseRule[]
}

export const routeEngineConfig: RouteEngineConfig = {
  slopeWindowKm: 0.5,
  slopeClampPercent: 20,
  slopeSpeedBands: [
    { maximumSlopePercent: -8, speedMultiplier: 1.45 },
    { maximumSlopePercent: -3, speedMultiplier: 1.2 },
    { maximumSlopePercent: 3, speedMultiplier: 1 },
    { maximumSlopePercent: 6, speedMultiplier: 0.78 },
    { maximumSlopePercent: 9, speedMultiplier: 0.58 },
    { maximumSlopePercent: Number.POSITIVE_INFINITY, speedMultiplier: 0.42 },
  ],
  timeMarkerReferenceSpeedKph: 18,
  // 7.5 weighted km: 30 min at 15 km/h and about 20.5 min at 22 km/h.
  timeMarkerIntervalMinutes: 25,
  timeMarkerDedupeMinutes: 0,
  featureSampleDistanceKm: 0.5,
  featureLookaroundKm: 1.5,
  featureProminenceM: 75,
  featureMinimumSpacingKm: 2,
  slopeChangeMinimumDeltaPercent: 5,
  slopeChangeMinimumBandJump: 2,
  slopeChangeMinimumSpacingKm: 3,
  continuityToleranceKm: 0.1,
  pauseRules: [
    { id: 'morning', name: 'Pause du matin', routeFraction: 0.25, durationShare: 0.25 },
    { id: 'main', name: 'Pause principale', routeFraction: 0.5, durationShare: 0.5 },
    {
      id: 'afternoon',
      name: 'Pause de l’après-midi',
      routeFraction: 0.75,
      durationShare: 0.25,
    },
  ],
}
