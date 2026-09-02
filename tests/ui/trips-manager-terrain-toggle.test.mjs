import { installMinimalDOMParser } from '../support/minimal-dom-parser.mjs'

installMinimalDOMParser()
import './support/dom-shim.mjs'
import '../storage/indexeddb/support/setup-fake-indexeddb.mjs'

import assert from 'node:assert/strict'
import test from 'node:test'

import { createTripRepository } from '../../src/storage/indexeddb/trip-repository.ts'
import { openTestDatabase } from '../storage/indexeddb/support/open-test-database.mjs'
import { createGenericTripBundle } from '../trip-core/support/generic-trip-fixture.mjs'
import { initializeTripsManager } from '../../src/ui/trips/trips-manager.ts'
import { buildGpxXml } from '../import/gpx/support/fixtures.mjs'

// R2.1 sections 18-23 (tests AF/AI/AJ/AK): the shared Normal/Montagne
// segmented toggle — exactly two selectable options, no "Automatique"/
// "Mixte" any more, in both the trip editor and the creation wizard.

function createFakeContainer() {
  let innerHTMLValue = ''
  const listeners = { click: [] }
  return {
    get innerHTML() { return innerHTMLValue },
    set innerHTML(value) { innerHTMLValue = value },
    addEventListener(type, listener) { listeners[type] ??= []; listeners[type].push(listener) },
    dispatch(type, event) { for (const listener of [...(listeners[type] ?? [])]) listener(event) },
    querySelector() { return null },
    querySelectorAll() { return [] },
    contains() { return true },
  }
}

function fakeActionElement(dataset) {
  const element = Object.assign(new globalThis.HTMLButtonElement(), { dataset })
  element.closest = (selector) => {
    if (selector === '[data-action]') return dataset.action !== undefined ? element : null
    if (selector === `[data-action="${dataset.action}"]`) return element
    if (selector === '[data-editor-action]') return dataset.editorAction !== undefined ? element : null
    return null
  }
  return element
}

function noopDeps(database, extra = {}) {
  return {
    database, now: () => '2027-05-10T08:00:00.000Z', idFactory: (() => { let n = 0; return () => `id-${n++}` })(),
    renderMap: () => {}, closeMap: () => {},
    ...extra,
  }
}

async function flush(ms = 30) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

function gpxBytes(name, startLat = 45) {
  const xml = buildGpxXml({
    tracks: [{ name, segments: [[
      { lat: startLat, lon: 6, ele: 1000 },
      { lat: startLat + 0.002, lon: 6.002, ele: 1050 },
      { lat: startLat + 0.004, lon: 6.004, ele: 1100 },
    ]] }],
  })
  return new TextEncoder().encode(xml).buffer
}

/**
 * The trip editor re-reads every ride day's own GPX bytes
 * (`loadTripEditDraft`), then re-analyzes them (`preAnalyzeGpxFiles`) — a
 * bundle saved without its `sourceFiles`' payloads throws "Octets GPX
 * introuvables" the moment the editor opens, and an empty/invalid payload
 * marks the ride invalid (blocking Enregistrer for an unrelated reason).
 * Real, valid, minimal GPX bytes for every source file.
 */
async function saveBundleWithSourcePayloads(db, bundle) {
  await createTripRepository(db).saveTripBundle(bundle, {
    sourcePayloads: bundle.sourceFiles.map((sourceFile, index) => ({ sourceFileId: sourceFile.id, content: gpxBytes(sourceFile.originalName, 45 + index) })),
  })
}

test('AI: the trip editor exposes exactly two terrain options — Normal/Montagne, no "Automatique"/"Mixte" anywhere', async () => {
  const db = await openTestDatabase()
  try {
    const bundle = createGenericTripBundle()
    await saveBundleWithSourcePayloads(db, bundle)
    const container = createFakeContainer()
    initializeTripsManager(container, noopDeps(db))
    await flush()
    container.dispatch('click', { target: fakeActionElement({ action: 'edit-trip', tripId: bundle.metadata.id }) })
    await flush(100)
    assert.match(container.innerHTML, /data-terrain-toggle/)
    assert.match(container.innerHTML, /data-terrain-mode="normal"[^>]*>Normal</)
    assert.match(container.innerHTML, /data-terrain-mode="mountain"[^>]*>Montagne</)
    assert.doesNotMatch(container.innerHTML, /Automatique/)
    assert.doesNotMatch(container.innerHTML, /Mixte/)
  } finally {
    db.close()
  }
})

