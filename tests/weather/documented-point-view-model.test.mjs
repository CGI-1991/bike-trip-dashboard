import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildDocumentedPointWeatherListViewModel,
  formatDocumentedPointWeatherSummary,
} from '../../src/weather/documented-point-view-model.ts'
import { buildRouteDisplayPoints } from '../../src/ui/route-engine.ts'
import { associateWeatherDay } from '../../src/weather/selectors.ts'
import { selectCurrentReferenceSamplePoints } from '../../src/weather/sample-points.ts'

function clock(clockMinutes) {
  return {
    dayOffset: 0,
    clockMinutes,
    totalMinutesFromDeparture: clockMinutes - 8 * 60,
  }
}

function point(id, type, elevationM, clockMinutes, name = id) {
  return {
    id,
    dayId: 'J1',
    type,
    name,
    status: 'confirmed',
    resolution: 'matched',
    sourceKind: type === 'col' ? 'col' : 'passage-group',
    alternatives: [],
    overrideApplied: true,
    standaloneWaypoint: false,
    matchedLatitude: 46,
    matchedLongitude: 6.5,
    matchedElevationM: elevationM,
    matchedTrackDistanceKm: clockMinutes - 8 * 60,
    eta: clock(clockMinutes),
  }
}

function hourly(time, overrides = {}) {
  return {
    time,
    temperatureC: 12.4,
    apparentTemperatureC: 10,
    relativeHumidityPct: 70,
    precipitationProbabilityPct: 35,
    precipitationMm: 0.4,
    rainMm: 0.4,
    showersMm: 0,
    snowfallCm: 0,
    weatherCode: 61,
    cloudCoverPct: 70,
    visibilityM: 10_000,
    windSpeedKph: 18,
    windDirectionDeg: 250,
    windGustsKph: 42,
    freezingLevelM: 2_500,
    ...overrides,
  }
}

function sample(pointValue) {
  return {
    id: `weather-${pointValue.id}`,
    dayId: 'J1',
    dayType: 'ride',
    tripDate: '2026-08-12',
    name: pointValue.name,
    type: pointValue.type,
    latitude: pointValue.matchedLatitude,
    longitude: pointValue.matchedLongitude,
    elevationM: pointValue.matchedElevationM,
    trackDistanceKm: pointValue.matchedTrackDistanceKm,
    eta: pointValue.eta,
    sourcePointIds: [pointValue.id],
    references: [{
      pointId: pointValue.id,
      name: pointValue.name,
      type: pointValue.type,
      trackDistanceKm: pointValue.matchedTrackDistanceKm,
      eta: pointValue.eta,
    }],
    source: 'roadbook-matched',
    role: 'route-point',
    contributesToDayRisk: true,
  }
}

function forecastWaypoint(pointValue, weather = hourly('2026-08-12T09:00')) {
  const samplePoint = sample(pointValue)
  return {
    samplePoint,
    etaLocal: '2026-08-12T09:00',
    forecastTimeLocal: weather.time,
    forecastOffsetMinutes: 0,
    weather,
    state: 'available',
    documentedForecasts: [{
      pointId: pointValue.id,
      etaLocal: '2026-08-12T09:00',
      forecastTimeLocal: weather.time,
      forecastOffsetMinutes: 0,
      weather,
      state: 'available',
    }],
  }
}

function state(waypoints, overrides = {}) {
  return {
    dayId: 'J1',
    dayType: 'ride',
    tripDate: '2026-08-12',
    availability: 'available',
    cacheState: 'fresh',
    source: 'network',
    fetchedAt: '2026-08-01T08:00:00.000Z',
    receivedDates: ['2026-08-12'],
    data: {
      type: 'ride',
      dayId: 'J1',
      tripDate: '2026-08-12',
      waypoints,
      routeSummary: {
        temperatureMinC: null,
        temperatureMaxC: null,
        apparentTemperatureMinC: null,
        apparentTemperatureMaxC: null,
        precipitationProbabilityMaxPct: null,
        hourlyPrecipitationMaxMm: null,
        windSpeedMaxKph: null,
        windGustsMaxKph: null,
        visibilityMinM: null,
        freezingLevelMinM: null,
        worstWeatherCode: null,
        coveredPointCount: waypoints.length,
        missingPointCount: 0,
      },
      dailyByLocation: [],
      currentWaypoints: [],
      todayReference: null,
    },
    isRefreshing: false,
    departureScenarios: null,
    ...overrides,
  }
}

