import './support/dom-shim.mjs'
import '../storage/indexeddb/support/setup-fake-indexeddb.mjs'

import assert from 'node:assert/strict'
import test from 'node:test'

import { createTripRepository } from '../../src/storage/indexeddb/trip-repository.ts'
import { openTestDatabase } from '../storage/indexeddb/support/open-test-database.mjs'
import { createGenericTripBundle } from '../trip-core/support/generic-trip-fixture.mjs'
import { initializeTripsManager } from '../../src/ui/trips/trips-manager.ts'

/**
 * A fake root container in the same spirit as
 * `tests/ui/import-wizard-focus.test.mjs`'s shim: tracks how many times its
 * own `innerHTML` is reassigned (a full-screen rebuild), and hands out
 * pre-registered fake sub-elements for `querySelector` so the module under
 * test's map/profile-mounting code (which needs a real Leaflet-capable DOM
 * we don't have here) takes its "container not found" early-return branch
 * instead of touching Leaflet at all.
 */
function fakeSubElement() {
  let innerHTMLValue = ''
  let outerHTMLValue = ''
  let innerSetCount = 0
  let outerSetCount = 0
  return {
    get innerHTML() { return innerHTMLValue },
    set innerHTML(value) { innerHTMLValue = value; innerSetCount++ },
    get outerHTML() { return outerHTMLValue },
    set outerHTML(value) { outerHTMLValue = value; outerSetCount++ },
    get innerSetCount() { return innerSetCount },
    get outerSetCount() { return outerSetCount },
    hidden: false,
    dataset: {},
  }
}

function createFakeContainer() {
  let innerHTMLValue = ''
  let innerSetCount = 0
  const listeners = { click: [], change: [], input: [] }
  const registered = new Map()

  return {
    get innerHTML() { return innerHTMLValue },
    set innerHTML(value) { innerHTMLValue = value; innerSetCount++ },
    get innerHTMLSetCount() { return innerSetCount },
    // Mirrors the real DOM's `{ signal }` behaviour (unlike a bare push):
    // this is what lets a test prove a subcomponent's listeners were really
    // torn down via `AbortController.abort()`, not just logically forgotten.
    addEventListener(type, listener, options) {
      listeners[type] ??= []
      listeners[type].push(listener)
      options?.signal?.addEventListener?.('abort', () => {
        listeners[type] = listeners[type].filter((candidate) => candidate !== listener)
      })
    },
    dispatch(type, event) { for (const listener of [...(listeners[type] ?? [])]) listener(event) },
    listenerCount(type) { return (listeners[type] ?? []).length },
    querySelector(selector) { return registered.get(selector) ?? null },
    querySelectorAll(selector) { return registered.get(selector) ?? [] },
    contains() { return true },
    register(selector, element) { registered.set(selector, element) },
  }
}

/** A fake `[data-action]` element good enough for the exact `.closest()` calls `trips-manager.ts`'s delegated handlers make. */
function fakeActionElement(dataset) {
  const element = Object.assign(new globalThis.HTMLButtonElement(), { dataset })
  element.closest = (selector) => {
    if (selector === '[data-day-tab]') return dataset.dayTab !== undefined ? element : null
    if (selector === '[data-action="toggle-climb-profile"]') return dataset.action === 'toggle-climb-profile' ? element : null
    if (selector === '[data-action="edit-day-infos"]') return dataset.action === 'edit-day-infos' ? element : null
    if (selector === '[data-action="cancel-edit-day-infos"]') return dataset.action === 'cancel-edit-day-infos' ? element : null
    if (selector === '[data-action]') return dataset.action !== undefined ? element : null
    return null
  }
  return element
}

/** A fake `.pause-editor__row` good enough for the `save-manual-pauses` handler, which reads `row.dataset.candidateId` plus its own checkbox/duration inputs via `row.querySelector(...)`. */
function fakePauseRow(candidateId, { checked, durationMinutes } = {}) {
  const checkbox = { checked: checked ?? false }
  const durationInput = { valueAsNumber: durationMinutes ?? Number.NaN }
  return {
    dataset: { candidateId },
    querySelector(selector) {
      if (selector === '[data-field="pause-active"]') return checkbox
      if (selector === '[data-field="pause-duration"]') return durationInput
      return null
    },
  }
}

/**
 * The base fixture's two ride stages have no structural route point at all
 * (neither carries an `osmFeatureType`) — realistic for a bare GPX import,
 * but it means neither stage has anything to anchor a manual pause on. Same
 * synthetic anchor `tests/ui/day-detail-view.test.mjs` already adds for the
 * same reason, reused here so manual mode actually seeds a real pause row.
 */
function withAnchorPoint(bundle) {
  bundle.routePoints.push({
    id: 'town-ui', routeId: bundle.routes[0].id, type: 'passage', name: 'Waypoint Town',
    latitude: 45.2, longitude: 6.35, elevationM: 300, trackDistanceKm: 30,
    osmFeatureType: 'town', lateralDistanceKm: 0.3,
    provenance: { sourceType: 'osm', sourceId: 'postpass:town:1', fetchedAt: null, engineVersion: 'route-enrichment@4', confidence: 'high', manuallyOverridden: false },
  })
  bundle.stages[0].routePointIds.push('town-ui')
  return bundle
}

