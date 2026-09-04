import './support/dom-shim.mjs'
import '../storage/indexeddb/support/setup-fake-indexeddb.mjs'

import assert from 'node:assert/strict'
import test from 'node:test'

import { tripId } from '../../src/trip-core/model/ids.ts'
import { createTripRepository } from '../../src/storage/indexeddb/trip-repository.ts'
import { openTestDatabase } from '../storage/indexeddb/support/open-test-database.mjs'
import { createGenericTripBundle } from '../trip-core/support/generic-trip-fixture.mjs'
import { initializeTripsManager } from '../../src/ui/trips/trips-manager.ts'

/**
 * Integrity-hardening sections 29-38/70-75 — auto-retry with backoff for a
 * stuck automatic-enrichment pass. `classifyEnrichmentFailure` has only two
 * outcomes (`'too-heavy'` / `'unavailable'`); a job that keeps failing as
 * `'too-heavy'` (the dead end this fixes) is written back `pending` with no
 * follow-up anywhere except: re-opening the trip, the debounced `online`
 * resume, or now this per-trip backoff timer (30s → 2min → 5min in
 * production, reset on real progress, cancelled on trip switch).
 *
 * These tests drive the real `startAutomaticEnrichment` orchestration
 * through `initializeTripsManager`'s public `open-trip` action and a
 * controllable `RouteEnrichmentProvider` stub, using real timers throughout
 * (fake-timer libraries fight fake-indexeddb's own `setImmediate`-based
 * scheduling — see the injection seam's own doc comment). `automaticRetryBackoffMs`
 * substitutes a tiny, well-separated three-rung ladder for the real
 * 30s/2min/5min one so the whole ladder — including its 5min cap — costs
 * a couple of seconds of real wall-clock time instead of minutes, while
 * still genuinely exercising the same code path with the same production
 * defaults everywhere else.
 */

const RUNGS = [50, 400, 1200]
// Geometric-mean cutoffs between consecutive rungs — a measured gap below
// `FAST_CEILING` is "the 1st rung fired", between the two ceilings is "the
// 2nd rung fired", at or above `MEDIUM_CEILING` is "the 3rd (capped) rung
// fired". Comfortably clear of real `setTimeout` jitter on a loaded CI box.
const FAST_CEILING = Math.sqrt(RUNGS[0] * RUNGS[1])
const MEDIUM_CEILING = Math.sqrt(RUNGS[1] * RUNGS[2])

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

function dispatchOpenTrip(container, id) {
  container.dispatch('click', { target: fakeActionElement({ action: 'open-trip', tripId: id }) })
}

async function flush(ms = 20) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitUntilIdle(handle, id, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs
  while (handle.isAutomaticEnrichmentInFlight(id) && Date.now() < deadline) await flush(5)
  assert.equal(handle.isAutomaticEnrichmentInFlight(id), false, 'automatic enrichment never settled within the test budget')
}

/** Polls until a stage has been attempted `expectedCount` times, returning the wall-clock time of that Nth attempt. */
async function waitForCallCount(provider, stageId, expectedCount, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs
  while ((provider.attempts.get(stageId) ?? 0) < expectedCount && Date.now() < deadline) await flush(5)
  assert.equal(provider.attempts.get(stageId), expectedCount, `expected exactly ${expectedCount} call(s) for ${stageId} within ${timeoutMs}ms`)
  return Date.now()
}

/** ~1.55 km of real geometry (well under `MINIMUM_SEGMENT_KM` = 2.5) so `planStageJobs` plans exactly ONE structural job per stage that never subdivides on failure — a stage's job identity, and this test's per-stage call count, stay stable across every retry. */
const SHORT_GEOMETRY = {
  full: null,
  simplified: [
    { latitude: 45.100, longitude: 6.200, altitudeM: 210 },
    { latitude: 45.112, longitude: 6.210, altitudeM: 220 },
  ],
}

function createShortRouteBundle() {
  const bundle = createGenericTripBundle()
  return {
    ...bundle,
    routes: bundle.routes.map((route) => ({ ...route, geometry: SHORT_GEOMETRY, parsingStatus: 'success', parsingErrors: [] })),
  }
}

/** A trip with zero enrichable stages (no route has any geometry at all) — `tripNeedsAutomaticEnrichment` is false the instant it loads, so opening it never calls the provider, only ever exercising the unconditional top-of-function `cancelAutomaticRetryBackoff()`. */
function createInertBundle(id) {
  const bundle = createGenericTripBundle()
  return {
    ...bundle,
    metadata: { ...bundle.metadata, id: tripId(id) },
    routes: bundle.routes.map((route) => ({ ...route, geometry: null })),
  }
}

