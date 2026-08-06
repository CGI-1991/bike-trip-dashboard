/**
 * Assembles the final `TripBundle` root (metadata/calendar/settings/
 * enrichment/generated-metadata) around the per-file stages/days/routes
 * already built. CDC section 14/16: a trip with no `startDate` gets an
 * undated calendar (`TripDay.date` stays `null` for every day, never a
 * synthetic one); a trip with a `startDate` gets one consecutive civil day
 * per ride day, starting at `startDate`.
 */

import type {
  Climb,
  RideStage,
  Route,
  RoutePoint,
  SourceFile,
  TripBundle,
  TripDay,
  TripDaySettings,
} from '../../trip-core/index.ts'
import { CURRENT_TRIP_BUNDLE_SCHEMA_VERSION } from '../../trip-core/index.ts'
import type { IsoDate } from '../../trip-core/model/common.ts'
import { addCivilDays } from '../../trip-core/validation/primitives.ts'
import type { ResolvedGpxTripImportOptions } from './types.ts'

export interface TripBuilderInput {
  readonly options: ResolvedGpxTripImportOptions
  readonly sourceFiles: readonly SourceFile[]
  readonly routes: readonly Route[]
  readonly routePoints: readonly RoutePoint[]
  readonly stages: readonly RideStage[]
  readonly days: readonly TripDay[]
  readonly climbs: readonly Climb[]
}

function asIsoDate(value: string): IsoDate {
  return value as IsoDate
}

export function assembleTripBundle(input: TripBuilderInput): TripBundle {
  const { options, sourceFiles, routes, routePoints, stages, days, climbs } = input
  const dated = options.startDate !== null
  const endDate = dated && days.length > 0 ? asIsoDate(addCivilDays(options.startDate as string, days.length - 1)) : null
  const startDate = dated ? asIsoDate(options.startDate as string) : null
  const timezone = dated ? options.timezone : null

  // Each day's own stage already carries its actual, resolved pause budget
  // (`pauseDurationSeconds` — a fixed value or `estimateAutomaticBreakBudget`'s
  // per-stage result, see `route-analysis.ts`) — read it back rather than
  // recomputing from `options.totalBreakMinutes`, which is not even a plain
  // number when adaptive pauses are requested.
  const dayTripDaySettings: readonly TripDaySettings[] = days.map((day, index) => ({
    dayId: day.id,
    departureTime: options.departureTime,
    totalBreakSeconds: stages[index]?.pauseDurationSeconds ?? null,
  }))

  return {
    schemaVersion: CURRENT_TRIP_BUNDLE_SCHEMA_VERSION,
    metadata: {
      id: options.tripId,
      slug: options.slug,
      name: options.name,
      description: null,
      createdAt: options.importedAt,
      updatedAt: options.importedAt,
      startDate,
      endDate,
      timezone,
      language: options.language,
      units: options.units,
      status: dated ? 'ready' : 'draft',
      schemaVersion: CURRENT_TRIP_BUNDLE_SCHEMA_VERSION,
      engineVersion: options.engineVersion,
    },
    calendar: { startDate, endDate, timezone },
    days,
    stages,
    sourceFiles,
    routes,
    climbs,
    routePoints,
    practicalPlaces: [],
    accommodations: [],
    weather: [],
    settings: {
      global: { referenceSpeedKph: options.referenceSpeedKph, pausePlanMode: 'automatic', mountainMode: options.mountainMode },
      days: dayTripDaySettings,
      stages: [],
    },
    overrides: [],
    enrichmentMetadata: { providers: [] },
    generatedMetadata: {
      engineVersion: options.engineVersion,
      generatedAt: options.importedAt,
      // Every locally-derivable domain this engine currently covers
      // (distance, D+/D-, profile, climbs, durations/ETA) has just been
      // computed — 'partial' would describe local computation itself being
      // incomplete, which it is not; only *enrichment* (OSM/weather, a
      // separate concept tracked by `enrichmentMetadata`) is still absent.
      derivedDataStatus: 'fresh',
    },
  }
}
