import test from 'node:test'
import assert from 'node:assert/strict'

import {
  TRIP_CALENDAR,
  addIsoDays,
  buildTripCalendar,
  getTripDate,
} from '../../src/trip/calendar.ts'
import { rga2026TripPlan } from '../../src/trip/plan.ts'
import { WeatherCache } from '../../src/weather/cache.ts'
import { weatherConfig } from '../../src/weather/config.ts'
import { WeatherCoordinator } from '../../src/weather/coordinator.ts'
import {
  createOpenMeteoProvider,
  createWeatherRequest,
  normalizeOpenMeteoResponse,
} from '../../src/weather/open-meteo.ts'
import { WeatherProviderError } from '../../src/weather/provider.ts'
import {
  buildWeatherDayDefinitions,
  deduplicateMatchedWeatherPoints,
  shouldDeduplicateWeatherPoints,
} from '../../src/weather/sample-points.ts'
import {
  associateWeatherDay,
  getExpectedWeatherHorizon,
  isWithinExpectedWeatherHorizon,
  selectNearestHourlyForecast,
  toEtaLocal,
} from '../../src/weather/selectors.ts'
import { getWeatherCodeLabel } from '../../src/weather/weather-code.ts'
import { renderWeatherDetail } from '../../src/ui/weather-detail.ts'

const HOURLY_UNITS = {
  temperature_2m: '°C',
  apparent_temperature: '°C',
  relative_humidity_2m: '%',
  precipitation_probability: '%',
  precipitation: 'mm',
  rain: 'mm',
  showers: 'mm',
  snowfall: 'cm',
  weather_code: 'wmo code',
  cloud_cover: '%',
  visibility: 'm',
  wind_speed_10m: 'km/h',
  wind_direction_10m: '°',
  wind_gusts_10m: 'km/h',
  freezing_level_height: 'm',
}

const DAILY_UNITS = {
  temperature_2m_min: '°C',
  temperature_2m_max: '°C',
  apparent_temperature_min: '°C',
  apparent_temperature_max: '°C',
  precipitation_sum: 'mm',
  precipitation_probability_max: '%',
  weather_code: 'wmo code',
  wind_speed_10m_max: 'km/h',
  wind_gusts_10m_max: 'km/h',
  wind_direction_10m_dominant: '°',
  sunrise: 'iso8601',
  sunset: 'iso8601',
}

const HOURLY_VALUES = {
  temperature_2m: 12,
  apparent_temperature: 11,
  relative_humidity_2m: 70,
  precipitation_probability: 30,
  precipitation: 0.4,
  rain: 0.3,
  showers: 0.1,
  snowfall: 0,
  weather_code: 61,
  cloud_cover: 65,
  visibility: 12_000,
  wind_speed_10m: 18,
  wind_direction_10m: 245,
  wind_gusts_10m: 31,
  freezing_level_height: 2_900,
}

const DAILY_VALUES = {
  temperature_2m_min: 7,
  temperature_2m_max: 19,
  apparent_temperature_min: 5,
  apparent_temperature_max: 18,
  precipitation_sum: 2.5,
  precipitation_probability_max: 55,
  weather_code: 63,
  wind_speed_10m_max: 25,
  wind_gusts_10m_max: 42,
  wind_direction_10m_dominant: 250,
}

function makeRawLocation({
  latitude = 45.5,
  longitude = 6.5,
  elevation = 1_200,
  locationId,
  dates = ['2026-08-10'],
  hours = ['08:00', '09:00'],
} = {}) {
  const hourlyTimes = dates.flatMap((date) =>
    hours.map((hour) => `${date}T${hour}`),
  )
  const hourly = { time: hourlyTimes }
  for (const variable of weatherConfig.hourlyVariables) {
    hourly[variable] = hourlyTimes.map(
      (_, index) => HOURLY_VALUES[variable] + index,
    )
  }

  const daily = { time: [...dates] }
  for (const variable of weatherConfig.dailyVariables) {
    if (variable === 'sunrise' || variable === 'sunset') {
      const time = variable === 'sunrise' ? '06:30' : '20:45'
      daily[variable] = dates.map((date) => `${date}T${time}`)
    } else {
      daily[variable] = dates.map(
        (_, index) => DAILY_VALUES[variable] + index,
      )
    }
  }

  return {
    ...(locationId === undefined ? {} : { location_id: locationId }),
    latitude,
    longitude,
    elevation,
    timezone: 'Europe/Paris',
    timezone_abbreviation: 'CEST',
    utc_offset_seconds: 7_200,
    hourly,
    hourly_units: { ...HOURLY_UNITS },
    daily,
    daily_units: { ...DAILY_UNITS },
  }
}

