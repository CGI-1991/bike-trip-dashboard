import './support/dom-shim.mjs'
import '../storage/indexeddb/support/setup-fake-indexeddb.mjs'

import assert from 'node:assert/strict'
import test from 'node:test'

import { createTripRepository } from '../../src/storage/indexeddb/trip-repository.ts'
import { openTestDatabase } from '../storage/indexeddb/support/open-test-database.mjs'
import { createGenericTripBundle } from '../trip-core/support/generic-trip-fixture.mjs'
import { initializeTripsManager } from '../../src/ui/trips/trips-manager.ts'
import { buildDayDetail } from '../../src/ui/trips/day-detail-view.ts'

// The Départ stat cell opens a small modal window (`time-edit-dialog.ts`)
// with heure/minutes, Annuler and Valider. Cancelling changes nothing;
// validating saves, recomputes the ETA, and — for a stage linked to another
// on the same day — checks the rest of the group for a strict conflict.
// The previous inline edit (a hidden `<input type="time">` plus a ✓) is
// gone; the tests below check the same guarantees through the new window.

class FakeElement {
  constructor() {
    this.listeners = new Map()
    this._hidden = false
    this._value = ''
    this._textContent = ''
    this.focusCalls = 0
    this.children = []
  }
  get hidden() { return this._hidden }
  set hidden(value) { this._hidden = value }
  get value() { return this._value }
  set value(value) { this._value = value }
  get textContent() { return this._textContent }
  set textContent(value) { this._textContent = value }
  set outerHTML(_value) { /* tracked only via the assertions below reading fresh bundle state */ }
  setAttribute() {}
  appendChild(child) { this.children.push(child) }
  querySelector() { return null }
  remove() {}
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

/**
 * A scripted stand-in for the real modal: records the request it was given,
 * and answers with whatever the test decided (including `null`, i.e. the
 * user cancelled). `validate` is called exactly as the real dialog calls it,
 * so a rejected entry is observable without a DOM.
 */
function scriptedDialog() {
  const calls = []
  let answer = null
  const open = (request) => {
    const validations = []
    calls.push({ request, validations })
    const proposed = typeof answer === 'function' ? answer(request) : answer
    if (proposed === null || proposed === undefined) return Promise.resolve(null)
    const validation = request.validate?.(proposed) ?? { ok: true }
    validations.push({ value: proposed, validation })
    return Promise.resolve(validation.ok ? proposed : null)
  }
  return {
    open,
    calls,
    answerWith(value) { answer = value },
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

async function openDayAlpha(db, { bundle: providedBundle } = {}) {
  const bundle = providedBundle ?? createGenericTripBundle()
  await createTripRepository(db).saveTripBundle(bundle)
  const container = createFakeContainer()
  const statsCard = new FakeElement()
  container.register('[data-day-detail-stats-card]', statsCard)
  const dialog = scriptedDialog()
  const handle = initializeTripsManager(container, noopDeps(db, { openTimeEditDialog: dialog.open }))
  await flush()
  container.dispatch('click', { target: fakeActionElement({ action: 'open-trip', tripId: bundle.metadata.id }) })
  await flush()
  container.dispatch('click', { target: fakeActionElement({ action: 'open-day-detail', dayId: bundle.days[0].id }) })
  await flush()
  return { bundle, container, dialog, statsCard, handle }
}

test('a click on the Départ value opens the edit window, pre-filled with the day’s current time', async () => {
  const db = await openTestDatabase()
  try {
    const { container, dialog } = await openDayAlpha(db)
    dialog.answerWith(null)
    container.dispatch('click', { target: fakeActionElement({ action: 'edit-day-departure-time' }) })
    await flush()
    assert.equal(dialog.calls.length, 1)
    assert.equal(dialog.calls[0].request.value, '08:00')
    assert.equal(dialog.calls[0].request.title, 'Heure de départ')
  } finally {
    db.close()
  }
})

test('Annuler (or dismissing the window) persists nothing at all', async () => {
  const db = await openTestDatabase()
  try {
    const { bundle, container, dialog } = await openDayAlpha(db)
    dialog.answerWith(null)
    container.dispatch('click', { target: fakeActionElement({ action: 'edit-day-departure-time' }) })
    await flush()
    const updated = await createTripRepository(db).loadTripBundle(bundle.metadata.id)
    assert.deepEqual(updated.settings.days, bundle.settings.days)
  } finally {
    db.close()
  }
})

test('Valider persists the new time and recalculates every waypoint’s ETA', async () => {
  const db = await openTestDatabase()
  try {
    const { bundle, container, dialog } = await openDayAlpha(db)
    const before = buildDayDetail(bundle, bundle.days[0].id)
    const arrivalBefore = before.waypoints.at(-1).clockTime

    dialog.answerWith('06:00')
    container.dispatch('click', { target: fakeActionElement({ action: 'edit-day-departure-time' }) })
    await flush()

    const updated = await createTripRepository(db).loadTripBundle(bundle.metadata.id)
    assert.equal(updated.settings.days.find((entry) => entry.dayId === bundle.days[0].id).departureTime, '06:00')

    const after = buildDayDetail(updated, bundle.days[0].id)
    assert.notEqual(arrivalBefore, after.waypoints.at(-1).clockTime, 'ETA recalculated')
    assert.match(after.statsHtml, /data-day-departure-value aria-label="Heure de départ 06:00, modifier">06:00<\/button>/)
  } finally {
    db.close()
  }
})

test('changing day-alpha’s departure time never touches day-delta’s own entry', async () => {
  const db = await openTestDatabase()
  try {
    const { bundle, container, dialog } = await openDayAlpha(db)
    const withDeltaSettings = {
      ...bundle,
      settings: { ...bundle.settings, days: [...bundle.settings.days, { dayId: bundle.days[3].id, departureTime: '09:30', totalBreakSeconds: null }] },
    }
    await createTripRepository(db).saveTripBundle(withDeltaSettings)

    dialog.answerWith('06:30')
    container.dispatch('click', { target: fakeActionElement({ action: 'edit-day-departure-time' }) })
    await flush()

    const updated = await createTripRepository(db).loadTripBundle(bundle.metadata.id)
    assert.equal(updated.settings.days.find((entry) => entry.dayId === bundle.days[0].id).departureTime, '06:30')
    assert.equal(updated.settings.days.find((entry) => entry.dayId === bundle.days[3].id).departureTime, '09:30')
  } finally {
    db.close()
  }
})

test('saving preserves the day’s existing totalBreakSeconds — only departureTime changes', async () => {
  const db = await openTestDatabase()
  try {
    const { bundle, container, dialog } = await openDayAlpha(db)
    dialog.answerWith('07:15')
    container.dispatch('click', { target: fakeActionElement({ action: 'edit-day-departure-time' }) })
    await flush()

    const updated = await createTripRepository(db).loadTripBundle(bundle.metadata.id)
    const daySettings = updated.settings.days.find((entry) => entry.dayId === bundle.days[0].id)
    assert.equal(daySettings.departureTime, '07:15')
    assert.equal(daySettings.totalBreakSeconds, 1_800)
  } finally {
    db.close()
  }
})

test('an unlinked day never gets a conflict check — any well-formed time validates', async () => {
  const db = await openTestDatabase()
  try {
    const { container, dialog } = await openDayAlpha(db)
    dialog.answerWith('05:00')
    container.dispatch('click', { target: fakeActionElement({ action: 'edit-day-departure-time' }) })
    await flush()
    assert.deepEqual(dialog.calls[0].validations[0].validation, { ok: true })
    assert.equal(dialog.calls[0].request.hint, null)
  } finally {
    db.close()
  }
})
