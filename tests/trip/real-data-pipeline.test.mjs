import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { installMinimalDOMParser } from '../support/minimal-dom-parser.mjs'

installMinimalDOMParser()

const { parseGpxDocument } = await import('../../src/gpx/parser.ts')
const { parseGpxFileNumber } = await import('../../src/gpx/load.ts')
const { rga2026TripPlan } = await import('../../src/trip/plan.ts')
const { buildTripProfile, scheduleTripTimeline } = await import('../../src/trip/timeline.ts')
const { validateRoadbookDocument, validateRoadbookOverridesDocument } = await import(
  '../../src/trip/roadbook-validation.ts'
)
const { buildRoadbookMatchReport } = await import('../../src/trip/roadbook-match.ts')
const { getRoadbookPointRole } = await import('../../src/trip/point-role.ts')
const { suppressedDocumentedPointIds } = await import('../../src/trip/roadbook-suppressions.ts')
const { emptyPausePlan } = await import('../../src/trip/pause-plan.ts')
const { createDefaultRideDaySettingsDocument, getRideDaySettings } = await import(
  '../../src/storage/ride-day-settings.ts'
)
const { buildWeatherDayDefinitions } = await import('../../src/weather/sample-points.ts')
const { associateWeatherDay } = await import('../../src/weather/selectors.ts')
const { buildDocumentedPointWeatherListViewModel } = await import(
  '../../src/weather/documented-point-view-model.ts'
)
const { buildRouteDisplayPoints } = await import('../../src/ui/route-engine.ts')
const { buildTodayViewModel } = await import('../../src/ui/today-view-model.ts')

const root = new URL('../../', import.meta.url)
const readText = (path) => readFile(new URL(path, root), 'utf8')
const readJson = async (path) => JSON.parse(await readText(path))

/**
 * Builds `PausePlace[]` per day exactly like `getPausePlaces`/`getPausePlacesByDay`
 * in `src/main.ts` — duplicated here (not imported, main.ts does not export
 * it) so this test exercises the same real-world contract the app relies on.
 */
function pausePlacesForDay(report, dayId) {
  const dayReport = report?.days.find((day) => day.dayId === dayId)
  const places = new Map()
  if (dayReport?.type === 'ride') {
    for (const point of dayReport.points) {
      const role = getRoadbookPointRole(point)
      const eligibleType = ['village', 'resupply', 'col', 'summit', 'passage', 'pause'].includes(point.type)
      if (point.matchedTrackDistanceKm === undefined || !(eligibleType || point.isPauseCandidate || point.isResupplyCandidate)) continue
      places.set(point.id, { id: point.id, name: point.name, trackDistanceKm: point.matchedTrackDistanceKm, offRoute: role !== 'route-point' })
    }
  }
  return [...places.values()].sort((a, b) => a.trackDistanceKm - b.trackDistanceKm)
}

function pausePlacesByDay(report) {
  return Object.fromEntries(
    rga2026TripPlan.days.filter((day) => day.type === 'ride').map(({ id }) => [id, pausePlacesForDay(report, id)]),
  )
}

/** Runs the exact same two-pass pipeline as `refreshTripTimeline`/`refreshRoadbookIntegration` in main.ts. */
async function runRealPipeline(getDaySettings, pausePlan = emptyPausePlan) {
  const manifest = await readJson('public/data/gpx/manifest.json')
  assert.equal(manifest.files.length, 10, 'expected exactly ten manifest entries')

  const gpxResults = await Promise.all(
    manifest.files.map(async (entry) => {
      const fileNumber = parseGpxFileNumber(entry.fileName)
      const source = { ...entry, fileNumber, url: entry.fileName, isVariant: false }
      const xmlText = await readText(`public/data/gpx/${entry.fileName}`)
      return parseGpxDocument(xmlText, source)
    }),
  )
  assert.equal(gpxResults.length, 10)
  assert.ok(gpxResults.every((result) => result.status === 'success'), 'all ten real GPX files must parse')

  const roadbook = validateRoadbookDocument(await readJson('public/data/trip/roadbook.json'))
  const overridesRaw = await readJson('public/data/trip/roadbook-overrides.json')
  const overrides = validateRoadbookOverridesDocument(overridesRaw, roadbook)
  assert.equal(overrides.skippedOverrides.length, 0, 'the real overrides file must load without any skipped entry')

  const profile = buildTripProfile(rga2026TripPlan, gpxResults)

  // Pass 1 — no roadbook report exists yet, so no documented places either
  // (this is exactly the state that used to deadlock every ride day).
  const firstPassTimeline = scheduleTripTimeline(profile, getDaySettings, emptyPausePlan, {})
  const firstReport = buildRoadbookMatchReport(roadbook, overrides, rga2026TripPlan, gpxResults, firstPassTimeline)

  // Pass 2 — real documented points are now available; reschedule with them,
  // exactly like the `roadbookPlacesHydrated` retry in main.ts.
  const timeline = scheduleTripTimeline(profile, getDaySettings, pausePlan, pausePlacesByDay(firstReport))
  const report = buildRoadbookMatchReport(roadbook, overrides, rga2026TripPlan, gpxResults, timeline)

  return { timeline, report, profile, gpxResults }
}

