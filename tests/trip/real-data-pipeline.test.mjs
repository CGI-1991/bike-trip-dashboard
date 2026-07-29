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

  return { timeline, report }
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
