import type { TripBundleSchemaVersion } from '../schema/version.ts'
import type { Accommodation } from './accommodation.ts'
import type { Climb } from './climb.ts'
import type { TripEnrichmentMetadata, TripGeneratedMetadata } from './generated-metadata.ts'
import type { TripOverride } from './overrides.ts'
import type { PracticalPlace } from './practical-place.ts'
import type { RideStage } from './ride-stage.ts'
import type { Route } from './route.ts'
import type { RoutePoint } from './route-point.ts'
import type { TripSettings } from './settings.ts'
import type { SourceFile } from './source-file.ts'
import type { TripCalendar } from './trip-calendar.ts'
import type { TripDay } from './trip-day.ts'
import type { TripMetadata } from './trip-metadata.ts'
import type { WeatherRecord } from './weather.ts'

/**
 * TripBundle v1 — the versioned, generic root of a trip.
 *
 * All collections are normalized (entities reference each other by id, never
 * nested/duplicated) and `readonly`, per CDC section 8. This phase defines
 * the shape only: no RGA data is ever assigned to it here.
 */
export interface TripBundleV1 {
  readonly schemaVersion: TripBundleSchemaVersion
  readonly metadata: TripMetadata
  readonly calendar: TripCalendar
  readonly days: readonly TripDay[]
  readonly stages: readonly RideStage[]
  readonly sourceFiles: readonly SourceFile[]
  readonly routes: readonly Route[]
  readonly climbs: readonly Climb[]
  readonly routePoints: readonly RoutePoint[]
  readonly practicalPlaces: readonly PracticalPlace[]
  readonly accommodations: readonly Accommodation[]
  readonly weather: readonly WeatherRecord[]
  readonly settings: TripSettings
  readonly overrides: readonly TripOverride[]
  readonly enrichmentMetadata: TripEnrichmentMetadata
  readonly generatedMetadata: TripGeneratedMetadata
}
