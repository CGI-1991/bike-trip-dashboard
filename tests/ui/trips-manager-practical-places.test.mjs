import './support/dom-shim.mjs'
import '../storage/indexeddb/support/setup-fake-indexeddb.mjs'

import assert from 'node:assert/strict'
import test from 'node:test'

import { createTripRepository } from '../../src/storage/indexeddb/trip-repository.ts'
import { openTestDatabase } from '../storage/indexeddb/support/open-test-database.mjs'
import { createGenericTripBundle } from '../trip-core/support/generic-trip-fixture.mjs'
import { initializeTripsManager } from '../../src/ui/trips/trips-manager.ts'

// CDC C2 sections 15-16 — end-to-end wiring: opening the Étape screen builds
// the fullscreen map's practical-POI layers straight from whatever is
// already persisted in `bundle.practicalPlaces` (never a network call of its
// own — `deps.practicalPlacesProvider` is deliberately omitted below, and
// this test still produces real layers), and only ever passes them to the
// day's own map — never the Aperçu map.

function createFakeContainer() {
  let innerHTMLValue = ''
  const listeners = { click: [] }
  const registered = new Map()
  return {
    get innerHTML() { return innerHTMLValue },
    set innerHTML(value) { innerHTMLValue = value },
    addEventListener(type, listener) { listeners[type] ??= []; listeners[type].push(listener) },
    dispatch(type, event) { for (const listener of [...(listeners[type] ?? [])]) listener(event) },
    querySelector(selector) { return (registered.get(selector) ?? [null])[0] ?? null },
    querySelectorAll(selector) { return registered.get(selector) ?? [] },
    contains() { return true },
    register(selector, elements) { registered.set(selector, elements) },
  }
}

function fakeActionElement(dataset) {
  const element = Object.assign(new globalThis.HTMLButtonElement(), { dataset })
  element.closest = (selector) => (selector === '[data-action]' ? (dataset.action !== undefined ? element : null) : null)
  return element
}

function fakeDialog() {
  return Object.assign(new globalThis.HTMLElement(), { querySelector: () => null })
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 20))
}

test('opening the Étape screen builds the fullscreen map\'s practical-POI layers from persisted data alone, only for the day\'s own map', async () => {
  const db = await openTestDatabase()
  try {
    const bundle = createGenericTripBundle()
    bundle.practicalPlaces.push({
      id: 'postpass-practical:stage-alpha:node:99',
      stageId: bundle.stages[0].id,
      category: 'water',
      name: 'Fontaine du Parc',
      latitude: 45.15,
      longitude: 6.3,
      description: null,
      trackDistanceKm: 5,
      detourKm: 0.05,
      openingHours: null,
      usefulTags: {},
      hidden: false,
      pinned: false,
      dayIds: [bundle.days[0].id],
      provenance: { sourceType: 'osm', sourceId: 'postpass-practical-places:node:99', fetchedAt: '2028-01-01T00:00:00.000Z', engineVersion: 'practical-places-postpass@1', confidence: 'high', manuallyOverridden: false },
    })
    await createTripRepository(db).saveTripBundle(bundle)

    const container = createFakeContainer()
    const renderMapCalls = []
    let practicalProviderCalls = 0

    const handle = initializeTripsManager(container, {
      database: db, now: () => '2027-05-09T08:00:00.000Z', idFactory: (() => { let n = 0; return () => `id-${n++}` })(),
      renderMap: (mapContainer, mapDialog, model, layers) => { renderMapCalls.push({ mapContainer, layers: layers ?? [] }) },
      closeMap: () => {},
      // Deliberately supplied but must never be called — this trip's
      // provider state is already implicitly "nothing to search" (no ride
      // stage lacks the geometry it needs is irrelevant here; the point is
      // that OPENING A DAY never itself triggers enrichment, tests AR/AS).
      practicalPlacesProvider: { id: 'must-not-be-called', sourceType: 'osm', attribution: 'x', async findCandidates() { practicalProviderCalls++; throw new Error('should never be called from opening a day') } },
    })
    void handle

    container.register('[data-day-detail-map]', [{}])
    container.register('[data-day-detail-map-dialog]', [fakeDialog()])
    container.register('[data-day-detail-profile]', [null])

    container.dispatch('click', { target: fakeActionElement({ action: 'open-trip', tripId: bundle.metadata.id }) })
    await flush()
    container.dispatch('click', { target: fakeActionElement({ action: 'open-day-detail', dayId: bundle.days[0].id }) })
    await flush()

    assert.equal(practicalProviderCalls, 0, 'opening the day never triggers a Postpass search of its own')
    const dayMapCall = renderMapCalls.at(-1)
    assert.ok(dayMapCall)
    const waterLayer = dayMapCall.layers.find((layer) => layer.id === 'practical-water')
    assert.ok(waterLayer, 'the water layer is present')
    assert.equal(waterLayer.markers.length, 1)
    assert.equal(waterLayer.markers[0].name, 'Fontaine du Parc')
    assert.equal(waterLayer.defaultVisible, false)
    const bikeLayer = dayMapCall.layers.find((layer) => layer.id === 'practical-bike-service')
    assert.ok(bikeLayer, 'every one of the six category layers is always offered, even empty')
    assert.equal(bikeLayer.markers.length, 0)
  } finally {
    db.close()
  }
})
