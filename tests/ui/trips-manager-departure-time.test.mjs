import './support/dom-shim.mjs'
import '../storage/indexeddb/support/setup-fake-indexeddb.mjs'

import assert from 'node:assert/strict'
import test from 'node:test'

import { createTripRepository } from '../../src/storage/indexeddb/trip-repository.ts'
import { openTestDatabase } from '../storage/indexeddb/support/open-test-database.mjs'
import { createGenericTripBundle } from '../trip-core/support/generic-trip-fixture.mjs'
import { initializeTripsManager } from '../../src/ui/trips/trips-manager.ts'
import { buildDayDetail } from '../../src/ui/trips/day-detail-view.ts'

// CDC D1.2 section 11 (tests M/N/O/P/Q): the Départ stat cell is the
// editing surface itself — a plain display button and an (initially
// hidden) `<input type="time">` toggle in place, no separate "Modifier"
// trigger/panel any more.

class FakeElement {
  constructor() {
    this.listeners = new Map()
    this._hidden = false
    this._value = ''
    this._textContent = ''
    this.focusCalls = 0
  }
  get hidden() { return this._hidden }
  set hidden(value) { this._hidden = value }
  get value() { return this._value }
  set value(value) { this._value = value }
  get textContent() { return this._textContent }
  set textContent(value) { this._textContent = value }
  set outerHTML(_value) { /* tracked only via the assertions below reading fresh bundle state */ }
  focus() { this.focusCalls += 1 }
  showPicker() {}
  addEventListener(type, listener, options = {}) {
    const set = this.listeners.get(type) ?? new Set()
    set.add(listener)
    this.listeners.set(type, set)
    options.signal?.addEventListener('abort', () => set.delete(listener), { once: true })
  }
  emit(type, event = {}) { for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event) }
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
  const displayButton = new FakeElement()
  displayButton.textContent = '08:00'
  const timeInput = new FakeElement()
  timeInput.value = '08:00'
  timeInput.hidden = true
  container.register('[data-day-departure-value]', displayButton)
  container.register('[data-day-departure-input]', timeInput)
  const handle = initializeTripsManager(container, noopDeps(db))
  await flush()
  container.dispatch('click', { target: fakeActionElement({ action: 'open-trip', tripId: bundle.metadata.id }) })
  await flush()
  container.dispatch('click', { target: fakeActionElement({ action: 'open-day-detail', dayId: bundle.days[0].id }) })
  await flush()
  return { bundle, container, displayButton, timeInput, handle }
}

test('M: a click on the Départ value reveals the inline input, focused, and hides the display button', async () => {
  const db = await openTestDatabase()
  try {
    const { container, displayButton, timeInput } = await openDayAlpha(db)
    assert.equal(timeInput.hidden, true, 'sanity check: the input starts hidden')
    container.dispatch('click', { target: fakeActionElement({ action: 'edit-day-departure-time' }) })
    assert.equal(displayButton.hidden, true)
    assert.equal(timeInput.hidden, false)
    assert.equal(timeInput.focusCalls, 1)
  } finally {
    db.close()
  }
})

test('O: Escape reverts the input to the original value and hides it again — no persistence', async () => {
  const db = await openTestDatabase()
  try {
    const { bundle, container, displayButton, timeInput } = await openDayAlpha(db)
    container.dispatch('click', { target: fakeActionElement({ action: 'edit-day-departure-time' }) })
    timeInput.value = '06:00'
    let prevented = false
    timeInput.emit('keydown', { key: 'Escape', preventDefault: () => { prevented = true } })
    assert.equal(prevented, true)
    assert.equal(timeInput.value, '08:00', 'reverted to the original value')
    assert.equal(timeInput.hidden, true)
    assert.equal(displayButton.hidden, false)

    const updated = await createTripRepository(db).loadTripBundle(bundle.metadata.id)
    assert.deepEqual(updated.settings.days, bundle.settings.days, 'Escape must never persist')
  } finally {
    db.close()
  }
})

test('N/P: Enter commits a valid new time — persists it and recalculates every waypoint\'s ETA', async () => {
  const db = await openTestDatabase()
  try {
    const { bundle, container, timeInput } = await openDayAlpha(db)
    const before = buildDayDetail(bundle, bundle.days[0].id)
    const arrivalBefore = before.waypoints.at(-1).clockTime

    container.dispatch('click', { target: fakeActionElement({ action: 'edit-day-departure-time' }) })
    timeInput.value = '06:00' // 2h earlier than the fixture's 08:00 default
    let prevented = false
    timeInput.emit('keydown', { key: 'Enter', preventDefault: () => { prevented = true } })
    assert.equal(prevented, true)
    await flush()

    const tripRepository = createTripRepository(db)
    const updated = await tripRepository.loadTripBundle(bundle.metadata.id)
    const daySettings = updated.settings.days.find((entry) => entry.dayId === bundle.days[0].id)
    assert.equal(daySettings.departureTime, '06:00')

    const after = buildDayDetail(updated, bundle.days[0].id)
    const arrivalAfter = after.waypoints.at(-1).clockTime
    assert.notEqual(arrivalBefore, arrivalAfter, 'P: ETA recalculated')
    assert.match(after.statsHtml, /data-day-departure-value aria-label="Heure de départ 06:00, modifier">06:00<\/button>/)
  } finally {
    db.close()
  }
})

