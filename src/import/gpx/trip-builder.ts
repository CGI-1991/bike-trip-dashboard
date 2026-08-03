/**
 * Assembles the final `TripBundle` root (metadata/calendar/settings/
 * enrichment/generated-metadata) around the per-file stages/days/routes
 * already built. CDC section 14/16: a trip with no `startDate` gets an
 * undated calendar (`TripDay.date` stays `null` for every day, never a
 * synthetic one); a trip with a `startDate` gets one consecutive civil day
 * per ride day, starting at `startDate`.
 */

import type {
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
}

function asIsoDate(value: string): IsoDate {
  return value as IsoDate
}

export function assembleTripBundle(input: TripBuilderInput): TripBundle {
  const { options, sourceFiles, routes, routePoints, stages, days } = input
  const dated = options.startDate !== null
  const endDate = dated && days.length > 0 ? asIsoDate(addCivilDays(options.startDate as string, days.length - 1)) : null
  const startDate = dated ? asIsoDate(options.startDate as string) : null
  const timezone = dated ? options.timezone : null

  const dayTripDaySettings: readonly TripDaySettings[] = days.map((day) => ({
    dayId: day.id,
    departureTime: options.departureTime,
    totalBreakSeconds: options.totalBreakMinutes * 60,
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
    climbs: [],
    routePoints,
    practicalPlaces: [],
    accommodations: [],
    weather: [],
    settings: {
      global: { referenceSpeedKph: options.referenceSpeedKph, pausePlanMode: 'automatic' },
      days: dayTripDaySettings,
      stages: [],
    },
    overrides: [],
    enrichmentMetadata: { providers: [] },
    generatedMetadata: {
      engineVersion: options.engineVersion,
      generatedAt: options.importedAt,
      derivedDataStatus: 'partial',
    },
  }
}
