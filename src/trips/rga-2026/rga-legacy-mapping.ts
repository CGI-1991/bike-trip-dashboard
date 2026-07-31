import { parseGpxFileNumber } from '../../gpx/load.ts'
import { getAccommodationMapsUrl } from '../../trip/accommodations.ts'
import type { Accommodation as LegacyAccommodation } from '../../trip/accommodations.ts'
import type { PracticalData, PracticalIconKey, PracticalPoint } from '../../practical/model.ts'
import type { RoadbookDocument, RoadbookOverridesDocument } from '../../trip/roadbook-types.ts'
import {
  accommodationId,
  practicalPlaceId,
  rideStageId,
  routeId,
  routePointId,
  sourceFileId,
  tripDayId,
  tripId,
} from '../../trip-core/model/ids.ts'
import type {
  Accommodation,
  AccommodationId,
  DataProvenance,
  GlobalTripSettings,
  IsoDate,
  PracticalPlace,
  PracticalPlaceCategory,
  Route,
  RoutePoint,
  RoutePointId,
  RoutePointType,
  RideStage,
  SourceFile,
  TripCalendar,
  TripDay,
  TripDayId,
  TripEnrichmentMetadata,
  TripGeneratedMetadata,
  TripMetadata,
  TripSettings,
} from '../../trip-core/index.ts'
import { CURRENT_TRIP_BUNDLE_SCHEMA_VERSION } from '../../trip-core/schema/version.ts'
import {
  RGA_ADAPTER_ENGINE_VERSION,
  RGA_CALENDAR_START_DATE,
  RGA_DAY_COUNT,
  RGA_LANGUAGE,
  RGA_NAME,
  RGA_RIDE_DAY_GPX_NUMBER,
  RGA_SLUG,
  RGA_TIMEZONE,
  RGA_TRIP_ID,
  RGA_MIGRATION_TIMESTAMP,
  genericDayIdValue,
  genericRouteIdValue,
  genericSourceFileIdValue,
  genericStageIdValue,
} from './rga-legacy-constants.ts'

/** One entry of the canonical package's root `manifest.json` `gpx` array. */
export interface RgaLegacyGpxManifestEntry {
  readonly fileName: string
  readonly startName: string
  readonly endName: string
  readonly sizeBytes: number
  readonly sha256: string
}

export interface RgaLegacyAccommodationsDocument {
  readonly version: 1
  readonly tripId: 'rga-2026'
  readonly accommodations: readonly LegacyAccommodation[]
}

export interface RgaLegacyDefaultSettings {
  readonly version: 1
  readonly referenceSpeedKph: number
  readonly departureTime: string
  readonly totalBreakMinutes: number
}

/**
 * Civil-day arithmetic anchored in UTC, independent of the host timezone or
 * DST — the same technique as `src/trip/calendar.ts`'s `addIsoDays` and
 * `src/trip-core/validation/primitives.ts`'s `addCivilDays`, kept local here
 * rather than reaching into either module's internals.
 */
function addCivilDays(isoDate: IsoDate, dayOffset: number): IsoDate {
  const [year, month, day] = isoDate.split('-').map(Number) as [number, number, number]
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() + dayOffset)
  return date.toISOString().slice(0, 10) as IsoDate
}

const RGA_CALENDAR_START_DATE_ISO = RGA_CALENDAR_START_DATE as IsoDate

export function mapMetadata(): TripMetadata {
  const endDate = addCivilDays(RGA_CALENDAR_START_DATE_ISO, RGA_DAY_COUNT - 1)
  return {
    id: tripId(RGA_TRIP_ID),
    slug: RGA_SLUG,
    name: RGA_NAME,
    description: null,
    createdAt: RGA_MIGRATION_TIMESTAMP,
    updatedAt: RGA_MIGRATION_TIMESTAMP,
    startDate: RGA_CALENDAR_START_DATE_ISO,
    endDate,
    timezone: RGA_TIMEZONE,
    language: RGA_LANGUAGE,
    units: 'metric',
    status: 'ready',
    schemaVersion: CURRENT_TRIP_BUNDLE_SCHEMA_VERSION,
    engineVersion: RGA_ADAPTER_ENGINE_VERSION,
  }
}