function defaultDaySettings() {
  const document = createDefaultRideDaySettingsDocument()
  return (dayId) => getRideDaySettings(document, dayId)
}

function syntheticHourly(time, locationIndex, hour) {
  return {
    time,
    temperatureC: 10 + locationIndex + hour / 10,
    apparentTemperatureC: 8 + locationIndex + hour / 10,
    relativeHumidityPct: 70,
    precipitationProbabilityPct: hour % 3 === 0 ? 45 : 15,
    precipitationMm: hour % 3 === 0 ? 0.4 : 0,
    rainMm: hour % 3 === 0 ? 0.4 : 0,
    showersMm: 0,
    snowfallCm: 0,
    weatherCode: hour % 3 === 0 ? 61 : 2,
    cloudCoverPct: 50,
    visibilityM: 10_000,
    windSpeedKph: 15,
    windDirectionDeg: 240,
    windGustsKph: locationIndex % 4 === 0 ? 50 : 25,
    freezingLevelM: 3_500,
  }
}

function syntheticForecast(definition) {
  return {
    provider: 'open-meteo',
    requestKey: `synthetic-${definition.dayId}`,
    fetchedAt: '2026-08-01T08:00:00.000Z',
    status: 'success',
    datesCovered: definition.requiredDates,
    issues: [],
    locations: definition.locations.map((location, locationIndex) => ({
      status: 'success',
      requestLocationId: location.id,
      requestedLatitude: location.latitude,
      requestedLongitude: location.longitude,
      requestedElevationM: location.elevationM,
      providerLatitude: location.latitude,
      providerLongitude: location.longitude,
      providerElevationM: location.elevationM,
      timezone: 'Europe/Paris',
      utcOffsetSeconds: 7_200,
      hourly: definition.requiredDates.flatMap((date) =>
        Array.from({ length: 24 }, (_, hour) =>
          syntheticHourly(`${date}T${String(hour).padStart(2, '0')}:00`, locationIndex, hour),
        ),
      ),
      daily: [],
      missingVariables: [],
      issues: [],
    })),
  }
}

const j1FiftyMinutePausePlan = {
  version: 1,
  days: [{
    dayId: 'J1',
    mode: 'custom',
    pauses: [
      { id: 'j1-col-break', active: true, placeId: 'j01-col-col-du-feu', placeName: 'Col du Feu', durationMinutes: 10, order: 0, origin: 'custom' },
      { id: 'j1-lullin-break', active: true, placeId: 'j01-passage-lullin', placeName: 'Lullin', durationMinutes: 30, order: 1, origin: 'custom' },
      { id: 'j1-saint-jean-break', active: true, placeId: 'j01-passage-saint-jean-d-aulps', placeName: 'Saint-Jean-d’Aulps', durationMinutes: 10, order: 2, origin: 'custom' },
    ],
  }],
}

function j1Settings(averageSpeedKph, totalBreakMinutes = 50) {
  const defaults = createDefaultRideDaySettingsDocument()
  return (dayId) => dayId === 'J1'
    ? { dayId, averageSpeedKph, departureTime: '08:00', totalBreakMinutes }
    : getRideDaySettings(defaults, dayId)
}

