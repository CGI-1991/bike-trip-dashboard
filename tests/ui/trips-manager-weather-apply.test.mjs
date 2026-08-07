import './support/dom-shim.mjs'
import '../storage/indexeddb/support/setup-fake-indexeddb.mjs'

import assert from 'node:assert/strict'
import test from 'node:test'

import { createTripRepository } from '../../src/storage/indexeddb/trip-repository.ts'
import { openTestDatabase } from '../storage/indexeddb/support/open-test-database.mjs'
import { createGenericTripBundle } from '../trip-core/support/generic-trip-fixture.mjs'
import { initializeTripsManager } from '../../src/ui/trips/trips-manager.ts'

// Sections 25-28 closeout: "Appliquer"/"Choisir" from the weather decision
// card never persists directly — it only reveals the shared compact
// confirmation panel; only "Confirmer" actually calls the same
// `saveDayDepartureTime` pipeline the Étape stats editor uses.

function fakeSubElement() {
  let hiddenValue = true
  let textContentValue = ''
  const dataset = {}
  return {
    get hidden() { return hiddenValue },
    set hidden(value) { hiddenValue = value },
    get textContent() { return textContentValue },
    set textContent(value) { textContentValue = value },
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
  const confirmPanel = fakeSubElement()
  const timesEl = fakeSubElement()
  container.register('[data-weather-apply-confirm]', confirmPanel)
  container.register('[data-weather-apply-confirm-times]', timesEl)
  initializeTripsManager(container, noopDeps(db))
  await flush()
  container.dispatch('click', { target: fakeActionElement({ action: 'open-trip', tripId: bundle.metadata.id }) })
  await flush()
  container.dispatch('click', { target: fakeActionElement({ action: 'open-day-detail', dayId: bundle.days[0].id }) })
  await flush()
  return { bundle, container, confirmPanel, timesEl }
}

test('"Appliquer"/"Choisir" reveals the confirmation panel pre-filled with current → target — never persists yet', async () => {
  const db = await openTestDatabase()
  try {
    const { container, confirmPanel, timesEl } = await openDayAlpha(db)
    container.dispatch('click', { target: fakeActionElement({ action: 'apply-weather-departure-time', departureTime: '07:00', currentDepartureTime: '08:00' }) })
    assert.equal(confirmPanel.hidden, false)
    assert.equal(timesEl.textContent, '08:00 → 07:00')
    assert.equal(confirmPanel.dataset.pendingDepartureTime, '07:00')
  } finally {
    db.close()
  }
})

test('"Annuler" hides the panel without ever persisting', async () => {
  const db = await openTestDatabase()
  try {
    const { bundle, container, confirmPanel } = await openDayAlpha(db)
    container.dispatch('click', { target: fakeActionElement({ action: 'apply-weather-departure-time', departureTime: '07:00', currentDepartureTime: '08:00' }) })
    container.dispatch('click', { target: fakeActionElement({ action: 'cancel-apply-weather-departure-time' }) })
    assert.equal(confirmPanel.hidden, true)
    const updated = await createTripRepository(db).loadTripBundle(bundle.metadata.id)
    assert.deepEqual(updated.settings.days, bundle.settings.days, 'cancelling must never touch the stored bundle')
  } finally {
    db.close()
  }
})

test('"Confirmer" persists the chosen departure time through the exact same saveDayDepartureTime pipeline as the Étape stats editor', async () => {
  const db = await openTestDatabase()
  try {
    const { bundle, container } = await openDayAlpha(db)
    container.dispatch('click', { target: fakeActionElement({ action: 'apply-weather-departure-time', departureTime: '07:00', currentDepartureTime: '08:00' }) })
    container.dispatch('click', { target: fakeActionElement({ action: 'confirm-apply-weather-departure-time' }) })
    await flush()
    const updated = await createTripRepository(db).loadTripBundle(bundle.metadata.id)
    const daySettings = updated.settings.days.find((entry) => entry.dayId === bundle.days[0].id)
    assert.equal(daySettings.departureTime, '07:00')
  } finally {
    db.close()
  }
})

test('confirming with no pending departure time (confirm clicked without a prior apply) is a safe no-op', async () => {
  const db = await openTestDatabase()
  try {
    const { bundle, container } = await openDayAlpha(db)
    container.dispatch('click', { target: fakeActionElement({ action: 'confirm-apply-weather-departure-time' }) })
    await flush()
    const updated = await createTripRepository(db).loadTripBundle(bundle.metadata.id)
    assert.deepEqual(updated.settings.days, bundle.settings.days)
  } finally {
    db.close()
  }
})
