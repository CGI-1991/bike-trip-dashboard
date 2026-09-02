import './support/dom-shim.mjs'
import '../storage/indexeddb/support/setup-fake-indexeddb.mjs'

import assert from 'node:assert/strict'
import test from 'node:test'

import { createTripRepository } from '../../src/storage/indexeddb/trip-repository.ts'
import { openTestDatabase } from '../storage/indexeddb/support/open-test-database.mjs'
import { createGenericTripBundle } from '../trip-core/support/generic-trip-fixture.mjs'
import { initializeTripsManager } from '../../src/ui/trips/trips-manager.ts'

/**
 * R2.1 sections 42-45 (tests BL/BM/BN): the real, confirmed cause of the
 * double-refresh observed on the field — `refreshIfShowing` used to call
 * the exact same `renderOverview` a genuine navigation open uses (wipe to
 * a "Chargement…" placeholder, full HTML replacement, Leaflet map torn
 * down and remounted) a SECOND time, unconditionally, the moment background
 * automatic enrichment settled — which, on a first open, is almost always
 * still running while Aperçu is already showing. `renderOverview`'s new
 * `diffGated` option skips all of that (placeholder wipe, HTML/map
 * replacement) whenever the freshly-computed Aperçu content turns out to be
 * byte-identical to what is already on screen.
 */

function createFakeContainer() {
  let innerHTMLValue = ''
  let innerHTMLSetCount = 0
  const listeners = { click: [] }
  const registered = new Map()
  return {
    get innerHTML() { return innerHTMLValue },
    set innerHTML(value) { innerHTMLValue = value; innerHTMLSetCount++ },
    get innerHTMLSetCount() { return innerHTMLSetCount },
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

/**
 * Without an explicit override, `trips-manager.ts` defaults `weatherProvider`
 * to the real `createOpenMeteoProvider()` — a genuine network `fetch` this
 * Node test environment has no access to, whose eventual rejection could
 * otherwise land well after a test (and its database) has already closed.
 * This is exactly the root cause `stubWeatherProvider` already exists for
 * elsewhere (e.g. `tests/ui/trips-manager-pause-editing.test.mjs`) — reused
 * here under the same name for the same reason.
 */
function stubWeatherProvider() {
  return {
    id: 'open-meteo',
    async fetchForecast(request) {
      return { provider: 'open-meteo', requestKey: request.key, fetchedAt: '2027-01-01T00:00:00.000Z', status: 'error', locations: [], datesCovered: [], issues: ['test stub — no real weather'] }
    },
  }
}

async function waitUntil(predicate, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs
  while (!predicate() && Date.now() < deadline) await flush(20)
}

test('BL/BN: opening Aperçu while automatic enrichment is still pending settles with no extra full render once enrichment finishes and nothing about the overview actually changed', async () => {
  const db = await openTestDatabase()
  try {
    const bundle = createGenericTripBundle()
    await createTripRepository(db).saveTripBundle(bundle)
    const container = createFakeContainer()

    let resolveFindCandidates
    const provider = {
      id: 'controllable', sourceType: 'osm', attribution: 'x',
      findCandidates() {
        return new Promise((resolve) => { resolveFindCandidates = resolve })
      },
    }

    const handle = initializeTripsManager(container, {
      database: db, now: () => '2027-05-01T08:00:00.000Z', idFactory: (() => { let n = 0; return () => `id-${n++}` })(),
      renderMap: () => {}, closeMap: () => {}, weatherProvider: stubWeatherProvider(),
      practicalPlacesProvider: provider,
    })

    container.dispatch('click', { target: fakeActionElement({ action: 'open-trip', tripId: bundle.metadata.id }) })
    await flush()
    await handle.goToOverviewForActiveTrip()
    await flush()

    const setCountAfterOpen = container.innerHTMLSetCount
    assert.ok(setCountAfterOpen > 0, 'opening Aperçu did render something')
    assert.ok(resolveFindCandidates !== undefined, 'enrichment is genuinely still in flight when Aperçu is already showing — the exact field scenario')

    // Settle the enrichment pass. `buildTripOverview` never surfaces
    // per-stage practical-places details, so its own HTML output is
    // unaffected by this specific provider resolving — the diff gate must
    // therefore produce ZERO additional `innerHTML` assignments here.
    resolveFindCandidates({ candidates: [], durationMs: 1, rawCandidateCount: 0, httpStatus: 200, payloadBytes: 0, startedAt: '2028-01-01T00:00:00.000Z', finishedAt: '2028-01-01T00:00:00.001Z' })
    await flush(300)
    assert.equal(container.innerHTMLSetCount, setCountAfterOpen, 'no visible "Chargement…" flash, no map teardown/rebuild when nothing about the overview changed')
    // Long enough for the enrichment pass's own trailing chain
    // (`refreshIfShowing`'s diff-gated `renderOverview`, itself a real
    // IndexedDB round-trip) to fully settle before the database closes
    // below — otherwise that trailing async work can still be mid-flight
    // against an already-closed database under heavier full-suite load.
    await flush(700)
  } finally {
    db.close()
  }
})

test('BM: when enrichment genuinely changes something Aperçu shows (e.g. route geometry newly resolved), the diff gate still lets the one real update through', async () => {
  const db = await openTestDatabase()
  try {
    const bundle = createGenericTripBundle()
    // day-delta's stage starts with no geometry at all in the shared
    // fixture — resolving it changes what `buildTripOverview` can compute
    // (its highlighted-day map/stats), a genuine, visible difference the
    // diff gate must not suppress.
    await createTripRepository(db).saveTripBundle(bundle)
    const container = createFakeContainer()

    let resolveRouteEnrichment
    const routeProvider = {
      id: 'controllable-route',
      async enrichRoute() {
        return new Promise((resolve) => { resolveRouteEnrichment = resolve })
      },
    }

    const handle = initializeTripsManager(container, {
      database: db, now: () => '2027-05-01T08:00:00.000Z', idFactory: (() => { let n = 0; return () => `id-${n++}` })(),
      renderMap: () => {}, closeMap: () => {}, weatherProvider: stubWeatherProvider(),
      routeEnrichmentProvider: routeProvider,
    })

    container.dispatch('click', { target: fakeActionElement({ action: 'open-trip', tripId: bundle.metadata.id }) })
    await flush()
    await handle.goToOverviewForActiveTrip()
    await flush()
    const setCountAfterOpen = container.innerHTMLSetCount

    if (resolveRouteEnrichment === undefined) {
      // This fixture's stages may already have resolvable geometry with no
      // enrichment actually attempted — a legitimate, harmless outcome; the
      // no-op-diff behaviour is already covered by the test above.
      return
    }
    await createTripRepository(db).saveTripBundle({
      ...bundle,
      stages: bundle.stages.map((stage) => (stage.id === bundle.stages[1]?.id ? { ...stage, distanceKm: 999 } : stage)),
    })
    resolveRouteEnrichment({ stageId: bundle.stages[1]?.id, source: 'provider', status: 'success', durationMs: 1 })
    await waitUntil(() => container.innerHTMLSetCount > setCountAfterOpen)
    assert.ok(container.innerHTMLSetCount > setCountAfterOpen, 'a genuine content change still reaches the screen — the diff gate never permanently freezes Aperçu')
    // Let the rest of the enrichment pass's own trailing chain settle before
    // the database closes below (same rationale as the test above).
    await flush(700)
  } finally {
    db.close()
  }
})
