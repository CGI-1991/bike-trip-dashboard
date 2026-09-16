import { installMinimalDOMParser } from '../support/minimal-dom-parser.mjs'
import './support/dom-shim.mjs'
import '../storage/indexeddb/support/setup-fake-indexeddb.mjs'

import assert from 'node:assert/strict'
import test from 'node:test'

import { buildGpxXml, toGpxImportFile } from '../import/gpx/support/fixtures.mjs'
import { runImport } from '../import/gpx/support/run-import.mjs'
import { createTripRepository } from '../../src/storage/indexeddb/trip-repository.ts'
import { validateTripBundle } from '../../src/trip-core/index.ts'

installMinimalDOMParser()

// `setRaceMode`/`recalculate` reach for the platform's own confirmation.
if (globalThis.window === undefined) globalThis.window = {}
globalThis.window.confirm = () => true

const { createTripEditor } = await import('../../src/ui/trips/trip-editor.ts')

/** A short, straight, gently climbing track — enough for the analysis pipeline to produce a real stage. */
function stageFile(index) {
  const points = Array.from({ length: 12 }, (_value, step) => ({
    lat: 45 + index * 0.1 + step * 0.004,
    lon: 6 + index * 0.1 + step * 0.004,
    ele: 200 + step * 8,
  }))
  return toGpxImportFile(buildGpxXml({ tracks: [{ name: `Étape ${index + 1}`, segments: [points] }] }), `stage-${index + 1}.gpx`)
}

/**
 * The smallest container the editor actually touches: one `innerHTML`
 * sink, delegated listeners, and a `querySelector` that only has to answer
 * for the few nodes the editor patches in place.
 */
function createFakeContainer() {
  const listeners = { click: [], input: [], change: [] }
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
    register(selector, node) { nodes.set(selector, node) },
  }
}

/** A click target whose `closest` answers for its own `data-action`/`data-editor-action`. */
function clickTarget(dataset) {
  const element = Object.assign(new globalThis.HTMLButtonElement(), { dataset })
  element.closest = (selector) => {
    const match = /^\[([a-z-]+)="([^"]+)"\]$/.exec(selector)
    if (match !== null) {
      const key = match[1].replace(/^data-/, '').replace(/-([a-z])/g, (_all, letter) => letter.toUpperCase())
      return dataset[key] === match[2] ? element : null
    }
    if (selector === '[data-editor-action]') return dataset.editorAction !== undefined ? element : null
    return null
  }
  return element
}

function inputTarget(field, value, position) {
  return Object.assign(new globalThis.HTMLInputElement(), {
    dataset: position === undefined ? { editorField: field } : { editorField: field, position: String(position) },
    value,
  })
}

/**
 * Waits for a condition instead of sleeping a fixed amount: the editor's own
 * work (loading a draft, re-analysing GPX, an atomic save) is async but
 * bounded, and a timer long enough to be safe under parallel test load would
 * slow every one of these tests down for nothing.
 */
async function waitFor(predicate, what) {
  for (let attempt = 0; attempt < 600; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`waitFor: ${what}`)
}

/** Lets the currently-queued async work drain, for the cases where the expected outcome is "nothing happened". */
async function settle() {
  for (let turn = 0; turn < 12; turn++) await new Promise((resolve) => setTimeout(resolve, 0))
}

async function openEditor(database, tripId) {
  const container = createFakeContainer()
  const saved = []
  const editor = createTripEditor(
    container,
    { database, now: () => '2028-01-02T00:00:00.000Z', idFactory: (() => { let n = 0; return () => `editor-id-${n++}` })() },
    tripId,
    (bundle) => saved.push(bundle),
    () => {},
  )
  await waitFor(() => container.innerHTML.includes('data-trip-editor'), 'the editor finished loading its draft')
  return { container, editor, saved }
}