function createControllableStructuralProvider() {
  const attempts = new Map()
  const behavior = new Map()
  return {
    id: 'controllable-structural',
    sourceType: 'osm',
    attribution: 'test fixture',
    attempts,
    setBehavior(stageId, mode) { behavior.set(stageId, mode) },
    async findStructuralCandidates(search) {
      attempts.set(search.stageId, (attempts.get(search.stageId) ?? 0) + 1)
      if ((behavior.get(search.stageId) ?? 'fail') === 'fail') throw new Error('synthetic too-heavy failure')
      return { candidates: [], durationMs: 1, rawCandidateCount: 0, httpStatus: 200, payloadBytes: 0, startedAt: '2028-01-01T00:00:00.000Z', finishedAt: '2028-01-01T00:00:00.001Z' }
    },
  }
}

test('a stuck stage retries on the first rung, resets to the first rung on real progress, then escalates rung by rung and stays capped at the last one', async () => {
  const db = await openTestDatabase()
  try {
    const bundle = createShortRouteBundle()
    const alphaId = bundle.stages[0].id
    const deltaId = bundle.stages[1].id
    await createTripRepository(db).saveTripBundle(bundle)

    const provider = createControllableStructuralProvider()
    const container = createFakeContainer()
    const handle = initializeTripsManager(container, {
      database: db, now: () => '2027-05-01T08:00:00.000Z', idFactory: (() => { let n = 0; return () => `id-${n++}` })(),
      renderMap: () => {}, closeMap: () => {},
      routeEnrichmentProvider: provider,
      automaticRetryBackoffMs: RUNGS,
    })

    dispatchOpenTrip(container, bundle.metadata.id)
    const t1 = await waitForCallCount(provider, alphaId, 1)
    await waitForCallCount(provider, deltaId, 1)
    await waitUntilIdle(handle, bundle.metadata.id)

    // Real progress: delta will succeed on its very next attempt.
    provider.setBehavior(deltaId, 'succeed')

    const t2 = await waitForCallCount(provider, alphaId, 2)
    await waitForCallCount(provider, deltaId, 2)
    await waitUntilIdle(handle, bundle.metadata.id)
    assert.ok(t2 - t1 < FAST_CEILING, `the initial backoff step is the ladder's first rung (gap ${t2 - t1}ms)`)

    // Delta is now complete and permanently skipped; this pass made real
    // progress (delta went from incomplete to complete), so the NEXT
    // backoff must reset to the first rung, not escalate.
    const t3 = await waitForCallCount(provider, alphaId, 3)
    await waitUntilIdle(handle, bundle.metadata.id)
    assert.equal(provider.attempts.get(deltaId), 2, 'the now-complete stage is never attempted again')
    assert.ok(t3 - t2 < FAST_CEILING, `real progress reset the ladder to its first rung instead of escalating (gap ${t3 - t2}ms)`)

    // This pass made no progress at all (alpha failed again, delta already
    // done) — the ladder must now escalate to its second rung.
    const t4 = await waitForCallCount(provider, alphaId, 4)
    await waitUntilIdle(handle, bundle.metadata.id)
    assert.ok(t4 - t3 >= FAST_CEILING && t4 - t3 < MEDIUM_CEILING, `a non-progress failure escalates to the ladder's second rung (gap ${t4 - t3}ms)`)

    // Another non-progress failure escalates once more, to the last rung.
    const t5 = await waitForCallCount(provider, alphaId, 5)
    await waitUntilIdle(handle, bundle.metadata.id)
    assert.ok(t5 - t4 >= MEDIUM_CEILING, `a second consecutive non-progress failure escalates to the ladder's last rung (gap ${t5 - t4}ms)`)

    // The ladder is capped at its last rung — it must never grow further.
    const t6 = await waitForCallCount(provider, alphaId, 6)
    await waitUntilIdle(handle, bundle.metadata.id)
    const gap = t6 - t5
    assert.ok(gap >= MEDIUM_CEILING && gap < RUNGS[2] * 3, `a further consecutive failure stays capped at the last rung rather than growing further (gap ${gap}ms)`)

    // Let alpha succeed too, so the trip becomes fully enriched and this
    // was the LAST backoff ever armed — otherwise the still-pending timer
    // for the next (capped) rung would fire well after this test (and its
    // database) has already closed.
    provider.setBehavior(alphaId, 'succeed')
    await waitForCallCount(provider, alphaId, 7)
    await waitUntilIdle(handle, bundle.metadata.id)
  } finally {
    db.close()
  }
})

test('switching to another trip cancels the first trip\'s pending backoff outright — it never retries again', async () => {
  const db = await openTestDatabase()
  try {
    const tripA = createShortRouteBundle()
    const alphaId = tripA.stages[0].id
    const tripB = createInertBundle('trip-inert-switch-target')
    await createTripRepository(db).saveTripBundle(tripA)
    await createTripRepository(db).saveTripBundle(tripB)

    const provider = createControllableStructuralProvider()
    const container = createFakeContainer()
    const handle = initializeTripsManager(container, {
      database: db, now: () => '2027-05-01T08:00:00.000Z', idFactory: (() => { let n = 0; return () => `id-${n++}` })(),
      renderMap: () => {}, closeMap: () => {},
      routeEnrichmentProvider: provider,
      automaticRetryBackoffMs: RUNGS,
    })

    dispatchOpenTrip(container, tripA.metadata.id)
    await waitForCallCount(provider, alphaId, 1)
    await waitUntilIdle(handle, tripA.metadata.id)

    dispatchOpenTrip(container, tripB.metadata.id)
    await waitUntilIdle(handle, tripB.metadata.id)

    // Wait comfortably past every rung of the ladder — trip A's stage must
    // never be attempted again once trip B took over, proving the switch
    // cancelled the timer rather than merely leaving it to fire a no-op
    // later (which would still show as "no new call" here, but this also
    // covers the timer having been cancelled outright rather than merely
    // superseded at the last instant).
    await flush(RUNGS[0] + RUNGS[1] + RUNGS[2])
    assert.equal(provider.attempts.get(alphaId), 1, 'the abandoned trip\'s backoff never fires again after a trip switch')
  } finally {
    db.close()
  }
})