function noopDeps(database, extra = {}) {
  return { database, now: () => '2027-05-10T08:00:00.000Z', idFactory: (() => { let n = 0; return () => `id-${n++}` })(), ...extra }
}

async function flush() {
  // Fire-and-forget click handlers chain through several real IndexedDB
  // round-trips (fake-indexeddb) before settling — a couple of real event
  // loop turns is the simplest reliable way to let them finish, since
  // `TripsManagerHandle` intentionally exposes no promise for a raw click.
  await new Promise((resolve) => setTimeout(resolve, 20))
}

test('"Ouvrir" on a trip card calls onNavigateToView("today") — CDC Jalon B4.2 section 5 (Ouvrir voyage = sélectionner + Aperçu)', async () => {
  const db = await openTestDatabase()
  try {
    const bundle = createGenericTripBundle()
    await createTripRepository(db).saveTripBundle(bundle)
    const navigated = []
    const container = createFakeContainer()
    initializeTripsManager(container, noopDeps(db, { onNavigateToView: (view) => navigated.push(view) }))
    await flush()

    container.dispatch('click', { target: fakeActionElement({ action: 'open-trip', tripId: bundle.metadata.id }) })

    assert.deepEqual(navigated, ['today'], 'clicking Ouvrir must drive the top-level nav to Aperçu, exactly like the bottom-nav link')
  } finally {
    db.close()
  }
})

test('saving the manual pause editor patches only the pauses/stats/timeline subtree — the root Étape screen is never rebuilt (CDC Jalon B4.3 sections 3/31)', async () => {
  const db = await openTestDatabase()
  try {
    const bundle = withAnchorPoint(createGenericTripBundle())
    await createTripRepository(db).saveTripBundle(bundle)
    const container = createFakeContainer()
    const pausesElement = fakeSubElement()
    pausesElement.dataset.stageId = 'stage-alpha'
    container.register('[data-day-detail-pauses]', pausesElement)
    container.register('[data-day-detail-stats]', fakeSubElement())
    container.register('[data-day-detail-timeline]', fakeSubElement())
    container.register('.pause-editor__row', [fakePauseRow('town-ui', { checked: true, durationMinutes: 20 })])

    initializeTripsManager(container, noopDeps(db))
    await flush()
    // "Ouvrir" → Aperçu (mode: 'overview'), same path as a real user, then
    // "Voir l'étape" for day-alpha — avoids depending on
    // `selectMostRelevantTrip`'s active-trip-id resolution, which has no
    // `localStorage` to read from in this Node test environment.
    container.dispatch('click', { target: fakeActionElement({ action: 'open-trip', tripId: bundle.metadata.id }) })
    await flush()
    container.dispatch('click', { target: fakeActionElement({ action: 'open-day-detail', dayId: 'day-alpha' }) })
    await flush()

    const setCountAfterMount = container.innerHTMLSetCount
    assert.ok(setCountAfterMount > 0, 'the initial Étape mount does set the root container once')

    container.dispatch('click', { target: fakeActionElement({ action: 'save-manual-pauses' }) })
    await flush()

    assert.equal(container.innerHTMLSetCount, setCountAfterMount, 'saving the manual pause editor must never reset the whole Étape screen (the "reload feel" bug this pass fixes)')
    assert.ok(pausesElement.outerSetCount > 0, 'the pauses subtree itself must still be refreshed')
    assert.match(pausesElement.outerHTML, /Mode manuel · 1 pause/, 'the patched fragment reflects the new manual pause')
    assert.match(pausesElement.outerHTML, /value="20"/, 'the checked row\'s duration is persisted')

    const saved = await createTripRepository(db).loadTripBundle(bundle.metadata.id)
    const stageSettings = saved.settings.stages.find((entry) => entry.stageId === 'stage-alpha')
    assert.equal(stageSettings.pausePlanMode, 'custom')
    assert.deepEqual(stageSettings.pauses.map((pause) => [pause.routePointId, pause.durationSeconds]), [['town-ui', 1_200]])
  } finally {
    db.close()
  }
})

