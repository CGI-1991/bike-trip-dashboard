import assert from 'node:assert/strict'
import test from 'node:test'

import { interpolateProfileSample, renderElevationProfile } from '../../src/ui/elevation-profile.ts'

function buildFixture() {
  const points = Array.from({ length: 200 }, (_, index) => ({
    latitude: 46 + index / 10_000,
    longitude: 6,
    elevationM: 400 + index,
  }))
  const gpx = { segments: [{ points }] }
  const timeline = {
    day: { id: 'J1', gpxNumber: 1 },
    route: { pauses: [] },
  }
  const startPoint = { id: 'j01-start', dayId: 'J1', type: 'start', resolution: 'matched', name: 'Thonon-les-Bains', matchedTrackDistanceKm: 0, matchedElevationM: 400 }
  const colPoint = { id: 'j01-col-col-du-feu', dayId: 'J1', type: 'col', resolution: 'matched', name: 'Col du Feu', matchedTrackDistanceKm: 5, matchedElevationM: 500 }
  const passagePoint = { id: 'j01-passage-lullin', dayId: 'J1', type: 'passage', resolution: 'matched', name: 'Lullin', matchedTrackDistanceKm: 10, matchedElevationM: 450 }
  const endPoint = { id: 'j01-end', dayId: 'J1', type: 'end', resolution: 'matched', name: 'Morzine', matchedTrackDistanceKm: 15, matchedElevationM: 550 }
  const report = {
    days: [
      {
        dayId: 'J1',
        type: 'ride',
        roadbook: { id: 'J1', startName: 'Thonon-les-Bains', endName: 'Morzine' },
        points: [startPoint, colPoint, passagePoint, endPoint],
      },
    ],
  }
  const container = { innerHTML: '' }
  renderElevationProfile(container, gpx, timeline, report, { name: 'Hôtel Le Soly', address: '234 Route de la Manche, 74110 Morzine' })
  return container.innerHTML
}

class FakeInteractiveElement {
  constructor() {
    this.attributes = new Map()
    this.listeners = new Map()
    this.hidden = true
    this.innerHTML = ''
    this.textContent = ''
    this.style = {}
  }
  addEventListener(type, listener, options = {}) {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
    options.signal?.addEventListener('abort', () => listeners.delete(listener), { once: true })
  }
  emit(type, event = {}) { for (const listener of this.listeners.get(type) ?? []) listener(event) }
  listenerCount(type) { return this.listeners.get(type)?.size ?? 0 }
  setAttribute(name, value) { this.attributes.set(name, String(value)) }
  getAttribute(name) { return this.attributes.get(name) ?? null }
  removeAttribute(name) { this.attributes.delete(name) }
  getBoundingClientRect() { return { left: 0, width: 800 } }
  setPointerCapture() {}
  releasePointerCapture() {}
}

function buildInteractiveFixture() {
  const elements = Object.fromEntries([
    '[data-profile-interactive]',
    '[data-profile-cursor]',
    '[data-profile-cursor-line]',
    '[data-profile-cursor-dot]',
    '[data-profile-tooltip]',
    '[data-profile-live]',
  ].map((selector) => [selector, new FakeInteractiveElement()]))
  elements['[data-profile-cursor]'].setAttribute('hidden', '')
  const container = { innerHTML: '', querySelector: (selector) => elements[selector] ?? null }
  const points = Array.from({ length: 200 }, (_, index) => ({ latitude: 46 + index / 10_000, longitude: 6, elevationM: 400 + index }))
  const gpx = { segments: [{ points }] }
  const timeline = { day: { id: 'J1', gpxNumber: 1 }, route: { pauses: [] } }
  renderElevationProfile(container, gpx, timeline, null)
  return { container, elements, gpx, timeline }
}

