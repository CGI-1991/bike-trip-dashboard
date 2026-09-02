import './support/dom-shim.mjs'
import '../storage/indexeddb/support/setup-fake-indexeddb.mjs'

import assert from 'node:assert/strict'
import test from 'node:test'

import { createTripRepository } from '../../src/storage/indexeddb/trip-repository.ts'
import { openTestDatabase } from '../storage/indexeddb/support/open-test-database.mjs'
import { createGenericTripBundle } from '../trip-core/support/generic-trip-fixture.mjs'
import { initializeTripsManager } from '../../src/ui/trips/trips-manager.ts'

/**
 * R3 sections 30-35 (tests 18-21 of the CDC's own success criteria): the
 * "Choisir sur la carte" picker's real click-driven wiring — mount, pick,
 * confirm/cancel, cleanup. `deps.mountLocationPicker` is faked here the
 * same way `renderMap`/`closeMap` already are in every other trips-manager
 * test file — this component never touches Leaflet directly.
 */

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

function fakePickerDom() {
  const mapMount = Object.assign(new globalThis.HTMLElement(), {})
  const fallback = Object.assign(new globalThis.HTMLElement(), { hidden: true })
  const confirmButton = Object.assign(new globalThis.HTMLButtonElement(), { disabled: false })
  const labelInput = Object.assign(new globalThis.HTMLInputElement(), { value: '' })
  const picker = {
    hidden: true,
    querySelector(selector) {
      if (selector === '[data-location-picker-map]') return mapMount
      if (selector === '[data-location-picker-fallback]') return fallback
      if (selector === '[data-action="confirm-choose-location"]') return confirmButton
      if (selector === '[data-location-picker-label]') return labelInput
      return null
    },
  }
  return { picker, mapMount, fallback, confirmButton, labelInput }
}

function fakeInteractionHandle() {
  let clickHandler = null
  let temporaryMarker = null
  return {
    handle: {
      setTemporaryMarker(latitude, longitude) { temporaryMarker = { latitude, longitude } },
      clearTemporaryMarker() { temporaryMarker = null },
      setCurrentLocationMarker() {},
      clearCurrentLocationMarker() {},
      onMapClick(handler) { clickHandler = handler },
    },
    triggerClick(latitude, longitude) { clickHandler?.(latitude, longitude) },
    get temporaryMarker() { return temporaryMarker },
    get hasClickHandler() { return clickHandler !== null },
  }
}

async function flush(ms = 30) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function openDay(db, dayId, deps = {}) {
  const bundle = createGenericTripBundle()
  await createTripRepository(db).saveTripBundle(bundle)
  const container = createFakeContainer()
  const { picker, mapMount, fallback, confirmButton, labelInput } = fakePickerDom()
  container.register('[data-location-picker]', picker)
  initializeTripsManager(container, {
    database: db, now: () => '2027-05-10T08:00:00.000Z', idFactory: (() => { let n = 0; return () => `id-${n++}` })(),
    renderMap: () => {}, closeMap: () => {},
    ...deps,
  })
  await flush()
  container.dispatch('click', { target: fakeActionElement({ action: 'open-trip', tripId: bundle.metadata.id }) })
  await flush()
  container.dispatch('click', { target: fakeActionElement({ action: 'open-day-detail', dayId } ) })
  await flush()
  return { bundle, container, picker, mapMount, fallback, confirmButton, labelInput }
}

test('starting the picker reveals it, pre-fills the label from the auto-resolved name, and mounts via deps.mountLocationPicker with the resolved initial coordinates', async () => {
  const db = await openTestDatabase()
  try {
    const mountCalls = []
    const interaction = fakeInteractionHandle()
    const { container, picker, confirmButton, labelInput } = await openDay(db, 'day-bravo', {
      mountLocationPicker: (mount, initial) => { mountCalls.push({ mount, initial }); return interaction.handle },
    })
    container.dispatch('click', { target: fakeActionElement({ action: 'start-choose-location', target: 'start' }) })
    await flush(200)

    assert.equal(picker.hidden, false)
    assert.equal(confirmButton.disabled, true, 'nothing picked yet')
    assert.equal(labelInput.value, 'Hilltown', 'pre-filled from the auto-resolved OFF location')
    assert.equal(mountCalls.length, 1)
    assert.ok(mountCalls[0].initial !== null, 'day-bravo\'s location auto-resolves from a neighbouring ride stage')
    assert.ok(interaction.hasClickHandler)
  } finally {
    db.close()
  }
})

