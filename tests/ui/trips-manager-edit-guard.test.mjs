import './support/dom-shim.mjs'
import '../storage/indexeddb/support/setup-fake-indexeddb.mjs'

import assert from 'node:assert/strict'
import test from 'node:test'

import { createTripRepository } from '../../src/storage/indexeddb/trip-repository.ts'
import { openTestDatabase } from '../storage/indexeddb/support/open-test-database.mjs'
import { createGenericTripBundle } from '../trip-core/support/generic-trip-fixture.mjs'
import { initializeTripsManager } from '../../src/ui/trips/trips-manager.ts'

/**
 * DER-DES-DER sections 55-65 / tests BK-BT — the edit guard as it is actually
 * WIRED, through `trips-manager.ts`'s own delegated click handler.
 *
 * `edit-guard.test.mjs` covers the decision logic itself; this file covers
 * the integration: that the Infos form registers a context when it opens,
 * that an external navigation consults it, and that "Rester" really does
 * cancel the navigation.
 */

function fakeField(value = '') {
  return { value, checked: undefined }
}

/** The Infos edit panel, with the fields the guard snapshots. */
function fakeInfosEditPanel(fields) {
  return {
    hidden: true,
    dataset: {},
    querySelectorAll(selector) {
      return selector === 'input, select, textarea' ? fields : []
    },
    querySelector() { return null },
  }
}

function fakeReadPanel() {
  return { hidden: false, dataset: {}, querySelectorAll() { return [] }, querySelector() { return null } }
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
  element.isConnected = true
  element.closest = (selector) => {
    if (selector === '[data-day-tab]') return dataset.dayTab !== undefined ? element : null
    if (selector === '[data-action="toggle-climb-profile"]') return dataset.action === 'toggle-climb-profile' ? element : null
    if (selector === '[data-action="toggle-bottom-panel"]') return dataset.action === 'toggle-bottom-panel' ? element : null
    if (selector === '[data-action="edit-day-infos"]') return dataset.action === 'edit-day-infos' ? element : null
    if (selector === '[data-action="cancel-edit-day-infos"]') return dataset.action === 'cancel-edit-day-infos' ? element : null
    if (selector === '[data-action]') return dataset.action !== undefined ? element : null
    if (selector === '[data-decision]') return null
    return null
  }
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
    database,
    now: () => '2027-05-10T08:00:00.000Z',
    idFactory: (() => { let n = 0; return () => `id-${n++}` })(),
    renderMap: () => {},
    closeMap: () => {},
    weatherProvider: stubWeatherProvider(),
    ...extra,
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 30))

/**
 * Waits for a condition rather than a fixed delay: the guard's save path is
 * a prompt, then a DB read, then a write, then a navigation — a chain long
 * enough that a fixed sleep is a flake waiting to happen under full-suite
 * load.
 */
async function waitFor(predicate, description) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.fail(`timed out waiting for: ${description}`)
}

/**
 * Drives the manager to the Étape screen for `day-alpha`, with the Infos
 * read/edit panels registered so the guard has something to snapshot.
 */
async function openDayDetail(database, extraDeps = {}) {
  const bundle = createGenericTripBundle()
  await createTripRepository(database).saveTripBundle(bundle)
  const container = createFakeContainer()
  const fields = [fakeField('Note de départ')]
  const editPanel = fakeInfosEditPanel(fields)
  const readPanel = fakeReadPanel()
  container.register('[data-day-infos-edit]', editPanel)
  container.register('[data-day-infos-read]', readPanel)

  const handle = initializeTripsManager(container, noopDeps(database, extraDeps))
  await flush()
  container.dispatch('click', { target: fakeActionElement({ action: 'open-trip', tripId: bundle.metadata.id }) })
  await flush()
  container.dispatch('click', { target: fakeActionElement({ action: 'open-day-detail', dayId: 'day-alpha' }) })
  await flush()
  return { container, fields, editPanel, readPanel, bundle, handle }
}

test('section 56/BT: opening the Infos form registers it, and leaving it UNCHANGED navigates away with no prompt at all', async () => {
  const database = await openTestDatabase()
  try {
    let prompted = 0
    const { container } = await openDayDetail(database, { confirmDiscardChanges: () => { prompted += 1; return 'stay' } })

    container.dispatch('click', { target: fakeActionElement({ action: 'edit-day-infos' }) })
    await flush()
    container.dispatch('click', { target: fakeActionElement({ action: 'back-to-list' }) })
    await flush()

    assert.equal(prompted, 0, 'a clean form is never worth interrupting for')
    await waitFor(() => /data-trips-list/.test(container.innerHTML), 'the navigation to go through')
  } finally {
    database.close()
  }
})

