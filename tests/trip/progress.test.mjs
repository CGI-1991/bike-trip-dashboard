import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { installMinimalDOMParser } from '../support/minimal-dom-parser.mjs'

installMinimalDOMParser()

const { parseGpxDocument } = await import('../../src/gpx/parser.ts')
const { parseGpxFileNumber } = await import('../../src/gpx/load.ts')
const { rga2026TripPlan } = await import('../../src/trip/plan.ts')
const { buildTripProfile, scheduleTripTimeline } = await import('../../src/trip/timeline.ts')
const { validateRoadbookDocument, validateRoadbookOverridesDocument } = await import('../../src/trip/roadbook-validation.ts')
const { buildRoadbookMatchReport } = await import('../../src/trip/roadbook-match.ts')
const { getRoadbookPointRole } = await import('../../src/trip/point-role.ts')
const { emptyPausePlan } = await import('../../src/trip/pause-plan.ts')
const { calculateTripProgress, getProgressLocalDate } = await import('../../src/trip/progress.ts')

const root = new URL('../../', import.meta.url)
const readText = (path) => readFile(new URL(path, root), 'utf8')
const readJson = async (path) => JSON.parse(await readText(path))

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
  return Object.fromEntries(rga2026TripPlan.days.filter((day) => day.type === 'ride').map(({ id }) => [id, pausePlacesForDay(report, id)]))
}

// Built once (module scope, awaited via top-level await) — the real ten-GPX /
// real-roadbook pipeline at the default 18 km/h reference speed, exactly like
// `real-data-pipeline.test.mjs`, so progress.ts is exercised against genuine
// terrain-derived durations and real pause placement, not a synthetic fixture.
async function buildRealTimeline() {
  const manifest = await readJson('public/data/gpx/manifest.json')
  const gpxResults = await Promise.all(
    manifest.files.map(async (entry) => {
      const fileNumber = parseGpxFileNumber(entry.fileName)
      const source = { ...entry, fileNumber, url: entry.fileName, isVariant: false }
      const xmlText = await readText(`public/data/gpx/${entry.fileName}`)
      return parseGpxDocument(xmlText, source)
    }),
  )
  const roadbook = validateRoadbookDocument(await readJson('public/data/trip/roadbook.json'))
  const overridesRaw = await readJson('public/data/trip/roadbook-overrides.json')
  const overrides = validateRoadbookOverridesDocument(overridesRaw, roadbook)
  const profile = buildTripProfile(rga2026TripPlan, gpxResults)
  const getDaySettings = () => ({ referenceSpeedKph: 18, departureTime: '08:00', totalBreakMinutes: 60 })
  const firstPassTimeline = scheduleTripTimeline(profile, getDaySettings, emptyPausePlan, {})
  const firstReport = buildRoadbookMatchReport(roadbook, overrides, rga2026TripPlan, gpxResults, firstPassTimeline)
  return scheduleTripTimeline(profile, getDaySettings, emptyPausePlan, pausePlacesByDay(firstReport))
}

const timeline = await buildRealTimeline()

test('before the trip: countdown state, no fabricated position, zero completed distance', () => {
  const summary = calculateTripProgress(new Date('2026-08-01T12:00:00Z'), rga2026TripPlan, timeline)
  assert.equal(summary.period, 'before')
  assert.equal(summary.currentDayId, 'J1')
  assert.equal(summary.currentDayState, 'upcoming')
  assert.equal(summary.position, null)
  assert.equal(summary.completedDistanceKm, 0)
  assert.equal(summary.completedRideDays, 0)
  assert.ok(summary.totalDistanceKm > 0, 'global totals must still be available before departure')
})

test('during J1, before its departure time: position stays at the departure point, day state is upcoming', () => {
  const summary = calculateTripProgress(new Date('2026-08-12T05:00:00Z'), rga2026TripPlan, timeline) // 07:00 Europe/Paris
  assert.equal(summary.period, 'during')
  assert.equal(summary.currentDayId, 'J1')
  assert.equal(summary.currentDayState, 'upcoming')
  assert.ok(summary.position !== null)
  assert.equal(summary.position.distanceKm, 0)
  assert.equal(summary.position.isPaused, false)
  assert.equal(summary.completedDistanceKm, 0)
})

test('during J1, mid-climb: the theoretical position interpolates forward along the real terrain profile', () => {
  const summary = calculateTripProgress(new Date('2026-08-12T07:00:00Z'), rga2026TripPlan, timeline) // 09:00 Europe/Paris
  assert.equal(summary.currentDayState, 'in-progress')
  assert.ok(summary.position.distanceKm > 0 && summary.position.distanceKm < 49.65)
  assert.equal(summary.position.isPaused, false)
  assert.ok(Math.abs(summary.completedDistanceKm - summary.position.distanceKm) < 1e-6, 'partial day distance interpolates the real GPX profile, not a calendar percentage')
})

