import type { Kilometers, KilometersPerHour, Meters, Seconds } from './common.ts'
import type {
  ClimbId,
  RideStageId,
  RouteId,
  RoutePointId,
  TripDayId,
  WeatherRecordId,
} from './ids.ts'
import type { DataProvenance } from './provenance.ts'

/** Generic validation lifecycle for a stage's computed content. */
export type RideStageValidationStatus = 'pending' | 'valid' | 'needs-review'

/**
 * A single day's ride. All computed fields are nullable — phase 2 defines the
 * shape only; nothing here is calculated by this phase (no GPX parsing, no
 * D+/D- computation, no ETA).
 */
export interface RideStage {
  readonly id: RideStageId
  readonly dayId: TripDayId
  readonly sourceRouteId: RouteId
  readonly name: string | null
  /**
   * Optional, user-chosen display name for this stage ("Étape reine",
   * "Boucle du col"…) — purely editorial. Deliberately NOT `name`, which is
   * the GPX track/segment name the parser read from the file and which a
   * re-import/structural edit legitimately overwrites; this one belongs to
   * the traveller and survives both. Optional/absent on historical records,
   * exactly like `TripDay.transferMode` — purely additive, no schema bump,
   * no migration. Absent, empty or whitespace-only means "no custom name":
   * every surface then falls back to its existing départ → arrivée label,
   * byte for byte. Never affects ids, start/end locations, GPX bytes or any
   * computed metric.
   */
  readonly customName?: string
  readonly startLocationName: string | null
  readonly endLocationName: string | null
  readonly distanceKm: Kilometers | null
  readonly elevationGainM: Meters | null
  readonly elevationLossM: Meters | null
  readonly minAltitudeM: Meters | null
  readonly maxAltitudeM: Meters | null
  readonly movingDurationSeconds: Seconds | null
  readonly pauseDurationSeconds: Seconds | null
  readonly totalDurationSeconds: Seconds | null
  readonly estimatedAverageSpeedKph: KilometersPerHour | null
  readonly validationStatus: RideStageValidationStatus
  /**
   * Provenance of `distanceKm`/`elevationGainM`/`elevationLossM` together —
   * the model has no per-field provenance, so these three always share one
   * origin (e.g. an editorial roadbook figure vs. a future GPX computation).
   * Required whenever any of the three is set; may stay `null` only when all
   * three are still `null`.
   */
  readonly metricsProvenance: DataProvenance | null
  readonly climbIds: readonly ClimbId[]
  readonly routePointIds: readonly RoutePointId[]
  readonly weatherRecordIds: readonly WeatherRecordId[]
}
