import assert from 'node:assert/strict'
import test from 'node:test'

import { rga2026TripPlan } from '../../src/trip/plan.ts'
import { scheduleTripTimeline } from '../../src/trip/timeline.ts'

function position(distanceKm, gpxNumber) {
  return {
    latitude: 46,
    longitude: 6,
    sourceFileNumber: gpxNumber,
    sourceFileName: `${gpxNumber}.gpx`,
    distanceKm,
    elevationGainM: 0,
    elevationLossM: 0,
    altitudeM: 500,
    localSlopePercent: 0,
    speedMultiplier: 1,
    weightedDistanceKm: distanceKm,
  }
}

function readyRouteProfile(gpxNumber, distanceKm = 60) {
  const start = position(0, gpxNumber)
  const end = position(distanceKm, gpxNumber)
  return {
    waypointSeeds: [
      { id: `route-start-${gpxNumber}`, type: 'route-start', name: 'Départ', position: start },
      { id: `route-end-${gpxNumber}`, type: 'route-end', name: 'Arrivée', position: end },
    ],
    pauseAnchors: [],
    segments: [
      {
        sourceFileNumber: gpxNumber,
        sourceFileName: `${gpxNumber}.gpx`,
        name: 'Test',
        startName: 'A',
        endName: 'B',
        pointCount: 2,
        trackSegmentCount: 1,
        distanceKm,
        elevationGainM: 0,
        elevationLossM: 0,
        minAltitudeM: 500,
        maxAltitudeM: 500,
        startPosition: start,
        endPosition: end,
      },
    ],
    summary: {
      sourceGpxCount: 1,
      sourceTrackSegmentCount: 1,
      sourcePointCount: 2,
      distanceKm,
      elevationGainM: 0,
      elevationLossM: 0,
      minAltitudeM: 500,
      maxAltitudeM: 500,
      weightedDistanceKm: distanceKm,
      isContinuous: true,
      maximumBoundaryGapKm: 0,
      firstSourceFileNumber: gpxNumber,
      lastSourceFileNumber: gpxNumber,
    },
  }
}

function buildProfile(readyDayIds) {
  return {
    tripId: rga2026TripPlan.id,
    routeConfig: {},
    days: rga2026TripPlan.days.map((day) => {
      if (day.type === 'off') return { type: 'off', day }
      if (readyDayIds.includes(day.id)) {
        return { type: 'ride', status: 'ready', day, routeProfile: readyRouteProfile(day.gpxNumber) }
      }
      return { type: 'ride', status: 'unavailable', day, message: 'non testé' }
    }),
  }
}

const settingsByDay = {
  J1: { averageSpeedKph: 18, departureTime: '08:00', totalBreakMinutes: 30 },
  J2: { averageSpeedKph: 16, departureTime: '07:30', totalBreakMinutes: 75 },
}

function getDaySettings(dayId) {
  return settingsByDay[dayId] ?? { averageSpeedKph: 18, departureTime: '08:00', totalBreakMinutes: 60 }
}

const pausePlacesByDay = {
  J1: [{ id: 'j01-place', name: 'Lieu J1', trackDistanceKm: 30, offRoute: false }],
  J2: [{ id: 'j02-place', name: 'Lieu J2', trackDistanceKm: 30, offRoute: false }],
}

test('each ride day uses its own settings — J1 and J2 get independent speed, departure and ETA', () => {
  const profile = buildProfile(['J1', 'J2'])
  const timeline = scheduleTripTimeline(profile, getDaySettings, undefined, pausePlacesByDay)

  const j1 = timeline.days.find((day) => day.day.id === 'J1')
  const j2 = timeline.days.find((day) => day.day.id === 'J2')

  assert.equal(j1.route.settings.averageSpeedKph, 18)
  assert.equal(j1.route.settings.departureTime, '08:00')
  assert.equal(j1.startTime, '08:00')

  assert.equal(j2.route.settings.averageSpeedKph, 16)
  assert.equal(j2.route.settings.departureTime, '07:30')
  assert.equal(j2.startTime, '07:30')

  // Same distance (60 km), different speed and break time: different ETA.
  assert.notEqual(j1.route.summary.arrivalTimeMinutes, j2.route.summary.arrivalTimeMinutes)
  assert.equal(j1.route.summary.pauseDurationMinutes, 30)
  assert.equal(j2.route.summary.pauseDurationMinutes, 75)
})