function makeClockTime(clockMinutes = 8 * 60, dayOffset = 0) {
  return {
    totalMinutesFromDeparture: clockMinutes - 8 * 60 + dayOffset * 1_440,
    clockMinutes,
    dayOffset,
  }
}

function makeSamplePoint({
  id = 'weather-J1-point-1',
  dayId = 'J1',
  dayType = 'ride',
  tripDate = '2026-08-10',
  eta = makeClockTime(),
  latitude = 45.5,
  longitude = 6.5,
  elevationM = 1_200,
} = {}) {
  const isOff = dayType === 'off'
  return {
    id,
    dayId,
    dayType,
    tripDate,
    name: isOff ? 'Journée OFF' : `Point ${id}`,
    type: isOff ? 'off-location' : 'passage',
    latitude,
    longitude,
    elevationM,
    ...(!isOff ? { trackDistanceKm: 12, eta } : {}),
    sourcePointIds: [id.replace('weather-', '')],
    references: isOff
      ? []
      : [
          {
            pointId: id.replace('weather-', ''),
            name: `Point ${id}`,
            type: 'passage',
            trackDistanceKm: 12,
            eta,
          },
        ],
    source: isOff ? 'adjacent-endpoint' : 'roadbook-matched',
  }
}

function makeDefinition({
  dayId = 'J1',
  dayType = 'ride',
  tripDate = '2026-08-10',
  eta = makeClockTime(),
  requiredDates = [tripDate],
  suffix = '1',
} = {}) {
  const samplePoint = makeSamplePoint({
    id: `weather-${dayId}-point-${suffix}`,
    dayId,
    dayType,
    tripDate,
    eta,
    latitude: 45.5 + Number(suffix) / 100,
    longitude: 6.5 + Number(suffix) / 100,
  })
  const location = {
    id: `location-${samplePoint.id}`,
    name: samplePoint.name,
    latitude: samplePoint.latitude,
    longitude: samplePoint.longitude,
    elevationM: samplePoint.elevationM,
    samplePointIds: [samplePoint.id],
  }
  return {
    dayId,
    dayType,
    tripDate,
    samplePoints: [samplePoint],
    locations: [location],
    requiredDates,
  }
}

function makeMultiDefinition() {
  const first = makeDefinition({ suffix: '1' })
  const secondPoint = makeSamplePoint({
    id: 'weather-J1-point-2',
    latitude: 46.2,
    longitude: 7.2,
    elevationM: 1_700,
  })
  return {
    ...first,
    samplePoints: [...first.samplePoints, secondPoint],
    locations: [
      ...first.locations,
      {
        id: 'location-weather-J1-point-2',
        name: secondPoint.name,
        latitude: secondPoint.latitude,
        longitude: secondPoint.longitude,
        elevationM: secondPoint.elevationM,
        samplePointIds: [secondPoint.id],
      },
    ],
  }
}

function makeForecastForRequest(
  request,
  fetchedAt = '2026-07-27T10:00:00.000Z',
) {
  const rawLocations = request.locations.map((location, index) =>
    makeRawLocation({
      latitude: location.latitude,
      longitude: location.longitude,
      elevation: location.elevationM,
      locationId: index,
      dates: request.requiredDates,
    }),
  )
  const raw = rawLocations.length === 1 ? rawLocations[0] : rawLocations
  return normalizeOpenMeteoResponse(raw, request, fetchedAt)
}

function makeHourly(time, overrides = {}) {
  return {
    time,
    temperatureC: 12,
    apparentTemperatureC: 11,
    relativeHumidityPct: 70,
    precipitationProbabilityPct: 30,
    precipitationMm: 0.4,
    rainMm: 0.3,
    showersMm: 0.1,
    snowfallCm: 0,
    weatherCode: 61,
    cloudCoverPct: 65,
    visibilityM: 12_000,
    windSpeedKph: 18,
    windDirectionDeg: 245,
    windGustsKph: 31,
    freezingLevelM: 2_900,
    ...overrides,
  }
}

