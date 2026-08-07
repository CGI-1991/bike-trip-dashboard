import './support/dom-shim.mjs'
import '../storage/indexeddb/support/setup-fake-indexeddb.mjs'

import assert from 'node:assert/strict'
import test from 'node:test'

import { createTripRepository } from '../../src/storage/indexeddb/trip-repository.ts'
import { openTestDatabase } from '../storage/indexeddb/support/open-test-database.mjs'
import { createGenericTripBundle } from '../trip-core/support/generic-trip-fixture.mjs'
import { initializeTripsManager } from '../../src/ui/trips/trips-manager.ts'
import { GENERIC_APP_HEADER_NO_ACTIVE_TRIP } from '../../src/ui/trips/app-header.ts'

// Bug 48B closeout: `trips-manager.ts` used to never report anything to the
// app-shell header at all, so `.brand`/`[data-day-indicator]` stayed
// permanently stuck on whatever `render.ts`'s static RGA-hardcoded markup
// shipped, regardless of which trip/day was actually open. This exercises
// the reporting side (`deps.onHeaderChange`) — `main.ts`'s own DOM-applying
// half is untestable here (no real `.brand`/`[data-day-indicator]` nodes in
// this fake-container harness), covered instead by
// `tests/ui/trips/app-header.test.mjs`'s pure `buildGenericAppHeader` tests.

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

test('Mes voyages (the initial list) reports no active-trip context', async () => {
  const db = await openTestDatabase()
  try {
    const headerStates = []
    initializeTripsManager(createFakeContainer(), noopDeps(db, { onHeaderChange: (state) => headerStates.push(state) }))
    await flush()
    assert.deepEqual(headerStates.at(-1), GENERIC_APP_HEADER_NO_ACTIVE_TRIP)
  } finally {
    db.close()
  }
})

test('opening a trip (Voyage/detail) reports its own name, no subtitle', async () => {
  const db = await openTestDatabase()
  try {
    const bundle = createGenericTripBundle()
    await createTripRepository(db).saveTripBundle(bundle)
    const headerStates = []
    const container = createFakeContainer()
    const handle = initializeTripsManager(container, noopDeps(db, { onHeaderChange: (state) => headerStates.push(state) }))
    await flush()
    await handle.goToDetailForActiveTrip()
    await flush()
    assert.deepEqual(headerStates.at(-1), { tripName: 'Sample Loop 01', subtitle: null })
  } finally {
    db.close()
  }
})

test('opening Aperçu for the trip reports its own name, no subtitle', async () => {
  const db = await openTestDatabase()
  try {
    const bundle = createGenericTripBundle()
    await createTripRepository(db).saveTripBundle(bundle)
    const headerStates = []
    const container = createFakeContainer()
    const handle = initializeTripsManager(container, noopDeps(db, { onHeaderChange: (state) => headerStates.push(state) }))
    await flush()
    await handle.goToOverviewForActiveTrip()
    await flush()
    assert.deepEqual(headerStates.at(-1), { tripName: 'Sample Loop 01', subtitle: null })
  } finally {
    db.close()
  }
})

test('opening a day (Étape/OFF/Transfert) reports the trip name plus "Jx sur N · Type"', async () => {
  const db = await openTestDatabase()
  try {
    const bundle = createGenericTripBundle()
    await createTripRepository(db).saveTripBundle(bundle)
    const headerStates = []
    const container = createFakeContainer()
    const handle = initializeTripsManager(container, noopDeps(db, { onHeaderChange: (state) => headerStates.push(state) }))
    await flush()
    await handle.goToDetailForActiveTrip()
    await flush()
    container.dispatch('click', { target: fakeActionElement({ action: 'open-day-detail', dayId: bundle.days[1].id }) })
    await flush()
    assert.deepEqual(headerStates.at(-1), { tripName: 'Sample Loop 01', subtitle: 'J2 sur 4 · OFF' })
  } finally {
    db.close()
  }
})

test('going back to "Mes voyages" clears the active-trip context — never leaks the trip the user just left', async () => {
  const db = await openTestDatabase()
  try {
    const bundle = createGenericTripBundle()
    await createTripRepository(db).saveTripBundle(bundle)
    const headerStates = []
    const container = createFakeContainer()
    const handle = initializeTripsManager(container, noopDeps(db, { onHeaderChange: (state) => headerStates.push(state) }))
    await flush()
    await handle.goToOverviewForActiveTrip()
    await flush()
    handle.goToList()
    await flush()
    assert.deepEqual(headerStates.at(-1), GENERIC_APP_HEADER_NO_ACTIVE_TRIP)
  } finally {
    db.close()
  }
})
