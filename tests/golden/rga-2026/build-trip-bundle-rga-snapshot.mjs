// Builds a deterministic, JSON-serializable summary of the TripBundle
// produced by `loadRgaLegacyTrip` — using the generic `trip-core` selectors
// wherever one exists, never reaching back into `public/data/` to patch in
// something the bundle doesn't have.

import { createHash } from 'node:crypto'

import {
  selectAccommodationForDay,
  selectClimbsForStage,
  selectOffDays,
  selectOrderedDays,
  selectPracticalPlacesForDay,
  selectRideDays,
  selectRouteForStage,
  selectStageForDay,
  selectTransferDays,
  selectTripCounts,
  selectTripTotals,
} from '../../../src/trip-core/index.ts'
import { createFakePublicFetch, FAKE_PUBLIC_BASE_URL } from '../../support/fake-public-fetch.mjs'

function sortBy(array, keyFn) {
  return [...array].sort((left, right) => {
    const a = keyFn(left)
    const b = keyFn(right)
    return a < b ? -1 : a > b ? 1 : 0
  })
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort()
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function hashOf(value) {
  return createHash('sha256').update(Buffer.from(stableStringify(value), 'utf8')).digest('hex')
}

export async function buildTripBundleRgaSnapshot() {
  const projectRoot = new URL('../../../', import.meta.url)
  const { loadRgaLegacyTrip } = await import('../../../src/trips/rga-2026/load-rga-legacy-trip.ts')
  const bundle = await loadRgaLegacyTrip(createFakePublicFetch(projectRoot), FAKE_PUBLIC_BASE_URL)

  const orderedDays = selectOrderedDays(bundle)
  const days = orderedDays.map((day) => ({
    id: day.id,
    index: day.index,
    displayNumber: day.displayNumber,
    date: day.date,
    type: day.type,
    startLocationName: day.startLocationName,
    endLocationName: day.endLocationName,
    accommodationId: day.accommodationId,
    notes: day.notes,
    hasStage: day.stageId !== null,
  }))

  const stages = sortBy(bundle.stages, (stage) => stage.id).map((stage) => {
    const route = selectRouteForStage(bundle, stage.id)
    const climbs = selectClimbsForStage(bundle, stage.id)
    return {
      id: stage.id,
      dayId: stage.dayId,
      name: stage.name,
      startLocationName: stage.startLocationName,
      endLocationName: stage.endLocationName,
      distanceKm: stage.distanceKm,
      elevationGainM: stage.elevationGainM,
      elevationLossM: stage.elevationLossM,
      metricsProvenance:
        stage.metricsProvenance === null
          ? null
          : {
              sourceType: stage.metricsProvenance.sourceType,
              confidence: stage.metricsProvenance.confidence,
              manuallyOverridden: stage.metricsProvenance.manuallyOverridden,
            },
      minAltitudeM: stage.minAltitudeM,
      maxAltitudeM: stage.maxAltitudeM,
      movingDurationSeconds: stage.movingDurationSeconds,
      pauseDurationSeconds: stage.pauseDurationSeconds,
      totalDurationSeconds: stage.totalDurationSeconds,
      estimatedAverageSpeedKph: stage.estimatedAverageSpeedKph,
      validationStatus: stage.validationStatus,
      routePointCount: stage.routePointIds.length,
      climbCount: climbs.length,
      hasRoute: route !== null,
      routeHasGeometry: route === null ? null : route.geometry !== null,
      routeHasProfile: route === null ? null : route.profile !== null,
      routeParsingStatus: route === null ? null : route.parsingStatus,
    }
  })

  const sourceFiles = sortBy(bundle.sourceFiles, (file) => file.id).map((file) => ({
    id: file.id,
    originalName: file.originalName,
    sizeBytes: file.sizeBytes,
    sha256: file.sha256,
    parsingStatus: file.parsingStatus,
  }))

  const routePoints = sortBy(bundle.routePoints, (point) => point.id).map((point) => ({
    id: point.id,
    routeId: point.routeId,
    type: point.type,
    name: point.name,
    latitude: point.latitude,
    longitude: point.longitude,
    elevationM: point.elevationM,
    trackDistanceKm: point.trackDistanceKm,
    confidence: point.provenance.confidence,
    manuallyOverridden: point.provenance.manuallyOverridden,
  }))

  const accommodations = sortBy(bundle.accommodations, (item) => item.id).map((item) => ({
    id: item.id,
    name: item.name,
    type: item.type,
    address: item.address,
    latitude: item.latitude,
    longitude: item.longitude,
    website: item.website,
    confirmed: item.confirmed,
    dayIds: sortBy(
      orderedDays.filter((day) => day.accommodationId === item.id).map((day) => day.id),
      (id) => id,
    ),
  }))

  const practicalPlaces = sortBy(bundle.practicalPlaces, (place) => place.id)
  const byCategory = {}
  for (const place of practicalPlaces) byCategory[place.category] = (byCategory[place.category] ?? 0) + 1
  const multiDayCount = practicalPlaces.filter((place) => place.dayIds.length > 1).length
  const displayNumberByGenericDayId = new Map(orderedDays.map((day) => [day.id, day.displayNumber]))
  // Normalized to bare day numbers — see the matching comment in build-legacy-rga-snapshot.mjs.
  const dayIdShape = practicalPlaces.map((place) => ({
    id: place.id,
    dayNumbers: [...place.dayIds].map((genericDayId) => displayNumberByGenericDayId.get(genericDayId)).sort((a, b) => a - b),
  }))
  const firstRideDay = selectRideDays(bundle)[0]
  const placesForFirstRideDay = firstRideDay === undefined ? [] : selectPracticalPlacesForDay(bundle, firstRideDay.id)

  return {
    metadata: {
      id: bundle.metadata.id,
      slug: bundle.metadata.slug,
      name: bundle.metadata.name,
      language: bundle.metadata.language,
      units: bundle.metadata.units,
      status: bundle.metadata.status,
      schemaVersion: bundle.metadata.schemaVersion,
      startDate: bundle.metadata.startDate,
      endDate: bundle.metadata.endDate,
      timezone: bundle.metadata.timezone,
    },
    calendar: { startDate: bundle.calendar.startDate, endDate: bundle.calendar.endDate, timezone: bundle.calendar.timezone },
    counts: selectTripCounts(bundle),
    offDayCount: selectOffDays(bundle).length,
    transferDayCount: selectTransferDays(bundle).length,
    days,
    stages,
    totals: selectTripTotals(bundle),
    sourceFiles,
    routes: {
      count: bundle.routes.length,
      allGeometryNull: bundle.routes.every((route) => route.geometry === null),
      allProfileNull: bundle.routes.every((route) => route.profile === null),
    },
    routePoints,
    climbCount: bundle.climbs.length,
    accommodations,
    practicalPlaces: {
      totalCount: practicalPlaces.length,
      byCategory,
      multiDayCount,
      dayIdShapeHash: hashOf(dayIdShape),
      firstRideDayPlaceCount: placesForFirstRideDay.length,
    },
    settings: {
      referenceSpeedKph: bundle.settings.global.referenceSpeedKph,
      pausePlanMode: bundle.settings.global.pausePlanMode,
      dayEntryCount: bundle.settings.days.length,
      stageEntryCount: bundle.settings.stages.length,
    },
    overrideCount: bundle.overrides.length,
    weatherCount: bundle.weather.length,
    enrichmentMetadata: bundle.enrichmentMetadata,
    generatedMetadata: bundle.generatedMetadata,
  }
}
