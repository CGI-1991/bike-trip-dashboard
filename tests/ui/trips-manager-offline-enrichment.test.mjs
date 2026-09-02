import './support/dom-shim.mjs'
import '../storage/indexeddb/support/setup-fake-indexeddb.mjs'

import assert from 'node:assert/strict'
import test from 'node:test'

import { createTripRepository } from '../../src/storage/indexeddb/trip-repository.ts'
import { openTestDatabase } from '../storage/indexeddb/support/open-test-database.mjs'
import { createGenericTripBundle } from '../trip-core/support/generic-trip-fixture.mjs'
import { initializeTripsManager } from '../../src/ui/trips/trips-manager.ts'

/**
 * R2 section 3.2 (offline robustness): `navigator.onLine === false` skips
 * automatic enrichment (geocoding/route/practical-places) outright instead
 * of attempting every provider and waiting out each one's own timeout —
 * opening a trip offline must not cost up to ~90s of dead time. A lying
 * `navigator.onLine === true` (or the value simply being `undefined`, as it
 * always is under this Node test environment) must NOT skip anything —
 * real fetch failures still go through the provider's own error handling.
 */

function createFakeContainer() {
  let innerHTMLValue = ''
  const listeners = { click: [] }
  return {
    get innerHTML() { return innerHTMLValue },
    set innerHTML(value) { innerHTMLValue = value },
    addEventListener(type, listener) { listeners[type] ??= []; listeners[type].push(listener) },
    dispatch(type, event) { for (const listener of [...(listeners[type] ?? [])]) listener(event) },
    querySelector() { return null },
    querySelectorAll() { return [] },
    contains() { return true },
  }
}

function fakeActionElement(dataset) {
  const element = Object.assign(new globalThis.HTMLButtonElement(), { dataset })
  element.closest = (selector) => (selector === '[data-action]' ? (dataset.action !== undefined ? element : null) : null)
  return element
}

async function flush(ms = 30) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

/** Restores `navigator.onLine` to its original (test-environment default `undefined`) value after each test — never leaks across files. */
function withNavigatorOnLine(value, run) {
  const original = Object.getOwnPropertyDescriptor(navigator, 'onLine')
  Object.defineProperty(navigator, 'onLine', { value, configurable: true })
  return run().finally(() => {
    if (original === undefined) delete navigator.onLine
    else Object.defineProperty(navigator, 'onLine', original)
  })
}

function neverCalledPracticalPlacesProvider() {
  return {
    id: 'must-not-be-called',
    async findCandidates() { throw new Error('practical-places provider must never be called while navigator.onLine === false') },
  }
}

test('offline (navigator.onLine === false): automatic enrichment is skipped outright — no provider call at all', async () => {
  await withNavigatorOnLine(false, async () => {
    const db = await openTestDatabase()
    try {
      const bundle = createGenericTripBundle()
      await createTripRepository(db).saveTripBundle(bundle)
      const container = createFakeContainer()
      initializeTripsManager(container, {
        database: db, now: () => '2027-05-01T08:00:00.000Z', idFactory: (() => { let n = 0; return () => `id-${n++}` })(),
        renderMap: () => {}, closeMap: () => {},
        practicalPlacesProvider: neverCalledPracticalPlacesProvider(),
      })
      container.dispatch('click', { target: fakeActionElement({ action: 'open-trip', tripId: bundle.metadata.id }) })
      // Long enough for the guard's own early return AND its `finally`
      // block's `refreshIfShowing` follow-up to fully settle before the
      // database closes below — otherwise that trailing async work can
      // still be mid-flight against an already-closed database.
      await flush(500)
      // No assertion needed beyond "did not throw" — the fake provider
      // above throws the moment it is actually called, which would surface
      // as an unhandled rejection/test failure.
    } finally {
      db.close()
    }
  })
})

test('online (navigator.onLine === true, or simply undefined as in this test environment by default): automatic enrichment still runs normally — the offline guard never skips a real attempt', async () => {
  await withNavigatorOnLine(true, async () => {
    const db = await openTestDatabase()
    try {
      const bundle = createGenericTripBundle()
      await createTripRepository(db).saveTripBundle(bundle)
      const container = createFakeContainer()
      let called = false
      initializeTripsManager(container, {
        database: db, now: () => '2027-05-01T08:00:00.000Z', idFactory: (() => { let n = 0; return () => `id-${n++}` })(),
        renderMap: () => {}, closeMap: () => {},
        practicalPlacesProvider: {
          id: 'stub',
          async findCandidates() {
            called = true
            return { candidates: [], durationMs: 1, rawCandidateCount: 0, httpStatus: 200, payloadBytes: 0, startedAt: '2028-01-01T00:00:00.000Z', finishedAt: '2028-01-01T00:00:00.001Z' }
          },
        },
      })
      container.dispatch('click', { target: fakeActionElement({ action: 'open-trip', tripId: bundle.metadata.id }) })
      await flush(200)
      assert.equal(called, true, 'the provider must actually be attempted when online')
    } finally {
      db.close()
    }
  })
})