async function importThreeStageTrip() {
  const { result, database } = await runImport([stageFile(0), stageFile(1), stageFile(2)], {
    startDate: '2028-06-01',
    timezone: 'Europe/Brussels',
  })
  assert.equal(result.ok, true, result.ok ? '' : result.error?.message)
  return { bundle: result.bundle, database }
}

test('the structure list offers a stage-name field per étape, and no chain button outside Course/Tour', async () => {
  const { bundle, database } = await importThreeStageTrip()
  try {
    const { container, editor } = await openEditor(database, bundle.metadata.id)
    assert.equal((container.innerHTML.match(/data-editor-field='stage-name'/g) ?? []).length, 3)
    assert.doesNotMatch(container.innerHTML, /data-editor-action="link-stage"/, 'linking is a Course/Tour affordance only')
    editor.destroy()
  } finally {
    database.close()
  }
})

test('Course/Tour reveals the chain buttons, and linking groups the two blocks together', async () => {
  const { bundle, database } = await importThreeStageTrip()
  try {
    const { container, editor } = await openEditor(database, bundle.metadata.id)

    container.dispatch('click', { target: clickTarget({ action: 'set-race-mode', raceMode: 'on' }) })
    assert.equal((container.innerHTML.match(/data-editor-action="link-stage"/g) ?? []).length, 2, 'one between each pair of consecutive stages')

    container.dispatch('click', { target: clickTarget({ editorAction: 'link-stage', position: '1' }) })
    await waitFor(() => container.innerHTML.includes('wizard-structure__group'), 'the group container appeared')
    assert.match(container.innerHTML, /wizard-structure__group/)
    assert.match(container.innerHTML, /Même journée — 2 étapes/)
    assert.match(container.innerHTML, /data-editor-action="unlink-stage" data-position="1"/)
    editor.destroy()
  } finally {
    database.close()
  }
})

test('saving a linked pair persists one shared date, shifts the rest of the planning, and stays valid', async () => {
  const { bundle, database } = await importThreeStageTrip()
  try {
    const { container, editor, saved } = await openEditor(database, bundle.metadata.id)
    const originalDayIds = bundle.days.map((day) => day.id)

    container.dispatch('click', { target: clickTarget({ action: 'set-race-mode', raceMode: 'on' }) })
    container.dispatch('click', { target: clickTarget({ editorAction: 'link-stage', position: '1' }) })
    await waitFor(() => container.innerHTML.includes('wizard-structure__group'), 'the link was created')
    container.dispatch('input', { target: inputTarget('stage-name', '  Étape reine  ', 0) })
    container.dispatch('click', { target: clickTarget({ editorAction: 'save' }) })
    await waitFor(() => saved.length === 1, 'the save completed')
    const stored = await createTripRepository(database).loadTripBundle(bundle.metadata.id)
    assert.equal(validateTripBundle(stored).ok, true)

    assert.deepEqual(stored.days.map((day) => day.id), originalDayIds, 'retained days keep their identity')
    assert.deepEqual(stored.days.map((day) => day.date), ['2028-06-01', '2028-06-01', '2028-06-02'])
    assert.equal(stored.calendar.endDate, '2028-06-02')
    assert.equal(stored.days[1].sameCalendarDayAsPrevious, true)
    assert.equal(stored.days[2].sameCalendarDayAsPrevious, undefined)

    assert.equal(stored.settings.global.raceMode, true)
    assert.ok(stored.stages.every((stage) => stage.pauseDurationSeconds === 0), 'no in-stage pause survives Course/Tour')

    const firstStage = stored.stages.find((stage) => stage.dayId === stored.days[0].id)
    assert.equal(firstStage.customName, 'Étape reine', 'trimmed, and stored on the stage itself')
    assert.notEqual(firstStage.startLocationName, 'Étape reine', 'the name never touches the start/end places')

    // The second stage of the group was given a coherent departure time
    // rather than keeping the trip-wide default.
    const secondDeparture = stored.settings.days.find((entry) => entry.dayId === stored.days[1].id).departureTime
    assert.notEqual(secondDeparture, '08:00')
    assert.match(secondDeparture, /^([01]\d|2[0-3]):[0-5]\d$/)
    assert.equal(secondDeparture.endsWith('00') || secondDeparture.endsWith('15') || secondDeparture.endsWith('30') || secondDeparture.endsWith('45'), true, 'rounded up to a quarter-hour')
    editor.destroy()
  } finally {
    database.close()
  }
})

