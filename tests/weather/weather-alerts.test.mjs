import test from 'node:test'
import assert from 'node:assert/strict'

import { getWeatherExposureContext } from '../../src/weather/alerts/exposure.ts'
import { evaluateHourlyRisk, evaluateWaypointAlerts } from '../../src/weather/alerts/evaluate-point.ts'
import {
  evaluateOffDayRisk,
  evaluateRideDayRisk,
  groupConsecutiveAlerts,
} from '../../src/weather/alerts/evaluate-day.ts'
import {
  attachRiskToScenarios,
  computeDepartureScenarios,
  DEPARTURE_SCENARIO_OFFSETS_MINUTES,
  shiftClockTime,
} from '../../src/weather/alerts/departure-scenarios.ts'
import {
  buildDepartureRecommendation,
  isSignificantImprovement,
  rankDepartureScenarios,
} from '../../src/weather/alerts/recommendations.ts'
import { WEATHER_ALERT_THRESHOLDS } from '../../src/weather/alerts/thresholds.ts'
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

function makeHourly(overrides = {}) {
  return {
    time: '2026-08-13T10:00',
    temperatureC: 15,
    apparentTemperatureC: 14,
    relativeHumidityPct: 55,
    precipitationProbabilityPct: 10,
    precipitationMm: 0,
    rainMm: 0,
    showersMm: 0,
    snowfallCm: 0,
    weatherCode: 1,
    cloudCoverPct: 20,
    visibilityM: 25_000,
    windSpeedKph: 10,
    windDirectionDeg: 180,
    windGustsKph: 15,
    freezingLevelM: 3_500,
    ...overrides,
  }
}

function makeSamplePoint(id, type, overrides = {}) {
  return {
    id,
    dayId: 'J1',
    dayType: 'ride',
    tripDate: overrides.tripDate ?? '2026-08-13',
    name: overrides.name ?? id,
    type,
    latitude: 45.2,
    longitude: 6.6,
    elevationM: overrides.elevationM ?? 800,
    trackDistanceKm: overrides.trackDistanceKm ?? 10,
    eta: overrides.eta ?? { totalMinutesFromDeparture: 120, clockMinutes: 600, dayOffset: 0 },
    sourcePointIds: [id],
    references: overrides.references ?? [],
    source: 'roadbook-matched',
  }
}