export function mapCalendar(): TripCalendar {
  return {
    startDate: RGA_CALENDAR_START_DATE_ISO,
    endDate: addCivilDays(RGA_CALENDAR_START_DATE_ISO, RGA_DAY_COUNT - 1),
    timezone: RGA_TIMEZONE,
  }
}

function migratedProvenance(sourceId: string, confidence: DataProvenance['confidence'] = 'high'): DataProvenance {
  return {
    sourceType: 'migrated',
    sourceId,
    fetchedAt: null,
    engineVersion: RGA_ADAPTER_ENGINE_VERSION,
    confidence,
    manuallyOverridden: false,
  }
}

/**
 * `roadbook.json`'s per-day `editorialStats` (distanceKm/elevationGainM/
 * elevationLossM) are structured, deterministic, and already validated by
 * the historical pipeline — but they are an editorial figure, not a GPX
 * computation, and may differ from a future GPX-derived value (see
 * CDC_RGA_2026_REFERENCE.md section 6.2). `confidence: 'medium'` reflects
 * that distinction; `sourceId` points at the exact source field.
 */
function editorialMetricsProvenance(legacyDayId: string): DataProvenance {
  return {
    sourceType: 'migrated',
    sourceId: `roadbook.json#days[${legacyDayId}].editorialStats`,
    fetchedAt: null,
    engineVersion: RGA_ADAPTER_ENGINE_VERSION,
    confidence: 'medium',
    manuallyOverridden: false,
  }
}

export function mapSourceFiles(gpxManifest: readonly RgaLegacyGpxManifestEntry[]): readonly SourceFile[] {
  return gpxManifest.map((entry) => {
    const gpxNumber = parseGpxFileNumber(entry.fileName)
    return {
      id: sourceFileId(genericSourceFileIdValue(gpxNumber)),
      originalName: entry.fileName,
      mimeType: 'application/gpx+xml',
      sizeBytes: entry.sizeBytes,
      // No reliable historical last-modified timestamp for these static, repo-committed assets.
      lastModifiedAt: null,
      sha256: entry.sha256,
      importedAt: RGA_MIGRATION_TIMESTAMP,
      // Not parsed by the generic engine in this phase — see Route.parsingStatus below.
      parsingStatus: 'pending',
      parsingErrors: [],
    }
  })
}

export function mapRoutes(gpxManifest: readonly RgaLegacyGpxManifestEntry[]): readonly Route[] {
  return gpxManifest.map((entry) => {
    const gpxNumber = parseGpxFileNumber(entry.fileName)
    const thisSourceFileId = sourceFileId(genericSourceFileIdValue(gpxNumber))
    return {
      id: routeId(genericRouteIdValue(gpxNumber)),
      sourceFileId: thisSourceFileId,
      segments: [
        { index: 0, name: `${entry.startName} → ${entry.endName}`, distanceKm: null, elevationGainM: null, elevationLossM: null },
      ],
      // No new GPX parser is introduced in this phase (CDC section 10) — geometry
      // and profile stay null until a Node/DOM-independent parsing path exists.
      geometry: null,
      profile: null,
      parsingStatus: 'pending',
      parsingErrors: [],
      provenance: {
        sourceType: 'gpx',
        sourceId: thisSourceFileId,
        fetchedAt: null,
        engineVersion: RGA_ADAPTER_ENGINE_VERSION,
        confidence: null,
        manuallyOverridden: false,
      },
    }
  })
}

interface RoadbookPointCatalogEntry {
  readonly name: string
  readonly type: RoutePointType
}

/**
 * Looks up a documented roadbook point's name and generic category (col,
 * resupply passage, optional detour) by id — sourced entirely from the
 * static, structured `roadbook.json` (never parsed from free text).
 */