test('joins compact weather by stable pointId only, never by name or proximity', () => {
  const first = point('point-a', 'passage', 800, 9 * 60, 'Saint-Martin')
  const closeName = point('point-b', 'passage', 805, 9 * 60 + 5, 'Saint Martin')
  const technical = point('technical-km-20', 'passage', 810, 9 * 60 + 10)
  const model = buildDocumentedPointWeatherListViewModel(
    state([forecastWaypoint(first), forecastWaypoint(technical)]),
    [first, closeName],
    '2026-08-01',
  )

  assert.equal(model.pointWeatherById.has(first.id), true)
  assert.equal(model.pointWeatherById.has(closeName.id), false)
  assert.equal(model.pointWeatherById.has(technical.id), false)
})

test('formats compact values and omits every absent fragment without false zero', () => {
  const routePoint = point('col', 'col', 1_500, 9 * 60)
  const model = buildDocumentedPointWeatherListViewModel(
    state([forecastWaypoint(routePoint, hourly('2026-08-12T09:00', {
      precipitationProbabilityPct: null,
      precipitationMm: null,
      windGustsKph: null,
    }))]),
    [routePoint],
    '2026-08-01',
  ).pointWeatherById.get(routePoint.id)
  const summary = formatDocumentedPointWeatherSummary(model)

  assert.match(summary, /12.*°C/)
  assert.doesNotMatch(summary, /pluie|mm|rafales|0 km\/h/)
})

test('reuses existing risk rules and hides normal risk while retaining significant levels', () => {
  const routePoint = point('high-col', 'col', 2_200, 9 * 60)
  const risky = buildDocumentedPointWeatherListViewModel(
    state([forecastWaypoint(routePoint, hourly('2026-08-12T09:00', {
      windGustsKph: 90,
    }))]),
    [routePoint],
    '2026-08-01',
  ).pointWeatherById.get(routePoint.id)
  const normal = buildDocumentedPointWeatherListViewModel(
    state([forecastWaypoint(routePoint, hourly('2026-08-12T09:00', {
      precipitationProbabilityPct: 10,
      precipitationMm: 0,
      weatherCode: 0,
      temperatureC: 18,
      apparentTemperatureC: 18,
      windSpeedKph: 5,
      windGustsKph: 10,
      freezingLevelM: 4_000,
    }))]),
    [routePoint],
    '2026-08-01',
  ).pointWeatherById.get(routePoint.id)

  assert.ok(risky.riskLevel === 'orange' || risky.riskLevel === 'red')
  assert.ok(risky.riskReasons.length > 0)
  assert.equal(normal.riskLevel, 'green')
})

test('outside horizon exposes current data only for start, highest documented col and finish', () => {
  const points = [
    point('start', 'start', 400, 8 * 60),
    point('village', 'passage', 700, 9 * 60),
    point('low-col', 'col', 1_100, 10 * 60),
    point('high-col', 'col', 1_900, 11 * 60),
    point('finish', 'end', 900, 12 * 60),
  ]
  const currentWaypoints = points.map((pointValue) => ({
    samplePoint: sample(pointValue),
    forecastTimeLocal: '2026-07-29T08:00',
    forecastOffsetMinutes: 0,
    weather: hourly('2026-07-29T08:00'),
    state: 'available',
  }))
  const outsideState = state([], {
    receivedDates: ['2026-07-29'],
    data: {
      ...state([]).data,
      currentWaypoints,
    },
  })
  const model = buildDocumentedPointWeatherListViewModel(
    outsideState,
    points,
    '2026-07-29',
  )

  assert.deepEqual([...model.pointWeatherById.keys()], ['start', 'high-col', 'finish'])
  assert.match(model.note, /prévisions du voyage ne sont pas encore disponibles/)
  for (const weather of model.pointWeatherById.values()) {
    assert.equal(weather.isCurrentNonPredictive, true)
    assert.match(
      formatDocumentedPointWeatherSummary(weather),
      /^Aujourd’hui · information actuelle, non prévisionnelle/,
    )
  }
})

