import './support/dom-shim.mjs'
import '../storage/indexeddb/support/setup-fake-indexeddb.mjs'

import assert from 'node:assert/strict'
import test from 'node:test'

import { createTripRepository } from '../../src/storage/indexeddb/trip-repository.ts'
import { openTestDatabase } from '../storage/indexeddb/support/open-test-database.mjs'
import { createGenericTripBundle } from '../trip-core/support/generic-trip-fixture.mjs'
import { initializeTripsManager } from '../../src/ui/trips/trips-manager.ts'

// CDC D1.1 sections 18-19 — the real wiring in trips-manager.ts that
// connects the profile's own sync events (elevation-profile-band.test.mjs)
// to a map's temporary-marker handle (route-map-interaction-handle.test.mjs).
// `getMapInteractionHandle` is fully dependency-injected, exactly like
// `renderMap`/`closeMap`, so this test never touches real Leaflet.

class FakeLeafElement {
  constructor() {
    this.attributes = new Map()
    this.listeners = new Map()
    this.textContent = ''
  }
  addEventListener(type, listener, options = {}) {
    const set = this.listeners.get(type) ?? new Set()
    set.add(listener)
    this.listeners.set(type, set)
    options.signal?.addEventListener('abort', () => set.delete(listener), { once: true })
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener) }
  dispatchEvent(event) { for (const listener of [...(this.listeners.get(event.type) ?? [])]) listener(event) }
  emit(type, event = {}) { for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event) }
  setAttribute(name, value) { this.attributes.set(name, String(value)) }
  getAttribute(name) { return this.attributes.get(name) ?? null }
  removeAttribute(name) { this.attributes.delete(name) }
  getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 240 } }
  setPointerCapture() {}
  releasePointerCapture() {}
}

class FakeProfileElement extends FakeLeafElement {
  constructor() {
    super()
    this._children = {
      '[data-profile-interactive]': new FakeLeafElement(),
      '[data-profile-cursor]': new FakeLeafElement(),
      '[data-profile-cursor-line]': new FakeLeafElement(),
      '[data-profile-cursor-dot]': new FakeLeafElement(),
      '[data-profile-band-distance]': new FakeLeafElement(),
      '[data-profile-band-altitude]': new FakeLeafElement(),
      '[data-profile-band-grade]': new FakeLeafElement(),
      '[data-profile-band-eta]': new FakeLeafElement(),
      '[data-profile-live]': new FakeLeafElement(),
    }
  }
  set innerHTML(_value) { /* the real markup string is irrelevant here — the fixed child map above stands in for it */ }
  get innerHTML() { return '' }
  querySelector(selector) { return this._children[selector] ?? null }
}

function fakeMapContainer() {
  return { innerHTML: '', querySelector: () => null, addEventListener() {}, removeEventListener() {} }
}

function fakeActionElement(dataset) {
  const element = Object.assign(new globalThis.HTMLButtonElement(), { dataset })
  element.closest = (selector) => (selector === '[data-action]' ? (dataset.action !== undefined ? element : null) : null)
  return element
}

function createFakeContainer() {
  const listeners = { click: [] }
  const registered = new Map()
  return {
    innerHTML: '',
    addEventListener(type, listener) { listeners[type] ??= []; listeners[type].push(listener) },
    dispatch(type, event) { for (const listener of [...(listeners[type] ?? [])]) listener(event) },
    querySelector(selector) { return registered.get(selector) ?? null },
    querySelectorAll(selector) { return registered.get(selector) ?? [] },
    contains() { return true },
    register(selector, element) { registered.set(selector, element) },
  }
}

function stubWeatherProvider() {
  return {
    id: 'open-meteo',
    async fetchForecast(request) {
      return { provider: 'open-meteo', requestKey: request.key, fetchedAt: '2027-01-01T00:00:00.000Z', status: 'error', locations: [], datesCovered: [], issues: ['test stub'] }
    },
  }
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 50))
}