function buildRoadbookPointCatalog(roadbook: RoadbookDocument): ReadonlyMap<string, RoadbookPointCatalogEntry> {
  const catalog = new Map<string, RoadbookPointCatalogEntry>()
  for (const day of roadbook.days) {
    if (day.type !== 'ride') continue
    for (const col of day.cols) catalog.set(col.id, { name: col.name, type: 'summit' })
    for (const passage of day.resupplyPassages) catalog.set(passage.id, { name: passage.label, type: 'passage' })
    for (const option of day.options) catalog.set(option.id, { name: option.title, type: 'poi' })
  }
  return catalog
}

/**
 * Route points sourced only from the manually-validated, `matched` entries
 * of `roadbook-overrides.json` (46 of the 53 overrides; `unmatched` and
 * `needs-review` entries have no confirmed position and are excluded — see
 * the phase 3 report's Limits section). `sourceAnchor` is the validated
 * real-world coordinate; `gpxProjection` supplies the track-relative
 * measurements (elevation, distance along the route).
 */
export function mapRoutePoints(
  overrides: RoadbookOverridesDocument,
  roadbook: RoadbookDocument,
): readonly RoutePoint[] {
  const catalog = buildRoadbookPointCatalog(roadbook)
  const matchedOverrides = overrides.overrides.filter((override) => override.approvedStatus === 'matched')
  return matchedOverrides.flatMap((override) => {
    const entry = catalog.get(override.pointId)
    if (entry === undefined) return []
    const gpxNumber = RGA_RIDE_DAY_GPX_NUMBER[override.dayId]
    if (gpxNumber === undefined) return []
    const point: RoutePoint = {
      id: routePointId(override.pointId),
      routeId: routeId(genericRouteIdValue(gpxNumber)),
      type: entry.type,
      name: entry.name,
      latitude: override.sourceAnchor.latitude,
      longitude: override.sourceAnchor.longitude,
      elevationM: override.gpxProjection.elevationM,
      trackDistanceKm: override.gpxProjection.trackDistanceKm,
      provenance: {
        sourceType: 'migrated',
        sourceId: override.pointId,
        fetchedAt: null,
        engineVersion: RGA_ADAPTER_ENGINE_VERSION,
        confidence: 'high',
        manuallyOverridden: true,
      },
    }
    return [point]
  })
}

function groupRoutePointIdsByLegacyDay(
  overrides: RoadbookOverridesDocument,
): ReadonlyMap<string, readonly RoutePointId[]> {
  const byDay = new Map<string, RoutePointId[]>()
  for (const override of overrides.overrides) {
    if (override.approvedStatus !== 'matched') continue
    const ids = byDay.get(override.dayId) ?? []
    ids.push(routePointId(override.pointId))
    byDay.set(override.dayId, ids)
  }
  return byDay
}

export interface RgaDaysAndStages {
  readonly days: readonly TripDay[]
  readonly stages: readonly RideStage[]
}

/**
 * A single, deterministic transformation for `TripDay.notes` (a nullable
 * string) from the roadbook's structured `notes` array (ride or OFF days
 * alike): no notes -> `null`; one or more -> joined with `"\n"`. Editorial
 * `ambiance` text, lodgings, activities and statistics are never folded in —
 * `ambiance` stays available only in the canonical roadbook copy (see the
 * phase 3 report's Limits section).
 */
function mapDayNotes(notes: readonly string[]): string | null {
  return notes.length === 0 ? null : notes.join('\n')
}