function makeRoadbookPoint({
  id = 'point-a',
  dayId = 'J1',
  status = 'matched',
  resolution = status === 'matched' ? 'matched' : 'user-decision-required',
  type = 'passage',
  latitude = 45,
  longitude = 6,
  elevationM = 1_000,
  trackDistanceKm = 10,
  pointIndex = 100,
  nextPointIndex = pointIndex + 1,
  segmentFraction = 0.25,
} = {}) {
  return {
    id,
    dayId,
    type,
    name: id,
    status,
    resolution,
    sourceKind: type === 'col' ? 'col' : 'passage-group',
    alternatives: [],
    overrideApplied: true,
    standaloneWaypoint: false,
    matchedLatitude: latitude,
    matchedLongitude: longitude,
    matchedElevationM: elevationM,
    matchedTrackDistanceKm: trackDistanceKm,
    matchedSegmentIndex: 0,
    matchedPointIndex: pointIndex,
    matchedNextPointIndex: nextPointIndex,
    matchedSegmentFraction: segmentFraction,
    eta: makeClockTime(8 * 60 + Math.round(trackDistanceKm)),
  }
}

class MemoryStorage {
  constructor(initial = {}) {
    this.values = new Map(Object.entries(initial))
  }

  getItem(key) {
    return this.values.get(key) ?? null
  }

  setItem(key, value) {
    this.values.set(key, value)
  }

  removeItem(key) {
    this.values.delete(key)
  }
}

class FakeElement {
  constructor() {
    this.dataset = {}
    this.attributes = new Map()
    this.innerHTML = ''
  }

  setAttribute(name, value) {
    this.attributes.set(name, value)
  }

  removeAttribute(name) {
    this.attributes.delete(name)
  }
}

function createDeferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function flushTasks() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

test('normalizes a complete single-location Open-Meteo response', () => {
  const request = createWeatherRequest(makeDefinition())
  const result = normalizeOpenMeteoResponse(
    makeRawLocation(),
    request,
    '2026-07-27T10:00:00.000Z',
  )

  assert.equal(result.status, 'success')
  assert.deepEqual(result.datesCovered, ['2026-08-10'])
  assert.equal(result.locations.length, 1)

  const [location] = result.locations
  assert.equal(location.status, 'success')
  assert.equal(location.requestLocationId, request.locations[0].id)
  assert.equal(location.hourly.length, 2)
  assert.equal(location.hourly[0].temperatureC, 12)
  assert.equal(location.daily.length, 1)
  assert.equal(location.daily[0].temperatureMaxC, 19)
  assert.deepEqual(location.missingVariables, [])
  assert.deepEqual(location.issues, [])
})

test('keeps the received horizon while retaining only useful normalized dates', () => {
  const request = createWeatherRequest(makeDefinition())
  const result = normalizeOpenMeteoResponse(
    makeRawLocation({
      dates: ['2026-08-09', '2026-08-10', '2026-08-11'],
    }),
    request,
    '2026-07-27T10:00:00.000Z',
  )
  const [location] = result.locations

  assert.deepEqual(result.datesCovered, [
    '2026-08-09',
    '2026-08-10',
    '2026-08-11',
  ])
  assert.equal(location.status, 'success')
  assert.equal(location.hourly.length, 2)
  assert.equal(location.daily.length, 1)
})

test('normalizes and realigns a multi-location response by location_id', () => {
  const request = createWeatherRequest(makeMultiDefinition())
  const raw = [
    makeRawLocation({
      latitude: 46.2,
      longitude: 7.2,
      elevation: 1_700,
      locationId: 1,
    }),
    makeRawLocation({
      latitude: 45.51,
      longitude: 6.51,
      elevation: 1_200,
      locationId: 0,
    }),
  ]

  const result = normalizeOpenMeteoResponse(
    raw,
    request,
    '2026-07-27T10:00:00.000Z',
  )

  assert.equal(result.status, 'success')
  assert.deepEqual(
    result.locations.map(({ requestLocationId }) => requestLocationId),
    request.locations.map(({ id }) => id),
  )
  assert.equal(result.locations[0].status, 'success')
  assert.equal(result.locations[0].providerLatitude, 45.51)
  assert.equal(result.locations[1].status, 'success')
  assert.equal(result.locations[1].providerLatitude, 46.2)
})

test('isolates a failed location in a partial multi-location response', () => {
  const request = createWeatherRequest(makeMultiDefinition())
  const result = normalizeOpenMeteoResponse(
    [
      makeRawLocation({ locationId: 0 }),
      { location_id: 1, error: true, reason: 'Location indisponible' },
    ],
    request,
    '2026-07-27T10:00:00.000Z',
  )

  assert.equal(result.status, 'partial')
  assert.equal(result.locations[0].status, 'success')
  assert.deepEqual(result.locations[1], {
    status: 'error',
    requestLocationId: request.locations[1].id,
    message: 'Location indisponible',
  })
  assert.match(result.issues.join(' '), /Location indisponible/)
})

