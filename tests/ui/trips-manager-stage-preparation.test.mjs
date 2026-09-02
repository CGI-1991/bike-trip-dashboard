import './support/dom-shim.mjs'
import '../storage/indexeddb/support/setup-fake-indexeddb.mjs'

import assert from 'node:assert/strict'
import test from 'node:test'

import { createTripRepository } from '../../src/storage/indexeddb/trip-repository.ts'
import { openTestDatabase } from '../storage/indexeddb/support/open-test-database.mjs'
import { createGenericTripBundle } from '../trip-core/support/generic-trip-fixture.mjs'
import { initializeTripsManager } from '../../src/ui/trips/trips-manager.ts'

/**
 * C2.5 sections 3-4/22-23: the "refresh chaos" this milestone fixes —
 * `startAutomaticEnrichment`'s `onProgress` used to call the full-rebuild
 * `refreshIfShowing` on EVERY per-stage tick, tearing down and rebuilding
 * the whole Voyage screen (and remounting Leaflet on Aperçu) over and over.
 * These tests assert the actual observable contract: while a background
 * enrichment pass runs with Voyage open, `container.innerHTML` is never
 * reassigned again — only the one stage's own preparation indicator is.
 */

// R1: `patchStagePreparationIndicators` now targets the always-present
// `[data-trip-day-prep-slot]` mount by `.innerHTML` rather than the
// indicator glyph's own (sometimes absent — "ready" renders nothing)
// `[data-trip-day-prep]` by `.outerHTML` — the fake follows suit.
function fakeIndicatorSlot() {
  let innerHTMLValue = ''
  let setCount = 0
  return {
    get innerHTML() { return innerHTMLValue },
    set innerHTML(value) { innerHTMLValue = value; setCount++ },
    get setCount() { return setCount },
  }
}

function fakeCardButton(slot) {
  return {
    querySelector: (selector) => (selector === '[data-trip-day-prep-slot]' ? slot : null),
    scrollIntoView() {},
  }
}