function readyRide(timeline, dayId) {
  const day = timeline.days.find((candidate) => candidate.day.id === dayId)
  assert.equal(day?.type, 'ride')
  assert.equal(day.status, 'ready')
  return day
}

function pointById(report, dayId, pointId) {
  const day = report.days.find((candidate) => candidate.dayId === dayId)
  assert.equal(day?.type, 'ride')
  const point = day.points.find((candidate) => candidate.id === pointId)
  assert.ok(point, `${pointId} must exist in ${dayId}`)
  assert.ok(point.eta, `${pointId} must have an ETA`)
  return point
}

function syntheticWeatherState(report, dayId, now) {
  const day = report.days.find((candidate) => candidate.dayId === dayId)
  assert.equal(day?.type, 'ride')
  const tripDate = `2026-08-${String(11 + day.dayNumber).padStart(2, '0')}`
  const operational = day.points.filter((point) => point.eta !== undefined && point.resolution === 'matched' && ['start', 'end', 'col', 'summit'].includes(point.type))
  const waypoints = operational.map((point) => {
    const samplePoint = {
      id: point.id, dayId, dayType: 'ride', tripDate, name: point.name, type: point.type,
      latitude: point.matchedLatitude ?? point.sourceLatitude ?? 45,
      longitude: point.matchedLongitude ?? point.sourceLongitude ?? 6,
      elevationM: point.matchedElevationM ?? point.elevationM ?? 0,
      trackDistanceKm: point.matchedTrackDistanceKm,
      eta: point.eta,
      sourcePointIds: [point.id], references: [], source: 'roadbook-matched', role: 'route-point', contributesToDayRisk: true,
    }
    const etaHour = String(Math.floor(point.eta.clockMinutes / 60)).padStart(2, '0')
    const etaMinute = String(point.eta.clockMinutes % 60).padStart(2, '0')
    const weather = { time: `${tripDate}T${etaHour}:${etaMinute}`, temperatureC: 14, apparentTemperatureC: 13, relativeHumidityPct: 60, precipitationProbabilityPct: 20, precipitationMm: 0, rainMm: 0, showersMm: 0, snowfallCm: 0, weatherCode: 2, cloudCoverPct: 30, visibilityM: 20_000, windSpeedKph: 15, windDirectionDeg: 180, windGustsKph: 25, freezingLevelM: 3_500 }
    return { samplePoint, etaLocal: weather.time, forecastTimeLocal: weather.time, forecastOffsetMinutes: 0, weather, state: 'available' }
  })
  return {
    dayId, dayType: 'ride', tripDate, availability: 'available', cacheState: 'fresh', source: 'cache', fetchedAt: now.toISOString(), receivedDates: [tripDate], data: { type: 'ride', dayId, tripDate, waypoints, routeSummary: { temperatureMinC: 14, temperatureMaxC: 18, apparentTemperatureMinC: 13, apparentTemperatureMaxC: 17, precipitationProbabilityMaxPct: 20, hourlyPrecipitationMaxMm: 0, windSpeedMaxKph: 15, windGustsMaxKph: 25, visibilityMinM: 20_000, freezingLevelMinM: 3_500, worstWeatherCode: 2, coveredPointCount: waypoints.length, missingPointCount: 0 }, dailyByLocation: [], todayReference: null }, isRefreshing: false, departureScenarios: null,
  }
}

test('the real ten-GPX / real-roadbook pipeline restores all ten ride days, none left unavailable', async () => {
  const { timeline } = await runRealPipeline(defaultDaySettings())

  assert.equal(timeline.days.length, 12)
  assert.equal(timeline.summary.rideDays, 10)
  assert.equal(timeline.summary.offDays, 2)
  assert.equal(timeline.summary.availableRideDays, 10, 'all ten ride days must be ready — this is the exact regression this test guards against')
  assert.equal(timeline.summary.unavailableRideDays, 0)

  for (const dayTimeline of timeline.days) {
    const planDay = rga2026TripPlan.days.find(({ id }) => id === dayTimeline.day.id)
    assert.equal(dayTimeline.day.type, planDay.type, `${dayTimeline.day.id} must keep the calendar's own type — never OFF because a timeline failed`)
  }

  const offDayIds = timeline.days.filter((day) => day.type === 'off').map((day) => day.day.id)
  assert.deepEqual(offDayIds.sort(), ['J5', 'J8'])
})