test('marks missing variables and incoherent column lengths as partial', () => {
  const request = createWeatherRequest(makeDefinition())
  const raw = makeRawLocation()
  delete raw.hourly.showers
  delete raw.hourly_units.showers
  raw.hourly.wind_speed_10m = [18]

  const result = normalizeOpenMeteoResponse(
    raw,
    request,
    '2026-07-27T10:00:00.000Z',
  )
  const [location] = result.locations

  assert.equal(result.status, 'partial')
  assert.equal(location.status, 'success')
  assert.ok(location.missingVariables.includes('showers'))
  assert.ok(location.missingVariables.includes('wind_speed_10m'))
  assert.equal(location.hourly[0].showersMm, null)
  assert.equal(location.hourly[1].windSpeedKph, null)
})

test('rejects an invalid mono- or multi-location response shape', () => {
  const singleRequest = createWeatherRequest(makeDefinition())
  const multiRequest = createWeatherRequest(makeMultiDefinition())

  assert.throws(
    () =>
      normalizeOpenMeteoResponse(
        [],
        singleRequest,
        '2026-07-27T10:00:00.000Z',
      ),
    (error) =>
      error instanceof WeatherProviderError &&
      error.kind === 'invalid-response',
  )
  assert.throws(
    () =>
      normalizeOpenMeteoResponse(
        {},
        multiRequest,
        '2026-07-27T10:00:00.000Z',
      ),
    (error) =>
      error instanceof WeatherProviderError &&
      error.kind === 'invalid-response',
  )
})

test('provider reports HTTP, invalid JSON, network and abort failures', async (t) => {
  const request = createWeatherRequest(makeDefinition())
  const cases = [
    {
      name: 'HTTP',
      fetch: async () => new Response('{}', { status: 503 }),
      kind: 'http',
      status: 503,
    },
    {
      name: 'invalid JSON',
      fetch: async () => new Response('{', { status: 200 }),
      kind: 'invalid-json',
    },
    {
      name: 'network',
      fetch: async () => {
        throw new TypeError('offline')
      },
      kind: 'network',
    },
    {
      name: 'abort',
      fetch: async () => {
        const error = new Error('cancelled')
        error.name = 'AbortError'
        throw error
      },
      kind: 'aborted',
    },
  ]

  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const provider = createOpenMeteoProvider(scenario.fetch)
      await assert.rejects(
        provider.fetchForecast(request),
        (error) => {
          assert.ok(error instanceof WeatherProviderError)
          assert.equal(error.kind, scenario.kind)
          if (scenario.status !== undefined) {
            assert.equal(error.status, scenario.status)
          }
          return true
        },
      )
    })
  }
})

test('selects the nearest hour, prefers the earlier one on ties, and enforces the offset', () => {
  const hourly = [
    makeHourly('2026-08-10T08:00'),
    makeHourly('2026-08-10T09:00'),
  ]

  const tie = selectNearestHourlyForecast(hourly, '2026-08-10T08:30')
  assert.equal(tie.weather.time, '2026-08-10T08:00')
  assert.equal(tie.offsetMinutes, -30)
  assert.equal(
    selectNearestHourlyForecast(hourly, '2026-08-10T08:30', 29),
    null,
  )
})

test('converts an ETA across midnight with its explicit day offset', () => {
  assert.equal(
    toEtaLocal('2026-08-10', makeClockTime(20, 1)),
    '2026-08-11T00:20',
  )
  assert.equal(
    toEtaLocal('2026-08-11', makeClockTime(8 * 60, 0)),
    '2026-08-11T08:00',
  )
})

test('uses the centralized French WMO fallback', () => {
  assert.equal(getWeatherCodeLabel(95), 'Orage')
  assert.equal(getWeatherCodeLabel(1234), 'Conditions non identifiées')
  assert.equal(getWeatherCodeLabel(null), 'Conditions non identifiées')
})

