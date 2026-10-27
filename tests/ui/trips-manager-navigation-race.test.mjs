import './support/dom-shim.mjs'
import '../storage/indexeddb/support/setup-fake-indexeddb.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createTripRepository } from '../../src/storage/indexeddb/trip-repository.ts'
import { openTestDatabase } from '../storage/indexeddb/support/open-test-database.mjs'
import { createGenericTripBundle } from '../trip-core/support/generic-trip-fixture.mjs'
import { initializeTripsManager } from '../../src/ui/trips/trips-manager.ts'

function container() {
  const listeners = new Map()
  return {
    innerHTML: '',
    addEventListener(type, fn) { listeners.set(type, [...listeners.get(type) ?? [], fn]) },
    dispatch(type, event) { for (const fn of listeners.get(type) ?? []) fn(event) },
    querySelector() { return null }, querySelectorAll() { return [] }, contains() { return true },
  }
}
const tick = () => new Promise(resolve => setTimeout(resolve, 20))
async function waitUntil(predicate) {
  const deadline = Date.now() + 2000
  while (!predicate() && Date.now() < deadline) await tick()
  assert.ok(predicate(), 'expected screen must settle')
}
const weatherProvider = { id: 'open-meteo', async fetchForecast(request) {
  return { provider: 'open-meteo', requestKey: request.key, fetchedAt: '2027-05-01T00:00:00Z', status: 'error', locations: [], datesCovered: [], issues: ['offline fixture'] }
} }

test('a pending active-trip lookup cannot replace Mes activités after a newer navigation', async () => {
  const db = await openTestDatabase()
  try {
    await createTripRepository(db).saveTripBundle(createGenericTripBundle())
    const host = container()
    const manager = initializeTripsManager(host, { database: db, now: () => '2027-05-01T08:00:00Z', idFactory: () => 'test', renderMap() {}, closeMap() {}, weatherProvider })
    await waitUntil(() => host.innerHTML.includes('data-trips-list'))
    const pending = manager.goToDetailForActiveTrip()
    manager.goToList()
    await pending
    await waitUntil(() => host.innerHTML.includes('data-trips-list'))
    assert.match(host.innerHTML, /data-trips-list/)
    assert.doesNotMatch(host.innerHTML, /data-trip-detail/)
    await manager.waitForWeatherIdle()
  } finally { db.close() }
})

test('an earlier list read cannot replace a wizard opened while the read is pending', async () => {
  const db = await openTestDatabase()
  try {
    const host = container()
    const manager = initializeTripsManager(host, { database: db, now: () => '2027-05-01T08:00:00Z', idFactory: () => 'test', renderMap() {}, closeMap() {}, weatherProvider })
    await waitUntil(() => host.innerHTML.includes('data-trips-empty'))
    const pending = manager.refresh()
    const target = Object.assign(new globalThis.HTMLButtonElement(), { dataset: { action: 'create-trip' } })
    target.closest = selector => selector === '[data-action]' ? target : null
    host.dispatch('click', { target })
    await pending
    assert.match(host.innerHTML, /wizard-name/)
    assert.doesNotMatch(host.innerHTML, /data-trips-empty/)
  } finally { db.close() }
})

test('a local read failure shows an explicit retry and retry restores the existing list', async () => {
  const db = await openTestDatabase()
  try {
    await createTripRepository(db).saveTripBundle(createGenericTripBundle())
    let failReads = false
    const database = new Proxy(db, { get(target, key) {
      if (key === 'transaction') return (...args) => {
        if (failReads) throw new DOMException('Injected read failure', 'UnknownError')
        return target.transaction(...args)
      }
      const value = Reflect.get(target, key, target)
      return typeof value === 'function' ? value.bind(target) : value
    } })
    const host = container()
    const manager = initializeTripsManager(host, { database, now: () => '2027-05-01T08:00:00Z', idFactory: () => 'test', renderMap() {}, closeMap() {}, weatherProvider })
    await waitUntil(() => host.innerHTML.includes('data-trips-list'))
    failReads = true
    await manager.refresh()
    assert.match(host.innerHTML, /data-screen-load-error role="alert"/)
    assert.doesNotMatch(host.innerHTML, /Chargement|Aucune activité/)
    failReads = false
    const target = Object.assign(new globalThis.HTMLButtonElement(), { dataset: { action: 'retry-screen' } })
    target.closest = selector => selector === '[data-action]' ? target : null
    host.dispatch('click', { target })
    await waitUntil(() => host.innerHTML.includes('data-trips-list'))
    assert.match(host.innerHTML, /Sample Loop 01/)
    assert.equal((await createTripRepository(db).listTrips()).length, 1)
  } finally { db.close() }
})
