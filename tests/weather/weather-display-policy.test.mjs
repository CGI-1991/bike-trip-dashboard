import test from 'node:test'
import assert from 'node:assert/strict'

import {
  WEATHER_DISPLAY_THRESHOLDS,
  computeLiveProgress,
  getCoverageFromDates,
  getNowLocalDateTime,
  isDateWithinCoverage,
  isTripDateInPast,
  selectWeatherDisplayMode,
} from '../../src/weather/display-policy.ts'
import { renderWeatherDetail } from '../../src/ui/weather-detail.ts'

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

function makeClockTime(clockMinutes, dayOffset = 0) {
  return {
    totalMinutesFromDeparture: clockMinutes - 8 * 60 + dayOffset * 1_440,
    clockMinutes,
    dayOffset,
  }
}

function makeSamplePoint(id, type, hour, minute = 0) {
  return {
    id,
    dayId: 'J1',
    dayType: 'ride',
    tripDate: '2026-08-12',
    name: id,
    type,
    latitude: 45.5,
    longitude: 6.5,
    elevationM: 1_200,
    trackDistanceKm: 10,
    eta: makeClockTime(hour * 60 + minute),
    sourcePointIds: [id],
    references: [],
    source: 'roadbook-matched',
  }
}

function makeWaypoint(id, type, hour, minute = 0, overrides = {}) {
  const samplePoint = makeSamplePoint(id, type, hour, minute)
  const etaLocal = `2026-08-12T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  return {
    samplePoint,
    etaLocal,
    forecastTimeLocal: etaLocal,
    forecastOffsetMinutes: 0,
    weather: {
      time: etaLocal,
      temperatureC: 15,
      apparentTemperatureC: 14,
      relativeHumidityPct: 60,
      precipitationProbabilityPct: 10,
      precipitationMm: 0,
      rainMm: 0,
      showersMm: 0,
      snowfallCm: 0,
      weatherCode: 1,
      cloudCoverPct: 30,
      visibilityM: 20_000,
      windSpeedKph: 12,
      windDirectionDeg: 200,
      windGustsKph: 20,
      freezingLevelM: 3_200,
    },
    state: 'available',
    ...overrides,
  }
}

function makeRideDayWeather(waypoints) {
  return {
    type: 'ride',
    dayId: 'J1',
    tripDate: '2026-08-12',
    waypoints,
    routeSummary: {
      temperatureMinC: 10,
      temperatureMaxC: 20,
      apparentTemperatureMinC: 9,
      apparentTemperatureMaxC: 19,
      precipitationProbabilityMaxPct: 20,
      hourlyPrecipitationMaxMm: 1,
      windSpeedMaxKph: 15,
      windGustsMaxKph: 25,
      visibilityMinM: 15_000,
      freezingLevelMinM: 3_000,
      worstWeatherCode: 61,
      coveredPointCount: waypoints.length,
      missingPointCount: 0,
    },
    dailyByLocation: [],
    todayReference: {
      date: '2026-07-27',
      temperatureMinC: 8,
      temperatureMaxC: 18,
      precipitationSumMm: 0.5,
      precipitationProbabilityMaxPct: 15,
      windSpeedMaxKph: 10,
      windGustsMaxKph: 22,
      weatherCode: 2,
    },
  }
}

function makeState(overrides = {}) {
  return {
    dayId: 'J1',
    dayType: 'ride',
    tripDate: '2026-08-12',
    availability: 'available',
    cacheState: 'fresh',
    source: 'network',
    fetchedAt: '2026-07-27T09:00:00.000Z',
    receivedDates: ['2026-07-27', '2026-08-12'],
    data: null,
    isRefreshing: false,
    departureScenarios: null,
    ...overrides,
  }
}

test('centralizes the planning/operational thresholds', () => {
  assert.equal(WEATHER_DISPLAY_THRESHOLDS.operationalStartDaysBefore, 2)
  assert.equal(WEATHER_DISPLAY_THRESHOLDS.planningStartDaysBefore, 7)
})

test('selects past for any trip date before today, regardless of coverage', () => {
  assert.equal(
    selectWeatherDisplayMode({
      today: '2026-08-12',
      tripDate: '2026-08-11',
      coverage: { startDate: '2026-08-01', endDate: '2026-08-20' },
    }),
    'past',
  )
  assert.equal(isTripDateInPast('2026-08-11', '2026-08-12'), true)
  assert.equal(isTripDateInPast('2026-08-12', '2026-08-12'), false)
})

test('selects live exactly on the trip day', () => {
  assert.equal(
    selectWeatherDisplayMode({
      today: '2026-08-12',
      tripDate: '2026-08-12',
      coverage: { startDate: '2026-08-01', endDate: '2026-08-20' },
    }),
    'live',
  )
})

test('falls back to today-reference when there is no real coverage, even for a near-term day', () => {
  assert.equal(
    selectWeatherDisplayMode({ today: '2026-08-12', tripDate: '2026-08-13', coverage: null }),
    'today-reference',
  )
  assert.equal(
    selectWeatherDisplayMode({
      today: '2026-08-12',
      tripDate: '2026-08-13',
      coverage: { startDate: '2026-08-01', endDate: '2026-08-12' },
    }),
    'today-reference',
  )
})

test('bands operational, planning and trend by day offset once covered', () => {
  const coverage = { startDate: '2026-08-01', endDate: '2026-09-01' }
  const modeAt = (dayOffsetDays) =>
    selectWeatherDisplayMode({
      today: '2026-08-12',
      tripDate: `2026-08-${String(12 + dayOffsetDays).padStart(2, '0')}`,
      coverage,
    })

  assert.equal(modeAt(1), 'operational')
  assert.equal(modeAt(2), 'operational')
  assert.equal(modeAt(3), 'planning')
  assert.equal(modeAt(7), 'planning')
  assert.equal(modeAt(8), 'trend')
  assert.equal(modeAt(16), 'trend')
})

test('derives coverage from an unordered list of received dates, or null when empty', () => {
  assert.deepEqual(getCoverageFromDates(['2026-08-05', '2026-08-01', '2026-08-10']), {
    startDate: '2026-08-01',
    endDate: '2026-08-10',
  })
  assert.equal(getCoverageFromDates([]), null)
  assert.equal(
    isDateWithinCoverage('2026-08-01', { startDate: '2026-08-01', endDate: '2026-08-10' }),
    true,
  )
  assert.equal(
    isDateWithinCoverage('2026-07-31', { startDate: '2026-08-01', endDate: '2026-08-10' }),
    false,
  )
})

test('computes the local now datetime in a given timezone across a DST offset', () => {
  assert.equal(
    getNowLocalDateTime(new Date('2026-08-12T10:30:00.000Z'), 'Europe/Paris'),
    '2026-08-12T12:30',
  )
})

test('splits waypoints into past, next and upcoming around the current local time', () => {
  const waypoints = [
    makeWaypoint('start', 'start', 8, 0),
    makeWaypoint('col', 'col', 10, 30),
    makeWaypoint('passage', 'passage', 12, 0),
    makeWaypoint('end', 'end', 15, 0),
  ]

  const progress = computeLiveProgress(waypoints, '2026-08-12T11:00')

  assert.deepEqual(progress.past.map(({ samplePoint }) => samplePoint.id), ['start', 'col'])
  assert.equal(progress.next.samplePoint.id, 'passage')
  assert.deepEqual(progress.upcoming.map(({ samplePoint }) => samplePoint.id), ['end'])
})

test('treats every waypoint as past once the day is theoretically finished', () => {
  const waypoints = [makeWaypoint('start', 'start', 8, 0), makeWaypoint('end', 'end', 15, 0)]
  const progress = computeLiveProgress(waypoints, '2026-08-12T23:00')

  assert.equal(progress.next, null)
  assert.deepEqual(progress.past.map(({ samplePoint }) => samplePoint.id), ['start', 'end'])
  assert.deepEqual(progress.upcoming, [])
})

test('renders the today-reference block without a false forecast or trip timeline', () => {
  const state = makeState({
    tripDate: '2026-08-25',
    receivedDates: [],
    data: null,
  })
  const container = new FakeElement()

  renderWeatherDetail(container, state, new Date('2026-07-27T10:00:00.000Z'))

  assert.equal(container.dataset.weatherMode, 'today-reference')
  assert.match(container.innerHTML, /Aujourd.hui sur le parcours/)
  assert.match(container.innerHTML, /sans valeur prévisionnelle pour le/)
  assert.doesNotMatch(container.innerHTML, /ETA/)
  assert.doesNotMatch(container.innerHTML, /weather-waypoint/)
})

test('renders the today-reference block from todayReference data when available', () => {
  const state = makeState({
    tripDate: '2026-08-25',
    receivedDates: ['2026-07-27'],
    data: makeRideDayWeather([]),
  })
  const container = new FakeElement()

  renderWeatherDetail(container, state, new Date('2026-07-27T10:00:00.000Z'))

  assert.equal(container.dataset.weatherMode, 'today-reference')
  assert.match(container.innerHTML, /Température du jour/)
  assert.match(container.innerHTML, /Condition générale/)
})

test('renders trend without the detailed per-waypoint timeline', () => {
  const waypoints = [makeWaypoint('start', 'start', 8, 0), makeWaypoint('col', 'col', 11, 0)]
  const state = makeState({
    tripDate: '2026-08-25',
    receivedDates: ['2026-07-27', '2026-09-01'],
    data: makeRideDayWeather(waypoints),
  })
  const container = new FakeElement()

  renderWeatherDetail(container, state, new Date('2026-08-12T10:00:00.000Z'))

  assert.equal(container.dataset.weatherMode, 'trend')
  assert.match(container.innerHTML, /Tendance/)
  assert.doesNotMatch(container.innerHTML, /weather-waypoint/)
})

test('renders operational with essential waypoints visible and the rest collapsed', () => {
  const waypoints = [
    makeWaypoint('start', 'start', 8, 0),
    makeWaypoint('col', 'col', 10, 0),
    makeWaypoint('passage', 'passage', 11, 0),
    makeWaypoint('end', 'end', 14, 0),
  ]
  const state = makeState({
    tripDate: '2026-08-13',
    receivedDates: ['2026-07-27', '2026-09-01'],
    data: makeRideDayWeather(waypoints),
  })
  const container = new FakeElement()

  renderWeatherDetail(container, state, new Date('2026-08-12T10:00:00.000Z'))

  assert.equal(container.dataset.weatherMode, 'operational')
  assert.match(container.innerHTML, /Prévision opérationnelle/)
  assert.match(container.innerHTML, /Autres passages/)
  assert.match(container.innerHTML, /Isotherme 0/)
})

test('renders live with the next theoretical waypoint and the GPS disclaimer', () => {
  const waypoints = [
    makeWaypoint('start', 'start', 8, 0),
    makeWaypoint('col', 'col', 10, 30),
    makeWaypoint('end', 'end', 14, 0),
  ]
  const state = makeState({
    tripDate: '2026-08-12',
    receivedDates: ['2026-07-27', '2026-09-01'],
    data: makeRideDayWeather(waypoints),
  })
  const container = new FakeElement()

  renderWeatherDetail(container, state, new Date('2026-08-12T09:30:00.000Z'))

  assert.equal(container.dataset.weatherMode, 'live')
  assert.match(container.innerHTML, /sans suivi GPS/)
  assert.match(container.innerHTML, /Prochain point théorique/)
  assert.match(container.innerHTML, /Repères déjà passés/)
})

test('renders a past day as finished without triggering a fresh forecast call', () => {
  const state = makeState({
    tripDate: '2026-08-05',
    availability: 'unavailable',
    source: 'none',
    cacheState: 'miss',
    receivedDates: [],
    fetchedAt: null,
    data: null,
    message: 'Journée passée : aucune donnée conservée, aucune actualisation.',
  })
  const container = new FakeElement()

  renderWeatherDetail(container, state, new Date('2026-08-12T10:00:00.000Z'))

  assert.equal(container.dataset.weatherMode, 'past')
  assert.match(container.innerHTML, /Journée passée/)
})