function createFakeContainer() {
  let innerHTMLValue = ''
  let innerSetCount = 0
  const listeners = { click: [] }
  const registered = new Map()
  return {
    get innerHTML() { return innerHTMLValue },
    set innerHTML(value) { innerHTMLValue = value; innerSetCount++ },
    get innerHTMLSetCount() { return innerSetCount },
    addEventListener(type, listener) { listeners[type] ??= []; listeners[type].push(listener) },
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

async function flush(ms = 30) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

/** Polls instead of a single fixed sleep — the final reconciliation involves a real DB round-trip on top of the in-memory chain the other ticks use, and a fixed short timeout flakes under heavier CI/full-suite load. */
async function waitUntil(predicate, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs
  while (!predicate() && Date.now() < deadline) await flush(20)
}

/**
 * Without an explicit override, `trips-manager.ts` defaults `weatherProvider`
 * to the real `createOpenMeteoProvider()` — a genuine network `fetch` this
 * Node test environment has no access to, whose eventual rejection could
 * otherwise land well after a test (and its database) has already closed.
 * Every `initializeTripsManager` call in this file renders Voyage, which
 * always calls `refreshWeather` — reused here under the same name as the
 * existing fix in `tests/ui/trips-manager-overview-refresh.test.mjs`.
 */
function stubWeatherProvider() {
  return {
    id: 'open-meteo',
    async fetchForecast(request) {
      return { provider: 'open-meteo', requestKey: request.key, fetchedAt: '2027-01-01T00:00:00.000Z', status: 'error', locations: [], datesCovered: [], issues: ['test stub — no real weather'] }
    },
  }
}

test('AB/AC: a practical-places progress tick patches only that stage\'s own indicator — Voyage\'s container.innerHTML is untouched mid-pass, and reconciles exactly once when the whole pass finishes', async () => {
  const db = await openTestDatabase()
  try {
    const bundle = createGenericTripBundle()
    // Both ride stages need real geometry to both be enrichable — the
    // shared fixture leaves route2 (day-delta) without any on purpose for
    // other tests; give it a trivial one here so there are two real,
    // independently-resolvable ticks to observe.
    const route2 = bundle.routes.find((route) => route.id === bundle.stages[1].sourceRouteId)
    route2.geometry = { full: null, simplified: [{ latitude: 45.5, longitude: 6.7, altitudeM: 900 }, { latitude: 45.6, longitude: 6.9, altitudeM: 1100 }] }
    await createTripRepository(db).saveTripBundle(bundle)

    const container = createFakeContainer()
    const alphaIndicator = fakeIndicatorSlot()
    const deltaIndicator = fakeIndicatorSlot()
    container.register('[data-day-id="day-alpha"]', fakeCardButton(alphaIndicator))
    container.register('[data-day-id="day-delta"]', fakeCardButton(deltaIndicator))

    const pendingCalls = []
    const provider = {
      id: 'controllable', sourceType: 'osm', attribution: 'x',
      findCandidates() {
        return new Promise((resolve) => {
          pendingCalls.push(() => resolve({ candidates: [], durationMs: 1, rawCandidateCount: 0, httpStatus: 200, payloadBytes: 0, startedAt: '2028-01-01T00:00:00.000Z', finishedAt: '2028-01-01T00:00:00.001Z' }))
        })
      },
    }

    const handle = initializeTripsManager(container, {
      database: db, now: () => '2027-05-01T08:00:00.000Z', idFactory: (() => { let n = 0; return () => `id-${n++}` })(),
      renderMap: () => {}, closeMap: () => {}, weatherProvider: stubWeatherProvider(),
      practicalPlacesProvider: provider,
    })

    // "open-trip" sets the trip active (and starts automatic enrichment in
    // the background) — then explicitly go to Voyage (the day-LIST, where
    // the preparation indicator/summary live), exactly like the bottom-nav
    // "Voyage" link resolves via `goToDetailForActiveTrip`.
    container.dispatch('click', { target: fakeActionElement({ action: 'open-trip', tripId: bundle.metadata.id }) })
    await flush()
    await handle.goToDetailForActiveTrip()
    await flush()

    const setCountAfterOpen = container.innerHTMLSetCount
    assert.ok(setCountAfterOpen > 0, 'opening Voyage did render something')
    // R3 sections 52-54 (root-causing the AB/AC flake): a fixed `flush()`
    // followed immediately by an exact-count assertion raced the real
    // async chain leading up to the first `findCandidates` call — under
    // full-suite CPU contention, 30ms isn't always enough for it to be
    // reached yet (`pendingCalls.length` observed at 0, not 1). Waiting on
    // the actual signal (the call itself landing) removes the race outright
    // — no arbitrary sleep to tune, just the real condition this assertion
    // cares about.
    await waitUntil(() => pendingCalls.length >= 1)
    assert.equal(pendingCalls.length, 1, 'stages are still requested one at a time (section 7) — the second is only reached once the first settles')

    // Resolve the FIRST stage's request — this is exactly the per-stage tick
    // that used to fire a full `renderDetail()` rebuild. The pass is not
    // over yet (a second stage remains), so nothing should reconcile the
    // whole screen at this point. Waiting for the SECOND call to actually
    // land (rather than a fixed `flush()`) both removes the same race as
    // above AND is a strictly stronger check: `innerHTMLSetCount` is
    // asserted unchanged across the whole window up to that point, not
    // just an arbitrary 30ms slice of it.
    pendingCalls[0]()
    await waitUntil(() => pendingCalls.length >= 2)
    assert.equal(pendingCalls.length, 2, 'the second (and last) stage is now being requested')
    assert.equal(container.innerHTMLSetCount, setCountAfterOpen, 'a mid-pass tick must never reassign the whole screen\'s innerHTML')
    assert.ok(alphaIndicator.setCount > 0 || deltaIndicator.setCount > 0, 'the resolved stage\'s own indicator IS patched — something useful still happens, just not a full rebuild')

    // Resolve the LAST stage — the whole pass now settles, and exactly one
    // final reconciliation (`renderDetail`'s own loading-placeholder +
    // real-content pair of assignments) is expected, never more. Already a
    // condition-based poll (never a blind sleep) — but its ORIGINAL
    // predicate (`> setCountAfterOpen`) was itself the real remaining
    // source of the AB/AC flake: it's satisfied by the FIRST of the two
    // expected assignments alone, so under full-suite contention the poll
    // could return, and the very next line assert, in the narrow gap
    // between the placeholder wipe and the real-content assignment —
    // observing `setCountAfterOpen + 1`, not `+ 2` (exactly the `7 !== 8`
    // failure mode). Waiting on the actual expected total removes this
    // race outright, no timeout tuning involved.
    pendingCalls[1]()
    await waitUntil(() => container.innerHTMLSetCount >= setCountAfterOpen + 2)
    assert.equal(container.innerHTMLSetCount, setCountAfterOpen + 2, 'exactly one full reconciliation once the whole pass has settled — never more')
    // Both `startAutomaticEnrichment` and its trailing `refreshWeather` are
    // fire-and-forget by design — waited out explicitly here so neither is
    // still mid-flight against the database once it closes below.
    await waitUntil(() => !handle.isAutomaticEnrichmentInFlight(bundle.metadata.id))
    await handle.waitForWeatherIdle()
  } finally {
    db.close()
  }
})

/**
 * R3 sections 41-42/51 (tests S-V): the gate that used to block clicking a
 * ride day from Voyage while its Postpass status was `pending`/`running`
 * (`isDayDetailOpenable`) is gone — a ride's own route/profil/timing/
 * timeline never came from Postpass in the first place, and the previous
 * gate blocked EVERY ride day for the whole (strictly sequential)
 * enrichment pass, not just the one stage actually being processed. These
 * assert the real click path end-to-end, replacing the old unit-level
 * `isDayDetailOpenable` tests removed from
 * `tests/trips-manager/stage-preparation.test.mjs`.
 */
test('S: a ride day still mid-Postpass-pass (pending/running) opens exactly like a ready one on click', async () => {
  const db = await openTestDatabase()
  try {
    const bundle = createGenericTripBundle()
    await createTripRepository(db).saveTripBundle(bundle)
    const container = createFakeContainer()

    let resolveFindCandidates
    const provider = {
      id: 'controllable', sourceType: 'osm', attribution: 'x',
      findCandidates() { return new Promise((resolve) => { resolveFindCandidates = resolve }) },
    }
    const handle = initializeTripsManager(container, {
      database: db, now: () => '2027-05-01T08:00:00.000Z', idFactory: (() => { let n = 0; return () => `id-${n++}` })(),
      renderMap: () => {}, closeMap: () => {}, weatherProvider: stubWeatherProvider(),
      practicalPlacesProvider: provider,
    })

    container.dispatch('click', { target: fakeActionElement({ action: 'open-trip', tripId: bundle.metadata.id }) })
    await flush()
    await handle.goToDetailForActiveTrip()
    await waitUntil(() => resolveFindCandidates !== undefined)
    // The very first stage's own Postpass request is genuinely still in
    // flight right now — the exact "running" moment the old gate blocked.

    container.dispatch('click', { target: fakeActionElement({ action: 'open-day-detail', dayId: bundle.days[0].id }) })
    await flush()
    // `renderDay` (via `openDay`) is the only real gate left — it must have
    // actually produced day content, not silently no-opped.
    assert.match(container.innerHTML, /data-day-detail/, 'the day screen opened even though Postpass is still running for it')

    resolveFindCandidates({ candidates: [], durationMs: 1, rawCandidateCount: 0, httpStatus: 200, payloadBytes: 0, startedAt: '2028-01-01T00:00:00.000Z', finishedAt: '2028-01-01T00:00:00.001Z' })
    await waitUntil(() => !handle.isAutomaticEnrichmentInFlight(bundle.metadata.id))
    await handle.waitForWeatherIdle()
  } finally {
    db.close()
  }
})

test('T/U: a partial or errored Postpass status never blocks opening either — already the case before R3, still true after removing the pending/running gate', async () => {
  const db = await openTestDatabase()
  try {
    const bundle = createGenericTripBundle()
    bundle.enrichmentMetadata = {
      providers: [{ provider: 'postpass-practical-places', status: 'partial', lastAttemptedAt: '2027-05-01T08:00:00.000Z', lastSuccessAt: null, message: '1 étape(s) restent à rechercher.' }],
    }
    await createTripRepository(db).saveTripBundle(bundle)
    const container = createFakeContainer()
    const handle = initializeTripsManager(container, {
      database: db, now: () => '2027-05-01T08:00:00.000Z', idFactory: (() => { let n = 0; return () => `id-${n++}` })(),
      renderMap: () => {}, closeMap: () => {}, weatherProvider: stubWeatherProvider(),
    })
    container.dispatch('click', { target: fakeActionElement({ action: 'open-trip', tripId: bundle.metadata.id }) })
    await flush()
    await handle.goToDetailForActiveTrip()
    await flush()
    container.dispatch('click', { target: fakeActionElement({ action: 'open-day-detail', dayId: bundle.days[0].id }) })
    await flush()
    assert.match(container.innerHTML, /data-day-detail/)
    await waitUntil(() => !handle.isAutomaticEnrichmentInFlight(bundle.metadata.id))
    await handle.waitForWeatherIdle()
  } finally {
    db.close()
  }
})