test('picking a point on the map enables Confirmer and places a temporary marker', async () => {
  const db = await openTestDatabase()
  try {
    const interaction = fakeInteractionHandle()
    const { container, confirmButton } = await openDay(db, 'day-bravo', {
      mountLocationPicker: () => interaction.handle,
    })
    container.dispatch('click', { target: fakeActionElement({ action: 'start-choose-location', target: 'start' }) })
    await flush(200)

    interaction.triggerClick(45.5, 6.7)
    assert.equal(confirmButton.disabled, false)
    assert.deepEqual(interaction.temporaryMarker, { latitude: 45.5, longitude: 6.7 })
  } finally {
    db.close()
  }
})

test('confirming persists the override coordinates + label, hides the picker, and cleans up the handle', async () => {
  const db = await openTestDatabase()
  try {
    const interaction = fakeInteractionHandle()
    const { bundle, container, picker, labelInput } = await openDay(db, 'day-bravo', {
      mountLocationPicker: () => interaction.handle,
    })
    container.dispatch('click', { target: fakeActionElement({ action: 'start-choose-location', target: 'start' }) })
    await flush(200)
    interaction.triggerClick(45.5, 6.7)
    labelInput.value = 'Custom Hamlet'

    container.dispatch('click', { target: fakeActionElement({ action: 'confirm-choose-location' }) })
    await flush(200)

    assert.equal(picker.hidden, true)
    assert.equal(interaction.hasClickHandler, false, 'onMapClick(null) — no zombie handler')

    const saved = await createTripRepository(db).loadTripBundle(bundle.metadata.id)
    const day = saved.days.find((candidate) => candidate.id === 'day-bravo')
    assert.equal(day.overrideStartLatitude, 45.5)
    assert.equal(day.overrideStartLongitude, 6.7)
    assert.equal(day.startLocationName, 'Custom Hamlet')
  } finally {
    db.close()
  }
})

test('an empty label at confirm time still persists a valid, non-empty fallback label — never saved without one', async () => {
  const db = await openTestDatabase()
  try {
    const interaction = fakeInteractionHandle()
    const { bundle, container, labelInput } = await openDay(db, 'day-bravo', {
      mountLocationPicker: () => interaction.handle,
    })
    container.dispatch('click', { target: fakeActionElement({ action: 'start-choose-location', target: 'start' }) })
    await flush(200)
    interaction.triggerClick(45.5, 6.7)
    labelInput.value = '   '

    container.dispatch('click', { target: fakeActionElement({ action: 'confirm-choose-location' }) })
    await flush(200)

    const saved = await createTripRepository(db).loadTripBundle(bundle.metadata.id)
    const day = saved.days.find((candidate) => candidate.id === 'day-bravo')
    assert.ok(day.startLocationName !== null && day.startLocationName.trim() !== '')
  } finally {
    db.close()
  }
})

test('cancelling hides the picker, discards the pending pick, and never saves anything', async () => {
  const db = await openTestDatabase()
  try {
    const interaction = fakeInteractionHandle()
    const { bundle, container, picker } = await openDay(db, 'day-bravo', {
      mountLocationPicker: () => interaction.handle,
    })
    container.dispatch('click', { target: fakeActionElement({ action: 'start-choose-location', target: 'start' }) })
    await flush(200)
    interaction.triggerClick(45.5, 6.7)

    container.dispatch('click', { target: fakeActionElement({ action: 'cancel-choose-location' }) })
    await flush(50)

    assert.equal(picker.hidden, true)
    assert.equal(interaction.hasClickHandler, false)

    const saved = await createTripRepository(db).loadTripBundle(bundle.metadata.id)
    const day = saved.days.find((candidate) => candidate.id === 'day-bravo')
    assert.equal(day.overrideStartLatitude, undefined)
  } finally {
    db.close()
  }
})

test('a null deps.mountLocationPicker (Leaflet unavailable) reveals the fallback message instead of crashing', async () => {
  const db = await openTestDatabase()
  try {
    const { container, fallback, confirmButton } = await openDay(db, 'day-bravo', {
      mountLocationPicker: () => null,
    })
    container.dispatch('click', { target: fakeActionElement({ action: 'start-choose-location', target: 'start' }) })
    await flush(200)

    assert.equal(fallback.hidden, false)
    assert.equal(confirmButton.disabled, true, 'nothing to confirm without a working map')
  } finally {
    db.close()
  }
})