test('BK/section 61: navigating away from a DIRTY Infos form prompts first', async () => {
  const database = await openTestDatabase()
  try {
    let prompted = 0
    const { container, fields } = await openDayDetail(database, { confirmDiscardChanges: () => { prompted += 1; return 'discard' } })

    container.dispatch('click', { target: fakeActionElement({ action: 'edit-day-infos' }) })
    await flush()
    fields[0].value = 'Note modifiée mais pas enregistrée'
    container.dispatch('click', { target: fakeActionElement({ action: 'back-to-list' }) })
    await flush()

    assert.equal(prompted, 1)
  } finally {
    database.close()
  }
})

test('BO/section 60: "Rester" cancels the navigation — the Étape screen stays, and the typed value is untouched', async () => {
  const database = await openTestDatabase()
  try {
    const { container, fields } = await openDayDetail(database, { confirmDiscardChanges: () => 'stay' })
    container.dispatch('click', { target: fakeActionElement({ action: 'edit-day-infos' }) })
    await flush()
    fields[0].value = 'travail en cours'
    const htmlBefore = container.innerHTML

    container.dispatch('click', { target: fakeActionElement({ action: 'back-to-list' }) })
    await flush()

    assert.equal(container.innerHTML, htmlBefore, 'no navigation happened')
    assert.doesNotMatch(container.innerHTML, /data-trips-list/)
    assert.equal(fields[0].value, 'travail en cours', 'nothing typed was lost')
  } finally {
    database.close()
  }
})

test('BN/section 59: "Abandonner" leaves without saving, and the navigation proceeds', async () => {
  const database = await openTestDatabase()
  try {
    const { container, fields, bundle } = await openDayDetail(database, { confirmDiscardChanges: () => 'discard' })
    container.dispatch('click', { target: fakeActionElement({ action: 'edit-day-infos' }) })
    await flush()
    fields[0].value = 'jamais enregistré'

    container.dispatch('click', { target: fakeActionElement({ action: 'back-to-list' }) })
    await flush()

    await waitFor(() => /data-trips-list/.test(container.innerHTML), 'the navigation to go through')
    const reloaded = await createTripRepository(database).loadTripBundle(bundle.metadata.id)
    const day = reloaded.days.find((candidate) => candidate.id === 'day-alpha')
    assert.notEqual(day.notes, 'jamais enregistré', 'nothing was persisted')
  } finally {
    database.close()
  }
})

test('BM/section 58: "Enregistrer" persists the pending edit, then lets the navigation proceed', async () => {
  const database = await openTestDatabase()
  try {
    const { container, fields, bundle } = await openDayDetail(database, { confirmDiscardChanges: () => 'save' })
    // The save path reads the notes field by its own selector, so register it.
    const notesField = fakeField('Réserver le gîte avant 18 h')
    container.register('[data-field="day-notes"]', notesField)
    container.dispatch('click', { target: fakeActionElement({ action: 'edit-day-infos' }) })
    await flush()
    fields[0].value = 'dirty'

    container.dispatch('click', { target: fakeActionElement({ action: 'back-to-list' }) })

    await waitFor(async () => {
      const reloaded = await createTripRepository(database).loadTripBundle(bundle.metadata.id)
      return reloaded.days.find((candidate) => candidate.id === 'day-alpha').notes === 'Réserver le gîte avant 18 h'
    }, 'the pending edit to be saved')
    await waitFor(() => /data-trips-list/.test(container.innerHTML), 'the navigation to go through')
  } finally {
    database.close()
  }
})

test('an explicit "Annuler" resolves the context itself — a following navigation never prompts on top of it', async () => {
  const database = await openTestDatabase()
  try {
    let prompted = 0
    const { container, fields } = await openDayDetail(database, { confirmDiscardChanges: () => { prompted += 1; return 'stay' } })
    container.dispatch('click', { target: fakeActionElement({ action: 'edit-day-infos' }) })
    await flush()
    fields[0].value = 'dirty'
    container.dispatch('click', { target: fakeActionElement({ action: 'cancel-edit-day-infos' }) })
    await flush()

    container.dispatch('click', { target: fakeActionElement({ action: 'back-to-list' }) })
    await flush()

    assert.equal(prompted, 0)
    await waitFor(() => /data-trips-list/.test(container.innerHTML), 'the navigation to go through')
  } finally {
    database.close()
  }
})

