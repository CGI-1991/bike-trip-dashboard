import type { Kilometers, Meters, Percent } from './common.ts'
import type { ClimbId, RouteId } from './ids.ts'
import type { DataProvenance } from './provenance.ts'

/** Detection confidence, per CDC section 13.6. */
export type ClimbConfidence = 'confirmed' | 'probable' | 'uncertain'

/** A detected climb (col, summit, or unnamed ascent) on a route. */
export interface Climb {
  readonly id: ClimbId
  readonly routeId: RouteId
  readonly name: string | null
  readonly startDistanceKm: Kilometers
  readonly endDistanceKm: Kilometers
  readonly elevationGainM: Meters
  readonly averageGradientPercent: Percent
  readonly maxGradientPercent: Percent | null
  readonly startAltitudeM: Meters | null
  readonly endAltitudeM: Meters | null
  readonly confidence: ClimbConfidence
  readonly provenance: DataProvenance
}