function createMapHandleSpy() {
  const calls = { setTemporaryMarker: [], clearTemporaryMarker: 0 }
  const handle = {
    setTemporaryMarker: (latitude, longitude) => calls.setTemporaryMarker.push([latitude, longitude]),
    clearTemporaryMarker: () => { calls.clearTemporaryMarker += 1 },
  }
  return { calls, getMapInteractionHandle: () => handle }
}

async function openDayAlphaWithProfileWired(db, getMapInteractionHandle) {
  const bundle = createGenericTripBundle()
  await createTripRepository(db).saveTripBundle(bundle)
  const container = createFakeContainer()
  const mapContainer = fakeMapContainer()
  const profileContainer = new FakeProfileElement()
  container.register('[data-day-detail-map]', mapContainer)
  container.register('[data-day-detail-profile]', profileContainer)
  const handle = initializeTripsManager(container, {
    database: db, now: () => '2027-05-10T08:00:00.000Z', idFactory: (() => { let n = 0; return () => `id-${n++}` })(),
    renderMap: () => {}, closeMap: () => {}, weatherProvider: stubWeatherProvider(),
    getMapInteractionHandle,
  })
  await flush()
  container.dispatch('click', { target: fakeActionElement({ action: 'open-trip', tripId: bundle.metadata.id }) })
  await flush()
  container.dispatch('click', { target: fakeActionElement({ action: 'open-day-detail', dayId: bundle.days[0].id }) })
  await flush()
  return { bundle, container, profileContainer, handle }
}

test('X/Y: a profile sample with a real position moves the map\'s temporary marker via the injected handle — never a direct Leaflet call from this module', async () => {
  const db = await openTestDatabase()
  try {
    const { getMapInteractionHandle, calls } = createMapHandleSpy()
    const { profileContainer } = await openDayAlphaWithProfileWired(db, getMapInteractionHandle)
    const svg = profileContainer.querySelector('[data-profile-interactive]')
    svg.emit('pointermove', { clientX: 400 })
    assert.equal(calls.setTemporaryMarker.length, 1)
    assert.ok(Number.isFinite(calls.setTemporaryMarker[0][0]))
    assert.ok(Number.isFinite(calls.setTemporaryMarker[0][1]))
  } finally {
    db.close()
  }
})

test('Z: leaving the profile clears the temporary marker through the same handle', async () => {
  const db = await openTestDatabase()
  try {
    const { getMapInteractionHandle, calls } = createMapHandleSpy()
    const { profileContainer } = await openDayAlphaWithProfileWired(db, getMapInteractionHandle)
    const svg = profileContainer.querySelector('[data-profile-interactive]')
    svg.emit('pointermove', { clientX: 400 })
    svg.emit('pointerleave')
    assert.equal(calls.clearTemporaryMarker, 1)
  } finally {
    db.close()
  }
})

test('no getMapInteractionHandle dependency at all (older/simpler test deps) never throws — the sync is simply a no-op', async () => {
  const db = await openTestDatabase()
  try {
    const { profileContainer } = await openDayAlphaWithProfileWired(db, undefined)
    const svg = profileContainer.querySelector('[data-profile-interactive]')
    assert.doesNotThrow(() => svg.emit('pointermove', { clientX: 400 }))
  } finally {
    db.close()
  }
})

test('re-rendering the day (e.g. a pause save patching the screen) never accumulates a second sync listener', async () => {
  const db = await openTestDatabase()
  try {
    const { getMapInteractionHandle, calls } = createMapHandleSpy()
    const { container, bundle, profileContainer } = await openDayAlphaWithProfileWired(db, getMapInteractionHandle)
    // Re-opening the same day re-runs mountMapAndProfile a second time —
    // the count of listeners registered for 'profile-sample-active' must
    // stay exactly one, not two.
    container.dispatch('click', { target: fakeActionElement({ action: 'open-day-detail', dayId: bundle.days[0].id }) })
    await flush()
    const svg = profileContainer.querySelector('[data-profile-interactive]')
    svg.emit('pointermove', { clientX: 400 })
    assert.equal(calls.setTemporaryMarker.length, 1, 'exactly one dispatch reaches the handle, not two')
  } finally {
    db.close()
  }
})