test('the profile draws distinct shapes per category, matching the map (circle/rounded-square/diamond)', () => {
  const html = buildFixture()
  assert.match(html, /profile-marker--start/)
  assert.match(html, /profile-marker--finish/)
  assert.match(html, /profile-marker--col-summit/)
  assert.match(html, /profile-marker--passage/)
  // col-summit is the only category rendered as a rotated (diamond) rect.
  assert.match(html, /profile-marker--col-summit"[^>]*>.*?rotate\(45\)/s)
  // finish is a rounded square (rect, not rotated).
  const finishMarker = html.match(/<g class="profile-marker profile-marker--finish"[^]*?<\/g>/)?.[0] ?? ''
  assert.match(finishMarker, /<rect/)
  assert.doesNotMatch(finishMarker, /rotate\(45\)/)
})

test('the arrival marker title uses the merged accommodation name, just like the map tooltip', () => {
  const html = buildFixture()
  assert.match(html, /Hôtel Le Soly · 15\.0 km/)
})

test('a pause attached to a documented point adds a ring to that same marker — no second position, no separate pause line', () => {
  const points = Array.from({ length: 200 }, (_, index) => ({ latitude: 46 + index / 10_000, longitude: 6, elevationM: 400 + index }))
  const gpx = { segments: [{ points }] }
  const timeline = {
    day: { id: 'J1', gpxNumber: 1 },
    route: { pauses: [{ id: 'pause-1', name: 'Col du Feu', durationMinutes: 20, pointId: 'j01-col-col-du-feu' }] },
  }
  const colPoint = { id: 'j01-col-col-du-feu', dayId: 'J1', type: 'col', resolution: 'matched', name: 'Col du Feu', matchedTrackDistanceKm: 5, matchedElevationM: 500 }
  const report = { days: [{ dayId: 'J1', type: 'ride', roadbook: { id: 'J1', startName: 'A', endName: 'B' }, points: [colPoint] }] }
  const container = { innerHTML: '' }
  renderElevationProfile(container, gpx, timeline, report)
  assert.match(container.innerHTML, /profile-marker--pause/)
  assert.match(container.innerHTML, /Col du Feu · 5\.0 km · Pause 20 min/)
  // Exactly one <g> marker for the col — the pause never creates a second element.
  assert.equal((container.innerHTML.match(/<g class="profile-marker/g) ?? []).length, 1)
  assert.doesNotMatch(container.innerHTML, /class="profile-pause"/)
})

test('an off-route documented point keeps its category shape but renders hollow', () => {
  const points = Array.from({ length: 50 }, (_, index) => ({ latitude: 46 + index / 10_000, longitude: 6, elevationM: 500 }))
  const gpx = { segments: [{ points }] }
  const timeline = { day: { id: 'J3', gpxNumber: 3 }, route: { pauses: [] } }
  const offRoutePassage = { id: 'j03-passage-la-clusaz', dayId: 'J3', type: 'village', resolution: 'informational', name: 'La Clusaz', matchedTrackDistanceKm: 5, matchedElevationM: 1_000 }
  const report = { days: [{ dayId: 'J3', type: 'ride', roadbook: { id: 'J3', startName: 'A', endName: 'B' }, points: [offRoutePassage] }] }
  const container = { innerHTML: '' }
  renderElevationProfile(container, gpx, timeline, report)
  assert.match(container.innerHTML, /profile-marker--off-route/)
  assert.match(container.innerHTML, /profile-marker--passage/)
})

test('the static profile remains visible and exposes the complete interactive overlay', () => {
  const html = buildFixture()
  assert.match(html, /class="profile-area"/)
  assert.match(html, /class="profile-line"/)
  assert.match(html, /data-profile-interactive tabindex="0"/)
  assert.match(html, /data-profile-cursor-line/)
  assert.match(html, /data-profile-cursor-dot/)
  assert.match(html, /data-profile-tooltip hidden/)
  assert.match(html, /data-profile-live aria-live="polite"/)
  assert.doesNotMatch(html, /NaN|Infinity/)
})

test('profile interpolation is continuous for distance, elevation and smoothed grade', () => {
  const samples = [
    { distanceKm: 0, altitudeM: 500, elevationM: 500, smoothedGradePercent: 0, latitude: 46, longitude: 6 },
    { distanceKm: 2, altitudeM: 700, elevationM: 700, smoothedGradePercent: 8, latitude: 47, longitude: 7 },
  ]
  assert.deepEqual(interpolateProfileSample(samples, 0), samples[0])
  assert.deepEqual(interpolateProfileSample(samples, 2), samples[1])
  assert.deepEqual(interpolateProfileSample(samples, 1), {
    distanceKm: 1,
    altitudeM: 600,
    elevationM: 600,
    smoothedGradePercent: 4,
    latitude: 46.5,
    longitude: 6.5,
  })
})

test('mouse, touch and keyboard move one cursor on the curve, keep the tooltip contained and clean old listeners', () => {
  const { container, elements, gpx, timeline } = buildInteractiveFixture()
  const svg = elements['[data-profile-interactive]']
  const cursor = elements['[data-profile-cursor]']
  const line = elements['[data-profile-cursor-line]']
  const dot = elements['[data-profile-cursor-dot]']
  const tooltip = elements['[data-profile-tooltip]']
  const live = elements['[data-profile-live]']

  assert.equal(svg.listenerCount('pointermove'), 1)
  svg.emit('pointermove', { clientX: 400, pointerId: 1, pointerType: 'mouse' })
  assert.equal(cursor.getAttribute('hidden'), null)
  assert.equal(tooltip.hidden, false)
  assert.equal(line.getAttribute('x1'), line.getAttribute('x2'))
  assert.ok(Number.isFinite(Number(dot.getAttribute('cy'))))
  assert.match(live.textContent, /km .* m .* Pente moyenne/s)
  assert.ok(Number.parseFloat(tooltip.style.left) >= 14 && Number.parseFloat(tooltip.style.left) <= 86)

  const mouseText = live.textContent
  svg.emit('pointerdown', { clientX: 650, pointerId: 2, pointerType: 'touch' })
  assert.notEqual(live.textContent, mouseText, 'touch uses the same continuous pointer interaction')
  let prevented = false
  svg.emit('keydown', { key: 'ArrowLeft', preventDefault: () => { prevented = true } })
  assert.equal(prevented, true)

  renderElevationProfile(container, gpx, timeline, null)
  assert.equal(svg.listenerCount('pointermove'), 1, 'rerender aborts the previous listener set before installing the next one')
  svg.emit('pointerleave')
  assert.notEqual(cursor.getAttribute('hidden'), null)
  assert.equal(tooltip.hidden, true)
})

test('J2 profile consolidates Le Grand-Bornand into one Vermont finish marker', () => {
  const points = Array.from({ length: 100 }, (_, index) => ({ latitude: 46 + index / 10_000, longitude: 6, elevationM: 500 + index }))
  const gpx = { segments: [{ points }] }
  const timeline = { day: { id: 'J2', gpxNumber: 2 }, route: { pauses: [] } }
  const start = { id: 'j02-start', dayId: 'J2', type: 'start', resolution: 'matched', name: 'Morzine', matchedTrackDistanceKm: 0, matchedElevationM: 500 }
  const end = { id: 'j02-end', dayId: 'J2', type: 'end', resolution: 'matched', name: 'Le Grand-Bornand', matchedTrackDistanceKm: 10, matchedElevationM: 600 }
  const report = { days: [{ dayId: 'J2', type: 'ride', roadbook: { id: 'J2', startName: 'Morzine', endName: 'Le Grand-Bornand' }, points: [start, end] }] }
  const accommodation = { name: 'Hôtel et Spa Le Vermont', address: '607 Route de la Vallée du Bouchet, 74450 Le Grand-Bornand' }
  const container = { innerHTML: '' }
  renderElevationProfile(container, gpx, timeline, report, accommodation)
  assert.equal((container.innerHTML.match(/profile-marker--finish/g) ?? []).length, 1)
  assert.equal((container.innerHTML.match(/Hôtel et Spa Le Vermont/g) ?? []).length, 1)
  assert.doesNotMatch(container.innerHTML, /Croix Saint-Maurice/)
})
