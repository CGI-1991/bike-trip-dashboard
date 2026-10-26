import assert from 'node:assert/strict'
import test from 'node:test'

import { renderGenericElevationProfile, sampleElevationProfileFromGeometry } from '../../src/ui/elevation-profile.ts'

test('a GPX without any altitude has no fictitious zero-metre profile', () => {
  const points = [{ latitude: 45, longitude: 6, altitudeM: null }, { latitude: 45.1, longitude: 6, altitudeM: null }]
  assert.deepEqual(sampleElevationProfileFromGeometry(points), [])
  const container = { innerHTML: '' }
  renderGenericElevationProfile(container, points, [])
  assert.match(container.innerHTML, /Profil altimétrique indisponible/)
  assert.doesNotMatch(container.innerHTML, /data-profile-interactive|0 m/)
})

// CDC D1.1 sections 16/18/21 — the generic profile's fixed info band and the
// profile→map sync events. The RGA profile (`renderElevationProfile`) keeps
// its own floating tooltip untouched — see `elevation-profile-markers.test.mjs`.

class FakeElement {
  constructor(width = 800, height = 240) {
    this.attributes = new Map()
    this.listeners = new Map()
    this.textContent = ''
    this.hidden = true
    this._width = width
    this._height = height
  }
  addEventListener(type, listener, options = {}) {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
    options.signal?.addEventListener('abort', () => listeners.delete(listener), { once: true })
  }
  dispatchEvent(event) { for (const listener of this.listeners.get(event.type) ?? []) listener(event) }
  emit(type, event = {}) { for (const listener of this.listeners.get(type) ?? []) listener(event) }
  listenerCount(type) { return this.listeners.get(type)?.size ?? 0 }
  setAttribute(name, value) { this.attributes.set(name, String(value)) }
  getAttribute(name) { return this.attributes.get(name) ?? null }
  removeAttribute(name) { this.attributes.delete(name) }
  getBoundingClientRect() { return { left: 0, top: 0, width: this._width, height: this._height } }
  setPointerCapture() {}
  releasePointerCapture() {}
}

function geometry() {
  // A straight line so latitude/longitude vary linearly with distance —
  // easy to assert against in the dispatched event detail.
  return Array.from({ length: 200 }, (_, index) => ({ latitude: 46 + index / 10_000, longitude: 6 + index / 10_000, altitudeM: 400 + index }))
}

function waypoint(overrides = {}) {
  return {
    id: 'wp', kind: 'city', importance: 'major', visibleByDefault: true, name: 'Ville',
    trackDistanceKm: 5, latitude: 46.005, longitude: 6.005, elevationM: 450, climbId: null,
    pauseDurationMinutes: null, elapsedMinutes: null, clockTime: null,
    ...overrides,
  }
}

function buildInteractiveFixture(timingCurve) {
  const elements = {
    '[data-profile-interactive]': new FakeElement(800, 240),
    '[data-profile-cursor]': new FakeElement(),
    '[data-profile-cursor-line]': new FakeElement(),
    '[data-profile-cursor-dot]': new FakeElement(),
    '[data-profile-band-distance]': new FakeElement(),
    '[data-profile-band-altitude]': new FakeElement(),
    '[data-profile-band-grade]': new FakeElement(),
    '[data-profile-band-eta]': new FakeElement(),
    '[data-profile-live]': new FakeElement(),
  }
  elements['[data-profile-cursor]'].setAttribute('hidden', '')
  const events = []
  const container = {
    innerHTML: '',
    querySelector: (selector) => elements[selector] ?? null,
    listeners: new Map(),
    addEventListener(type, listener) {
      const set = this.listeners.get(type) ?? new Set()
      set.add(listener)
      this.listeners.set(type, set)
    },
    dispatchEvent(event) {
      events.push(event)
      for (const listener of this.listeners.get(event.type) ?? []) listener(event)
    },
  }
  renderGenericElevationProfile(container, geometry(), [waypoint()], 'Étape test', timingCurve ?? null)
  return { container, elements, events }
}

test('the band renders neutral dashes on mount, before any interaction (CDC section 16)', () => {
  const { container } = buildInteractiveFixture()
  assert.match(container.innerHTML, /data-profile-band-distance>—</)
  assert.match(container.innerHTML, /data-profile-band-altitude>—</)
  assert.match(container.innerHTML, /data-profile-band-grade>—</)
  assert.match(container.innerHTML, /data-profile-band-eta>—</)
  assert.doesNotMatch(container.innerHTML, /data-profile-tooltip/, 'no floating tooltip on the generic profile any more')
})

test('V: a pointer sample updates distance/altitude/pente in the band', () => {
  const { elements } = buildInteractiveFixture()
  const svg = elements['[data-profile-interactive]']
  svg.emit('pointermove', { clientX: 400 })
  assert.match(elements['[data-profile-band-distance]'].textContent, /km$/)
  assert.match(elements['[data-profile-band-altitude]'].textContent, /m$/)
  assert.match(elements['[data-profile-band-grade]'].textContent, /%$/)
})

test('the band ETA cell stays "—" without a timing curve, and shows a real clock time with one', () => {
  const { elements: withoutCurve } = buildInteractiveFixture(null)
  withoutCurve['[data-profile-interactive]'].emit('pointermove', { clientX: 400 })
  assert.equal(withoutCurve['[data-profile-band-eta]'].textContent, '—')

  const timingCurve = { clockTimeAt: (distanceKm) => `1${Math.round(distanceKm)}:00` }
  const { elements: withCurve } = buildInteractiveFixture(timingCurve)
  withCurve['[data-profile-interactive]'].emit('pointermove', { clientX: 400 })
  assert.match(withCurve['[data-profile-band-eta]'].textContent, /^1\d:00$/)
})