test('an unchecked row is never saved as a pause — only checked candidates survive', async () => {
  const db = await openTestDatabase()
  try {
    const bundle = withAnchorPoint(createGenericTripBundle())
    await createTripRepository(db).saveTripBundle(bundle)
    const container = createFakeContainer()
    const pausesElement = fakeSubElement()
    pausesElement.dataset.stageId = 'stage-alpha'
    container.register('[data-day-detail-pauses]', pausesElement)
    container.register('[data-day-detail-stats]', fakeSubElement())
    container.register('[data-day-detail-timeline]', fakeSubElement())
    container.register('.pause-editor__row', [fakePauseRow('town-ui', { checked: false })])

    initializeTripsManager(container, noopDeps(db))
    await flush()
    container.dispatch('click', { target: fakeActionElement({ action: 'open-trip', tripId: bundle.metadata.id }) })
    await flush()
    container.dispatch('click', { target: fakeActionElement({ action: 'open-day-detail', dayId: 'day-alpha' }) })
    await flush()
    container.dispatch('click', { target: fakeActionElement({ action: 'save-manual-pauses' }) })
    await flush()

    const saved = await createTripRepository(db).loadTripBundle(bundle.metadata.id)
    const stageSettings = saved.settings.stages.find((entry) => entry.stageId === 'stage-alpha')
    assert.deepEqual(stageSettings.pauses, [])
  } finally {
    db.close()
  }
})

// --- multi-trip bug (CDC Jalon B4.3 section 16): leaked wizard/editor listeners ---

test('opening a trip (e.g. via the bottom nav) while the wizard is still open tears down its listeners first — the root cause of "un save peut ouvrir Aperçu d\'un autre voyage"', async () => {
  const db = await openTestDatabase()
  try {
    const bundle = createGenericTripBundle()
    await createTripRepository(db).saveTripBundle(bundle)
    const container = createFakeContainer()
    initializeTripsManager(container, noopDeps(db))
    await flush()

    container.dispatch('click', { target: fakeActionElement({ action: 'create-trip' }) })
    await flush()
    assert.ok(container.listenerCount('input') > 0, 'the wizard attaches its own input listener while open')

    // Navigating away directly (any full-screen render entry point — not
    // just "Mes voyages") without ever cancelling/saving the wizard first.
    container.dispatch('click', { target: fakeActionElement({ action: 'open-trip', tripId: bundle.metadata.id }) })
    await flush()

    assert.equal(container.listenerCount('input'), 0, 'the wizard\'s own listeners must be torn down once we navigate away, or its stale state could still react to a later click')
    assert.match(container.innerHTML, /data-trip-overview/, 'Aperçu for the trip we actually opened is now showing')
  } finally {
    db.close()
  }
})

test('leaving the wizard (cancel) returns to Mes voyages — never Aperçu, never a silently active trip (CDC Jalon B4.3 section 17)', async () => {
  const db = await openTestDatabase()
  try {
    const bundle = createGenericTripBundle()
    await createTripRepository(db).saveTripBundle(bundle)
    const container = createFakeContainer()
    initializeTripsManager(container, noopDeps(db))
    await flush()

    container.dispatch('click', { target: fakeActionElement({ action: 'create-trip' }) })
    await flush()
    assert.match(container.innerHTML, /data-wizard/, 'the wizard is showing')

    // The wizard's own "Annuler" button — handled by its own internal
    // listener (`data-action="cancel"`), same as a real click would be.
    container.dispatch('click', { target: fakeActionElement({ action: 'cancel' }) })
    await flush()

    assert.match(container.innerHTML, /data-trips-list|data-trips-empty/, 'back to Mes voyages, not Aperçu')
    assert.doesNotMatch(container.innerHTML, /data-trip-overview/)
  } finally {
    db.close()
  }
})

test('"Revenir à l’automatique" reverts a custom stage to the trip-wide default without a full rebuild', async () => {
  const db = await openTestDatabase()
  try {
    const bundle = withAnchorPoint(createGenericTripBundle())
    bundle.settings.stages[0] = {
      stageId: 'stage-alpha', pausePlanMode: 'custom',
      pauses: [{ id: 'pause-1', active: true, routePointId: 'town-ui', durationSeconds: 900, order: 0, origin: 'custom' }],
    }
    await createTripRepository(db).saveTripBundle(bundle)
    const container = createFakeContainer()
    const pausesElement = fakeSubElement()
    pausesElement.dataset.stageId = 'stage-alpha'
    container.register('[data-day-detail-pauses]', pausesElement)
    container.register('[data-day-detail-stats]', fakeSubElement())
    container.register('[data-day-detail-timeline]', fakeSubElement())

    initializeTripsManager(container, noopDeps(db))
    await flush()
    container.dispatch('click', { target: fakeActionElement({ action: 'open-trip', tripId: bundle.metadata.id }) })
    await flush()
    container.dispatch('click', { target: fakeActionElement({ action: 'open-day-detail', dayId: 'day-alpha' }) })
    await flush()
    const setCountAfterMount = container.innerHTMLSetCount

    container.dispatch('click', { target: fakeActionElement({ action: 'pause-mode-automatic' }) })
    await flush()

    assert.equal(container.innerHTMLSetCount, setCountAfterMount, 'reverting to automatic must never reset the whole Étape screen')
    const saved = await createTripRepository(db).loadTripBundle(bundle.metadata.id)
    assert.equal(saved.settings.stages.find((entry) => entry.stageId === 'stage-alpha'), undefined, 'the per-stage override is dropped, inheriting the trip-wide default again')
  } finally {
    db.close()
  }
})
