import './support/dom-shim.mjs'
import '../storage/indexeddb/support/setup-fake-indexeddb.mjs'

import assert from 'node:assert/strict'
import test from 'node:test'

import { createTripRepository } from '../../src/storage/indexeddb/trip-repository.ts'
import { openTestDatabase } from '../storage/indexeddb/support/open-test-database.mjs'
import { createGenericTripBundle } from '../trip-core/support/generic-trip-fixture.mjs'
import { initializeTripsManager } from '../../src/ui/trips/trips-manager.ts'

// R2.1 sections 3-4 (tests B/C/D/E/F): the Pauses/Météo bottom block's own
// open/close mechanics — a pure client-side toggle, never a re-render.

function createFakeContainer() {
  let innerHTMLValue = ''
  let innerHTMLSetCount = 0
  const listeners = { click: [] }
  return {
    get innerHTML() { return innerHTMLValue },
    set innerHTML(value) {
      innerHTMLValue = value
      innerHTMLSetCount++
    },
    get innerHTMLSetCount() { return innerHTMLSetCount },
    addEventListener(type, listener) { listeners[type] ??= []; listeners[type].push(listener) },
    dispatch(type, event) { for (const listener of [...(listeners[type] ?? [])]) listener(event) },
    querySelector() { return null },
    querySelectorAll() { return [] },
    contains() { return true },
  }
}

/** A minimal real toggle/panel pair, driven the same way the actual rendered HTML behaves (via `hidden`/`aria-expanded`), so the click handler under test can be exercised without a full DOM. */
function fakeToggle(id, controlsId) {
  const dataset = { action: 'toggle-bottom-panel' }
  let ariaExpanded = 'false'
  const element = Object.assign(new globalThis.HTMLButtonElement(), {
    id, dataset,
    getAttribute(name) { return name === 'aria-controls' ? controlsId : name === 'aria-expanded' ? ariaExpanded : null },
    setAttribute(name, value) { if (name === 'aria-expanded') ariaExpanded = value },
    matches(selector) { return selector === '[data-action="toggle-bottom-panel"]' },
  })
  element.closest = (selector) => (selector === '[data-action="toggle-bottom-panel"]' ? element : null)
  return element
}

function fakePanel(id) {
  const element = Object.assign(new globalThis.HTMLElement(), { id, hidden: true, matches: (selector) => selector === '[data-bottom-panel]' })
  return element
}

function fakeActionElement(dataset) {
  const element = Object.assign(new globalThis.HTMLButtonElement(), { dataset })
  element.closest = (selector) => (selector === '[data-action]' ? (dataset.action !== undefined ? element : null) : null)
  return element
}

async function flush(ms = 30) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function openDayAlphaWithBottomBlock(db) {
  const bundle = createGenericTripBundle()
  await createTripRepository(db).saveTripBundle(bundle)
  const container = createFakeContainer()
  const pausesToggle = fakeToggle('t-pauses', 'p-pauses')
  const weatherToggle = fakeToggle('t-weather', 'p-weather')
  const pausesPanel = fakePanel('p-pauses')
  const weatherPanel = fakePanel('p-weather')
  initializeTripsManager(container, {
    database: db, now: () => '2027-05-10T08:00:00.000Z', idFactory: (() => { let n = 0; return () => `id-${n++}` })(),
    renderMap: () => {}, closeMap: () => {},
  })
  await flush()
  container.dispatch('click', { target: fakeActionElement({ action: 'open-trip', tripId: bundle.metadata.id }) })
  await flush()
  container.dispatch('click', { target: fakeActionElement({ action: 'open-day-detail', dayId: bundle.days[0].id }) })
  await flush()
  // Register the toggles/panels AFTER the day-detail render (whose own
  // fake `innerHTML` setter doesn't parse markup) so `querySelectorAll`
  // finds exactly these fakes when the click handler under test runs.
  const registered = [pausesToggle, weatherToggle, pausesPanel, weatherPanel]
  container.querySelectorAll = (selector) => registered.filter((el) => el.matches(selector))
  container.querySelector = (idSelector) => {
    const id = idSelector.replace(/^#/, '')
    return registered.find((el) => el.id === id) ?? null
  }
  return { bundle, container, pausesToggle, weatherToggle, pausesPanel, weatherPanel }
}

test('B/C: clicking Pauses opens it; clicking Pauses again closes it', async () => {
  const db = await openTestDatabase()
  try {
    const { container, pausesToggle, pausesPanel } = await openDayAlphaWithBottomBlock(db)
    container.dispatch('click', { target: pausesToggle })
    assert.equal(pausesPanel.hidden, false, 'B: Pauses is now open')
    assert.equal(pausesToggle.getAttribute('aria-expanded'), 'true')
    container.dispatch('click', { target: pausesToggle })
    assert.equal(pausesPanel.hidden, true, 'C: clicking the open toggle again closes it')
    assert.equal(pausesToggle.getAttribute('aria-expanded'), 'false')
  } finally {
    db.close()
  }
})

test('D/E: Pauses open, then clicking Météo closes Pauses and opens Météo — never two panels open at once', async () => {
  const db = await openTestDatabase()
  try {
    const { container, pausesToggle, weatherToggle, pausesPanel, weatherPanel } = await openDayAlphaWithBottomBlock(db)
    container.dispatch('click', { target: pausesToggle })
    assert.equal(pausesPanel.hidden, false)
    container.dispatch('click', { target: weatherToggle })
    assert.equal(pausesPanel.hidden, true, 'D: Pauses closed')
    assert.equal(pausesToggle.getAttribute('aria-expanded'), 'false')
    assert.equal(weatherPanel.hidden, false, 'D: Météo opened')
    assert.equal(weatherToggle.getAttribute('aria-expanded'), 'true')
    assert.ok(!(pausesPanel.hidden === false && weatherPanel.hidden === false), 'E: never two panels open at once')
  } finally {
    db.close()
  }
})

test('F: toggling the bottom block never reassigns the whole screen\'s innerHTML — a pure client-side attribute/hidden flip', async () => {
  const db = await openTestDatabase()
  try {
    const { container, pausesToggle, weatherToggle } = await openDayAlphaWithBottomBlock(db)
    const setCountAfterOpen = container.innerHTMLSetCount
    container.dispatch('click', { target: pausesToggle })
    container.dispatch('click', { target: weatherToggle })
    container.dispatch('click', { target: weatherToggle })
    assert.equal(container.innerHTMLSetCount, setCountAfterOpen, 'F: no full render for any bottom-block interaction')
  } finally {
    db.close()
  }
})