test('every ride day has a real distance, duration, departure and arrival — no NaN, no artificial zero', async () => {
  const { timeline } = await runRealPipeline(defaultDaySettings())

  for (const dayTimeline of timeline.days) {
    if (dayTimeline.type !== 'ride') continue
    assert.equal(dayTimeline.status, 'ready', `${dayTimeline.day.id} should be ready`)
    assert.ok(Number.isFinite(dayTimeline.route.summary.distanceKm) && dayTimeline.route.summary.distanceKm > 0, `${dayTimeline.day.id} distance`)
    assert.ok(Number.isFinite(dayTimeline.route.summary.totalDurationMinutes) && dayTimeline.route.summary.totalDurationMinutes > 0, `${dayTimeline.day.id} duration`)
    assert.ok(typeof dayTimeline.startTime === 'string' && dayTimeline.startTime.length > 0, `${dayTimeline.day.id} startTime`)
    assert.ok(Number.isFinite(dayTimeline.arrivalTime.totalMinutesFromDeparture), `${dayTimeline.day.id} arrivalTime`)

    for (const waypoint of dayTimeline.route.waypoints) {
      for (const value of Object.values(waypoint.progress)) {
        if (typeof value === 'number') assert.ok(Number.isFinite(value), `${dayTimeline.day.id} waypoint ${waypoint.id} has a non-finite progress value`)
      }
    }
  }
})

test('pause invariants hold for every ride day: sum equals the effective total, strictly increasing distance, no duplicate or suppressed pointId', async () => {
  const { timeline } = await runRealPipeline(defaultDaySettings())

  for (const dayTimeline of timeline.days) {
    if (dayTimeline.type !== 'ride' || dayTimeline.status !== 'ready') continue
    const { route, day } = dayTimeline
    const pauseSum = route.pauses.reduce((total, pause) => total + pause.durationMinutes, 0)
    assert.equal(pauseSum, route.settings.totalBreakMinutes, `${day.id}: sum of pauses must equal the day's effective total`)
    assert.equal(route.summary.pauseDurationMinutes, route.settings.totalBreakMinutes, `${day.id}: summary pause duration must match settings`)

    const distances = route.pauses.map((pause) => pause.distanceKm)
    const sorted = [...distances].sort((a, b) => a - b)
    assert.deepEqual(distances, sorted, `${day.id}: pauses must already be in strictly increasing distance order`)
    assert.equal(new Set(distances).size, distances.length, `${day.id}: no two pauses share the same distance`)

    const pointIds = route.pauses.flatMap((pause) => (pause.pointId === undefined ? [] : [pause.pointId]))
    assert.equal(new Set(pointIds).size, pointIds.length, `${day.id}: no pointId is used by two pauses`)
    for (const pointId of pointIds) {
      assert.equal(suppressedDocumentedPointIds.has(pointId), false, `${day.id}: pause must never sit on a suppressed point (${pointId})`)
    }

    for (const pause of route.pauses) {
      assert.ok(Number.isFinite(pause.durationMinutes) && pause.durationMinutes > 0, `${day.id}: pause duration must be finite and positive`)
    }
  }
})

test('changing J2’s settings alone never changes J1’s computed route on the real pipeline', async () => {
  const baseDocument = createDefaultRideDaySettingsDocument()
  const baseline = await runRealPipeline((dayId) => getRideDaySettings(baseDocument, dayId))
  const j1Baseline = baseline.timeline.days.find((day) => day.day.id === 'J1')

  const changed = await runRealPipeline((dayId) =>
    dayId === 'J2'
      ? { dayId, averageSpeedKph: 14, departureTime: '06:15', totalBreakMinutes: 90 }
      : getRideDaySettings(baseDocument, dayId),
  )
  const j1AfterChange = changed.timeline.days.find((day) => day.day.id === 'J1')

  assert.deepEqual(j1AfterChange.route.summary, j1Baseline.route.summary)
  assert.equal(j1AfterChange.startTime, j1Baseline.startTime)
})