test('changing J2 alone never changes J1’s computed route', () => {
  const profile = buildProfile(['J1', 'J2'])
  const baseline = scheduleTripTimeline(profile, getDaySettings, undefined, pausePlacesByDay)
  const j1Baseline = baseline.days.find((day) => day.day.id === 'J1')

  const changed = scheduleTripTimeline(
    profile,
    (dayId) => (dayId === 'J2' ? { averageSpeedKph: 10, departureTime: '05:00', totalBreakMinutes: 5 } : getDaySettings(dayId)),
    undefined,
    pausePlacesByDay,
  )
  const j1AfterChange = changed.days.find((day) => day.day.id === 'J1')

  assert.deepEqual(j1AfterChange.route.summary, j1Baseline.route.summary)
  assert.equal(j1AfterChange.startTime, j1Baseline.startTime)
})

test('TripTimeline no longer carries one shared settings field — each ride day owns its own via route.settings', () => {
  const profile = buildProfile(['J1'])
  const timeline = scheduleTripTimeline(profile, getDaySettings)
  assert.equal('settings' in timeline, false)
})

test('regression guard: an empty pausePlacesByDay (before the roadbook report exists) never leaves a ride day unavailable', () => {
  const profile = buildProfile(['J1', 'J2', 'J3'])
  // Exactly the state of the very first scheduling pass in main.ts: no
  // documented places have been resolved yet for any day.
  const timeline = scheduleTripTimeline(profile, getDaySettings, undefined, {})

  for (const dayId of ['J1', 'J2', 'J3']) {
    const day = timeline.days.find((candidate) => candidate.day.id === dayId)
    assert.equal(day.status, 'ready', `${dayId} must stay ready even with zero documented places available`)
    assert.equal(day.route.summary.pauseDurationMinutes, 0, `${dayId} has nothing to attach its configured break to yet, so it schedules with none`)
  }
})

test('custom mode: the effective total break always equals the sum of resolved anchors, never a stale stored value', () => {
  const profile = buildProfile(['J6'])
  const pausePlan = {
    version: 1,
    days: [
      {
        dayId: 'J6',
        mode: 'custom',
        pauses: [{ id: 'lunch', active: true, placeId: 'j06-place', placeName: 'Lieu', durationMinutes: 20, order: 0, origin: 'custom' }],
      },
    ],
  }
  const places = { J6: [{ id: 'j06-place', name: 'Lieu', trackDistanceKm: 30, offRoute: false }] }
  // The day's stored RideDaySettings.totalBreakMinutes (60, from getDaySettings's
  // fallback) intentionally disagrees with the one custom pause (20 min).
  const timeline = scheduleTripTimeline(profile, getDaySettings, pausePlan, places)
  const j6 = timeline.days.find((day) => day.day.id === 'J6')
  assert.equal(j6.status, 'ready')
  assert.equal(j6.route.summary.pauseDurationMinutes, 20, 'the resolved custom pause sum wins, not the stored 60')
  assert.equal(j6.route.pauses.length, 1)
  assert.equal(j6.route.pauses[0].pointId, 'j06-place')
})

test('a custom plan whose every pause becomes unresolvable recovers as automatic for that day only, preserving its configured total', () => {
  const profile = buildProfile(['J1', 'J2'])
  const pausePlan = {
    version: 1,
    days: [
      {
        dayId: 'J1',
        mode: 'custom',
        // Points to a place that no longer exists (suppressed/unknown) — the whole plan resolves to nothing.
        pauses: [{ id: 'stale', active: true, placeId: 'no-longer-exists', placeName: 'Disparu', durationMinutes: 15, order: 0, origin: 'custom' }],
      },
    ],
  }
  const timeline = scheduleTripTimeline(profile, getDaySettings, pausePlan, pausePlacesByDay)

  const j1 = timeline.days.find((day) => day.day.id === 'J1')
  const j2 = timeline.days.find((day) => day.day.id === 'J2')
  assert.equal(j1.status, 'ready', 'J1 must recover instead of becoming unavailable')
  assert.equal(j1.route.settings.totalBreakMinutes, 30, "J1's own configured total (30) is preserved, not zeroed")
  assert.equal(j1.route.summary.pauseDurationMinutes, 30)
  assert.ok(j1.route.pauses.length > 0, 'automatic pauses regenerate from the real places available')
  // J2 is completely unaffected by J1's recovery.
  assert.equal(j2.status, 'ready')
  assert.equal(j2.route.settings.totalBreakMinutes, 75)
})
