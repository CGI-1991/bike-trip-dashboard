// A synthetic, fully-valid TripBundle used by the "étapes liées" tests:
// three consecutive ride days, each with a real (flat, straight) route
// geometry so the existing ETA pipeline produces a genuine arrival time.
// Nothing here is tied to any real itinerary.

import { addCivilDays } from '../../../src/trip-core/validation/primitives.ts'

const ENGINE_VERSION = 'linked-stages-fixture@1'

function provenance(overrides = {}) {
  return {
    sourceType: 'gpx',
    sourceId: null,
    fetchedAt: null,
    engineVersion: ENGINE_VERSION,
    confidence: 'high',
    manuallyOverridden: false,
    ...overrides,
  }
}

/** A flat, straight line of `lengthDegrees` of longitude at 45°N — roughly 78.7 km per degree. */
function geometry(startLongitude, lengthDegrees) {
  return [
    { latitude: 45, longitude: startLongitude, altitudeM: 100 },
    { latitude: 45, longitude: startLongitude + lengthDegrees / 2, altitudeM: 100 },
    { latitude: 45, longitude: startLongitude + lengthDegrees, altitudeM: 100 },
  ]
}

/**
 * `rideCount` consecutive ride days starting on 2028-06-01.
 *
 * `links` lists the day indexes carrying `sameCalendarDayAsPrevious`, and
 * the calendar dates/endDate are derived from them exactly as the validator
 * requires (`calendar.startDate + calendarDayOffsets(days)[index]`).
 */
export function createLinkedTripBundle({ rideCount = 3, links = [], startDate = '2028-06-01', referenceSpeedKph = 20 } = {}) {
  const linked = new Set(links)
  const offsets = []
  let offset = 0
  for (let index = 0; index < rideCount; index++) {
    if (index > 0 && !linked.has(index)) offset += 1
    offsets.push(offset)
  }
  const endDate = addCivilDays(startDate, offsets[offsets.length - 1] ?? 0)

  const days = []
  const stages = []
  const routes = []
  const sourceFiles = []
  const settingsDays = []

  for (let index = 0; index < rideCount; index++) {
    const dayId = `day-${index}`
    const stageId = `stage-${index}`
    const routeId = `route-${index}`
    const sourceFileId = `source-${index}`
    const points = geometry(6 + index, 0.5)

    days.push({
      id: dayId,
      index,
      displayNumber: index + 1,
      date: addCivilDays(startDate, offsets[index]),
      type: 'ride',
      stageId,
      startLocationName: `Départ ${index + 1}`,
      endLocationName: `Arrivée ${index + 1}`,
      accommodationId: null,
      notes: null,
      enrichmentStatus: 'complete',
      ...(linked.has(index) ? { sameCalendarDayAsPrevious: true } : {}),
    })

    stages.push({
      id: stageId,
      dayId,
      sourceRouteId: routeId,
      name: null,
      startLocationName: `Départ ${index + 1}`,
      endLocationName: `Arrivée ${index + 1}`,
      distanceKm: 39.4,
      elevationGainM: 0,
      elevationLossM: 0,
      minAltitudeM: 100,
      maxAltitudeM: 100,
      movingDurationSeconds: 7_092,
      // Zero, so an ETA is exactly departure + moving time: these tests are
      // about the schedule rules, not about pause placement.
      pauseDurationSeconds: 0,
      totalDurationSeconds: 7_092,
      estimatedAverageSpeedKph: referenceSpeedKph,
      validationStatus: 'valid',
      metricsProvenance: provenance(),
      climbIds: [],
      routePointIds: [],
      weatherRecordIds: [],
    })

    routes.push({
      id: routeId,
      sourceFileId,
      segments: [{ index: 0, name: null, distanceKm: 39.4, elevationGainM: 0, elevationLossM: 0 }],
      geometry: { full: points, simplified: null },
      profile: null,
      parsingStatus: 'success',
      parsingErrors: [],
      provenance: provenance({ sourceId: sourceFileId }),
    })

    sourceFiles.push({
      id: sourceFileId,
      originalName: `stage-${index}.gpx`,
      mimeType: 'application/gpx+xml',
      sizeBytes: 1_024,
      lastModifiedAt: null,
      sha256: String(index).repeat(64).slice(0, 64),
      importedAt: '2028-01-01T00:00:00.000Z',
      parsingStatus: 'success',
      parsingErrors: [],
    })

    settingsDays.push({ dayId, departureTime: '08:00', totalBreakSeconds: 0 })
  }

  return {
    schemaVersion: 1,
    metadata: {
      id: 'trip-linked-fixture',
      slug: 'linked-fixture',
      name: 'Voyage lié',
      description: null,
      createdAt: '2028-01-01T00:00:00.000Z',
      updatedAt: '2028-01-01T00:00:00.000Z',
      startDate,
      endDate,
      timezone: 'Europe/Brussels',
      language: 'fr',
      units: 'metric',
      status: 'ready',
      schemaVersion: 1,
      engineVersion: ENGINE_VERSION,
    },
    calendar: { startDate, endDate, timezone: 'Europe/Brussels' },
    days,
    stages,
    sourceFiles,
    routes,
    climbs: [],
    routePoints: [],
    practicalPlaces: [],
    accommodations: [],
    weather: [],
    settings: {
      global: { referenceSpeedKph, pausePlanMode: 'automatic' },
      days: settingsDays,
      stages: [],
    },
    overrides: [],
    enrichmentMetadata: { providers: [] },
    generatedMetadata: { engineVersion: ENGINE_VERSION, generatedAt: '2028-01-01T00:00:00.000Z', derivedDataStatus: 'fresh' },
  }
}

/**
 * Adds three villages per route, at the 25/50/75 % marks the automatic
 * pause engine aims for — without a real anchor nearby it places no pause at
 * all, so a test about pause time needs them.
 */
export function withVillages(bundle) {
  const routePoints = []
  const stages = bundle.stages.map((stage) => {
    const route = bundle.routes.find((candidate) => candidate.id === stage.sourceRouteId)
    const points = route.geometry.full
    const startLongitude = points[0].longitude
    const span = points[points.length - 1].longitude - startLongitude
    const ids = [0.25, 0.5, 0.75].map((fraction, position) => {
      const id = `${stage.id}-village-${position}`
      routePoints.push({
        id,
        routeId: route.id,
        type: 'village',
        name: `Village ${position + 1}`,
        latitude: 45,
        longitude: startLongitude + span * fraction,
        elevationM: 100,
        trackDistanceKm: (stage.distanceKm ?? 0) * fraction,
        osmFeatureType: 'village',
        provenance: { sourceType: 'osm', sourceId: null, fetchedAt: null, engineVersion: 'route-enrichment@4', confidence: 'high', manuallyOverridden: false },
      })
      return id
    })
    return { ...stage, routePointIds: ids }
  })
  return { ...bundle, stages, routePoints }
}

/** Attaches a lodging to one day, returning a new bundle. */
export function withLodging(bundle, dayId, { id, name }) {
  return {
    ...bundle,
    accommodations: [
      ...bundle.accommodations,
      {
        id,
        name,
        type: 'hotel',
        address: null,
        latitude: null,
        longitude: null,
        mapsUrl: null,
        website: null,
        phone: null,
        bookingReference: null,
        notes: null,
        confirmed: true,
        provenance: { sourceType: 'user', sourceId: null, fetchedAt: null, engineVersion: ENGINE_VERSION, confidence: null, manuallyOverridden: true },
      },
    ],
    days: bundle.days.map((day) => (day.id === dayId ? { ...day, accommodationId: id } : day)),
  }
}
