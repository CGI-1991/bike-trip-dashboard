import './support/dom-shim.mjs'
import '../storage/indexeddb/support/setup-fake-indexeddb.mjs'

import assert from 'node:assert/strict'
import test from 'node:test'

import { createTripRepository } from '../../src/storage/indexeddb/trip-repository.ts'
import { setActiveTrip } from '../../src/trips-manager/trip-manager-actions.ts'
import { openTestDatabase } from '../storage/indexeddb/support/open-test-database.mjs'
import { initializeTripsManager } from '../../src/ui/trips/trips-manager.ts'
import { isSegmentMarkerClimbName } from '../../src/analysis/gpx-marker-names.ts'
import { createLinkedTripBundle } from '../trips-manager/support/linked-trip-fixture.mjs'

// `repairSegmentMarkerClimbNames` used to run only on the Aperçu load, so a
// visitor who went straight to Voyage — or opened an Étape from there — kept
// the broken names indefinitely. Every trip SCREEN now loads through the same
// path, and these tests open each of them WITHOUT ever visiting Aperçu.

function createFakeContainer() {
  const listeners = { click: [], change: [], input: [] }
  const nodes = new Map()
  return {
    innerHTML: '',
    addEventListener(type, listener, options) {
      listeners[type] ??= []
      listeners[type].push(listener)
      options?.signal?.addEventListener?.('abort', () => {
        listeners[type] = listeners[type].filter((candidate) => candidate !== listener)
      })
    },
    dispatch(type, event) { for (const listener of [...(listeners[type] ?? [])]) listener(event) },
    querySelector(selector) { return nodes.get(selector) ?? null },
    querySelectorAll() { return [] },
    contains() { return true },
    register(selector, node) { nodes.set(selector, node) },
  }
}

function fakeActionElement(dataset) {
  const element = Object.assign(new globalThis.HTMLButtonElement(), { dataset })
  element.closest = (selector) => (selector === '[data-action]' ? (dataset.action !== undefined ? element : null) : null)
  return element
}

function stubWeatherProvider() {
  return {
    id: 'open-meteo',
    async fetchForecast(request) {
      return { provider: 'open-meteo', requestKey: request.key, fetchedAt: '2028-01-01T00:00:00.000Z', status: 'error', locations: [], datesCovered: [], issues: ['test stub'] }
    },
  }
}

function deps(database) {
  return {
    database,
    now: () => '2028-06-01T08:00:00.000Z',
    idFactory: (() => { let n = 0; return () => `legacy-${n++}` })(),
    renderMap: () => {},
    closeMap: () => {},
    weatherProvider: stubWeatherProvider(),
  }
}

/** Awaits the predicate's own result, so an async check is genuinely awaited rather than treated as a truthy Promise. */
async function waitFor(predicate, what) {
  for (let attempt = 0; attempt < 600; attempt++) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`waitFor: ${what}`)
}

/**
 * A trip exactly as an older import left it: its climbs named after the GPX
 * segment markers ("Fin grimpeur"), with one real OSM col alongside the last
 * of them — the state that blocked the col↔climb merge.
 */
function legacyBundle() {
  const base = createLinkedTripBundle({ rideCount: 2 })
  const route = base.routes[0]
  const stage = base.stages[0]
  const climb = {
    id: 'legacy-climb-1', routeId: route.id, name: 'Fin grimpeur',
    startDistanceKm: 5, endDistanceKm: 20, elevationGainM: 420,
    averageGradientPercent: 5.5, maxGradientPercent: 9, startAltitudeM: 100, endAltitudeM: 520,
    confidence: 'confirmed',
    provenance: { sourceType: 'generated', sourceId: null, fetchedAt: null, engineVersion: 'gpx-import@1', confidence: 'high', manuallyOverridden: false },
  }
  const col = {
    id: 'legacy-col-1', routeId: route.id, type: 'summit', name: 'Col du Test',
    latitude: 45, longitude: 6.25, elevationM: 520, trackDistanceKm: 20,
    osmFeatureType: 'mountain-pass', lateralDistanceKm: 0,
    provenance: { sourceType: 'osm', sourceId: 'osm-1', fetchedAt: null, engineVersion: 'route-enrichment@4', confidence: 'high', manuallyOverridden: false },
  }
  return {
    ...base,
    climbs: [climb],
    routePoints: [col],
    stages: base.stages.map((candidate) => (candidate.id === stage.id ? { ...candidate, climbIds: [climb.id], routePointIds: [col.id] } : candidate)),
  }
}

async function storedClimbName(database, tripId) {
  const bundle = await createTripRepository(database).loadTripBundle(tripId)
  return bundle.climbs[0].name
}

test('opening VOYAGE on a legacy trip repairs it — no visit to Aperçu required', async () => {
  const database = await openTestDatabase()
  try {
    const bundle = legacyBundle()
    await createTripRepository(database).saveTripBundle(bundle)
    await setActiveTrip(database, bundle.metadata.id, '2028-06-01')
    assert.equal(isSegmentMarkerClimbName(await storedClimbName(database, bundle.metadata.id)), true, 'the trip really starts broken')

    const container = createFakeContainer()
    const handle = initializeTripsManager(container, deps(database))
    await handle.goToDetailForActiveTrip()

    const repaired = await storedClimbName(database, bundle.metadata.id)
    assert.equal(isSegmentMarkerClimbName(repaired), false)
    assert.equal(repaired, 'Col du Test', 'it adopts the col the trip already knows')
  } finally {
    database.close()
  }
})

test('opening an ÉTAPE directly on a legacy trip repairs it too', async () => {
  const database = await openTestDatabase()
  try {
    const bundle = legacyBundle()
    const repository = createTripRepository(database)
    await repository.saveTripBundle(bundle)
    await setActiveTrip(database, bundle.metadata.id, '2028-06-01')

    const container = createFakeContainer()
    const handle = initializeTripsManager(container, deps(database))
    await handle.goToDetailForActiveTrip()

    // Put the ORIGINAL legacy climb back — name and provenance both. Only
    // restoring the name would leave the OSM provenance the first repair
    // wrote, and the repair rightly refuses to touch an OSM-named climb, so
    // the trip would no longer be repairable at all.
    const current = await repository.loadTripBundle(bundle.metadata.id)
    await repository.saveTripBundle({ ...current, climbs: bundle.climbs })
    assert.equal(isSegmentMarkerClimbName(await storedClimbName(database, bundle.metadata.id)), true)

    container.dispatch('click', { target: fakeActionElement({ action: 'open-day-detail', dayId: bundle.days[0].id }) })
    await waitFor(async () => !isSegmentMarkerClimbName(await storedClimbName(database, bundle.metadata.id)), 'the Étape load repaired the trip')

    assert.equal(await storedClimbName(database, bundle.metadata.id), 'Col du Test')
  } finally {
    database.close()
  }
})

test('a trip needing no repair is never rewritten by opening a screen', async () => {
  const database = await openTestDatabase()
  try {
    const bundle = createLinkedTripBundle({ rideCount: 2 })
    const repository = createTripRepository(database)
    await repository.saveTripBundle(bundle)
    await setActiveTrip(database, bundle.metadata.id, '2028-06-01')
    const before = await repository.loadTripBundle(bundle.metadata.id)

    const container = createFakeContainer()
    const handle = initializeTripsManager(container, deps(database))
    await handle.goToDetailForActiveTrip()

    const after = await repository.loadTripBundle(bundle.metadata.id)
    assert.deepEqual(after.climbs, before.climbs)
    assert.equal(after.metadata.updatedAt, before.metadata.updatedAt, 'nothing was written')
  } finally {
    database.close()
  }
})