test('an offline skip never arms a competing backoff timer — only the existing online-event resume may retry it', async () => {
  const originalOnLine = Object.getOwnPropertyDescriptor(navigator, 'onLine')
  Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
  const db = await openTestDatabase()
  try {
    const bundle = createShortRouteBundle()
    await createTripRepository(db).saveTripBundle(bundle)

    const provider = createControllableStructuralProvider()
    const container = createFakeContainer()
    const handle = initializeTripsManager(container, {
      database: db, now: () => '2027-05-01T08:00:00.000Z', idFactory: (() => { let n = 0; return () => `id-${n++}` })(),
      renderMap: () => {}, closeMap: () => {},
      routeEnrichmentProvider: provider,
      automaticRetryBackoffMs: RUNGS,
    })

    dispatchOpenTrip(container, bundle.metadata.id)
    await waitUntilIdle(handle, bundle.metadata.id)
    assert.equal(provider.attempts.size, 0, 'the offline guard skips the pass outright — the provider is never even reached')

    // Waiting past the whole backoff ladder must change nothing: the
    // offline early-return never schedules a backoff timer at all, so
    // there is nothing here to fire and nothing to compete with the
    // separate `online` event listener that already owns this case.
    await flush(RUNGS[0] + RUNGS[1] + RUNGS[2])
    assert.equal(provider.attempts.size, 0, 'no backoff timer was armed by the offline skip')
  } finally {
    db.close()
    if (originalOnLine === undefined) delete navigator.onLine
    else Object.defineProperty(navigator, 'onLine', originalOnLine)
  }
})

test('a rapid second "open" on the same in-flight trip never starts a duplicate pass, and only one retry ever fires per backoff step', async () => {
  const db = await openTestDatabase()
  try {
    const bundle = createShortRouteBundle()
    const alphaId = bundle.stages[0].id
    await createTripRepository(db).saveTripBundle(bundle)

    const provider = createControllableStructuralProvider()
    const container = createFakeContainer()
    const handle = initializeTripsManager(container, {
      database: db, now: () => '2027-05-01T08:00:00.000Z', idFactory: (() => { let n = 0; return () => `id-${n++}` })(),
      renderMap: () => {}, closeMap: () => {},
      routeEnrichmentProvider: provider,
      automaticRetryBackoffMs: RUNGS,
    })

    // Two "open" clicks issued back to back, in the same synchronous turn,
    // before the first pass has claimed anything past its own entry point.
    // `waitForCallCount` (unlike `waitUntilIdle`) waits for the count to
    // actually reach its target rather than for "in flight" to read false —
    // right after these two synchronous dispatches, neither call has
    // necessarily reached `startAutomaticEnrichment`'s guard claim yet, so
    // `isAutomaticEnrichmentInFlight` can still (correctly) read `false` for
    // a moment; `waitUntilIdle` would misread that as "already settled".
    dispatchOpenTrip(container, bundle.metadata.id)
    dispatchOpenTrip(container, bundle.metadata.id)
    await waitForCallCount(provider, alphaId, 1)
    await waitUntilIdle(handle, bundle.metadata.id)
    // A concurrent second pass slipping through would still show up as a
    // second call shortly afterwards — settle briefly and recheck rather
    // than trusting the count the instant it first reaches 1.
    await flush(30)
    assert.equal(provider.attempts.get(alphaId), 1, 'the single-flight guard merges the duplicate click into one real pass, not two')

    await waitForCallCount(provider, alphaId, 2)
    await waitUntilIdle(handle, bundle.metadata.id)

    // No runaway/duplicate retry: the count must not have jumped past 2
    // shortly after the single expected retry fired.
    await flush(RUNGS[0] / 2)
    assert.equal(provider.attempts.get(alphaId), 2, 'exactly one retry fires per backoff step — never two competing timers')

    // Let alpha succeed so no further backoff is ever armed — otherwise the
    // still-pending timer for the next step would fire well after this
    // test (and its database) has already closed.
    provider.setBehavior(alphaId, 'succeed')
    await waitForCallCount(provider, alphaId, 3)
    await waitUntilIdle(handle, bundle.metadata.id)
  } finally {
    db.close()
  }
})