test('real roadbook and GPX data receive deterministic compact weather without technical or suppressed points', async () => {
  const pausePlan = {
    version: 1,
    days: [{
      dayId: 'J2',
      mode: 'custom',
      pauses: [{
        id: 'cluses-break',
        active: true,
        placeId: 'j02-passage-cluses',
        placeName: 'Cluses',
        durationMinutes: 20,
        order: 0,
        origin: 'custom',
      }],
    }],
  }
  const { timeline, report } = await runRealPipeline(defaultDaySettings(), pausePlan)
  const definitions = buildWeatherDayDefinitions(
    rga2026TripPlan,
    timeline,
    report,
    '2026-08-01',
  )
  const renderedByDay = new Map()

  for (const dayId of ['J1', 'J2']) {
    const definition = definitions.find((candidate) => candidate.dayId === dayId)
    const dayTimeline = timeline.days.find((day) => day.day.id === dayId)
    assert.ok(definition)
    assert.equal(dayTimeline.status, 'ready')
    const data = associateWeatherDay(
      definition,
      syntheticForecast(definition),
      '2026-08-01',
      '2026-08-01T10:00',
    )
    const state = {
      dayId,
      dayType: 'ride',
      tripDate: definition.tripDate,
      availability: 'available',
      cacheState: 'fresh',
      source: 'network',
      fetchedAt: '2026-08-01T08:00:00.000Z',
      receivedDates: definition.requiredDates,
      data,
      isRefreshing: false,
      departureScenarios: null,
    }
    const documentedPoints = report.allPointMatches.filter((point) => point.dayId === dayId)
    const model = buildDocumentedPointWeatherListViewModel(
      state,
      documentedPoints,
      '2026-08-01',
    )
    const cards = buildRouteDisplayPoints(
      dayTimeline.route,
      dayId,
      report,
      null,
      model,
    )
    renderedByDay.set(dayId, { documentedPoints, model, cards, dayTimeline })

    const sampledPointIds = new Set(
      definition.samplePoints.flatMap(({ sourcePointIds }) => sourcePointIds),
    )
    for (const pointId of sampledPointIds) {
      assert.equal(model.pointWeatherById.has(pointId), true, `${dayId}: ${pointId} must join by stable id`)
    }
    assert.equal(new Set(cards.map(({ id }) => id)).size, cards.length)
    assert.ok(cards.every(({ html }) => !/<details|Détail|route-point--generated/.test(html)))
    assert.ok(cards.every(({ html }) => !/NaN/.test(html)))
  }

  const j1 = renderedByDay.get('J1')
  const j1Names = j1.documentedPoints.map(({ name }) => name).join(' | ')
  const j1Html = j1.cards.map(({ html }) => html).join('')
  assert.match(j1Html, /Gare de Thonon-les-Bains/)
  assert.match(j1Names, /Col du Feu/)
  assert.match(j1Names, /Lullin/)
  assert.match(j1Names, /Saint-Jean/)
  assert.doesNotMatch(j1Names, /Bellevaux|repère kilométrique|rupture de pente/i)

  const j2 = renderedByDay.get('J2')
  const clusesPoints = j2.documentedPoints.filter(
    (point) => point.name === 'Cluses' && getRoadbookPointRole(point) !== 'information',
  )
  assert.equal(clusesPoints.length, 1)
  assert.equal(j2.cards.filter(({ html }) => /Cluses/.test(html)).length, 1)
  const clusesId = clusesPoints[0].id
  assert.equal(j2.model.pointWeatherById.has(clusesId), true)
  assert.equal(j2.dayTimeline.route.pauses.filter(({ pointId }) => pointId === clusesId).length, 1)

  const allNames = report.allPointMatches.map(({ name }) => name).join(' | ')
  for (const suppressedName of [
    'Bellevaux',
    'Crest-Voland',
    'Arêches',
    'Les Chapieux',
    'Tignes',
    'Château-Queyras',
    'Cime de la Bonette',
  ]) {
    assert.doesNotMatch(allNames, new RegExp(suppressedName, 'i'))
  }

  assert.equal(timeline.summary.rideDays, 10)
  assert.equal(timeline.summary.offDays, 2)
  assert.equal(timeline.summary.availableRideDays, 10)
})