test('renders distinct ride, OFF and outside-horizon weather panels', () => {
  const fetchedAt = '2026-07-27T10:00:00.000Z'
  const rideDefinition = makeDefinition()
  const rideRequest = createWeatherRequest(rideDefinition)
  const rideData = associateWeatherDay(
    rideDefinition,
    makeForecastForRequest(rideRequest, fetchedAt),
  )
  const rideContainer = new FakeElement()
  renderWeatherDetail(
    rideContainer,
    {
      dayId: 'J1',
      dayType: 'ride',
      tripDate: '2026-08-10',
      availability: 'available',
      cacheState: 'fresh',
      source: 'network',
      fetchedAt,
      receivedDates: ['2026-07-27', '2026-08-11'],
      data: rideData,
      isRefreshing: false,
      departureScenarios: null,
    },
    new Date('2026-08-08T10:00:00.000Z'),
  )
  assert.equal(rideContainer.dataset.weatherMode, 'operational')
  assert.match(rideContainer.innerHTML, /data-weather-ride-summary/)
  assert.match(rideContainer.innerHTML, /Altitude/)
  assert.match(rideContainer.innerHTML, /Visibilité/)
  assert.match(rideContainer.innerHTML, /ETA/)
  assert.match(rideContainer.innerHTML, /Horizon reçu/)

  const offDefinition = makeDefinition({
    dayId: 'J5',
    dayType: 'off',
    tripDate: '2026-08-14',
    requiredDates: ['2026-08-14'],
    suffix: '5',
  })
  const offRequest = createWeatherRequest(offDefinition)
  const offData = associateWeatherDay(
    offDefinition,
    makeForecastForRequest(offRequest, fetchedAt),
  )
  const offContainer = new FakeElement()
  renderWeatherDetail(
    offContainer,
    {
      dayId: 'J5',
      dayType: 'off',
      tripDate: '2026-08-14',
      availability: 'available',
      cacheState: 'fresh',
      source: 'network',
      fetchedAt,
      receivedDates: ['2026-08-14'],
      data: offData,
      isRefreshing: false,
      departureScenarios: null,
    },
    new Date('2026-08-12T10:00:00.000Z'),
  )
  assert.equal(offContainer.dataset.weatherMode, 'operational')
  assert.match(offContainer.innerHTML, /data-weather-off-summary/)
  assert.doesNotMatch(offContainer.innerHTML, /ETA|GPX/)

  const outsideContainer = new FakeElement()
  renderWeatherDetail(
    outsideContainer,
    {
      dayId: 'J12',
      dayType: 'ride',
      tripDate: '2026-08-21',
      availability: 'outside-horizon',
      cacheState: 'miss',
      source: 'none',
      fetchedAt: null,
      receivedDates: [],
      data: null,
      isRefreshing: false,
      departureScenarios: null,
    },
    new Date('2026-08-08T10:00:00.000Z'),
  )
  assert.equal(outsideContainer.dataset.weatherMode, 'today-reference')
  assert.match(outsideContainer.innerHTML, /2026-08-21/)
  assert.match(outsideContainer.innerHTML, /Aujourd.hui sur le parcours/)
  assert.match(
    outsideContainer.innerHTML,
    /sans valeur prévisionnelle pour le/,
  )
})

test('builds an independent 12-day calendar and evaluates the 16-day horizon', () => {
  const calendar = buildTripCalendar(rga2026TripPlan)

  assert.equal(TRIP_CALENDAR.startDate, '2026-08-12')
  assert.equal(TRIP_CALENDAR.status, 'confirmed')
  assert.equal(getTripDate(1), '2026-08-12')
  assert.equal(getTripDate(2), '2026-08-13')
  assert.equal(getTripDate(12), '2026-08-23')
  assert.equal(calendar.length, 12)
  assert.deepEqual(calendar.map(({ date }) => date), [
    '2026-08-12',
    '2026-08-13',
    '2026-08-14',
    '2026-08-15',
    '2026-08-16',
    '2026-08-17',
    '2026-08-18',
    '2026-08-19',
    '2026-08-20',
    '2026-08-21',
    '2026-08-22',
    '2026-08-23',
  ])

  const now = new Date('2026-07-27T10:00:00.000Z')
  assert.deepEqual(getExpectedWeatherHorizon(now), {
    startDate: '2026-07-27',
    endDate: '2026-08-11',
  })
  assert.equal(isWithinExpectedWeatherHorizon('2026-08-10', now), true)
  assert.equal(isWithinExpectedWeatherHorizon('2026-08-11', now), true)
  assert.equal(isWithinExpectedWeatherHorizon('2026-08-12', now), false)
})

test('builds an OFF-day weather point from an adjacent endpoint without ETA', () => {
  const timeline = {
    tripId: rga2026TripPlan.id,
    settings: {},
    days: rga2026TripPlan.days.map((day) =>
      day.type === 'off'
        ? { type: 'off', day }
        : {
            type: 'ride',
            status: 'unavailable',
            day,
            message: 'Fixture sans chronologie',
          },
    ),
    summary: {},
  }
  const report = {
    allPointMatches: [
      makeRoadbookPoint({
        id: 'j04-end',
        dayId: 'J4',
        type: 'end',
        latitude: 45.62,
        longitude: 6.77,
        elevationM: 840,
      }),
    ],
  }

  const definitions = buildWeatherDayDefinitions(
    rga2026TripPlan,
    timeline,
    report,
    '2026-07-27',
  )
  const definition = definitions.find(({ dayId }) => dayId === 'J5')

  assert.equal(definition.dayType, 'off')
  assert.equal(definition.samplePoints.length, 1)
  assert.equal(definition.samplePoints[0].source, 'adjacent-endpoint')
  assert.equal(definition.samplePoints[0].eta, undefined)
  assert.deepEqual(definition.requiredDates, ['2026-07-27', '2026-08-16'])

  const result = makeForecastForRequest(createWeatherRequest(definition))
  const associated = associateWeatherDay(definition, result, '2026-07-27')
  assert.equal(associated.type, 'off')
  assert.equal(associated.samplePoint.eta, undefined)
  assert.equal(associated.daily.date, '2026-08-16')
  assert.equal(associated.hourly.length, 2)
})