test('section 61: a click INSIDE the form is not a departure — the picker trigger never prompts', async () => {
  const database = await openTestDatabase()
  try {
    let prompted = 0
    const { container, fields } = await openDayDetail(database, { confirmDiscardChanges: () => { prompted += 1; return 'stay' } })
    container.dispatch('click', { target: fakeActionElement({ action: 'edit-day-infos' }) })
    await flush()
    fields[0].value = 'dirty'

    container.dispatch('click', { target: fakeActionElement({ action: 'start-choose-location', target: 'start' }) })
    await flush()

    assert.equal(prompted, 0, 'editing the location IS editing the form, not leaving it')
  } finally {
    database.close()
  }
})

test('the guard never loops: one "Abandonner" produces exactly one navigation, not an endless re-dispatch', async () => {
  const database = await openTestDatabase()
  try {
    let prompted = 0
    const { container, fields } = await openDayDetail(database, { confirmDiscardChanges: () => { prompted += 1; return 'discard' } })
    container.dispatch('click', { target: fakeActionElement({ action: 'edit-day-infos' }) })
    await flush()
    fields[0].value = 'dirty'

    container.dispatch('click', { target: fakeActionElement({ action: 'back-to-list' }) })
    await flush()

    assert.equal(prompted, 1, 'the re-dispatched click bypasses the guard instead of re-entering it')
  } finally {
    database.close()
  }
})

// --- polish-final section 26-28 (test "TEST DIRTY BOTTOM NAV"): the
// bottom app-nav (Aperçu/Voyage/Mes voyages) is wired straight to
// `goToOverviewForActiveTrip`/`goToDetailForActiveTrip`/`goToList` from
// `main.ts`, never through `handleContainerClick`'s own `EXTERNAL_ACTIONS`
// gate — before the fix, these silently dropped a dirty edit instead of
// prompting, and the modal only surfaced later, out of context. -----------

test('Mes voyages (goToList) prompts IMMEDIATELY for a dirty Infos form — never silently discarded', async () => {
  const database = await openTestDatabase()
  try {
    let prompted = 0
    const { container, fields, handle } = await openDayDetail(database, { confirmDiscardChanges: () => { prompted += 1; return 'stay' } })
    container.dispatch('click', { target: fakeActionElement({ action: 'edit-day-infos' }) })
    await flush()
    fields[0].value = 'jamais confirmé'
    handle.goToList()
    await flush()
    assert.equal(prompted, 1, 'the bottom-nav "Mes voyages" link must ask before leaving, exactly like an in-container navigation')
  } finally {
    database.close()
  }
})

test('Aperçu (goToOverviewForActiveTrip) prompts immediately for a dirty Infos form, and "Rester" keeps the edit alive', async () => {
  const database = await openTestDatabase()
  try {
    let prompted = 0
    const { container, fields, handle } = await openDayDetail(database, { confirmDiscardChanges: () => { prompted += 1; return 'stay' } })
    container.dispatch('click', { target: fakeActionElement({ action: 'edit-day-infos' }) })
    await flush()
    fields[0].value = 'travail en cours'

    await handle.goToOverviewForActiveTrip()

    assert.equal(prompted, 1, 'Aperçu never bypasses the guard the way it used to')
    assert.equal(fields[0].value, 'travail en cours', '"Rester" really did cancel the navigation — nothing typed was lost')
  } finally {
    database.close()
  }
})

test('Voyage (goToDetailForActiveTrip) discards a dirty Infos form on "Abandonner" and proceeds', async () => {
  const database = await openTestDatabase()
  try {
    let prompted = 0
    const { container, fields, handle, bundle } = await openDayDetail(database, { confirmDiscardChanges: () => { prompted += 1; return 'discard' } })
    container.dispatch('click', { target: fakeActionElement({ action: 'edit-day-infos' }) })
    await flush()
    fields[0].value = 'jamais enregistré'

    await handle.goToDetailForActiveTrip()

    assert.equal(prompted, 1)
    const reloaded = await createTripRepository(database).loadTripBundle(bundle.metadata.id)
    const day = reloaded.days.find((candidate) => candidate.id === 'day-alpha')
    assert.notEqual(day.notes, 'jamais enregistré', 'discarded, never persisted')
  } finally {
    database.close()
  }
})
