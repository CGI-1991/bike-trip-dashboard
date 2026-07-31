import type { IsoDate, IsoDateTime } from './common.ts'
import type { RoutePointId, TripDayId, WeatherRecordId } from './ids.ts'
import type { DataProvenance } from './provenance.ts'

/**
 * A single normalized weather sample for one location and one forecast
 * instant, tied to the day and (when applicable) the route point it was
 * generated for. This is a minimal generic placeholder for phase 2 — it does
 * not replace or reimplement `src/weather/*`, which keeps serving the legacy
 * trip pipeline.
 */
export interface WeatherRecord {
  readonly id: WeatherRecordId
  readonly dayId: TripDayId
  readonly routePointId: RoutePointId | null
  readonly forDate: IsoDate
  readonly forecastAt: IsoDateTime | null
  readonly temperatureMinC: number | null
  readonly temperatureMaxC: number | null
  readonly precipitationMm: number | null
  readonly windSpeedKph: number | null
  readonly weatherCode: number | null
  readonly provenance: DataProvenance
}