test('real J1 preserves the configured moving average, applies 10+30+10 once and shows arrival-before-pause ETAs', async () => {
  const { timeline, report, profile } = await runRealPipeline(j1Settings(18), j1FiftyMinutePausePlan)
  const j1 = readyRide(timeline, 'J1')
  const { route } = j1
  const targetMovingMinutes = route.summary.distanceKm / 18 * 60

  assert.ok(Math.abs(route.summary.movingDurationMinutes - targetMovingMinutes) < 1 / 60, 'moving time must be exact within one second')
  assert.ok(Math.abs(route.summary.distanceKm / (route.summary.movingDurationMinutes / 60) - 18) < 1e-9, 'effective moving average must remain exactly 18 km/h')
  assert.deepEqual(route.pauses.map(({ durationMinutes }) => durationMinutes), [10, 30, 10])
  assert.equal(route.summary.pauseDurationMinutes, 50)
  assert.ok(Math.abs(route.summary.totalDurationMinutes - (targetMovingMinutes + 50)) < 1 / 60)
  assert.ok(Math.abs(j1.arrivalTime.totalMinutesFromDeparture - (targetMovingMinutes + 50)) < 1 / 60)
  assert.ok(Math.abs(j1.arrivalTime.clockMinutes - (8 * 60 + targetMovingMinutes + 50)) <= 0.5, 'displayed clock is rounded to the nearest minute')
  assert.ok(j1.arrivalTime.clockMinutes > 11 * 60 + 30 && j1.arrivalTime.clockMinutes < 11 * 60 + 40)
  assert.equal(route.waypoints.some(({ type }) => type === 'pause-start' || type === 'pause-end'), false, 'pauses must not create waypoints')

  for (const pause of route.pauses) {
    const point = pointById(report, 'J1', pause.pointId)
    assert.ok(Math.abs(point.eta.totalMinutesFromDeparture - pause.startElapsedMinutes) < 1e-6, `${point.name} ETA must be its arrival before its own pause`)
  }
  const j1Report = report.days.find(({ dayId }) => dayId === 'J1')
  const etaValues = j1Report.points.flatMap((point) => point.eta === undefined ? [] : [point.eta.totalMinutesFromDeparture])
  assert.deepEqual(etaValues, [...etaValues].sort((a, b) => a - b), 'J1 documented ETAs must be non-decreasing')

  const profileDay = profile.days.find(({ day }) => day.id === 'J1')
  assert.equal(profileDay.status, 'ready')
  assert.ok(profileDay.routeProfile.terrainSeries.length > 2)
  assert.ok(profileDay.routeProfile.terrainSeries.every((point) => Object.values(point).every(Number.isFinite)))
})

test('real J1 at 13.2 km/h moves the arrival near 12:35 while J2 remains unchanged', async () => {
  const fast = await runRealPipeline(j1Settings(18), j1FiftyMinutePausePlan)
  const prudent = await runRealPipeline(j1Settings(13.2), j1FiftyMinutePausePlan)
  const fastJ1 = readyRide(fast.timeline, 'J1')
  const prudentJ1 = readyRide(prudent.timeline, 'J1')
  const fastJ2 = readyRide(fast.timeline, 'J2')
  const prudentJ2 = readyRide(prudent.timeline, 'J2')

  const targetMovingMinutes = prudentJ1.route.summary.distanceKm / 13.2 * 60
  assert.ok(Math.abs(prudentJ1.route.summary.movingDurationMinutes - targetMovingMinutes) < 1 / 60)
  assert.ok(Math.abs(prudentJ1.route.summary.distanceKm / (prudentJ1.route.summary.movingDurationMinutes / 60) - 13.2) < 1e-9)
  assert.ok(prudentJ1.arrivalTime.clockMinutes > 12 * 60 + 30 && prudentJ1.arrivalTime.clockMinutes < 12 * 60 + 40)
  assert.ok(prudentJ1.arrivalTime.clockMinutes > fastJ1.arrivalTime.clockMinutes)
  assert.deepEqual(prudentJ2.route.summary, fastJ2.route.summary)
  assert.equal(prudentJ2.startTime, fastJ2.startTime)
})

