import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { rga2026TripPlan } from '../../src/trip/plan.ts'
import { buildOverviewAlerts, buildOverviewViewModel } from '../../src/ui/overview-view-model.ts'

const accommodations = JSON.parse(readFileSync(new URL('../../public/data/trip/accommodations.json', import.meta.url), 'utf8')).accommodations

function routeTimeline(dayId = 'J1') {
  const day = rga2026TripPlan.days.find(({ id }) => id === dayId)
  if (day.type === 'off') return { tripId: 'rga-2026', days: [{ type: 'off', day }], summary: {} }
  return {
    tripId: 'rga-2026',
    days: [{
      type: 'ride', status: 'ready', day, startTime: '08:00',
      arrivalTime: { totalMinutesFromDeparture: 215.5, clockMinutes: 695, dayOffset: 0 },
      route: {
        settings: { referenceSpeedKph: 18, departureTime: '08:00', totalBreakMinutes: 50 },
        pauses: [], waypoints: [], segments: [],
        summary: { distanceKm: 49.6, elevationGainM: 1_557, elevationLossM: 900, movingDurationMinutes: 165.5, estimatedAverageSpeedKph: 17.98, pauseDurationMinutes: 50, totalDurationMinutes: 215.5, departureTimeMinutes: 480, arrivalTimeMinutes: 695.5, terrainTiming: [] },
      },
    }],
    summary: { totalDays: 12, rideDays: 10, offDays: 2, availableRideDays: 1, unavailableRideDays: 0, totalDistanceKm: 49.6, totalElevationGainM: 1_557 },
  }
}

function baseInput(overrides = {}) {
  return {
    now: new Date('2026-08-12T08:00:00Z'),
    plan: rga2026TripPlan,
    timeline: routeTimeline('J1'),
    roadbookReport: null,
    roadbookError: null,
    accommodations,
    weatherSnapshot: { selectedDayId: 'J1', states: new Map() },
    gpxReport: null,
    publicBaseUrl: '/',
    isOffline: false,
    ...overrides,
  }
}

test('before the trip: model exposes the countdown, the global progress summary and a merged map', () => {
  const model = buildOverviewViewModel(baseInput({ now: new Date('2026-08-01T12:00:00Z') }))
  assert.equal(model.period, 'before')
  assert.equal(model.daysUntilStart, 11)
  assert.equal(model.progress.position, null)
  assert.equal(model.stage.dayId, 'J1')
  assert.ok(model.mapModel !== undefined)
})

test('during the trip: daysUntilStart is null and the stage reflects the current day', () => {
  const model = buildOverviewViewModel(baseInput())
  assert.equal(model.period, 'during')
  assert.equal(model.daysUntilStart, null)
  assert.equal(model.stage.dayId, 'J1')
})

test('after the trip: model still resolves without a timeline for the final day', () => {
  const model = buildOverviewViewModel(baseInput({ now: new Date('2026-08-24T12:00:00Z'), timeline: null }))
  assert.equal(model.period, 'after')
  assert.equal(model.daysUntilStart, null)
})

test('buildOverviewAlerts: offline surfaces an info alert independently of everything else', () => {
  const stage = { type: 'ride', weather: { primaryAlert: null }, errors: [] }
  const alerts = buildOverviewAlerts({ isOffline: true, weatherState: null, stage, gpxAvailable: true, roadbookAvailable: true, roadbookError: null, timelineAvailable: true })
  assert.ok(alerts.some((alert) => alert.id === 'offline' && alert.level === 'info'))
})

test('buildOverviewAlerts: a red primary weather alert becomes a danger-level entry, orange becomes warning', () => {
  const stage = { type: 'ride', weather: { primaryAlert: { level: 'red', title: 'Orage', summary: '', place: 'Col du Feu', time: '10:00' } }, errors: [] }
  const [alert] = buildOverviewAlerts({ isOffline: false, weatherState: null, stage, gpxAvailable: true, roadbookAvailable: true, roadbookError: null, timelineAvailable: true })
  assert.equal(alert.level, 'danger')
  assert.match(alert.message, /Orage/)
  assert.match(alert.message, /Col du Feu/)

  const orangeStage = { type: 'ride', weather: { primaryAlert: { level: 'orange', title: 'Vent', summary: '', place: null, time: null } }, errors: [] }
  const [orangeAlert] = buildOverviewAlerts({ isOffline: false, weatherState: null, stage: orangeStage, gpxAvailable: true, roadbookAvailable: true, roadbookError: null, timelineAvailable: true })
  assert.equal(orangeAlert.level, 'warning')
})

