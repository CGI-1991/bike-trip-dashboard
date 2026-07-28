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
async function runRealPipeline(getDaySettings) {
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
  const timeline = scheduleTripTimeline(profile, getDaySettings, emptyPausePlan, pausePlacesByDay(firstReport))
  const report = buildRoadbookMatchReport(roadbook, overrides, rga2026TripPlan, gpxResults, timeline)

  return { timeline, report }
}

function defaultDaySettings() {
  const document = createDefaultRideDaySettingsDocument()
  return (dayId) => getRideDaySettings(document, dayId)
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
