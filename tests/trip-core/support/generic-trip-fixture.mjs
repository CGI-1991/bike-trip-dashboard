// Generic, fully synthetic TripBundle v1 fixture used only by trip-core tests.
// Entirely made up: no fixed day count or ride/rest split, no hardcoded
// timezone, and no real-world place names — none of it is tied to any
// specific existing trip or itinerary.
//
// Four logical days: ride, off, transfer, ride — two ride stages, two routes,
// two source files, one climb, three route points, one accommodation, one
// practical place, and (in the dated variant) one weather record.

import {
  accommodationId,
  climbId,
  overrideId,
  practicalPlaceId,
  rideStageId,
  routeId,
  routePointId,
  sourceFileId,
  tripDayId,
  tripId,
  weatherRecordId,
} from '../../../src/trip-core/model/ids.ts'

const ENGINE_VERSION = 'trip-core-fixture@1'

function provenance(overrides) {
  return {
    sourceType: 'generated',
    sourceId: null,
    fetchedAt: null,
    engineVersion: ENGINE_VERSION,
    confidence: null,
    manuallyOverridden: false,
    ...overrides,
  }
}

/**
 * Builds a fresh, independent TripBundle-shaped plain object each call.
 * `dated: false` produces the "trip with no calendar yet" variant (CDC
 * section 6.1 / 16.1): no calendar dates, no day dates, and no weather
 * (weather always requires a date).
 */
