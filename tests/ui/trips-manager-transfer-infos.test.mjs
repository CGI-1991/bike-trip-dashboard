import './support/dom-shim.mjs'
import '../storage/indexeddb/support/setup-fake-indexeddb.mjs'

import assert from 'node:assert/strict'
import test from 'node:test'

import { createTripRepository } from '../../src/storage/indexeddb/trip-repository.ts'
import { openTestDatabase } from '../storage/indexeddb/support/open-test-database.mjs'
import { createGenericTripBundle } from '../trip-core/support/generic-trip-fixture.mjs'
import { initializeTripsManager } from '../../src/ui/trips/trips-manager.ts'

// R2.1 sections 33-34/36-37 (tests BB/BC and friends): the `save-day-infos`
// handler's own wiring for the new transfer fields — mode/heures/opérateur/
// lien always save onto the transfer day itself, while notes/lodging save
// onto whichever day `resolveSharedInfoDayId` actually names (itself, or
// the previous day for an `after_previous` transfer).

function createFakeContainer() {
  let innerHTMLValue = ''
  const listeners = { click: [] }
  const registered = new Map()
  return {
    get innerHTML() { return innerHTMLValue },
    set innerHTML(value) { innerHTMLValue = value },
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

function fakeField(Ctor, value) {
  return Object.assign(new Ctor(), { value })
}

async function flush(ms = 30) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function openDay(db, dayId) {
  const bundle = createGenericTripBundle()
  await createTripRepository(db).saveTripBundle(bundle)
  const container = createFakeContainer()
  initializeTripsManager(container, {
    database: db, now: () => '2027-05-10T08:00:00.000Z', idFactory: (() => { let n = 0; return () => `id-${n++}` })(),
    renderMap: () => {}, closeMap: () => {},
  })
  await flush()
  container.dispatch('click', { target: fakeActionElement({ action: 'open-trip', tripId: bundle.metadata.id }) })
  await flush()
  container.dispatch('click', { target: fakeActionElement({ action: 'open-day-detail', dayId } ) })
  await flush()
  return { bundle, container }
}

test('a dedicated transfer\'s mode/heures/opérateur/lien all save onto the transfer day itself', async () => {
  const db = await openTestDatabase()
  try {
    const { bundle, container } = await openDay(db, 'day-charlie')
    container.register('[data-field="day-notes"]', fakeField(globalThis.HTMLTextAreaElement, 'Updated notes'))
    container.register('[data-field="transfer-mode"]', fakeField(globalThis.HTMLSelectElement, 'train'))
    container.register('[data-field="transfer-departure-time"]', fakeField(globalThis.HTMLInputElement, '09:20'))
    container.register('[data-field="transfer-arrival-time"]', fakeField(globalThis.HTMLInputElement, '12:05'))
    container.register('[data-field="transfer-operator"]', fakeField(globalThis.HTMLInputElement, 'SNCF'))
    container.register('[data-field="transfer-link"]', fakeField(globalThis.HTMLInputElement, 'https://sncf-connect.com/booking'))
    container.dispatch('click', { target: fakeActionElement({ action: 'save-day-infos' }) })
    await flush(200)

    const saved = await createTripRepository(db).loadTripBundle(bundle.metadata.id)
    const day = saved.days.find((candidate) => candidate.id === 'day-charlie')
    assert.equal(day.notes, 'Updated notes')
    assert.equal(day.transferMode, 'train')
    assert.equal(day.transferDepartureTime, '09:20')
    assert.equal(day.transferArrivalTime, '12:05')
    assert.equal(day.transferOperator, 'SNCF')
    assert.equal(day.transferLink, 'https://sncf-connect.com/booking')
  } finally {
    db.close()
  }
})

test('R2.1 sections 33-34: an after_previous transfer saves its notes onto the previous day, but its own mode/heures onto itself — never a second, orphaned copy of notes', async () => {
  const db = await openTestDatabase()
  try {
    const bundle = createGenericTripBundle()
    bundle.days[2].transferTiming = 'after_previous'
    await createTripRepository(db).saveTripBundle(bundle)
    const container = createFakeContainer()
    initializeTripsManager(container, {
      database: db, now: () => '2027-05-10T08:00:00.000Z', idFactory: (() => { let n = 0; return () => `id-${n++}` })(),
      renderMap: () => {}, closeMap: () => {},
    })
    await flush()
    container.dispatch('click', { target: fakeActionElement({ action: 'open-trip', tripId: bundle.metadata.id }) })
    await flush()
    container.dispatch('click', { target: fakeActionElement({ action: 'open-day-detail', dayId: 'day-charlie' }) })
    await flush()

    container.register('[data-field="day-notes"]', fakeField(globalThis.HTMLTextAreaElement, 'Shared note about Hilltown'))
    container.register('[data-field="transfer-mode"]', fakeField(globalThis.HTMLSelectElement, 'bus'))
    container.dispatch('click', { target: fakeActionElement({ action: 'save-day-infos' }) })
    await flush(200)

    const saved = await createTripRepository(db).loadTripBundle(bundle.metadata.id)
    const previous = saved.days.find((candidate) => candidate.id === 'day-bravo')
    const transfer = saved.days.find((candidate) => candidate.id === 'day-charlie')
    assert.equal(previous.notes, 'Shared note about Hilltown', 'the shared notes land on the previous (calendar-adjacent) day')
    assert.equal(transfer.notes, 'Train transfer, no cyclable stage.', 'the transfer day\'s own (now-orphaned) notes are left untouched, never overwritten with the shared value')
    assert.equal(transfer.transferMode, 'bus', 'the transfer\'s own mode still saves onto the transfer day itself, even though notes went elsewhere')
  } finally {
    db.close()
  }
})

test('R2.1 sections 40-41: a manual location override saves onto the day itself — never onto the shared info day', async () => {
  const db = await openTestDatabase()
  try {
    const bundle = createGenericTripBundle()
    bundle.days[2].transferTiming = 'after_previous'
    await createTripRepository(db).saveTripBundle(bundle)
    const container = createFakeContainer()
    initializeTripsManager(container, {
      database: db, now: () => '2027-05-10T08:00:00.000Z', idFactory: (() => { let n = 0; return () => `id-${n++}` })(),
      renderMap: () => {}, closeMap: () => {},
    })
    await flush()
    container.dispatch('click', { target: fakeActionElement({ action: 'open-trip', tripId: bundle.metadata.id }) })
    await flush()
    container.dispatch('click', { target: fakeActionElement({ action: 'open-day-detail', dayId: 'day-charlie' }) })
    await flush()

    container.register('[data-field="location-start"]', fakeField(globalThis.HTMLInputElement, 'Custom Origin'))
    container.register('[data-field="location-end"]', fakeField(globalThis.HTMLInputElement, 'Custom Destination'))
    container.dispatch('click', { target: fakeActionElement({ action: 'save-day-infos' }) })
    await flush(200)

    const saved = await createTripRepository(db).loadTripBundle(bundle.metadata.id)
    const transfer = saved.days.find((candidate) => candidate.id === 'day-charlie')
    const previous = saved.days.find((candidate) => candidate.id === 'day-bravo')
    assert.equal(transfer.startLocationName, 'Custom Origin')
    assert.equal(transfer.endLocationName, 'Custom Destination')
    assert.equal(previous.startLocationName, 'Hilltown', 'the shared-info previous day\'s own location is never touched by the transfer\'s own override')
  } finally {
    db.close()
  }
})

test('clearing a manual location field resets it back to null — "use the automatic one" again, never fabricated', async () => {
  const db = await openTestDatabase()
  try {
    const { bundle, container } = await openDay(db, 'day-charlie')
    container.register('[data-field="location-start"]', fakeField(globalThis.HTMLInputElement, '   '))
    container.dispatch('click', { target: fakeActionElement({ action: 'save-day-infos' }) })
    await flush(200)

    const saved = await createTripRepository(db).loadTripBundle(bundle.metadata.id)
    const day = saved.days.find((candidate) => candidate.id === 'day-charlie')
    assert.equal(day.startLocationName, null)
  } finally {
    db.close()
  }
})

test('a bike transfer leg hides the opérateur field live on selection — pure client-side reveal, never a save', async () => {
  const db = await openTestDatabase()
  try {
    const { container } = await openDay(db, 'day-charlie')
    const select = Object.assign(new globalThis.HTMLSelectElement(), { dataset: { field: 'transfer-mode' }, value: 'bike' })
    const operatorGroup = Object.assign(new globalThis.HTMLElement(), { hidden: false })
    container.register('[data-field-group="transfer-operator"]', operatorGroup)
    container.dispatch('change', { target: select })
    assert.equal(operatorGroup.hidden, true)
    select.value = 'train'
    container.dispatch('change', { target: select })
    assert.equal(operatorGroup.hidden, false)
  } finally {
    db.close()
  }
})
