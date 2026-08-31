import './support/dom-shim.mjs'
import '../storage/indexeddb/support/setup-fake-indexeddb.mjs'

import assert from 'node:assert/strict'
import test from 'node:test'

import { createTripRepository } from '../../src/storage/indexeddb/trip-repository.ts'
import { openTestDatabase } from '../storage/indexeddb/support/open-test-database.mjs'
import { createGenericTripBundle } from '../trip-core/support/generic-trip-fixture.mjs'
import { initializeTripsManager } from '../../src/ui/trips/trips-manager.ts'

// CDC D1.2 sections 14-24 (test U/V/W) — the real end-to-end wiring: once
// weather arrives, `trips-manager.ts` fills each Parcours row's own
// `[data-waypoint-weather]` mount (day-detail-view.ts) with its matching
// point from the SAME view-model the (now points-list-free) weather panel
// itself reads — matched purely by id, no second fetch, no second list.

function fakeElement() {
  const dataset = {}
  return {
    innerHTML: '',
    dataset,
  }
}

function createFakeContainer() {
  let innerHTMLValue = ''
  const listeners = { click: [], change: [], input: [] }
  const registered = new Map()
  return {
    get innerHTML() { return innerHTMLValue },
    set innerHTML(value) { innerHTMLValue = value },
    addEventListener(type, listener, options) {
      listeners[type] ??= []
      listeners[type].push(listener)
      options?.signal?.addEventListener?.('abort', () => {
        listeners[type] = listeners[type].filter((candidate) => candidate !== listener)
      })
    },
    dispatch(type, event) { for (const listener of [...(listeners[type] ?? [])]) listener(event) },
    querySelector(selector) { return (registered.get(selector) ?? [null])[0] ?? null },
    querySelectorAll(selector) { return registered.get(selector) ?? [] },
    contains() { return true },
    register(selector, elements) { registered.set(selector, elements) },
  }
}

function fakeActionElement(dataset) {
  const element = Object.assign(new globalThis.HTMLButtonElement(), { dataset })
  element.closest = (selector) => (selector === '[data-action]' ? (dataset.action !== undefined ? element : null) : null)
  return element
}

/** All-benign forecast (mirrors tests/weather/generic/view-model.test.mjs's own fixture) — enough to exercise the compact, non-alert rendering path end to end. */
function fakeForecastFor(request, fetchedAt = '2027-05-09T06:00:00.000Z') {
  const hours = ['08:00', '10:00', '12:00', '14:00', '16:00']
  return {
    provider: 'open-meteo', requestKey: request.key, fetchedAt, status: 'success',
    locations: request.locations.map((location) => ({
      status: 'success', requestLocationId: location.id,
      requestedLatitude: location.latitude, requestedLongitude: location.longitude, requestedElevationM: location.elevationM,
      providerLatitude: location.latitude, providerLongitude: location.longitude, providerElevationM: location.elevationM,
      timezone: request.timezone, utcOffsetSeconds: 3_600,
      hourly: request.requiredDates.flatMap((date) => hours.map((hour) => ({
        time: `${date}T${hour}`, temperatureC: 15, apparentTemperatureC: 14, relativeHumidityPct: 60,
        precipitationProbabilityPct: 10, precipitationMm: 0, rainMm: 0, showersMm: 0, snowfallCm: 0,
        weatherCode: 1, cloudCoverPct: 20, visibilityM: 20_000, windSpeedKph: 10, windDirectionDeg: 180,
        windGustsKph: 15, freezingLevelM: 3_000,
      }))),
      daily: request.requiredDates.map((date) => ({
        date, temperatureMinC: 10, temperatureMaxC: 20, apparentTemperatureMinC: 9, apparentTemperatureMaxC: 19,
        precipitationSumMm: 0, precipitationProbabilityMaxPct: 10, weatherCode: 1, windSpeedMaxKph: 15,
        windGustsMaxKph: 20, windDirectionDominantDeg: 180, sunrise: `${date}T06:30`, sunset: `${date}T20:30`,
      })),
      missingVariables: [], issues: [],
    })),
    datesCovered: request.requiredDates, issues: [],
  }
}

function realWeatherProvider() {
  return { id: 'open-meteo', async fetchForecast(request) { return fakeForecastFor(request) } }
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 50))
}

test('U/W: the start waypoint\'s own [data-waypoint-weather] mount is filled from the exact same view-model the (points-list-free) weather panel reads — matched by id, no second list, no second fetch', async () => {
  const db = await openTestDatabase()
  try {
    const bundle = createGenericTripBundle()
    await createTripRepository(db).saveTripBundle(bundle)
    const container = createFakeContainer()
    const weatherPanel = fakeElement()
    // day-alpha's ride stage is "stage-alpha" — canonical-waypoints.ts
    // stamps its start waypoint id as `${stage.id}:start`, the exact same
    // id weather/generic/sample-points.ts uses for the matching sample
    // point (`id: waypoint.id`).
    const startWaypointMount = fakeElement()
    startWaypointMount.dataset.waypointId = 'stage-alpha:start'
    container.register('[data-day-detail-weather]', [weatherPanel])
    container.register('[data-waypoint-weather]', [startWaypointMount])

    const handle = initializeTripsManager(container, {
      database: db, now: () => '2027-05-09T08:00:00.000Z', idFactory: (() => { let n = 0; return () => `id-${n++}` })(),
      renderMap: () => {}, closeMap: () => {}, weatherProvider: realWeatherProvider(),
    })
    await flush()
    container.dispatch('click', { target: fakeActionElement({ action: 'open-trip', tripId: bundle.metadata.id }) })
    await flush()
    container.dispatch('click', { target: fakeActionElement({ action: 'open-day-detail', dayId: bundle.days[0].id }) })
    await flush()
    await flush() // the weather fetch itself is async on top of the render's own microtasks

    assert.doesNotMatch(weatherPanel.innerHTML, /weather-points-block/, 'the points list itself is gone from the mounted panel')
    assert.match(startWaypointMount.innerHTML, /day-detail__waypoint-weather/, 'the matching row got its own inline weather line')
    assert.match(startWaypointMount.innerHTML, /°C/)
  } finally {
    db.close()
  }
})
