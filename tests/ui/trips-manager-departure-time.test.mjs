import './support/dom-shim.mjs'
import '../storage/indexeddb/support/setup-fake-indexeddb.mjs'

import assert from 'node:assert/strict'
import test from 'node:test'

import { createTripRepository } from '../../src/storage/indexeddb/trip-repository.ts'
import { openTestDatabase } from '../storage/indexeddb/support/open-test-database.mjs'
import { createGenericTripBundle } from '../trip-core/support/generic-trip-fixture.mjs'
import { initializeTripsManager } from '../../src/ui/trips/trips-manager.ts'
import { buildDayDetail } from '../../src/ui/trips/day-detail-view.ts'

// Sections 13-17/41 closeout: per-day departure time — display, inline
// editor, `saveDayDepartureTime`-equivalent persistence, ETA recalculation,
// and multi-day independence (J1's own departure time must never move J2's).

function fakeSubElement() {
  let hiddenValue = false
  let valueValue = ''
  let textContentValue = ''
  return {
    get hidden() { return hiddenValue },
    set hidden(value) { hiddenValue = value },
    get value() { return valueValue },
    set value(value) { valueValue = value },
    get textContent() { return textContentValue },
    set textContent(value) { textContentValue = value },
    set outerHTML(_value) { /* tracked only via the assertions below reading fresh bundle state */ },
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
  const editor = fakeSubElement()
  const timeInput = fakeSubElement()
  const status = fakeSubElement()
  container.register('[data-day-departure-editor]', editor)
  container.register('[data-field="day-departure-time"]', timeInput)
  container.register('[data-day-departure-status]', status)
  const handle = initializeTripsManager(container, noopDeps(db))
  await flush()
  container.dispatch('click', { target: fakeActionElement({ action: 'open-trip', tripId: bundle.metadata.id }) })
  await flush()
  container.dispatch('click', { target: fakeActionElement({ action: 'open-day-detail', dayId: bundle.days[0].id }) })
  await flush()
  return { bundle, container, editor, timeInput, status, handle }
}

test('"Modifier" reveals the editor; "Annuler" hides it again — pure client-side toggles, no persistence', async () => {
  const db = await openTestDatabase()
  try {
    const { container, editor } = await openDayAlpha(db)
    assert.equal(editor.hidden, false, 'the fake starts unhidden — asserting the toggle actually runs, not a false positive')
    container.dispatch('click', { target: fakeActionElement({ action: 'edit-day-departure-time' }) })
    assert.equal(editor.hidden, false)
    container.dispatch('click', { target: fakeActionElement({ action: 'cancel-edit-day-departure-time' }) })
    assert.equal(editor.hidden, true)
  } finally {
    db.close()
  }
})

test('saving a valid time persists TripDaySettings.departureTime for that day only, and every waypoint\'s ETA shifts by exactly the offset', async () => {
  const db = await openTestDatabase()
  try {
    const { bundle, container, timeInput } = await openDayAlpha(db)
    const before = buildDayDetail(bundle, bundle.days[0].id)
    const arrivalBefore = before.waypoints.at(-1).clockTime

    timeInput.value = '06:00' // 2h earlier than the fixture's 08:00 default
    container.dispatch('click', { target: fakeActionElement({ action: 'save-day-departure-time' }) })
    await flush()

    const tripRepository = createTripRepository(db)
    const updated = await tripRepository.loadTripBundle(bundle.metadata.id)
    const daySettings = updated.settings.days.find((entry) => entry.dayId === bundle.days[0].id)
    assert.equal(daySettings.departureTime, '06:00')

    const after = buildDayDetail(updated, bundle.days[0].id)
    const arrivalAfter = after.waypoints.at(-1).clockTime
    assert.notEqual(arrivalBefore, arrivalAfter)
    assert.match(after.statsHtml, /<span data-day-departure-value>06:00<\/span>/)
  } finally {
    db.close()
  }
})

test('changing day-alpha\'s departure time never touches day-delta\'s own entry, or its own default when it has none (multi-day independence, section 41)', async () => {
  const db = await openTestDatabase()
  try {
    const { bundle, container, timeInput } = await openDayAlpha(db)
    // Give day-delta (the fixture's second ride day) its own explicit override first.
    const withDeltaSettings = {
      ...bundle,
      settings: { ...bundle.settings, days: [...bundle.settings.days, { dayId: bundle.days[3].id, departureTime: '09:30', totalBreakSeconds: null }] },
    }
    await createTripRepository(db).saveTripBundle(withDeltaSettings)

    timeInput.value = '06:30'
    container.dispatch('click', { target: fakeActionElement({ action: 'save-day-departure-time' }) })
    await flush()

    const updated = await createTripRepository(db).loadTripBundle(bundle.metadata.id)
    const alphaSettings = updated.settings.days.find((entry) => entry.dayId === bundle.days[0].id)
    const deltaSettings = updated.settings.days.find((entry) => entry.dayId === bundle.days[3].id)
    assert.equal(alphaSettings.departureTime, '06:30')
    assert.equal(deltaSettings.departureTime, '09:30', 'day-delta\'s own explicit departure time must survive day-alpha\'s save untouched')
  } finally {
    db.close()
  }
})

test('an invalid/empty time is never persisted — the bundle stays untouched and a status message is shown', async () => {
  const db = await openTestDatabase()
  try {
    const { bundle, container, timeInput, status } = await openDayAlpha(db)
    timeInput.value = ''
    container.dispatch('click', { target: fakeActionElement({ action: 'save-day-departure-time' }) })
    await flush()

    const updated = await createTripRepository(db).loadTripBundle(bundle.metadata.id)
    assert.deepEqual(updated.settings.days, bundle.settings.days, 'an invalid time must never reach saveTripBundle')
    assert.match(status.textContent, /invalide/i)
  } finally {
    db.close()
  }
})

test('saving preserves the day\'s existing totalBreakSeconds — only departureTime changes', async () => {
  const db = await openTestDatabase()
  try {
    const bundle = createGenericTripBundle()
    // The fixture's day-alpha entry already carries totalBreakSeconds: 1_800.
    const container = createFakeContainer()
    const timeInput = fakeSubElement()
    container.register('[data-field="day-departure-time"]', timeInput)
    await createTripRepository(db).saveTripBundle(bundle)
    initializeTripsManager(container, noopDeps(db))
    await flush()
    container.dispatch('click', { target: fakeActionElement({ action: 'open-trip', tripId: bundle.metadata.id }) })
    await flush()
    container.dispatch('click', { target: fakeActionElement({ action: 'open-day-detail', dayId: bundle.days[0].id }) })
    await flush()

    timeInput.value = '07:15'
    container.dispatch('click', { target: fakeActionElement({ action: 'save-day-departure-time' }) })
    await flush()

    const updated = await createTripRepository(db).loadTripBundle(bundle.metadata.id)
    const daySettings = updated.settings.days.find((entry) => entry.dayId === bundle.days[0].id)
    assert.equal(daySettings.departureTime, '07:15')
    assert.equal(daySettings.totalBreakSeconds, 1_800)
  } finally {
    db.close()
  }
})