function formatClockMinutesLocal(clockMinutes) {
  const hours = Math.floor(clockMinutes / 60)
  const minutes = clockMinutes % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

function makeWaypoint(samplePoint, weatherOverrides = {}, state = 'available') {
  const etaLocal = `${samplePoint.tripDate}T${formatClockMinutesLocal(samplePoint.eta.clockMinutes)}`
  return {
    samplePoint,
    etaLocal,
    forecastTimeLocal: state === 'unavailable' ? null : etaLocal,
    forecastOffsetMinutes: state === 'unavailable' ? null : 0,
    weather: state === 'unavailable' ? null : makeHourly({ time: etaLocal, ...weatherOverrides }),
    state,
  }
}

const colExposure = getWeatherExposureContext(makeSamplePoint('col', 'col', { elevationM: 2_100 }))
const villageExposure = getWeatherExposureContext(
  makeSamplePoint('village', 'passage', { elevationM: 400 }),
)

// --- precipitation -----------------------------------------------------

test('precipitation: amount alone crosses orange', () => {
  const findings = evaluateHourlyRisk(makeHourly({ precipitationMm: 1.6 }), 800, villageExposure)
  const finding = findings.find((f) => f.riskType === 'precipitation')
  assert.equal(finding?.level, 'orange')
})

test('precipitation: probability plus amount crosses red', () => {
  const findings = evaluateHourlyRisk(
    makeHourly({ precipitationMm: 2.2, precipitationProbabilityPct: 85 }),
    800,
    villageExposure,
  )
  const finding = findings.find((f) => f.riskType === 'precipitation')
  assert.equal(finding?.level, 'red')
})

test('precipitation: a high probability alone, without a meaningful amount, triggers nothing', () => {
  const findings = evaluateHourlyRisk(
    makeHourly({ precipitationMm: 0.1, precipitationProbabilityPct: 92 }),
    800,
    villageExposure,
  )
  assert.equal(findings.some((f) => f.riskType === 'precipitation'), false)
})

test('precipitation: 4 mm/h alone crosses red regardless of probability', () => {
  const findings = evaluateHourlyRisk(
    makeHourly({ precipitationMm: 4.5, precipitationProbabilityPct: null }),
    800,
    villageExposure,
  )
  const finding = findings.find((f) => f.riskType === 'precipitation')
  assert.equal(finding?.level, 'red')
})

// --- wind / gusts --------------------------------------------------------

test('wind: sustained wind thresholds are the same everywhere', () => {
  const orange = evaluateHourlyRisk(makeHourly({ windSpeedKph: 40 }), 800, villageExposure).find(
    (f) => f.riskType === 'wind',
  )
  const red = evaluateHourlyRisk(makeHourly({ windSpeedKph: 55 }), 800, villageExposure).find(
    (f) => f.riskType === 'wind',
  )
  assert.equal(orange?.level, 'orange')
  assert.equal(red?.level, 'red')
})

test('gusts: a col is more sensitive than a valley passage at the same gust speed', () => {
  const hourly = makeHourly({ windGustsKph: 47 })
  const onCol = evaluateHourlyRisk(hourly, 2_100, colExposure).find((f) => f.riskType === 'gust')
  const onValley = evaluateHourlyRisk(hourly, 400, villageExposure).find((f) => f.riskType === 'gust')
  assert.equal(onCol?.level, 'orange')
  assert.equal(onValley, undefined)
})

// --- cold / heat ---------------------------------------------------------

test('cold: the same apparent temperature is only a risk in altitude context', () => {
  const hourly = makeHourly({ apparentTemperatureC: 4 })
  const onCol = evaluateHourlyRisk(hourly, 2_100, colExposure).find((f) => f.riskType === 'cold')
  const onValley = evaluateHourlyRisk(hourly, 400, villageExposure).find((f) => f.riskType === 'cold')
  assert.equal(onCol?.level, 'orange')
  assert.equal(onValley, undefined)
})

test('heat: orange and red thresholds', () => {
  const orange = evaluateHourlyRisk(makeHourly({ apparentTemperatureC: 31 }), 800, villageExposure).find(
    (f) => f.riskType === 'heat',
  )
  const red = evaluateHourlyRisk(makeHourly({ apparentTemperatureC: 36 }), 800, villageExposure).find(
    (f) => f.riskType === 'heat',
  )
  assert.equal(orange?.level, 'orange')
  assert.equal(red?.level, 'red')
})

// --- visibility ------------------------------------------------------------

test('visibility: orange below 5000 m, red below 1000 m', () => {
  const orange = evaluateHourlyRisk(makeHourly({ visibilityM: 3_000 }), 800, villageExposure).find(
    (f) => f.riskType === 'visibility',
  )
  const red = evaluateHourlyRisk(makeHourly({ visibilityM: 800 }), 800, villageExposure).find(
    (f) => f.riskType === 'visibility',
  )
  assert.equal(orange?.level, 'orange')
  assert.equal(red?.level, 'red')
})

// --- freezing level --------------------------------------------------------

test('freezing level: orange within the margin, red at or below the elevation', () => {
  const orange = evaluateHourlyRisk(
    makeHourly({ freezingLevelM: 2_700 }),
    2_500,
    villageExposure,
  ).find((f) => f.riskType === 'freezing-level')
  const red = evaluateHourlyRisk(makeHourly({ freezingLevelM: 2_400 }), 2_500, villageExposure).find(
    (f) => f.riskType === 'freezing-level',
  )
  assert.equal(orange?.level, 'orange')
  assert.equal(red?.level, 'red')
})

// --- snow --------------------------------------------------------------

test('snow: any snowfall in August is at least orange', () => {
  const finding = evaluateHourlyRisk(makeHourly({ snowfallCm: 0.3 }), 800, villageExposure).find(
    (f) => f.riskType === 'snow',
  )
  assert.equal(finding?.level, 'orange')
})

test('snow: a significant quantity alone crosses red', () => {
  const finding = evaluateHourlyRisk(makeHourly({ snowfallCm: 1.5 }), 800, villageExposure).find(
    (f) => f.riskType === 'snow',
  )
  assert.equal(finding?.level, 'red')
})

// --- thunderstorm --------------------------------------------------------

test('thunderstorm: orange for code 95, red with hail wording for 96/99', () => {
  const orange = evaluateHourlyRisk(makeHourly({ weatherCode: 95 }), 800, villageExposure).find(
    (f) => f.riskType === 'thunderstorm',
  )
  const red = evaluateHourlyRisk(makeHourly({ weatherCode: 99 }), 800, villageExposure).find(
    (f) => f.riskType === 'thunderstorm',
  )
  assert.equal(orange?.level, 'orange')
  assert.equal(red?.level, 'red')
  assert.match(red?.summary ?? '', /grêle/)
})

// --- combinations --------------------------------------------------------

test('combination: rain + cold on an exposed point reinforces an orange freezing level to red', () => {
  const hourly = makeHourly({
    freezingLevelM: 2_700,
    precipitationMm: 2,
    apparentTemperatureC: 4,
  })
  const findings = evaluateHourlyRisk(hourly, 2_500, colExposure)
  const freezing = findings.find((f) => f.riskType === 'freezing-level')
  assert.equal(freezing?.level, 'red')
  assert.match(freezing?.summary ?? '', /combiné/)
})

test('combination: low snowfall escalates to red when wind and cold also fire on an exposed point', () => {
  const hourly = makeHourly({ snowfallCm: 0.4, windGustsKph: 50, apparentTemperatureC: 4 })
  const finding = evaluateHourlyRisk(hourly, 2_100, colExposure).find((f) => f.riskType === 'snow')
  assert.equal(finding?.level, 'red')
})

test('combination: the same low snowfall alone (no wind/cold) stays orange', () => {
  const hourly = makeHourly({ snowfallCm: 0.4 })
  const finding = evaluateHourlyRisk(hourly, 2_100, colExposure).find((f) => f.riskType === 'snow')
  assert.equal(finding?.level, 'orange')
})

// --- waypoint binding & unavailable data ----------------------------------

test('a waypoint with no forecast produces no alert, never an invented one', () => {
  const point = makeSamplePoint('j01-col', 'col', { elevationM: 2_000 })
  const waypoint = makeWaypoint(point, {}, 'unavailable')
  assert.deepEqual(evaluateWaypointAlerts('J1', waypoint), [])
})

// --- grouping --------------------------------------------------------------

test('grouping: consecutive same-type same-level alerts merge into one, spanning first/last point', () => {
  const alerts = [
    { id: 'a', dayId: 'J1', pointId: 'p1', pointName: 'Col A', riskType: 'gust', level: 'orange', title: 'Rafales notables', summary: 'x', etaLocal: '2026-08-13T10:00', value: 46, unit: 'km/h', isOperational: true, firstPointId: 'p1', lastPointId: 'p1', memberPointIds: ['p1'] },
    { id: 'b', dayId: 'J1', pointId: 'p2', pointName: 'Passage B', riskType: 'gust', level: 'orange', title: 'Rafales notables', summary: 'x', etaLocal: '2026-08-13T11:30', value: 51, unit: 'km/h', isOperational: true, firstPointId: 'p2', lastPointId: 'p2', memberPointIds: ['p2'] },
    { id: 'c', dayId: 'J1', pointId: 'p3', pointName: 'Col C', riskType: 'gust', level: 'orange', title: 'Rafales notables', summary: 'x', etaLocal: '2026-08-13T13:00', value: 44, unit: 'km/h', isOperational: true, firstPointId: 'p3', lastPointId: 'p3', memberPointIds: ['p3'] },
  ]
  const grouped = groupConsecutiveAlerts(alerts)
  assert.equal(grouped.length, 1)
  assert.equal(grouped[0].firstPointId, 'p1')
  assert.equal(grouped[0].lastPointId, 'p3')
  assert.deepEqual(grouped[0].memberPointIds, ['p1', 'p2', 'p3'])
  assert.match(grouped[0].title, /entre Col A et Col C/)
  assert.match(grouped[0].summary, /10:00–13:00/)
  assert.match(grouped[0].summary, /51 km\/h/)
})

test('grouping: a different risk type in between breaks the run into separate groups', () => {
  const alerts = [
    { id: 'a', dayId: 'J1', pointId: 'p1', pointName: 'Col A', riskType: 'gust', level: 'orange', title: 't', summary: 's', isOperational: true, memberPointIds: ['p1'] },
    { id: 'b', dayId: 'J1', pointId: 'p2', pointName: 'Passage B', riskType: 'cold', level: 'orange', title: 't', summary: 's', isOperational: true, memberPointIds: ['p2'] },
    { id: 'c', dayId: 'J1', pointId: 'p3', pointName: 'Col C', riskType: 'gust', level: 'orange', title: 't', summary: 's', isOperational: true, memberPointIds: ['p3'] },
  ]
  assert.equal(groupConsecutiveAlerts(alerts).length, 3)
})

// --- day-level risk --------------------------------------------------------

function makeRideDay(waypoints) {
  return {
    type: 'ride',
    dayId: 'J1',
    tripDate: '2026-08-13',
    waypoints,
    routeSummary: {
      temperatureMinC: 10,
      temperatureMaxC: 20,
      apparentTemperatureMinC: 8,
      apparentTemperatureMaxC: 18,
      precipitationProbabilityMaxPct: 10,
      hourlyPrecipitationMaxMm: 0,
      windSpeedMaxKph: 10,
      windGustsMaxKph: 15,
      visibilityMinM: 20_000,
      freezingLevelMinM: 3_500,
      worstWeatherCode: 1,
      coveredPointCount: waypoints.filter((w) => w.state === 'available').length,
      missingPointCount: waypoints.filter((w) => w.state !== 'available').length,
    },
    dailyByLocation: [],
    todayReference: null,
  }
}

const freshContext = { fetchedAt: '2026-08-13T08:00:00.000Z', now: new Date('2026-08-13T08:10:00.000Z') }

test('day risk: one red col among ten green points still yields a red day', () => {
  const redCol = makeWaypoint(makeSamplePoint('col', 'col', { elevationM: 2_200 }), {
    windGustsKph: 70,
  })
  const greenPoints = Array.from({ length: 9 }, (_, index) =>
    makeWaypoint(makeSamplePoint(`p${index}`, 'passage', { elevationM: 500 })),
  )
  const risk = evaluateRideDayRisk('J1', makeRideDay([redCol, ...greenPoints]), freshContext)
  assert.equal(risk.level, 'red')
  assert.equal(risk.redCount, 1)
})

test('day risk: insufficient essential coverage forces unknown instead of a false green', () => {
  const essentialPoints = [
    makeWaypoint(makeSamplePoint('start', 'start'), {}, 'available'),
    makeWaypoint(makeSamplePoint('col', 'col', { elevationM: 2_000 }), {}, 'unavailable'),
    makeWaypoint(makeSamplePoint('end', 'end'), {}, 'unavailable'),
  ]
  const risk = evaluateRideDayRisk('J1', makeRideDay(essentialPoints), freshContext)
  assert.equal(risk.level, 'unknown')
  assert.ok(risk.alerts.some((alert) => alert.riskType === 'forecast-coverage'))
})

test('day risk: data older than the trusted window is downgraded to unknown with a stale-data alert', () => {
  const greenPoints = [
    makeWaypoint(makeSamplePoint('start', 'start')),
    makeWaypoint(makeSamplePoint('end', 'end')),
  ]
  const staleContext = {
    fetchedAt: '2026-08-13T00:00:00.000Z',
    now: new Date('2026-08-13T08:00:00.000Z'),
  }
  const risk = evaluateRideDayRisk('J1', makeRideDay(greenPoints), staleContext)
  assert.equal(risk.level, 'unknown')
  assert.ok(risk.alerts.some((alert) => alert.riskType === 'stale-data'))
})

test('OFF day risk: evaluates rain/wind/heat/cold/storm across the hourly series, not snow or visibility', () => {
  const samplePoint = makeSamplePoint('off', 'off-location', { elevationM: 900 })
  const hourly = [
    makeHourly({ time: '2026-08-13T09:00', snowfallCm: 5, visibilityM: 200 }),
    makeHourly({ time: '2026-08-13T15:00', apparentTemperatureC: 32 }),
  ]
  const data = {
    type: 'off',
    dayId: 'J5',
    tripDate: '2026-08-13',
    samplePoint,
    daily: null,
    hourly,
    localSummary: {
      temperatureMinC: 15,
      temperatureMaxC: 25,
      apparentTemperatureMinC: 14,
      apparentTemperatureMaxC: 24,
      precipitationProbabilityMaxPct: 10,
      hourlyPrecipitationMaxMm: 0,
      windSpeedMaxKph: 10,
      windGustsMaxKph: 15,
      visibilityMinM: 200,
      freezingLevelMinM: null,
      worstWeatherCode: 1,
      coveredPointCount: 1,
      missingPointCount: 0,
    },
    todayReference: null,
  }
  const risk = evaluateOffDayRisk('J5', data, freshContext)
  assert.equal(risk.alerts.some((alert) => alert.riskType === 'snow'), false)
  assert.equal(risk.alerts.some((alert) => alert.riskType === 'visibility'), false)
  assert.ok(risk.alerts.some((alert) => alert.riskType === 'heat'))
})

// --- departure scenarios ---------------------------------------------------

test('shiftClockTime keeps elapsed time from departure invariant and only moves the clock', () => {
  const shifted = shiftClockTime({ totalMinutesFromDeparture: 180, clockMinutes: 660, dayOffset: 0 }, 60)
  assert.equal(shifted.totalMinutesFromDeparture, 180)
  assert.equal(shifted.clockMinutes, 720)
  assert.equal(shifted.dayOffset, 0)
})

test('shiftClockTime carries across midnight and can go negative to signal incoherence', () => {
  const forward = shiftClockTime({ totalMinutesFromDeparture: 0, clockMinutes: 1_410, dayOffset: 0 }, 60)
  assert.equal(forward.clockMinutes, 30)
  assert.equal(forward.dayOffset, 1)

  const backward = shiftClockTime({ totalMinutesFromDeparture: 0, clockMinutes: 30, dayOffset: 0 }, -120)
  assert.equal(backward.dayOffset, -1)
})

function makeForecastResult(locationId, hourly) {
  return {
    provider: 'open-meteo',
    requestKey: 'k',
    fetchedAt: '2026-08-13T06:00:00.000Z',
    status: 'success',
    locations: [
      {
        status: 'success',
        requestLocationId: locationId,
        requestedLatitude: 45.2,
        requestedLongitude: 6.6,
        requestedElevationM: 800,
        providerLatitude: 45.2,
        providerLongitude: 6.6,
        providerElevationM: 800,
        timezone: 'Europe/Paris',
        utcOffsetSeconds: 7_200,
        hourly,
        daily: [],
        missingVariables: [],
        issues: [],
      },
    ],
    datesCovered: ['2026-08-13'],
    issues: [],
  }
}

function makeDefinition(samplePoints) {
  return {
    dayId: 'J1',
    dayType: 'ride',
    tripDate: '2026-08-13',
    samplePoints,
    locations: samplePoints.map((point) => ({
      id: `location-${point.id}`,
      name: point.name,
      latitude: point.latitude,
      longitude: point.longitude,
      elevationM: point.elevationM,
      samplePointIds: [point.id],
    })),
    requiredDates: ['2026-08-13'],
  }
}

test('computeDepartureScenarios produces 5 scenarios from a single forecast, without any network call', () => {
  const start = makeSamplePoint('start', 'start', {
    eta: { totalMinutesFromDeparture: 0, clockMinutes: 480, dayOffset: 0 },
  })
  const end = makeSamplePoint('end', 'end', {
    eta: { totalMinutesFromDeparture: 300, clockMinutes: 780, dayOffset: 0 },
  })
  const definition = makeDefinition([start, end])
  const hourly = Array.from({ length: 16 }, (_, hour) =>
    makeHourly({ time: `2026-08-13T${String(hour).padStart(2, '0')}:00`, temperatureC: hour }),
  )
  const result = makeForecastResult(`location-${start.id}`, hourly)
  const startLocationResult = makeForecastResult(`location-${start.id}`, hourly).locations[0]
  const endLocationResult = { ...startLocationResult, requestLocationId: `location-${end.id}` }
  const combinedResult = { ...result, locations: [startLocationResult, endLocationResult] }

  const scenarios = computeDepartureScenarios(definition, combinedResult)

  assert.equal(scenarios.length, DEPARTURE_SCENARIO_OFFSETS_MINUTES.length)
  assert.deepEqual(scenarios.map((s) => s.offsetMinutes), [...DEPARTURE_SCENARIO_OFFSETS_MINUTES])
  const current = scenarios.find((s) => s.offsetMinutes === 0)
  assert.equal(current?.isCurrent, true)
  assert.equal(current?.departureTimeLocal, '2026-08-13T08:00')
  const plusTwoHours = scenarios.find((s) => s.offsetMinutes === 120)
  assert.equal(plusTwoHours?.departureTimeLocal, '2026-08-13T10:00')
  // Reassociation picks a different hourly sample per shifted ETA, proving no
  // new fetch was needed: the same 16-hour series backs every scenario.
  assert.notEqual(
    current?.waypoints[0]?.weather?.temperatureC,
    plusTwoHours?.waypoints[0]?.weather?.temperatureC,
  )
})

test('computeDepartureScenarios marks a scenario incoherent when it would depart the day before', () => {
  const start = makeSamplePoint('start', 'start', {
    eta: { totalMinutesFromDeparture: 0, clockMinutes: 30, dayOffset: 0 },
  })
  const definition = makeDefinition([start])
  const result = makeForecastResult(`location-${start.id}`, [makeHourly({ time: '2026-08-13T00:30' })])

  const scenarios = computeDepartureScenarios(definition, result)
  const shiftedEarly = scenarios.find((s) => s.offsetMinutes === -120)
  assert.equal(shiftedEarly?.isCoherent, false)
  assert.match(shiftedEarly?.incoherenceReason ?? '', /avant le début de la journée/)
})

test('computeDepartureScenarios returns nothing for an OFF day: no cyclist departure to compare', () => {
  const definition = { ...makeDefinition([]), dayType: 'off' }
  assert.deepEqual(computeDepartureScenarios(definition, makeForecastResult('x', [])), [])
})

// --- ranking & recommendation ----------------------------------------------

function makeScenario(offsetMinutes, overrides = {}) {
  return {
    offsetMinutes,
    isCurrent: offsetMinutes === 0,
    isCoherent: true,
    incoherenceReason: null,
    departureTimeLocal: `2026-08-13T${String(8 + offsetMinutes / 60).padStart(2, '0')}:00`,
    arrivalTimeLocal: null,
    coveredPointCount: 6,
    missingPointCount: 0,
    maximumRainMm: 0,
    maximumGustKph: 20,
    minimumApparentTemperatureC: 10,
    minimumExposedApparentTemperatureC: 8,
    minimumVisibilityM: 20_000,
    risk: {
      level: 'green',
      redCount: 0,
      orangeCount: 0,
      upcomingRedCount: 0,
      upcomingOrangeCount: 0,
      coveredPointCount: 6,
      missingPointCount: 0,
      essentialCoverageRatio: 1,
      alerts: [],
    },
    ...overrides,
  }
}

test('rankDepartureScenarios prefers fewer red, then fewer orange alerts', () => {
  const worse = makeScenario(0, { risk: { ...makeScenario(0).risk, redCount: 1 } })
  const better = makeScenario(60, { risk: { ...makeScenario(0).risk, redCount: 0, orangeCount: 2 } })
  const ranked = rankDepartureScenarios([worse, better])
  assert.equal(ranked[0].offsetMinutes, 60)
})

test('rankDepartureScenarios always sorts incoherent scenarios last', () => {
  const incoherent = makeScenario(-120, { isCoherent: false })
  const coherent = makeScenario(120, {
    risk: { ...makeScenario(0).risk, redCount: 3 },
  })
  const ranked = rankDepartureScenarios([incoherent, coherent])
  assert.equal(ranked.at(-1)?.offsetMinutes, -120)
})

test('isSignificantImprovement: removing a red alert is always significant', () => {
  const current = makeScenario(0, { risk: { ...makeScenario(0).risk, redCount: 1 } })
  const candidate = makeScenario(60, { risk: { ...makeScenario(0).risk, redCount: 0 } })
  assert.equal(isSignificantImprovement(current, candidate), true)
})

test('isSignificantImprovement: a negligible difference is not significant', () => {
  const current = makeScenario(0, { maximumGustKph: 40 })
  const candidate = makeScenario(60, { maximumGustKph: 38 })
  assert.equal(isSignificantImprovement(current, candidate), false)
})

test('recommendation: not applicable in trend or planning mode', () => {
  const scenarios = [makeScenario(0)]
  const recommendation = buildDepartureRecommendation(scenarios, {
    mode: 'trend',
    hasDeparted: false,
    cacheAgeMs: 0,
  })
  assert.equal(recommendation.status, 'not-applicable')
})

test('recommendation: insufficient-data when essential coverage is too low', () => {
  const current = makeScenario(0, {
    risk: { ...makeScenario(0).risk, essentialCoverageRatio: 0.4 },
  })
  const recommendation = buildDepartureRecommendation([current], {
    mode: 'operational',
    hasDeparted: false,
    cacheAgeMs: 0,
  })
  assert.equal(recommendation.status, 'insufficient-data')
})

test('recommendation: keep-current when no coherent scenario is significantly better', () => {
  const current = makeScenario(0)
  const others = DEPARTURE_SCENARIO_OFFSETS_MINUTES.filter((offset) => offset !== 0).map((offset) =>
    makeScenario(offset),
  )
  const recommendation = buildDepartureRecommendation([current, ...others], {
    mode: 'operational',
    hasDeparted: false,
    cacheAgeMs: 0,
  })
  assert.equal(recommendation.status, 'keep-current')
  assert.equal(recommendation.recommendedScenario, null)
})

test('recommendation: recommends a coherent, significantly better departure time', () => {
  const current = makeScenario(0, { risk: { ...makeScenario(0).risk, redCount: 1, orangeCount: 1 } })
  const better = makeScenario(-60, { risk: { ...makeScenario(0).risk, redCount: 0, orangeCount: 0 } })
  const recommendation = buildDepartureRecommendation([current, better], {
    mode: 'operational',
    hasDeparted: false,
    cacheAgeMs: 0,
  })
  assert.equal(recommendation.status, 'recommended-change')
  assert.equal(recommendation.recommendedScenario?.offsetMinutes, -60)
  assert.ok(recommendation.explanation.some((line) => line.includes('sans garantie de conditions réelles')))
})

test('recommendation: an incoherent "day before" scenario is never recommended even if it scores best', () => {
  const current = makeScenario(0, { risk: { ...makeScenario(0).risk, redCount: 1 } })
  const incoherentBest = makeScenario(-120, {
    isCoherent: false,
    risk: { ...makeScenario(0).risk, redCount: 0 },
  })
  const recommendation = buildDepartureRecommendation([current, incoherentBest], {
    mode: 'operational',
    hasDeparted: false,
    cacheAgeMs: 0,
  })
  assert.notEqual(recommendation.recommendedScenario?.offsetMinutes, -120)
})

test('recommendation: after the theoretical departure, live mode never proposes a retroactive change', () => {
  const current = makeScenario(0, { risk: { ...makeScenario(0).risk, redCount: 1 } })
  const better = makeScenario(-60, { risk: { ...makeScenario(0).risk, redCount: 0 } })
  const recommendation = buildDepartureRecommendation([current, better], {
    mode: 'live',
    hasDeparted: true,
    cacheAgeMs: 0,
  })
  assert.equal(recommendation.status, 'not-applicable')
})

test('attachRiskToScenarios turns weather-only scenarios into risk-aware ones sharing the same evaluation as a normal day', () => {
  const point = makeSamplePoint('col', 'col', { elevationM: 2_200 })
  const base = [
    {
      offsetMinutes: 0,
      isCurrent: true,
      isCoherent: true,
      incoherenceReason: null,
      departureTimeLocal: '2026-08-13T08:00',
      arrivalTimeLocal: '2026-08-13T12:00',
      waypoints: [makeWaypoint(point, { windGustsKph: 70 })],
      coveredPointCount: 1,
      missingPointCount: 0,
    },
  ]
  const [scenario] = attachRiskToScenarios('J1', '2026-08-13', base, freshContext)
  assert.equal(scenario.risk.level, 'red')
  assert.equal(scenario.maximumGustKph, 70)
})

// --- mode integration (rendering through weather-detail.ts) ----------------

function makeIntegrationState(overrides = {}) {
  return {
    dayId: 'J1',
    dayType: 'ride',
    tripDate: '2026-08-13',
    availability: 'available',
    cacheState: 'fresh',
    source: 'network',
    fetchedAt: '2026-08-12T06:00:00.000Z',
    receivedDates: ['2026-08-12', '2026-09-01'],
    data: null,
    isRefreshing: false,
    departureScenarios: null,
    ...overrides,
  }
}

function makeWindyRideWaypoints(tripDate) {
  return [
    makeWaypoint(
      makeSamplePoint('start', 'start', {
        tripDate,
        eta: { totalMinutesFromDeparture: 0, clockMinutes: 480, dayOffset: 0 },
      }),
    ),
    makeWaypoint(
      makeSamplePoint('col', 'col', {
        tripDate,
        elevationM: 2_200,
        eta: { totalMinutesFromDeparture: 120, clockMinutes: 600, dayOffset: 0 },
      }),
      { windGustsKph: 70 },
    ),
    makeWaypoint(
      makeSamplePoint('end', 'end', {
        tripDate,
        eta: { totalMinutesFromDeparture: 300, clockMinutes: 780, dayOffset: 0 },
      }),
    ),
  ]
}

function makeSimpleScenarioSet(tripDate) {
  const start = makeSamplePoint('start', 'start', {
    tripDate,
    eta: { totalMinutesFromDeparture: 0, clockMinutes: 480, dayOffset: 0 },
  })
  const end = makeSamplePoint('end', 'end', {
    tripDate,
    eta: { totalMinutesFromDeparture: 240, clockMinutes: 720, dayOffset: 0 },
  })
  const points = [start, end]
  const definition = makeDefinition(points)
  const hourly = Array.from({ length: 16 }, (_, hour) =>
    makeHourly({ time: `${tripDate}T${String(hour).padStart(2, '0')}:00` }),
  )
  const startForecast = makeForecastResult(`location-${start.id}`, hourly).locations[0]
  const endForecast = { ...startForecast, requestLocationId: `location-${end.id}` }
  const result = { ...makeForecastResult('x', hourly), locations: [startForecast, endForecast] }
  return computeDepartureScenarios(definition, result)
}

test('mode integration: today-reference never shows a risk summary or a scenario comparison', () => {
  const state = makeIntegrationState({ tripDate: '2026-08-25', receivedDates: [], data: null })
  const container = new FakeElement()
  renderWeatherDetail(container, state, new Date('2026-07-27T10:00:00.000Z'))
  assert.equal(container.dataset.weatherMode, 'today-reference')
  assert.doesNotMatch(container.innerHTML, /data-weather-risk-summary/)
  assert.doesNotMatch(container.innerHTML, /data-weather-scenario-comparison/)
})

test('mode integration: trend gives a cautious advisory sentence, no per-point alerts, no recommendation', () => {
  const tripDate = '2026-08-25'
  const state = makeIntegrationState({
    tripDate,
    data: makeRideDay(makeWindyRideWaypoints(tripDate)),
  })
  const container = new FakeElement()
  renderWeatherDetail(container, state, new Date('2026-08-12T06:00:00.000Z'))
  assert.equal(container.dataset.weatherMode, 'trend')
  assert.doesNotMatch(container.innerHTML, /weather-waypoint__alerts/)
  assert.doesNotMatch(container.innerHTML, /data-weather-scenario-comparison/)
  assert.doesNotMatch(container.innerHTML, /weather-recommendation/)
  assert.match(container.innerHTML, /venteuse/)
})

test('mode integration: planning shows an indicative risk summary and a preliminary scenario comparison', () => {
  const tripDate = '2026-08-17'
  const state = makeIntegrationState({
    tripDate,
    data: makeRideDay(makeWindyRideWaypoints(tripDate)),
    departureScenarios: makeSimpleScenarioSet(tripDate),
  })
  const container = new FakeElement()
  renderWeatherDetail(container, state, new Date('2026-08-12T06:00:00.000Z'))
  assert.equal(container.dataset.weatherMode, 'planning')
  assert.match(container.innerHTML, /data-weather-risk-summary/)
  assert.match(container.innerHTML, /aperçu préliminaire/)
  assert.doesNotMatch(container.innerHTML, /weather-recommendation/)
})

test('mode integration: operational shows a full risk summary, a firm scenario comparison and per-point badges', () => {
  const tripDate = '2026-08-13'
  const state = makeIntegrationState({
    tripDate,
    data: makeRideDay(makeWindyRideWaypoints(tripDate)),
    departureScenarios: makeSimpleScenarioSet(tripDate),
  })
  const container = new FakeElement()
  renderWeatherDetail(container, state, new Date('2026-08-12T06:00:00.000Z'))
  assert.equal(container.dataset.weatherMode, 'operational')
  assert.match(container.innerHTML, /data-weather-risk-summary/)
  assert.match(container.innerHTML, /data-weather-scenario-comparison/)
  assert.doesNotMatch(container.innerHTML, /aperçu préliminaire/)
  assert.match(container.innerHTML, /weather-waypoint__alerts/)
})

test('mode integration: live before the theoretical departure still allows the scenario comparison', () => {
  const tripDate = '2026-08-12'
  const state = makeIntegrationState({
    tripDate,
    data: makeRideDay(makeWindyRideWaypoints(tripDate)),
    departureScenarios: makeSimpleScenarioSet(tripDate),
  })
  const container = new FakeElement()
  // 07:00 local (Europe/Paris, UTC+2 in August) — before the 08:00 departure.
  renderWeatherDetail(container, state, new Date('2026-08-12T05:00:00.000Z'))
  assert.equal(container.dataset.weatherMode, 'live')
  assert.match(container.innerHTML, /data-weather-scenario-comparison/)
  assert.match(container.innerHTML, /sans suivi GPS/)
})

test('mode integration: live after the theoretical departure drops the scenario comparison for a risk summary', () => {
  const tripDate = '2026-08-12'
  const state = makeIntegrationState({
    tripDate,
    data: makeRideDay(makeWindyRideWaypoints(tripDate)),
    departureScenarios: makeSimpleScenarioSet(tripDate),
  })
  const container = new FakeElement()
  // 11:00 local — after the 08:00 departure.
  renderWeatherDetail(container, state, new Date('2026-08-12T09:00:00.000Z'))
  assert.equal(container.dataset.weatherMode, 'live')
  assert.doesNotMatch(container.innerHTML, /data-weather-scenario-comparison/)
  assert.match(container.innerHTML, /data-weather-risk-summary/)
})

test('mode integration: an OFF day never shows a departure scenario comparison or a recommendation', () => {
  const samplePoint = makeSamplePoint('off', 'off-location', { elevationM: 900 })
  const offData = {
    type: 'off',
    dayId: 'J5',
    tripDate: '2026-08-13',
    samplePoint,
    daily: null,
    hourly: [makeHourly({ time: '2026-08-13T15:00', apparentTemperatureC: 32 })],
    localSummary: {
      temperatureMinC: 15,
      temperatureMaxC: 25,
      apparentTemperatureMinC: 14,
      apparentTemperatureMaxC: 24,
      precipitationProbabilityMaxPct: 10,
      hourlyPrecipitationMaxMm: 0,
      windSpeedMaxKph: 10,
      windGustsMaxKph: 15,
      visibilityMinM: 20_000,
      freezingLevelMinM: null,
      worstWeatherCode: 1,
      coveredPointCount: 1,
      missingPointCount: 0,
    },
    todayReference: null,
  }
  const state = makeIntegrationState({
    dayId: 'J5',
    dayType: 'off',
    tripDate: '2026-08-13',
    data: offData,
    departureScenarios: null,
  })
  const container = new FakeElement()
  renderWeatherDetail(container, state, new Date('2026-08-12T06:00:00.000Z'))
  assert.equal(container.dataset.weatherMode, 'operational')
  assert.match(container.innerHTML, /data-weather-risk-summary/)
  assert.doesNotMatch(container.innerHTML, /data-weather-scenario-comparison/)
  assert.doesNotMatch(container.innerHTML, /weather-recommendation/)
})

test('mode integration: a past day never triggers a risk computation or a scenario comparison', () => {
  const state = makeIntegrationState({
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
  assert.doesNotMatch(container.innerHTML, /data-weather-risk-summary/)
  assert.doesNotMatch(container.innerHTML, /data-weather-scenario-comparison/)
})
