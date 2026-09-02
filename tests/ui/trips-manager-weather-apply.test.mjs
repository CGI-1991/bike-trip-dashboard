import './support/dom-shim.mjs'
import '../storage/indexeddb/support/setup-fake-indexeddb.mjs'

import assert from 'node:assert/strict'
import test from 'node:test'

import { createTripRepository } from '../../src/storage/indexeddb/trip-repository.ts'
import { openTestDatabase } from '../storage/indexeddb/support/open-test-database.mjs'
import { createGenericTripBundle } from '../trip-core/support/generic-trip-fixture.mjs'
import { initializeTripsManager } from '../../src/ui/trips/trips-manager.ts'

// R2.1 section 7 (tests O-U): "Appliquer"/"Choisir" from the weather
// decision card now persist the new departure time IMMEDIATELY — no
// confirmation panel, no modal, no separate "Annuler" (reverting is simply
// choosing "Actuel" or another scenario again).

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
    querySelector(selector) { return registered.get(selector) ?? null },
    querySelectorAll(selector) { return registered.get(selector) ?? [] },
    contains() { return true },
    register(selector, element) { registered.set(selector, element) },
  }
}

function fakeActionElement(dataset) {
  const element = Object.assign(new globalThis.HTMLButtonElement(), { dataset })
  element.closest = (selector) => (selector === '[data-action]' ? (dataset.action !== undefined ? element : null) : null)
  return element
}

function stubWeatherProvider() {
  return {
    id: 'open-meteo',
    async fetchForecast(request) {
      return { provider: 'open-meteo', requestKey: request.key, fetchedAt: '2027-01-01T00:00:00.000Z', status: 'error', locations: [], datesCovered: [], issues: ['test stub'] }
    },
  }
}

function noopDeps(database, extra = {}) {
  return {
    database, now: () => '2027-05-10T08:00:00.000Z', idFactory: (() => { let n = 0; return () => `id-${n++}` })(),
    renderMap: () => {}, closeMap: () => {}, weatherProvider: stubWeatherProvider(),
    ...extra,
  }
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 50))
}

async function openDayAlpha(db) {
  const bundle = createGenericTripBundle()
  await createTripRepository(db).saveTripBundle(bundle)
  const container = createFakeContainer()
  initializeTripsManager(container, noopDeps(db))
  await flush()
  container.dispatch('click', { target: fakeActionElement({ action: 'open-trip', tripId: bundle.metadata.id }) })
  await flush()
  container.dispatch('click', { target: fakeActionElement({ action: 'open-day-detail', dayId: bundle.days[0].id }) })
  await flush()
  return { bundle, container }
}

test('O/P: "Choisir"/"Appliquer" persists the chosen departure time immediately through the exact same saveDayDepartureTime pipeline as the Étape stats editor', async () => {
  const db = await openTestDatabase()
  try {
    const { bundle, container } = await openDayAlpha(db)
    container.dispatch('click', { target: fakeActionElement({ action: 'apply-weather-departure-time', departureTime: '07:00' }) })
    await flush()
    const updated = await createTripRepository(db).loadTripBundle(bundle.metadata.id)
    const daySettings = updated.settings.days.find((entry) => entry.dayId === bundle.days[0].id)
    assert.equal(daySettings.departureTime, '07:00')
  } finally {
    db.close()
  }
})

test('Q: no confirmation panel/modal ever appears — there is nothing left to confirm or cancel', async () => {
  const db = await openTestDatabase()
  try {
    const { container } = await openDayAlpha(db)
    container.dispatch('click', { target: fakeActionElement({ action: 'apply-weather-departure-time', departureTime: '07:00' }) })
    await flush()
    assert.doesNotMatch(container.innerHTML, /data-weather-apply-confirm/)
  } finally {
    db.close()
  }
})

test('a click with no departureTime dataset (malformed/unexpected) is a safe no-op — never persists', async () => {
  const db = await openTestDatabase()
  try {
    const { bundle, container } = await openDayAlpha(db)
    container.dispatch('click', { target: fakeActionElement({ action: 'apply-weather-departure-time' }) })
    await flush()
    const updated = await createTripRepository(db).loadTripBundle(bundle.metadata.id)
    assert.deepEqual(updated.settings.days, bundle.settings.days)
  } finally {
    db.close()
  }
})

test('R: choosing a second, different scenario afterwards overwrites the first — reverting is just picking another scenario, never a separate "Annuler"', async () => {
  const db = await openTestDatabase()
  try {
    const { bundle, container } = await openDayAlpha(db)
    container.dispatch('click', { target: fakeActionElement({ action: 'apply-weather-departure-time', departureTime: '07:00' }) })
    await flush()
    container.dispatch('click', { target: fakeActionElement({ action: 'apply-weather-departure-time', departureTime: '08:00' }) })
    await flush()
    const updated = await createTripRepository(db).loadTripBundle(bundle.metadata.id)
    const daySettings = updated.settings.days.find((entry) => entry.dayId === bundle.days[0].id)
    assert.equal(daySettings.departureTime, '08:00', 'the later choice wins — no lingering pending state from the first click')
  } finally {
    db.close()
  }
})