test('X: a sample with lat/lon dispatches "profile-sample-active" with that exact position, on the profile\'s own container', () => {
  const { container, elements, events } = buildInteractiveFixture()
  elements['[data-profile-interactive]'].emit('pointermove', { clientX: 400 })
  const activeEvents = events.filter((event) => event.type === 'profile-sample-active')
  assert.equal(activeEvents.length, 1)
  assert.ok(Number.isFinite(activeEvents[0].detail.latitude))
  assert.ok(Number.isFinite(activeEvents[0].detail.longitude))
})

test('race-bound selection uses the profile plot margins and the same chainage as the cursor', () => {
  const { elements, events } = buildInteractiveFixture()
  const svg = elements['[data-profile-interactive]']
  svg.emit('pointermove', { clientX: 20 })
  assert.equal(events.filter(event => event.type === 'profile-distance-active').at(-1).detail.distanceKm, 0)
  svg.emit('pointermove', { clientX: 780 })
  const total = events.filter(event => event.type === 'profile-distance-active').at(-1).detail.distanceKm
  svg.emit('pointermove', { clientX: 210 })
  const selected = events.filter(event => event.type === 'profile-distance-active').at(-1).detail.distanceKm
  assert.ok(Math.abs(selected - total / 4) < 1e-8)
  const sync = events.filter(event => event.type === 'profile-sample-active').at(-1)
  assert.ok(Number.isFinite(sync.detail.latitude))
})

test('Z: leaving the profile clears the band back to neutral and dispatches "profile-sample-cleared"', () => {
  const { elements, events } = buildInteractiveFixture()
  const svg = elements['[data-profile-interactive]']
  svg.emit('pointermove', { clientX: 400 })
  svg.emit('pointerleave')
  assert.equal(elements['[data-profile-band-distance]'].textContent, '—')
  assert.equal(elements['[data-profile-band-eta]'].textContent, '—')
  assert.ok(events.some((event) => event.type === 'profile-sample-cleared'))
})

test('a touch tap that never leaves the element does not clear the band — only a real leave/cancel does (CDC section 18)', () => {
  const { elements } = buildInteractiveFixture()
  const svg = elements['[data-profile-interactive]']
  svg.emit('pointerdown', { clientX: 400, pointerId: 1 })
  svg.emit('pointerup', { pointerId: 1 })
  assert.notEqual(elements['[data-profile-band-distance]'].textContent, '—')
})

test('the synthetic leave after lifting a finger keeps the selected point readable, while cancellation still clears it', () => {
  const { elements, events } = buildInteractiveFixture()
  const svg = elements['[data-profile-interactive]']
  svg.emit('pointerdown', { clientX: 400, pointerId: 1 })
  svg.emit('pointerup', { pointerId: 1 })
  svg.emit('pointerleave', { pointerType: 'touch', buttons: 0 })
  assert.notEqual(elements['[data-profile-band-distance]'].textContent, '—')
  assert.equal(events.some(event => event.type === 'profile-sample-cleared'), false)
  svg.emit('pointercancel')
  assert.equal(elements['[data-profile-band-distance]'].textContent, '—')
})

test('moving focus to a card after a touch keeps the reading stable; subsequent keyboard blur still clears it', () => {
  const { elements, events } = buildInteractiveFixture()
  const svg = elements['[data-profile-interactive]']
  svg.emit('pointerdown', { clientX: 400, pointerId: 1, pointerType: 'touch' })
  svg.emit('pointerup', { pointerId: 1, pointerType: 'touch' })
  svg.emit('blur')
  assert.notEqual(elements['[data-profile-band-distance]'].textContent, '—')
  assert.equal(events.some(event => event.type === 'profile-sample-cleared'), false)
  svg.emit('keydown', { key: 'Tab' })
  svg.emit('blur')
  assert.equal(elements['[data-profile-band-distance]'].textContent, '—')
  assert.ok(events.some(event => event.type === 'profile-sample-cleared'))
})

test('AA: keyboard navigation (ArrowRight/ArrowLeft) updates the band and dispatches the same sync event as pointer interaction', () => {
  const { elements, events } = buildInteractiveFixture()
  const svg = elements['[data-profile-interactive]']
  let prevented = false
  svg.emit('keydown', { key: 'ArrowRight', preventDefault: () => { prevented = true } })
  assert.equal(prevented, true)
  assert.notEqual(elements['[data-profile-band-distance]'].textContent, '—')
  assert.ok(events.some((event) => event.type === 'profile-sample-active'))
})

test('losing keyboard focus (blur) clears the band, same as a pointer leave', () => {
  const { elements, events } = buildInteractiveFixture()
  const svg = elements['[data-profile-interactive]']
  svg.emit('keydown', { key: 'ArrowRight', preventDefault: () => {} })
  svg.emit('blur')
  assert.equal(elements['[data-profile-band-distance]'].textContent, '—')
  assert.ok(events.some((event) => event.type === 'profile-sample-cleared'))
})

test('rerendering the profile tears down the previous listener set before installing the next one', () => {
  const { container, elements } = buildInteractiveFixture()
  const svg = elements['[data-profile-interactive]']
  assert.equal(svg.listenerCount('pointermove'), 1)
  renderGenericElevationProfile(container, geometry(), [waypoint()], 'Étape test')
  assert.equal(svg.listenerCount('pointermove'), 1)
})