test('linking then unlinking in the same session leaves nothing to save — a genuine no-op stays a no-op', async () => {
  const { bundle, database } = await importThreeStageTrip()
  try {
    const { container, editor, saved } = await openEditor(database, bundle.metadata.id)
    container.dispatch('click', { target: clickTarget({ action: 'set-race-mode', raceMode: 'on' }) })
    container.dispatch('click', { target: clickTarget({ editorAction: 'link-stage', position: '1' }) })
    await waitFor(() => container.innerHTML.includes('wizard-structure__group'), 'the link was created')
    container.dispatch('click', { target: clickTarget({ action: 'set-race-mode', raceMode: 'off' }) })
    assert.doesNotMatch(container.innerHTML, /wizard-structure__group/, 'the group is gone with the mode')

    container.dispatch('click', { target: clickTarget({ editorAction: 'save' }) })
    await settle()
    assert.equal(saved.length, 0, 'back exactly where it started: nothing to write')
    editor.destroy()
  } finally {
    database.close()
  }
})

test('leaving Course/Tour on a SAVED trip separates the linked stages and gives each its own day back', async () => {
  const { bundle, database } = await importThreeStageTrip()
  try {
    const first = await openEditor(database, bundle.metadata.id)
    first.container.dispatch('click', { target: clickTarget({ action: 'set-race-mode', raceMode: 'on' }) })
    first.container.dispatch('click', { target: clickTarget({ editorAction: 'link-stage', position: '1' }) })
    await waitFor(() => first.container.innerHTML.includes('wizard-structure__group'), 'the link was created')
    first.container.dispatch('click', { target: clickTarget({ editorAction: 'save' }) })
    await waitFor(() => first.saved.length === 1, 'the first save completed')
    first.editor.destroy()

    const second = await openEditor(database, bundle.metadata.id)
    assert.match(second.container.innerHTML, /wizard-structure__group/, 'the saved group is shown again on reopen')
    second.container.dispatch('click', { target: clickTarget({ action: 'set-race-mode', raceMode: 'off' }) })
    second.container.dispatch('click', { target: clickTarget({ editorAction: 'save' }) })
    await waitFor(() => second.saved.length === 1, 'the second save completed')

    const stored = await createTripRepository(database).loadTripBundle(bundle.metadata.id)
    assert.equal(validateTripBundle(stored).ok, true)
    assert.deepEqual(stored.days.map((day) => day.date), ['2028-06-01', '2028-06-02', '2028-06-03'])
    assert.ok(stored.days.every((day) => day.sameCalendarDayAsPrevious === undefined))
    assert.equal(stored.settings.global.raceMode, false)
    second.editor.destroy()
  } finally {
    database.close()
  }
})

test('the detection sensitivity picked in the editor is saved with the trip', async () => {
  const { bundle, database } = await importThreeStageTrip()
  try {
    const { container, editor, saved } = await openEditor(database, bundle.metadata.id)
    // Slider position 4 is the most sensitive step ("Pays plat").
    container.dispatch('input', { target: inputTarget('climb-sensitivity', '4') })
    container.dispatch('click', { target: clickTarget({ editorAction: 'save' }) })
    await waitFor(() => saved.length === 1, 'the save completed')
    const stored = await createTripRepository(database).loadTripBundle(bundle.metadata.id)
    assert.equal(stored.settings.global.climbDetectionSensitivity, 'flat')
    assert.equal(validateTripBundle(stored).ok, true)
    editor.destroy()
  } finally {
    database.close()
  }
})