test('blur commits a valid, changed value exactly like Enter', async () => {
  const db = await openTestDatabase()
  try {
    const { bundle, container, timeInput } = await openDayAlpha(db)
    container.dispatch('click', { target: fakeActionElement({ action: 'edit-day-departure-time' }) })
    timeInput.value = '07:15'
    timeInput.emit('blur')
    await flush()

    const updated = await createTripRepository(db).loadTripBundle(bundle.metadata.id)
    const daySettings = updated.settings.days.find((entry) => entry.dayId === bundle.days[0].id)
    assert.equal(daySettings.departureTime, '07:15')
  } finally {
    db.close()
  }
})

test('blur with an unchanged value just reverts — never a needless save', async () => {
  const db = await openTestDatabase()
  try {
    const { bundle, container, timeInput, displayButton } = await openDayAlpha(db)
    container.dispatch('click', { target: fakeActionElement({ action: 'edit-day-departure-time' }) })
    // No edit at all — value stays 08:00.
    timeInput.emit('blur')
    await flush()

    assert.equal(timeInput.hidden, true)
    assert.equal(displayButton.hidden, false)
    const updated = await createTripRepository(db).loadTripBundle(bundle.metadata.id)
    assert.deepEqual(updated.settings.days, bundle.settings.days)
  } finally {
    db.close()
  }
})

test('an invalid/empty time typed then blurred is never persisted — reverts instead', async () => {
  const db = await openTestDatabase()
  try {
    const { bundle, container, timeInput } = await openDayAlpha(db)
    container.dispatch('click', { target: fakeActionElement({ action: 'edit-day-departure-time' }) })
    timeInput.value = ''
    timeInput.emit('blur')
    await flush()

    const updated = await createTripRepository(db).loadTripBundle(bundle.metadata.id)
    assert.deepEqual(updated.settings.days, bundle.settings.days, 'an invalid time must never reach saveTripBundle')
    assert.equal(timeInput.value, '08:00', 'reverted to the original value')
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

    container.dispatch('click', { target: fakeActionElement({ action: 'edit-day-departure-time' }) })
    timeInput.value = '06:30'
    timeInput.emit('keydown', { key: 'Enter', preventDefault: () => {} })
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

test('saving preserves the day\'s existing totalBreakSeconds — only departureTime changes', async () => {
  const db = await openTestDatabase()
  try {
    const bundle = createGenericTripBundle()
    // The fixture's day-alpha entry already carries totalBreakSeconds: 1_800.
    const container = createFakeContainer()
    const displayButton = new FakeElement()
    displayButton.textContent = '08:00'
    const timeInput = new FakeElement()
    timeInput.value = '08:00'
    timeInput.hidden = true
    container.register('[data-day-departure-value]', displayButton)
    container.register('[data-day-departure-input]', timeInput)
    await createTripRepository(db).saveTripBundle(bundle)
    initializeTripsManager(container, noopDeps(db))
    await flush()
    container.dispatch('click', { target: fakeActionElement({ action: 'open-trip', tripId: bundle.metadata.id }) })
    await flush()
    container.dispatch('click', { target: fakeActionElement({ action: 'open-day-detail', dayId: bundle.days[0].id }) })
    await flush()

    container.dispatch('click', { target: fakeActionElement({ action: 'edit-day-departure-time' }) })
    timeInput.value = '07:15'
    timeInput.emit('keydown', { key: 'Enter', preventDefault: () => {} })
    await flush()

    const updated = await createTripRepository(db).loadTripBundle(bundle.metadata.id)
    const daySettings = updated.settings.days.find((entry) => entry.dayId === bundle.days[0].id)
    assert.equal(daySettings.departureTime, '07:15')
    assert.equal(daySettings.totalBreakSeconds, 1_800)
  } finally {
    db.close()
  }
})

test('re-opening the edit after a save never accumulates a second keydown/blur listener on the input', async () => {
  const db = await openTestDatabase()
  try {
    const { bundle, container, timeInput } = await openDayAlpha(db)
    container.dispatch('click', { target: fakeActionElement({ action: 'edit-day-departure-time' }) })
    timeInput.value = '06:00'
    timeInput.emit('keydown', { key: 'Enter', preventDefault: () => {} })
    await flush()
    // patchDayDetail re-wires a *fresh* stats subtree/input — since this
    // fake container keeps returning the SAME registered fake element,
    // this proves the second wiring aborted the first rather than piling
    // a second listener onto it.
    assert.equal(timeInput.listeners.get('keydown')?.size ?? 0, 1)
    assert.equal(timeInput.listeners.get('blur')?.size ?? 0, 1)
  } finally {
    db.close()
  }
})