test('during J1, inside the automatic pause window: the theoretical position freezes at the pause point for the whole pause', () => {
  const atPauseStart = calculateTripProgress(new Date('2026-08-12T08:00:00Z'), rga2026TripPlan, timeline) // 10:00 Europe/Paris
  const laterInSamePause = calculateTripProgress(new Date('2026-08-12T08:30:00Z'), rga2026TripPlan, timeline) // 10:30 Europe/Paris
  assert.equal(atPauseStart.position.isPaused, true)
  assert.equal(laterInSamePause.position.isPaused, true)
  assert.deepEqual(atPauseStart.position, laterInSamePause.position, 'the position must not creep forward during a pause')
})

test('during J1, after its theoretical arrival: the day reads as completed and counts as a full ride day', () => {
  const summary = calculateTripProgress(new Date('2026-08-12T12:00:00Z'), rga2026TripPlan, timeline) // 14:00 Europe/Paris
  assert.equal(summary.currentDayState, 'completed')
  assert.equal(summary.completedRideDays, 1)
  assert.ok(Math.abs(summary.position.distanceKm - 49.64915533819358) < 1e-6)
  assert.equal(summary.position.dayProgress, 1)
})

test('an OFF day (J5) never creates fictitious movement — position stays frozen at the previous ride day’s arrival', () => {
  const summary = calculateTripProgress(new Date('2026-08-16T12:00:00Z'), rga2026TripPlan, timeline)
  assert.equal(summary.currentDayId, 'J5')
  assert.equal(summary.currentDayState, 'off')
  assert.equal(summary.completedRideDays, 4, 'J1–J4 are done, J5 itself is OFF and adds no ride day')
  assert.equal(summary.position.dayProgress, 1, 'position is pinned at the end of J4, the last completed ride day')
})

test('after the trip: finished state, position at the final arrival (Nice), full stats available', () => {
  const summary = calculateTripProgress(new Date('2026-08-24T12:00:00Z'), rga2026TripPlan, timeline)
  assert.equal(summary.period, 'after')
  assert.equal(summary.currentDayId, 'J12')
  assert.equal(summary.currentDayState, 'completed')
  assert.equal(summary.completedRideDays, 10)
  assert.equal(summary.remainingRideDays, 0)
  assert.ok(Math.abs(summary.position.latitude - 43.698707) < 1e-4 && Math.abs(summary.position.longitude - 7.270109) < 1e-4, 'the final theoretical position is Nice, the real J12 GPX endpoint')
  assert.ok(Math.abs(summary.completedDistanceKm - summary.totalDistanceKm) < 1e-6)
})

test('distance, D+ and D- progression stay internally consistent: completed + remaining = total, always within [0, total]', () => {
  for (const iso of ['2026-08-01T12:00:00Z', '2026-08-12T07:00:00Z', '2026-08-16T12:00:00Z', '2026-08-24T12:00:00Z']) {
    const summary = calculateTripProgress(new Date(iso), rga2026TripPlan, timeline)
    for (const [completed, remaining, total] of [
      [summary.completedDistanceKm, summary.remainingDistanceKm, summary.totalDistanceKm],
      [summary.completedElevationGainM, summary.remainingElevationGainM, summary.totalElevationGainM],
      [summary.completedElevationLossM, summary.remainingElevationLossM, summary.totalElevationLossM],
    ]) {
      assert.ok(Math.abs(completed + remaining - total) < 1e-6, `${iso}: completed + remaining must equal total`)
      assert.ok(completed >= -1e-9 && completed <= total + 1e-6, `${iso}: completed must stay within [0, total]`)
    }
    assert.ok(summary.progressPercent >= 0 && summary.progressPercent <= 100)
    assert.equal(summary.offDays, 2)
  }
})

test('the current-day resolution is timezone-driven (Europe/Paris), matching the trip calendar, not raw UTC', () => {
  const justBeforeMidnightParisOnAug11 = calculateTripProgress(new Date('2026-08-11T21:59:00Z'), rga2026TripPlan, timeline) // 23:59 Europe/Paris on Aug 11
  const justAfterMidnightParis = calculateTripProgress(new Date('2026-08-11T22:01:00Z'), rga2026TripPlan, timeline) // 00:01 Europe/Paris on Aug 12
  assert.equal(justBeforeMidnightParisOnAug11.period, 'before')
  assert.equal(justAfterMidnightParis.period, 'during')
  assert.equal(justAfterMidnightParis.currentDayId, 'J1')
})

test('getProgressLocalDate returns the calendar date in the trip timezone', () => {
  assert.equal(getProgressLocalDate(new Date('2026-08-12T05:00:00Z'), rga2026TripPlan), '2026-08-12')
  assert.equal(getProgressLocalDate(new Date('2026-08-11T22:01:00Z'), rga2026TripPlan), '2026-08-12')
})
