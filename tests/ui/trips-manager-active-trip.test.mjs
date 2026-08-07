import './support/dom-shim.mjs'
import '../storage/indexeddb/support/setup-fake-indexeddb.mjs'

import assert from 'node:assert/strict'
import test, { after, before } from 'node:test'

import { createTripRepository } from '../../src/storage/indexeddb/trip-repository.ts'
import { openTestDatabase } from '../storage/indexeddb/support/open-test-database.mjs'
import { createGenericTripBundle } from '../trip-core/support/generic-trip-fixture.mjs'
import { initializeTripsManager } from '../../src/ui/trips/trips-manager.ts'

/**
 * Section 45/10-11 closeout: `active-trip-selection.test.mjs` already proves
 * `resolvePreferredActiveTripId`'s pure rule in isolation ("an explicit
 * choice wins even over an in-progress trip"), and the read-only audit for
 * this milestone found no live bug in the wiring — but it also found ZERO
 * integration coverage of the actual scenario at the `trips-manager.ts`
 * level: open trip B, open a day of B, click Aperçu, click Voyage, "reload"
 * (a fresh `initializeTripsManager` instance re-reading the same persisted
 * `localStorage`), click Aperçu again — B every time, never trip A even
 * though A is the one `selectMostRelevantTrip`'s own fallback logic would
 * pick automatically (in-progress beats upcoming beats last-active). This
 * file is that missing integration test, so a future regression in the
 * wiring (not just the pure selection function) would actually be caught.
 */

// `active-trip.ts` reads `globalThis.localStorage` defensively and treats it
// as unavailable when absent — true by default in this Node test runner.
// Install a small in-memory stand-in for the duration of this file only, so
// `setActiveTrip`/`getActiveTripId` actually persist across the two separate
// `initializeTripsManager` instances the "reload" test below creates —
// exactly like a real browser tab reload would.
let previousLocalStorageDescriptor

before(() => {
  previousLocalStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const values = new Map()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: (key) => values.delete(key),
    },
  })
})

after(() => {
  if (previousLocalStorageDescriptor) {
    Object.defineProperty(globalThis, 'localStorage', previousLocalStorageDescriptor)
  } else {
    delete globalThis.localStorage
  }
})

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

/** `validateTripBundle` requires every day's `date` to equal `calendar.startDate + index` days — shifting a fixture's calendar means re-deriving each day's date to match, never just the calendar/metadata dates alone. */
function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function withCalendar(bundle, startDate, endDate) {
  return {
    ...bundle,
    metadata: { ...bundle.metadata, startDate, endDate },
    calendar: { ...bundle.calendar, startDate, endDate },
    days: bundle.days.map((day) => ({ ...day, date: addDays(startDate, day.index) })),
    // Irrelevant to this test (active-trip resolution, not weather) and tied
    // to the fixture's original hardcoded dates — dropped rather than
    // reshifted, to avoid asserting anything about a field this test doesn't
    // exercise.
    weather: [],
    stages: bundle.stages.map((stage) => ({ ...stage, weatherRecordIds: [] })),
  }
}

/** Trip A: in-progress relative to `now: '2027-05-10'` — this is exactly the trip `selectMostRelevantTrip`'s fallback would pick automatically if there were no explicit active-trip id at all. */
function tripA() {
  const bundle = withCalendar(createGenericTripBundle(), '2027-05-09', '2027-05-12')
  return { ...bundle, metadata: { ...bundle.metadata, id: 'trip-a', slug: 'trip-a', name: 'Trip A (in progress)' } }
}

/** Trip B: dates well outside "today" — never the automatic fallback's pick, only ever reachable by an explicit user choice. */
function tripB() {
  const bundle = withCalendar(createGenericTripBundle(), '2027-08-01', '2027-08-04')
  return { ...bundle, metadata: { ...bundle.metadata, id: 'trip-b', slug: 'trip-b', name: 'Trip B (chosen explicitly)' } }
}

test('open B, open a day of B, click Aperçu, click Voyage, then "reload" and click Aperçu again — always B, never A', async () => {
  const db = await openTestDatabase()
  try {
    const a = tripA()
    const b = tripB()
    await createTripRepository(db).saveTripBundle(a)
    await createTripRepository(db).saveTripBundle(b)

    const headerStatesSession1 = []
    const container1 = createFakeContainer()
    // No `onNavigateToView` supplied — per CDC Jalon B4.4 section 4, the
    // "open-trip" handler then falls back to rendering Aperçu directly
    // itself, exactly the shape a standalone-embedding test needs.
    const session1 = initializeTripsManager(container1, noopDeps(db, { onHeaderChange: (state) => headerStatesSession1.push(state) }))
    await flush()

    // B. Open trip B.
    container1.dispatch('click', { target: fakeActionElement({ action: 'open-trip', tripId: 'trip-b' }) })
    await flush()
    assert.equal(headerStatesSession1.at(-1).tripName, 'Trip B (chosen explicitly)', 'opening B must show B\'s own Aperçu, not A')

    // E/F. Open a day of B (from the overview screen just opened).
    container1.dispatch('click', { target: fakeActionElement({ action: 'open-day-detail', dayId: b.days[0].id }) })
    await flush()
    assert.equal(headerStatesSession1.at(-1).tripName, 'Trip B (chosen explicitly)', 'the opened day must still belong to B')

    // C. Click the global "Aperçu" nav — must resolve back to B, the actual
    // active trip, never A (which `selectMostRelevantTrip` would otherwise
    // pick automatically as the in-progress trip).
    await session1.goToOverviewForActiveTrip()
    await flush()
    assert.equal(headerStatesSession1.at(-1).tripName, 'Trip B (chosen explicitly)', 'Aperçu must always open the ACTIVE trip (B), never the automatically "most relevant" one (A)')

    // D. Click "Voyage" — same trip.
    await session1.goToDetailForActiveTrip()
    await flush()
    assert.equal(headerStatesSession1.at(-1).tripName, 'Trip B (chosen explicitly)')

    // G/H/I. "F5": a brand-new `initializeTripsManager` instance (fresh
    // in-memory closure state, exactly like a real page reload) reading the
    // SAME persisted `localStorage` active-trip id. Aperçu must still
    // resolve to B.
    const headerStatesSession2 = []
    const container2 = createFakeContainer()
    const session2 = initializeTripsManager(container2, noopDeps(db, { onHeaderChange: (state) => headerStatesSession2.push(state) }))
    await flush()
    await session2.goToOverviewForActiveTrip()
    await flush()
    assert.equal(headerStatesSession2.at(-1).tripName, 'Trip B (chosen explicitly)', 'after a reload, Aperçu must still resolve to the persisted active trip (B), not automatically fall back to the in-progress trip (A)')
  } finally {
    db.close()
  }
})