test('buildOverviewAlerts: without a primary weather alert, falls back to unavailable/stale-cache signals', () => {
  const stage = { type: 'ride', weather: { primaryAlert: null }, errors: [] }
  const unavailable = buildOverviewAlerts({ isOffline: false, weatherState: null, stage, gpxAvailable: true, roadbookAvailable: true, roadbookError: null, timelineAvailable: true })
  assert.ok(unavailable.some((alert) => alert.id === 'weather-unavailable'))

  const stale = buildOverviewAlerts({ isOffline: false, weatherState: { availability: 'stale-cache' }, stage, gpxAvailable: true, roadbookAvailable: true, roadbookError: null, timelineAvailable: true })
  assert.ok(stale.some((alert) => alert.id === 'weather-cache'))

  const available = buildOverviewAlerts({ isOffline: false, weatherState: { availability: 'available' }, stage, gpxAvailable: true, roadbookAvailable: true, roadbookError: null, timelineAvailable: true })
  assert.ok(!available.some((alert) => alert.id.startsWith('weather-')))
})

test('buildOverviewAlerts: surfaces GPX-unavailable, roadbook-unavailable and timeline/ETA-unavailable independently', () => {
  const stage = { type: 'ride', weather: { primaryAlert: null }, errors: [] }
  const gpxDown = buildOverviewAlerts({ isOffline: false, weatherState: { availability: 'available' }, stage, gpxAvailable: false, roadbookAvailable: true, roadbookError: null, timelineAvailable: true })
  assert.ok(gpxDown.some((alert) => alert.id === 'gpx-unavailable'))

  const roadbookDown = buildOverviewAlerts({ isOffline: false, weatherState: { availability: 'available' }, stage, gpxAvailable: true, roadbookAvailable: false, roadbookError: null, timelineAvailable: true })
  assert.ok(roadbookDown.some((alert) => alert.id === 'roadbook-unavailable'))

  const roadbookErrored = buildOverviewAlerts({ isOffline: false, weatherState: { availability: 'available' }, stage, gpxAvailable: true, roadbookAvailable: true, roadbookError: new Error('boom'), timelineAvailable: true })
  assert.ok(roadbookErrored.some((alert) => alert.id === 'roadbook-unavailable'))

  const timelineDown = buildOverviewAlerts({ isOffline: false, weatherState: { availability: 'available' }, stage, gpxAvailable: true, roadbookAvailable: true, roadbookError: null, timelineAvailable: false })
  assert.ok(timelineDown.some((alert) => alert.id === 'timeline-unavailable'))

  const stageWithErrors = { type: 'ride', weather: { primaryAlert: null }, errors: ['Calcul de l’étape temporairement indisponible'] }
  const stageErrored = buildOverviewAlerts({ isOffline: false, weatherState: { availability: 'available' }, stage: stageWithErrors, gpxAvailable: true, roadbookAvailable: true, roadbookError: null, timelineAvailable: true })
  assert.ok(stageErrored.some((alert) => alert.id === 'timeline-unavailable'))
})

test('buildOverviewAlerts: a fully healthy state produces no alerts at all', () => {
  const stage = { type: 'ride', weather: { primaryAlert: null }, errors: [] }
  const alerts = buildOverviewAlerts({ isOffline: false, weatherState: { availability: 'available' }, stage, gpxAvailable: true, roadbookAvailable: true, roadbookError: null, timelineAvailable: true })
  assert.deepEqual(alerts, [])
})

test('buildOverviewAlerts: an OFF day never demands GPX to be considered healthy', () => {
  const stage = { type: 'off', weather: { primaryAlert: null }, errors: [] }
  const alerts = buildOverviewAlerts({ isOffline: false, weatherState: { availability: 'available' }, stage, gpxAvailable: false, roadbookAvailable: true, roadbookError: null, timelineAvailable: true })
  assert.deepEqual(alerts, [])
})