test('outside-horizon request locations are limited to the same three deterministic roles', () => {
  const points = [
    point('start-request', 'start', 400, 8 * 60),
    point('village-request', 'passage', 700, 9 * 60),
    point('low-col-request', 'col', 1_100, 10 * 60),
    point('high-col-request', 'col', 1_900, 11 * 60),
    point('finish-request', 'end', 900, 12 * 60),
  ]
  const selected = selectCurrentReferenceSamplePoints(points.map(sample))

  assert.deepEqual(
    selected.map(({ sourcePointIds }) => sourcePointIds[0]),
    ['start-request', 'high-col-request', 'finish-request'],
  )
})

test('a local weather failure never removes the documented point contract', () => {
  const routePoint = point('unavailable-point', 'passage', 800, 9 * 60)
  const unavailable = forecastWaypoint(routePoint)
  unavailable.state = 'unavailable'
  unavailable.weather = null
  unavailable.documentedForecasts[0].state = 'unavailable'
  unavailable.documentedForecasts[0].weather = null
  unavailable.documentedForecasts[0].reason = 'Localisation indisponible.'
  const model = buildDocumentedPointWeatherListViewModel(
    state([unavailable]),
    [routePoint],
    '2026-08-01',
  )

  assert.equal(model.pointWeatherById.get(routePoint.id).forecastStatus, 'unavailable')
  assert.equal(formatDocumentedPointWeatherSummary(model.pointWeatherById.get(routePoint.id)), 'Météo indisponible')
})

test('Parcours stays static with at most one compact weather and risk line per point', () => {
  const routePoint = point('static-col', 'col', 1_500, 9 * 60)
  const weather = buildDocumentedPointWeatherListViewModel(
    state([forecastWaypoint(routePoint, hourly('2026-08-12T09:00', {
      windGustsKph: 90,
    }))]),
    [routePoint],
    '2026-08-01',
  )
  const report = { days: [], allPointMatches: [routePoint] }
  const route = { pauses: [] }
  const html = buildRouteDisplayPoints(route, 'J1', report, null, weather)[0].html

  assert.equal((html.match(/data-point-weather(?:\s|>)/g) ?? []).length, 1)
  assert.equal((html.match(/data-point-risk-level/g) ?? []).length, 1)
  assert.doesNotMatch(html, /<details|Détail|route-point--generated/)
  assert.match(html, /data-route-point-id='static-col'/)
})

test('each documented reference selects the forecast hour from its own ETA', () => {
  const first = point('first-reference', 'passage', 800, 8 * 60 + 10)
  const second = point('second-reference', 'passage', 805, 9 * 60 + 40)
  const groupedSample = {
    ...sample(first),
    sourcePointIds: [first.id, second.id],
    references: [
      sample(first).references[0],
      sample(second).references[0],
    ],
  }
  const location = {
    id: 'location-grouped',
    name: 'Grouped',
    latitude: 46,
    longitude: 6.5,
    elevationM: 800,
    samplePointIds: [groupedSample.id],
  }
  const definition = {
    dayId: 'J1',
    dayType: 'ride',
    tripDate: '2026-08-12',
    samplePoints: [groupedSample],
    locations: [location],
    requiredDates: ['2026-08-12'],
  }
  const result = {
    provider: 'open-meteo',
    requestKey: 'grouped',
    fetchedAt: '2026-08-01T08:00:00.000Z',
    status: 'success',
    datesCovered: ['2026-08-12'],
    issues: [],
    locations: [{
      status: 'success',
      requestLocationId: location.id,
      requestedLatitude: 46,
      requestedLongitude: 6.5,
      requestedElevationM: 800,
      providerLatitude: 46,
      providerLongitude: 6.5,
      providerElevationM: 800,
      timezone: 'Europe/Paris',
      utcOffsetSeconds: 7_200,
      hourly: [
        hourly('2026-08-12T08:00'),
        hourly('2026-08-12T10:00'),
      ],
      daily: [],
      missingVariables: [],
      issues: [],
    }],
  }
  const data = associateWeatherDay(
    definition,
    result,
    '2026-08-01',
    '2026-08-01T10:00',
  )
  const forecasts = data.waypoints[0].documentedForecasts

  assert.equal(forecasts.find(({ pointId }) => pointId === first.id).forecastTimeLocal, '2026-08-12T08:00')
  assert.equal(forecasts.find(({ pointId }) => pointId === second.id).forecastTimeLocal, '2026-08-12T10:00')
})