test('real consolidated Today models cover J1, corrected J2, OFF J5, J6, J9, J10 and the post-trip J12 state', async () => {
  const { timeline, report, gpxResults } = await runRealPipeline(j1Settings(18), j1FiftyMinutePausePlan)
  const accommodationDocument = await readJson('public/data/trip/accommodations.json')
  const accommodations = accommodationDocument.accommodations
  const buildDay = (dayId, instant) => {
    const now = new Date(instant)
    const planDay = rga2026TripPlan.days.find((day) => day.id === dayId)
    const gpx = planDay.type === 'ride' ? gpxResults.find((result) => result.status === 'success' && result.source.fileName === planDay.gpxFile) : null
    const states = planDay.type === 'ride' ? new Map([[dayId, syntheticWeatherState(report, dayId, now)]]) : new Map()
    return buildTodayViewModel({ now, plan: rga2026TripPlan, timeline, roadbookReport: report, accommodations, weatherSnapshot: { selectedDayId: 'J12', states }, gpx, publicBaseUrl: '/' })
  }

  const j1 = buildDay('J1', '2026-08-01T12:00:00Z')
  assert.equal(j1.dayId, 'J1')
  assert.equal(j1.departureName, 'Gare de Thonon-les-Bains')
  assert.equal(j1.accommodation.name, 'Hôtel Le Soly')
  assert.ok(j1.mapModel.coordinates.length > 2)
  assert.ok(j1.stats.distanceKm > 49 && j1.stats.distanceKm < 51)
  assert.deepEqual(j1.weather.points.map(({ name }) => name), ['Gare de Thonon-les-Bains', 'Col du Feu', 'Hôtel Le Soly'])
  assert.match(j1.dayHref, /J1/)
  assert.match(j1.gpxHref, /01_route-des-grandes-alpes/)

  const j2 = buildDay('J2', '2026-08-13T12:00:00Z')
  assert.equal(j2.accommodation.id, 'grand-bornand-vermont')
  assert.equal(j2.accommodation.name, 'Hôtel et Spa Le Vermont')
  assert.equal(j2.accommodation.website, 'https://hotelspalevermont.com/')
  assert.equal(j2.arrivalName, 'Hôtel et Spa Le Vermont')
  assert.equal(j2.mapModel.markers.filter(({ category }) => category === 'finish').length, 1)
  assert.equal(j2.mapModel.markers.find(({ category }) => category === 'finish').name, 'Hôtel et Spa Le Vermont')
  assert.doesNotMatch(JSON.stringify(j2), /Croix Saint-Maurice|croix-saint-maurice/)

  const j5 = buildDay('J5', '2026-08-16T12:00:00Z')
  assert.equal(j5.type, 'off')
  assert.equal(j5.locationName, 'Bourg-Saint-Maurice')
  assert.equal('stats' in j5, false)
  assert.equal('gpxHref' in j5, false)

  const j6 = buildDay('J6', '2026-08-17T12:00:00Z')
  assert.equal(j6.weather.points.find(({ role }) => role === 'main-col').name, 'Col de l’Iseran')
  assert.doesNotMatch(JSON.stringify(j6), /Tignes/i)

  const j9 = buildDay('J9', '2026-08-20T12:00:00Z')
  assert.equal(j9.accommodation.name, 'Gîte Auberge L’Éterlou')
  assert.equal(j9.accommodation.locality, 'Faucon-de-Barcelonnette')
  assert.equal(j9.accommodation.website, 'https://www.ubaye-gite-hote-barcelonnette.fr/fr/')
  assert.equal(j9.mapModel.markers.filter(({ category }) => category === 'finish').length, 1)

  const j10 = buildDay('J10', '2026-08-21T12:00:00Z')
  assert.equal(j10.weather.points.find(({ role }) => role === 'main-col').name, 'Col de la Bonette')
  assert.doesNotMatch(JSON.stringify(j10), /Cime de la Bonette/)

  const j12 = buildDay('J12', '2026-08-24T12:00:00Z')
  assert.equal(j12.dayId, 'J12')
  assert.equal(j12.statusLabel, 'Voyage terminé')
})