export function mapDaysAndStages(
  roadbook: RoadbookDocument,
  accommodationIdByLegacyDay: ReadonlyMap<string, AccommodationId>,
  overrides: RoadbookOverridesDocument,
): RgaDaysAndStages {
  const routePointIdsByLegacyDay = groupRoutePointIdsByLegacyDay(overrides)
  const days: TripDay[] = []
  const stages: RideStage[] = []

  roadbook.days.forEach((day, index) => {
    const genericId = tripDayId(genericDayIdValue(day.dayNumber))
    const date = addCivilDays(RGA_CALENDAR_START_DATE_ISO, index)
    const accommodationIdForDay = accommodationIdByLegacyDay.get(day.id) ?? null

    if (day.type === 'ride') {
      const gpxNumber = RGA_RIDE_DAY_GPX_NUMBER[day.id]
      if (gpxNumber === undefined) {
        throw new Error(`Aucun numéro GPX historique pour la journée ${day.id}.`)
      }
      const stageId = rideStageId(genericStageIdValue(day.id))
      days.push({
        id: genericId,
        index,
        displayNumber: day.dayNumber,
        date,
        type: 'ride',
        stageId,
        startLocationName: day.startName,
        endLocationName: day.endName,
        accommodationId: accommodationIdForDay,
        notes: mapDayNotes(day.notes),
        enrichmentStatus: 'not-started',
      })
      stages.push({
        id: stageId,
        dayId: genericId,
        sourceRouteId: routeId(genericRouteIdValue(gpxNumber)),
        name: day.variant === null ? day.title : `${day.title} (${day.variant})`,
        startLocationName: day.startName,
        endLocationName: day.endName,
        distanceKm: day.editorialStats.distanceKm,
        elevationGainM: day.editorialStats.elevationGainM,
        elevationLossM: day.editorialStats.elevationLossM,
        minAltitudeM: null,
        maxAltitudeM: null,
        movingDurationSeconds: null,
        pauseDurationSeconds: null,
        totalDurationSeconds: null,
        estimatedAverageSpeedKph: null,
        validationStatus: 'pending',
        metricsProvenance: editorialMetricsProvenance(day.id),
        climbIds: [],
        routePointIds: routePointIdsByLegacyDay.get(day.id) ?? [],
        weatherRecordIds: [],
      })
    } else {
      days.push({
        id: genericId,
        index,
        displayNumber: day.dayNumber,
        date,
        type: 'off',
        stageId: null,
        startLocationName: day.locationName,
        endLocationName: day.locationName,
        accommodationId: accommodationIdForDay,
        notes: mapDayNotes(day.notes),
        enrichmentStatus: 'not-started',
      })
    }
  })

  return { days, stages }
}

export function mapAccommodations(legacyAccommodations: readonly LegacyAccommodation[]): readonly Accommodation[] {
  return legacyAccommodations.map((legacy) => ({
    id: accommodationId(legacy.id),
    name: legacy.name,
    type: legacy.type,
    address: legacy.address,
    latitude: legacy.latitude ?? null,
    longitude: legacy.longitude ?? null,
    mapsUrl: getAccommodationMapsUrl(legacy),
    website: legacy.website ?? null,
    phone: null,
    bookingReference: null,
    notes: null,
    confirmed: legacy.confirmed,
    provenance: {
      sourceType: 'user',
      sourceId: legacy.id,
      fetchedAt: null,
      engineVersion: RGA_ADAPTER_ENGINE_VERSION,
      confidence: 'high',
      manuallyOverridden: legacy.confirmed,
    },
  }))
}

export function buildAccommodationDayIndex(
  legacyAccommodations: readonly LegacyAccommodation[],
): ReadonlyMap<string, AccommodationId> {
  const byLegacyDay = new Map<string, AccommodationId>()
  for (const legacy of legacyAccommodations) {
    const id = accommodationId(legacy.id)
    for (const dayId of legacy.dayIds) byLegacyDay.set(dayId, id)
  }
  return byLegacyDay
}

/** Exported so tooling (e.g. the golden master comparator) can map a legacy icon key to its TripBundle category without duplicating this table. */
export const ICON_KEY_TO_CATEGORY: Readonly<Record<PracticalIconKey, PracticalPlaceCategory | null>> = {
  shelter: 'shelter',
  bakery: 'bakery',
  cafe: 'cafe-or-ice-cream',
  water: 'water',
  food: 'fast-food',
  bicycle: 'bike-service',
  grocery: 'supermarket',
  toilet: 'toilet',
  // No TripBundle v1 equivalent — see the phase 3 report's Limits section.
  // The current dataset has zero points on this layer, so nothing is dropped today.
  generic: null,
}