test('AJ/AK: an old bundle with mountainMode left unset (legacy "automatic") is normalized to a concrete Normal/Montagne pre-selection — never crashes, never a tristate', async () => {
  const db = await openTestDatabase()
  try {
    const bundle = createGenericTripBundle()
    // Legacy shape: never explicitly set (still `undefined`, exactly like a
    // bundle from before this control existed) — stage-alpha's own gentle
    // elevation profile derives to a non-'mountain' label, so this must
    // normalize to Normal pre-selected (AJ), never crash (AK covers the
    // reverse case: an explicit `true` normalizes to Montagne, exercised
    // in the next test below).
    delete bundle.settings.global.mountainMode
    await saveBundleWithSourcePayloads(db, bundle)
    const container = createFakeContainer()
    initializeTripsManager(container, noopDeps(db))
    await flush()
    container.dispatch('click', { target: fakeActionElement({ action: 'edit-trip', tripId: bundle.metadata.id }) })
    await flush(100)
    assert.match(container.innerHTML, /data-terrain-mode="normal"[^>]*aria-pressed="true"/)
    assert.match(container.innerHTML, /data-terrain-mode="mountain"[^>]*aria-pressed="false"/)
  } finally {
    db.close()
  }
})

test('AK: an old bundle explicitly forced to mountain mode pre-selects Montagne', async () => {
  const db = await openTestDatabase()
  try {
    const bundle = createGenericTripBundle()
    bundle.settings.global.mountainMode = true
    await saveBundleWithSourcePayloads(db, bundle)
    const container = createFakeContainer()
    initializeTripsManager(container, noopDeps(db))
    await flush()
    container.dispatch('click', { target: fakeActionElement({ action: 'edit-trip', tripId: bundle.metadata.id }) })
    await flush(100)
    assert.match(container.innerHTML, /data-terrain-mode="mountain"[^>]*aria-pressed="true"/)
    assert.match(container.innerHTML, /data-terrain-mode="normal"[^>]*aria-pressed="false"/)
  } finally {
    db.close()
  }
})

test('clicking Montagne flips the toggle and marks the editor dirty (Enregistrer becomes enabled)', async () => {
  const db = await openTestDatabase()
  try {
    const bundle = createGenericTripBundle()
    await saveBundleWithSourcePayloads(db, bundle)
    const container = createFakeContainer()
    initializeTripsManager(container, noopDeps(db))
    await flush()
    container.dispatch('click', { target: fakeActionElement({ action: 'edit-trip', tripId: bundle.metadata.id }) })
    await flush(100)
    assert.match(container.innerHTML, /data-terrain-mode="normal"[^>]*aria-pressed="true"/, 'Normal is the fixture\'s own starting selection')
    container.dispatch('click', { target: fakeActionElement({ action: 'set-terrain-mode', terrainMode: 'mountain' }) })
    assert.match(container.innerHTML, /data-terrain-mode="mountain"[^>]*aria-pressed="true"/)
    assert.match(container.innerHTML, /data-editor-action='save'(?![^>]*disabled)/, 'Enregistrer must no longer be disabled once terrain actually changed')
  } finally {
    db.close()
  }
})

test('AF: a brand-new trip in the creation wizard always starts with Normal pre-selected — never Automatique/Mixte, whatever GPX might eventually suggest', async () => {
  const db = await openTestDatabase()
  try {
    const container = createFakeContainer()
    initializeTripsManager(container, noopDeps(db))
    await flush()
    container.dispatch('click', { target: fakeActionElement({ action: 'create-trip' }) })
    await flush(30)
    assert.match(container.innerHTML, /data-terrain-mode="normal"[^>]*aria-pressed="true"/)
    assert.match(container.innerHTML, /data-terrain-mode="mountain"[^>]*aria-pressed="false"/)
    assert.doesNotMatch(container.innerHTML, /Automatique/)
    assert.doesNotMatch(container.innerHTML, /Mixte/)
  } finally {
    db.close()
  }
})

test('AI: the creation wizard\'s Informations card carries name/date/vitesse together, matching the editor\'s own placement — never split across two different layouts', async () => {
  const db = await openTestDatabase()
  try {
    const container = createFakeContainer()
    initializeTripsManager(container, noopDeps(db))
    await flush()
    container.dispatch('click', { target: fakeActionElement({ action: 'create-trip' }) })
    await flush(30)
    const infoCardStart = container.innerHTML.indexOf('data-wizard-info')
    const infoCardEnd = container.innerHTML.indexOf('</section>', infoCardStart)
    const infoCard = container.innerHTML.slice(infoCardStart, infoCardEnd)
    assert.match(infoCard, /<p class="eyebrow">Informations<\/p>/)
    assert.match(infoCard, /Nom du voyage/)
    assert.match(infoCard, /Date de départ/)
    assert.match(infoCard, /Vitesse de référence/)
    assert.doesNotMatch(infoCard, /Terrain/, 'terrain stays in Réglages avancés, never duplicated into Informations')
  } finally {
    db.close()
  }
})