export function createGenericTripBundle({ dated = true } = {}) {
  const day0 = tripDayId('day-alpha')
  const day1 = tripDayId('day-bravo')
  const day2 = tripDayId('day-charlie')
  const day3 = tripDayId('day-delta')

  const stage1 = rideStageId('stage-alpha')
  const stage2 = rideStageId('stage-delta')

  const sourceFile1 = sourceFileId('source-file-alpha')
  const sourceFile2 = sourceFileId('source-file-delta')

  const route1 = routeId('route-alpha')
  const route2 = routeId('route-delta')

  const climb1 = climbId('climb-delta-pass')

  const point1 = routePointId('point-alpha-start')
  const point2 = routePointId('point-alpha-end')
  const point3 = routePointId('point-delta-summit')

  const place1 = practicalPlaceId('place-bakery-alpha')
  const lodging1 = accommodationId('lodging-hilltown-inn')
  const weather1 = weatherRecordId('weather-day-alpha-start')
  const override1 = overrideId('override-point-alpha-end-name')

  const startDate = dated ? '2027-05-10' : null
  const endDate = dated ? '2027-05-13' : null
  const timezone = dated ? 'America/Denver' : null

  return {
    schemaVersion: 1,
    metadata: {
      id: tripId('trip-sample-loop-01'),
      slug: 'sample-loop-01',
      name: 'Sample Loop 01',
      description: 'A synthetic four-day trip used to exercise TripBundle v1.',
      createdAt: '2027-01-01T00:00:00.000Z',
      updatedAt: '2027-01-02T00:00:00.000Z',
      startDate,
      endDate,
      timezone,
      language: 'en',
      units: 'metric',
      status: dated ? 'ready' : 'draft',
      schemaVersion: 1,
      engineVersion: ENGINE_VERSION,
    },
    calendar: { startDate, endDate, timezone },
    days: [
      {
        id: day0,
        index: 0,
        displayNumber: 1,
        date: dated ? '2027-05-10' : null,
        type: 'ride',
        stageId: stage1,
        startLocationName: 'Riverside',
        endLocationName: 'Hilltown',
        accommodationId: null,
        notes: null,
        enrichmentStatus: 'partial',
      },
      {
        id: day1,
        index: 1,
        displayNumber: 2,
        date: dated ? '2027-05-11' : null,
        type: 'off',
        stageId: null,
        startLocationName: 'Hilltown',
        endLocationName: 'Hilltown',
        accommodationId: lodging1,
        notes: 'Rest day in Hilltown.',
        enrichmentStatus: 'not-started',
      },
      {
        id: day2,
        index: 2,
        displayNumber: 3,
        date: dated ? '2027-05-12' : null,
        type: 'transfer',
        stageId: null,
        startLocationName: 'Hilltown',
        endLocationName: 'Lakeside',
        accommodationId: null,
        notes: 'Train transfer, no cyclable stage.',
        enrichmentStatus: 'not-started',
      },
      {
        id: day3,
        index: 3,
        displayNumber: 4,
        date: dated ? '2027-05-13' : null,
        type: 'ride',
        stageId: stage2,
        startLocationName: 'Lakeside',
        endLocationName: 'Summit Junction',
        accommodationId: null,
        notes: null,
        enrichmentStatus: 'complete',
      },
    ],
    stages: [
      {
        id: stage1,
        dayId: day0,
        sourceRouteId: route1,
        name: 'Riverside to Hilltown',
        startLocationName: 'Riverside',
        endLocationName: 'Hilltown',
        distanceKm: 62.4,
        elevationGainM: 780,
        elevationLossM: 410,
        minAltitudeM: 210,
        maxAltitudeM: 640,
        movingDurationSeconds: 11_400,
        pauseDurationSeconds: 1_800,
        totalDurationSeconds: 13_200,
        estimatedAverageSpeedKph: 19.7,
        validationStatus: 'valid',
        climbIds: [],
        routePointIds: [point1, point2],
        weatherRecordIds: dated ? [weather1] : [],
      },
      {
        id: stage2,
        dayId: day3,
        sourceRouteId: route2,
        name: 'Lakeside to Summit Junction',
        startLocationName: 'Lakeside',
        endLocationName: 'Summit Junction',
        distanceKm: null,
        elevationGainM: null,
        elevationLossM: null,
        minAltitudeM: null,
        maxAltitudeM: null,
        movingDurationSeconds: null,
        pauseDurationSeconds: null,
        totalDurationSeconds: null,
        estimatedAverageSpeedKph: null,
        validationStatus: 'pending',
        climbIds: [climb1],
        routePointIds: [point3],
        weatherRecordIds: [],
      },
    ],
    sourceFiles: [
      {
        id: sourceFile1,
        originalName: 'alpha.gpx',
        mimeType: 'application/gpx+xml',
        sizeBytes: 48_213,
        lastModifiedAt: '2027-01-01T00:00:00.000Z',
        sha256: 'a'.repeat(64),
        importedAt: '2027-01-01T00:00:00.000Z',
        parsingStatus: 'success',
        parsingErrors: [],
      },
      {
        id: sourceFile2,
        originalName: 'delta.gpx',
        mimeType: 'application/gpx+xml',
        sizeBytes: 51_022,
        lastModifiedAt: null,
        sha256: null,
        importedAt: '2027-01-01T00:00:00.000Z',
        parsingStatus: 'pending',
        parsingErrors: [],
      },
    ],
    routes: [
      {
        id: route1,
        sourceFileId: sourceFile1,
        segments: [
          { index: 0, name: 'Riverside to Hilltown', distanceKm: 62.4, elevationGainM: 780, elevationLossM: 410 },
        ],
        geometry: {
          full: null,
          simplified: [
            { latitude: 45.1, longitude: 6.2, altitudeM: 210 },
            { latitude: 45.3, longitude: 6.5, altitudeM: 640 },
          ],
        },
        profile: null,
        parsingStatus: 'success',
        parsingErrors: [],
        provenance: provenance({ sourceType: 'gpx', sourceId: sourceFile1, confidence: 'high' }),
      },
      {
        id: route2,
        sourceFileId: sourceFile2,
        segments: [{ index: 0, name: null, distanceKm: null, elevationGainM: null, elevationLossM: null }],
        geometry: null,
        profile: null,
        parsingStatus: 'pending',
        parsingErrors: [],
        provenance: provenance({ sourceType: 'gpx', sourceId: sourceFile2 }),
      },
    ],
    climbs: [
      {
        id: climb1,
        routeId: route2,
        name: 'Delta Pass',
        startDistanceKm: 30,
        endDistanceKm: 34.5,
        elevationGainM: 520,
        averageGradientPercent: 6.8,
        maxGradientPercent: 11.2,
        startAltitudeM: 900,
        endAltitudeM: 1_420,
        confidence: 'probable',
        provenance: provenance({ confidence: 'medium' }),
      },
    ],
    routePoints: [
      {
        id: point1,
        routeId: route1,
        type: 'start',
        name: 'Riverside',
        latitude: 45.1,
        longitude: 6.2,
        elevationM: 210,
        trackDistanceKm: 0,
        provenance: provenance({ sourceType: 'gpx', sourceId: sourceFile1, confidence: 'high' }),
      },
      {
        id: point2,
        routeId: route1,
        type: 'end',
        name: 'Hilltown',
        latitude: 45.3,
        longitude: 6.5,
        elevationM: 640,
        trackDistanceKm: 62.4,
        provenance: provenance({ sourceType: 'gpx', sourceId: sourceFile1, confidence: 'high' }),
      },
      {
        id: point3,
        routeId: route2,
        type: 'summit',
        name: 'Delta Pass Summit',
        latitude: 45.55,
        longitude: 6.8,
        elevationM: 1_420,
        trackDistanceKm: 34.5,
        provenance: provenance({ confidence: 'medium' }),
      },
    ],
    practicalPlaces: [
      {
        id: place1,
        category: 'bakery',
        name: 'Riverside Bakery',
        latitude: 45.11,
        longitude: 6.21,
        description: 'Fresh bread and pastries near the start.',
        trackDistanceKm: 1.2,
        detourKm: 0.1,
        openingHours: '06:00-13:00',
        hidden: false,
        pinned: true,
        provenance: provenance({ sourceType: 'osm', sourceId: 'osm-node-1234', fetchedAt: '2027-01-01T00:00:00.000Z', confidence: 'medium' }),
      },
    ],
    accommodations: [
      {
        id: lodging1,
        name: 'Hilltown Inn',
        type: 'gite',
        address: '12 Ridge Road, Hilltown',
        latitude: 45.3,
        longitude: 6.5,
        mapsUrl: 'https://maps.example.com/hilltown-inn',
        website: null,
        phone: null,
        bookingReference: null,
        notes: null,
        confirmed: true,
        provenance: provenance({ sourceType: 'user', manuallyOverridden: true }),
      },
    ],
    weather: dated
      ? [
          {
            id: weather1,
            dayId: day0,
            routePointId: point1,
            forDate: '2027-05-10',
            forecastAt: '2027-05-09T18:00:00.000Z',
            temperatureMinC: 8,
            temperatureMaxC: 19,
            precipitationMm: 0.4,
            windSpeedKph: 12,
            weatherCode: 2,
            provenance: provenance({
              sourceType: 'open-meteo',
              sourceId: 'open-meteo-run-2027-05-09',
              fetchedAt: '2027-05-09T18:00:00.000Z',
              confidence: 'medium',
            }),
          },
        ]
      : [],
    settings: {
      global: { referenceSpeedKph: 17, pausePlanMode: 'automatic' },
      days: [{ dayId: day0, departureTime: '08:00', totalBreakSeconds: 1_800 }],
      stages: [
        {
          stageId: stage1,
          pausePlanMode: null,
          pauses: [
            { id: 'pause-alpha-1', active: true, routePointId: point2, durationSeconds: 900, order: 0, origin: 'automatic' },
          ],
        },
      ],
    },
    overrides: [
      {
        id: override1,
        targetType: 'route-point',
        targetId: point2,
        field: 'name',
        value: 'Hilltown (confirmed)',
        reason: 'User corrected the auto-generated name from OSM.',
        createdAt: '2027-01-03T00:00:00.000Z',
      },
    ],
    enrichmentMetadata: {
      providers: [
        { provider: 'gpx', lastAttemptedAt: '2027-01-01T00:00:00.000Z', lastSuccessAt: '2027-01-01T00:00:00.000Z', status: 'success', message: null },
        { provider: 'osm', lastAttemptedAt: '2027-01-01T00:05:00.000Z', lastSuccessAt: '2027-01-01T00:05:00.000Z', status: 'success', message: null },
        {
          provider: 'open-meteo',
          lastAttemptedAt: dated ? '2027-05-09T18:00:00.000Z' : null,
          lastSuccessAt: dated ? '2027-05-09T18:00:00.000Z' : null,
          status: dated ? 'success' : 'not-configured',
          message: dated ? null : 'No trip date set yet.',
        },
      ],
    },
    generatedMetadata: {
      engineVersion: ENGINE_VERSION,
      generatedAt: '2027-01-02T00:00:00.000Z',
      derivedDataStatus: 'partial',
    },
  }
}