test('the transfer day\'s "end" target resolves the destination side independently from "start"', async () => {
  const db = await openTestDatabase()
  try {
    const bundle = createGenericTripBundle()
    // Give the next ride stage's own route usable geometry so the
    // destination side actually resolves too.
    bundle.routes[1].geometry = { full: [{ latitude: 45.1, longitude: 5.1, altitudeM: null }, { latitude: 45.9, longitude: 5.9, altitudeM: null }], simplified: null }
    await createTripRepository(db).saveTripBundle(bundle)
    const container = createFakeContainer()
    const { picker, labelInput } = fakePickerDom()
    container.register('[data-location-picker]', picker)
    const interaction = fakeInteractionHandle()
    const mountCalls = []
    initializeTripsManager(container, {
      database: db, now: () => '2027-05-10T08:00:00.000Z', idFactory: (() => { let n = 0; return () => `id-${n++}` })(),
      renderMap: () => {}, closeMap: () => {},
      mountLocationPicker: (mount, initial) => { mountCalls.push(initial); return interaction.handle },
    })
    await flush()
    container.dispatch('click', { target: fakeActionElement({ action: 'open-trip', tripId: bundle.metadata.id }) })
    await flush()
    container.dispatch('click', { target: fakeActionElement({ action: 'open-day-detail', dayId: 'day-charlie' }) })
    await flush()

    container.dispatch('click', { target: fakeActionElement({ action: 'start-choose-location', target: 'end' }) })
    await flush(200)

    assert.equal(labelInput.value, 'Lakeside', 'the destination auto-resolves from the next stage\'s own startLocationName')
    // The destination coordinate is the NEXT stage's own route-geometry
    // START point (geometry[0]) — where the rider begins pedaling after
    // the transfer, not the transfer's own arrival point (no GPX exists
    // for the transfer itself).
    assert.deepEqual(mountCalls[0], { latitude: 45.1, longitude: 5.1 })
  } finally {
    db.close()
  }
})

test('R3 sections 36-37: confirming a pick immediately refreshes the identity header and the map slot — never stale until the screen reopens', async () => {
  const db = await openTestDatabase()
  try {
    const bundle = createGenericTripBundle()
    await createTripRepository(db).saveTripBundle(bundle)
    const container = createFakeContainer()
    const { picker, labelInput } = fakePickerDom()
    const identityEl = { outerHTML: '<header data-day-detail-identity>stale</header>' }
    const mapSlotEl = { innerHTML: '' }
    container.register('[data-location-picker]', picker)
    container.register('[data-day-detail-identity]', identityEl)
    container.register('[data-day-detail-map-slot]', mapSlotEl)
    const interaction = fakeInteractionHandle()
    initializeTripsManager(container, {
      database: db, now: () => '2027-05-10T08:00:00.000Z', idFactory: (() => { let n = 0; return () => `id-${n++}` })(),
      renderMap: () => {}, closeMap: () => {},
      mountLocationPicker: () => interaction.handle,
    })
    await flush()
    container.dispatch('click', { target: fakeActionElement({ action: 'open-trip', tripId: bundle.metadata.id }) })
    await flush()
    container.dispatch('click', { target: fakeActionElement({ action: 'open-day-detail', dayId: 'day-bravo' }) })
    await flush()

    container.dispatch('click', { target: fakeActionElement({ action: 'start-choose-location', target: 'start' }) })
    await flush(200)
    interaction.triggerClick(45.5, 6.7)
    labelInput.value = 'Custom Hamlet'
    container.dispatch('click', { target: fakeActionElement({ action: 'confirm-choose-location' }) })
    await flush(300)

    assert.doesNotMatch(identityEl.outerHTML, /stale/, 'the identity header was actually replaced')
    assert.match(identityEl.outerHTML, /Custom Hamlet/, 'reflects the just-chosen location, without reopening the screen')
    assert.match(mapSlotEl.innerHTML, /data-day-detail-map data-explore-map/, 'the map slot reflects the map card content — including the first time a location ever resolves, since that slot patch never depends on the map card having existed in the DOM before')
  } finally {
    db.close()
  }
})