test('deduplicates exact projections and nearby points only below strict thresholds', () => {
  const exactLeft = makeRoadbookPoint({
    id: 'exact-left',
    latitude: 45,
    longitude: 6,
  })
  const exactRight = makeRoadbookPoint({
    id: 'exact-right',
    latitude: 46,
    longitude: 7,
    elevationM: 2_000,
  })
  assert.equal(shouldDeduplicateWeatherPoints(exactLeft, exactRight), true)

  const nearby = makeRoadbookPoint({
    id: 'nearby',
    longitude: 6.0007,
    elevationM: 1_029,
    pointIndex: 200,
  })
  assert.equal(shouldDeduplicateWeatherPoints(exactLeft, nearby), true)

  const elevationBoundary = makeRoadbookPoint({
    id: 'elevation-boundary',
    longitude: 6.0007,
    elevationM: 1_030,
    pointIndex: 300,
  })
  assert.equal(
    shouldDeduplicateWeatherPoints(exactLeft, elevationBoundary),
    false,
  )
})

test('filters review, unmatched and Cime points before weather sampling', () => {
  const operational = makeRoadbookPoint({ id: 'operational' })
  const review = makeRoadbookPoint({ id: 'review', status: 'review' })
  const unmatched = makeRoadbookPoint({
    id: 'unmatched',
    status: 'unmatched',
  })
  const excludedCime = makeRoadbookPoint({
    id: 'j10-option-cime-de-la-bonette',
    dayId: 'J10',
    resolution: 'excluded',
  })

  const groups = deduplicateMatchedWeatherPoints([
    operational,
    review,
    unmatched,
    excludedCime,
  ])

  assert.equal(groups.length, 1)
  assert.deepEqual(
    groups.flatMap(({ members }) => members.map(({ id }) => id)),
    ['operational'],
  )
})

test('uses complete-link grouping to avoid transitive deduplication chains', () => {
  const points = [
    makeRoadbookPoint({
      id: 'a',
      longitude: 6,
      trackDistanceKm: 10,
      pointIndex: 100,
    }),
    makeRoadbookPoint({
      id: 'b',
      longitude: 6.0007,
      trackDistanceKm: 11,
      pointIndex: 200,
    }),
    makeRoadbookPoint({
      id: 'c',
      longitude: 6.0014,
      trackDistanceKm: 12,
      pointIndex: 300,
    }),
  ]

  assert.equal(shouldDeduplicateWeatherPoints(points[0], points[1]), true)
  assert.equal(shouldDeduplicateWeatherPoints(points[1], points[2]), true)
  assert.equal(shouldDeduplicateWeatherPoints(points[0], points[2]), false)
  assert.deepEqual(
    deduplicateMatchedWeatherPoints(points).map(({ members }) => members.length),
    [2, 1],
  )
})

test('returns fresh, stale and invalid cache states deterministically', () => {
  const storage = new MemoryStorage()
  const cache = new WeatherCache(storage)
  const request = createWeatherRequest(makeDefinition())
  const result = makeForecastForRequest(
    request,
    '2026-07-27T10:00:00.000Z',
  )

  assert.equal(
    cache.put(request, result, new Date('2026-07-27T10:00:00.000Z')),
    true,
  )
  assert.equal(
    cache.get(request, new Date('2026-07-27T10:29:59.999Z')).state,
    'fresh',
  )
  assert.equal(
    cache.get(request, new Date('2026-07-27T10:30:00.000Z')).state,
    'stale',
  )

  storage.setItem(weatherConfig.cacheKey, '{invalid JSON')
  assert.equal(cache.get(request, new Date('2026-07-27T10:10:00.000Z')), null)

  storage.setItem(
    weatherConfig.cacheKey,
    JSON.stringify({ version: 999, provider: 'open-meteo', entries: [] }),
  )
  assert.equal(cache.get(request, new Date('2026-07-27T10:10:00.000Z')), null)
})