/** `J1` -> the generic `TripDayId` assigned to that same day in `mapDaysAndStages`. */
export function buildLegacyDayIdIndex(roadbook: RoadbookDocument): ReadonlyMap<string, TripDayId> {
  const byLegacyId = new Map<string, TripDayId>()
  roadbook.days.forEach((day) => {
    byLegacyId.set(day.id, tripDayId(genericDayIdValue(day.dayNumber)))
  })
  return byLegacyId
}

function resolveLegacyDayId(
  legacyDayIdIndex: ReadonlyMap<string, TripDayId>,
  legacyDayId: string,
  practicalPointId: string,
): TripDayId {
  const genericId = legacyDayIdIndex.get(legacyDayId)
  if (genericId === undefined) {
    throw new Error(`Journée historique inconnue "${legacyDayId}" référencée par le lieu pratique ${practicalPointId}.`)
  }
  return genericId
}

function mapPracticalPlace(
  point: PracticalPoint,
  category: PracticalPlaceCategory,
  legacyDayIdIndex: ReadonlyMap<string, TripDayId>,
): PracticalPlace {
  return {
    id: practicalPlaceId(point.id),
    category,
    name: point.name,
    latitude: point.latitude,
    longitude: point.longitude,
    description: point.description ?? null,
    // Not tracked by the legacy generator — see the phase 3 report's Limits section.
    trackDistanceKm: null,
    detourKm: null,
    openingHours: null,
    hidden: false,
    pinned: false,
    // Copied verbatim from the historical dayIds — never recomputed from geographic
    // proximity (see the phase 3B report, section A).
    dayIds: point.dayIds.map((legacyDayId) => resolveLegacyDayId(legacyDayIdIndex, legacyDayId, point.id)),
    provenance: migratedProvenance(point.id),
  }
}

export function mapPracticalPlaces(
  practicalData: PracticalData,
  legacyDayIdIndex: ReadonlyMap<string, TripDayId>,
): readonly PracticalPlace[] {
  const layerIconKeyById = new Map(practicalData.layers.map((layer) => [layer.id, layer.iconKey]))
  return practicalData.points.flatMap((point) => {
    const iconKey = layerIconKeyById.get(point.layerId)
    const category = iconKey === undefined ? null : ICON_KEY_TO_CATEGORY[iconKey]
    return category === null || category === undefined ? [] : [mapPracticalPlace(point, category, legacyDayIdIndex)]
  })
}

export function mapSettings(
  rideDayIds: readonly TripDayId[],
  defaultSettings: RgaLegacyDefaultSettings,
): TripSettings {
  const global: GlobalTripSettings = {
    referenceSpeedKph: defaultSettings.referenceSpeedKph,
    pausePlanMode: 'automatic',
  }
  return {
    global,
    days: rideDayIds.map((dayId) => ({
      dayId,
      departureTime: defaultSettings.departureTime,
      totalBreakSeconds: defaultSettings.totalBreakMinutes * 60,
    })),
    // Automatic pause anchors are computed at runtime from the route profile
    // (see `src/trip/pause-plan.ts`) — nothing to pre-populate deterministically
    // without that profile, so no per-stage override is recorded here.
    stages: [],
  }
}

export function mapEnrichmentMetadata(): TripEnrichmentMetadata {
  return {
    providers: [
      {
        provider: 'gpx',
        lastAttemptedAt: null,
        lastSuccessAt: null,
        status: 'not-configured',
        message: 'GPX parsing not yet run through the generic engine for this migrated snapshot.',
      },
      { provider: 'osm', lastAttemptedAt: null, lastSuccessAt: null, status: 'not-configured', message: null },
      { provider: 'open-meteo', lastAttemptedAt: null, lastSuccessAt: null, status: 'not-configured', message: null },
    ],
  }
}

export function mapGeneratedMetadata(): TripGeneratedMetadata {
  return {
    engineVersion: RGA_ADAPTER_ENGINE_VERSION,
    generatedAt: null,
    derivedDataStatus: 'not-generated',
  }
}