test('coordinator serves a fresh cache entry without fetching', async () => {
  const now = new Date('2026-07-27T10:10:00.000Z')
  const definition = makeDefinition()
  const request = createWeatherRequest(definition)
  const cache = new WeatherCache(new MemoryStorage())
  cache.put(
    request,
    makeForecastForRequest(request, '2026-07-27T10:00:00.000Z'),
    now,
  )
  let calls = 0
  const coordinator = new WeatherCoordinator({
    cache,
    now: () => now,
    provider: {
      id: 'open-meteo',
      async fetchForecast() {
        calls += 1
        throw new Error('unexpected fetch')
      },
    },
  })

  coordinator.setDefinitions([definition], 'J1')
  await coordinator.waitForIdle()
  const state = coordinator.getState('J1')

  assert.equal(calls, 0)
  assert.equal(state.availability, 'available')
  assert.equal(state.source, 'cache')
  assert.equal(state.cacheState, 'fresh')
  assert.equal(state.data.type, 'ride')
  coordinator.dispose()
})

test('coordinator refreshes stale data and retains it after a provider failure', async () => {
  const now = new Date('2026-07-27T11:00:00.000Z')
  const definition = makeDefinition()
  const request = createWeatherRequest(definition)
  const cache = new WeatherCache(new MemoryStorage())
  cache.put(
    request,
    makeForecastForRequest(request, '2026-07-27T10:00:00.000Z'),
    now,
  )
  let calls = 0
  const coordinator = new WeatherCoordinator({
    cache,
    now: () => now,
    provider: {
      id: 'open-meteo',
      async fetchForecast() {
        calls += 1
        throw new Error('offline')
      },
    },
  })

  coordinator.setDefinitions([definition], 'J1')
  await coordinator.waitForIdle()
  const state = coordinator.getState('J1')

  assert.equal(calls, 1)
  assert.equal(state.availability, 'stale-cache')
  assert.equal(state.source, 'cache')
  assert.equal(state.cacheState, 'stale')
  assert.notEqual(state.data, null)
  assert.match(state.message, /offline/)
  coordinator.dispose()
})

test('coordinator coalesces concurrent forced refreshes for one request key', async () => {
  const now = new Date('2026-07-27T10:10:00.000Z')
  const definition = makeDefinition()
  const request = createWeatherRequest(definition)
  const cache = new WeatherCache(new MemoryStorage())
  cache.put(
    request,
    makeForecastForRequest(request, '2026-07-27T10:00:00.000Z'),
    now,
  )
  const deferred = createDeferred()
  let calls = 0
  let capturedRequest
  const coordinator = new WeatherCoordinator({
    cache,
    now: () => now,
    provider: {
      id: 'open-meteo',
      fetchForecast(providerRequest) {
        calls += 1
        capturedRequest = providerRequest
        return deferred.promise
      },
    },
  })

  coordinator.setDefinitions([definition], 'J1')
  const firstRefresh = coordinator.refreshSelected()
  const secondRefresh = coordinator.refreshSelected()
  assert.equal(calls, 1)

  deferred.resolve(
    makeForecastForRequest(capturedRequest, '2026-07-27T10:10:00.000Z'),
  )
  await Promise.all([firstRefresh, secondRefresh])

  const state = coordinator.getState('J1')
  assert.equal(calls, 1)
  assert.equal(state.availability, 'available')
  assert.equal(state.source, 'network')
  assert.equal(state.isRefreshing, false)
  coordinator.dispose()
})

test('coordinator re-associates a changed ETA without fetching the same signature', async () => {
  const now = new Date('2026-07-27T10:10:00.000Z')
  const initial = makeDefinition({ eta: makeClockTime(8 * 60) })
  let calls = 0
  const coordinator = new WeatherCoordinator({
    cache: new WeatherCache(new MemoryStorage()),
    now: () => now,
    provider: {
      id: 'open-meteo',
      async fetchForecast(request) {
        calls += 1
        return makeForecastForRequest(request, now.toISOString())
      },
    },
  })

  coordinator.setDefinitions([initial], 'J1')
  await coordinator.waitForIdle()
  assert.equal(calls, 1)
  assert.equal(
    coordinator.getState('J1').data.waypoints[0].etaLocal,
    '2026-08-10T08:00',
  )

  const updated = makeDefinition({ eta: makeClockTime(9 * 60) })
  assert.equal(
    createWeatherRequest(updated).key,
    createWeatherRequest(initial).key,
  )
  coordinator.setDefinitions([updated], 'J1')
  await coordinator.waitForIdle()

  assert.equal(calls, 1)
  assert.equal(
    coordinator.getState('J1').data.waypoints[0].etaLocal,
    '2026-08-10T09:00',
  )
  coordinator.dispose()
})

test('coordinator applies the latest ETA when an identical request completes in flight', async () => {
  const now = new Date('2026-07-27T10:10:00.000Z')
  const initial = makeDefinition({ eta: makeClockTime(8 * 60) })
  const updated = makeDefinition({ eta: makeClockTime(9 * 60) })
  const deferred = createDeferred()
  let calls = 0
  let capturedRequest
  const coordinator = new WeatherCoordinator({
    cache: new WeatherCache(new MemoryStorage()),
    now: () => now,
    provider: {
      id: 'open-meteo',
      async fetchForecast(request) {
        calls += 1
        capturedRequest = request
        return deferred.promise
      },
    },
  })

  coordinator.setDefinitions([initial], 'J1')
  coordinator.setDefinitions([updated], 'J1')
  assert.equal(calls, 1)

  deferred.resolve(
    makeForecastForRequest(capturedRequest, now.toISOString()),
  )
  await coordinator.waitForIdle()

  assert.equal(calls, 1)
  assert.equal(
    coordinator.getState('J1').data.waypoints[0].etaLocal,
    '2026-08-10T09:00',
  )
  coordinator.dispose()
})

test('coordinator fetches one grouped current-reference request outside the trip horizon', async () => {
  const definition = makeDefinition({
    dayId: 'J3',
    tripDate: '2026-08-12',
    requiredDates: ['2026-08-12'],
    suffix: '3',
  })
  let calls = 0
  const coordinator = new WeatherCoordinator({
    cache: new WeatherCache(new MemoryStorage()),
    now: () => new Date('2026-07-27T10:00:00.000Z'),
    provider: {
      id: 'open-meteo',
      async fetchForecast(request) {
        calls += 1
        return makeForecastForRequest(
          request,
          '2026-07-27T10:00:00.000Z',
          ['2026-07-27'],
        )
      },
    },
  })

  coordinator.setDefinitions([definition], 'J3')
  await coordinator.waitForIdle()

  assert.equal(calls, 1)
  assert.equal(coordinator.getState('J3').source, 'network')
  assert.equal(coordinator.getState('J3').data.type, 'ride')
  coordinator.dispose()
})

test('coordinator prioritizes the selected day and limits concurrency to two', async () => {
  const definitions = [
    makeDefinition({
      dayId: 'J1',
      tripDate: '2026-07-28',
      requiredDates: ['2026-07-28'],
      suffix: '1',
    }),
    makeDefinition({
      dayId: 'J2',
      tripDate: '2026-07-29',
      requiredDates: ['2026-07-29'],
      suffix: '2',
    }),
    makeDefinition({
      dayId: 'J3',
      tripDate: '2026-07-30',
      requiredDates: ['2026-07-30'],
      suffix: '3',
    }),
  ]
  const deferredByDay = new Map(
    definitions.map(({ dayId }) => [dayId, createDeferred()]),
  )
  const requestByDay = new Map()
  const starts = []
  let active = 0
  let maximumActive = 0
  const coordinator = new WeatherCoordinator({
    cache: new WeatherCache(new MemoryStorage()),
    now: () => new Date('2026-07-27T10:00:00.000Z'),
    maxConcurrentRequests: 2,
    provider: {
      id: 'open-meteo',
      fetchForecast(request) {
        starts.push(request.dayId)
        requestByDay.set(request.dayId, request)
        active += 1
        maximumActive = Math.max(maximumActive, active)
        return deferredByDay.get(request.dayId).promise.finally(() => {
          active -= 1
        })
      },
    },
  })

  coordinator.setDefinitions(definitions, 'J3')
  assert.deepEqual(starts, ['J3', 'J1'])
  assert.equal(maximumActive, 2)

  deferredByDay
    .get('J3')
    .resolve(makeForecastForRequest(requestByDay.get('J3')))
  await flushTasks()
  assert.deepEqual(starts, ['J3', 'J1', 'J2'])
  assert.equal(maximumActive, 2)

  deferredByDay
    .get('J1')
    .resolve(makeForecastForRequest(requestByDay.get('J1')))
  deferredByDay
    .get('J2')
    .resolve(makeForecastForRequest(requestByDay.get('J2')))
  await coordinator.waitForIdle()

  assert.equal(maximumActive, 2)
  for (const { dayId } of definitions) {
    assert.equal(coordinator.getState(dayId).availability, 'available')
  }
  coordinator.dispose()
})
