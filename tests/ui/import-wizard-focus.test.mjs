import assert from 'node:assert/strict'
import test from 'node:test'

// Minimal, purpose-built DOM shim — not a general jsdom replacement. Only
// defines what `import-wizard.ts` actually touches (`instanceof
// HTMLInputElement`/`Element`/`HTMLButtonElement` checks, `dataset`,
// `container.innerHTML`/`querySelector`, delegated `addEventListener` with
// an abort signal) so the *real* module under test runs unmodified.
if (globalThis.Element === undefined) {
  globalThis.Element = class Element {}
  globalThis.HTMLElement = class HTMLElement extends globalThis.Element {}
  globalThis.HTMLInputElement = class HTMLInputElement extends globalThis.HTMLElement {}
  globalThis.HTMLSelectElement = class HTMLSelectElement extends globalThis.HTMLElement {}
  globalThis.HTMLButtonElement = class HTMLButtonElement extends globalThis.HTMLElement {}
}

function createFakeContainer() {
  let innerHTMLValue = ''
  let setCount = 0
  const listeners = { input: [], change: [], click: [] }
  const submitButton = Object.assign(new globalThis.HTMLButtonElement(), { disabled: false })
  const reasonsList = { innerHTML: '' }

  return {
    get innerHTML() { return innerHTMLValue },
    set innerHTML(value) { innerHTMLValue = value; setCount++ },
    get innerHTMLSetCount() { return setCount },
    addEventListener(type, listener, options) {
      listeners[type].push(listener)
      options?.signal?.addEventListener?.('abort', () => {
        listeners[type] = listeners[type].filter((candidate) => candidate !== listener)
      })
    },
    dispatch(type, event) {
      for (const listener of [...listeners[type]]) listener(event)
    },
    querySelector(selector) {
      if (selector === '[data-action="submit"]') return submitButton
      if (selector === '[data-wizard-validation-reasons]') return reasonsList
      return null
    },
    submitButton,
    reasonsList,
  }
}

function fakeTextInput(field, value) {
  return Object.assign(new globalThis.HTMLInputElement(), { dataset: { field }, value })
}

const { createImportWizard } = await import('../../src/ui/trips/import-wizard.ts')

function noopDeps() {
  return { database: {}, now: () => '2028-08-04T10:00:00.000Z', idFactory: (() => { let n = 0; return () => `id-${n++}` })() }
}

test('typing in the name field never triggers a full re-render (innerHTML is only set once, at creation)', () => {
  const container = createFakeContainer()
  const wizard = createImportWizard(container, noopDeps(), () => {}, () => {})
  const initialSetCount = container.innerHTMLSetCount
  assert.equal(initialSetCount, 1, 'exactly one render at creation')

  for (const partial of ['V', 'Ve', 'Vel', 'Velo', 'Velo T', 'Velo Tour']) {
    container.dispatch('input', { target: fakeTextInput('name', partial) })
  }

  assert.equal(container.innerHTMLSetCount, initialSetCount, 'typing must never re-render the whole wizard (that is what drops focus/caret)')
  wizard.destroy()
})

test('typing in the start-date field is equally focus-safe', () => {
  const container = createFakeContainer()
  const wizard = createImportWizard(container, noopDeps(), () => {}, () => {})
  const initialSetCount = container.innerHTMLSetCount

  for (const partial of ['2', '20', '202', '2028', '2028-0', '2028-08', '2028-08-0', '2028-08-04']) {
    container.dispatch('input', { target: fakeTextInput('start-date', partial) })
  }

  assert.equal(container.innerHTMLSetCount, initialSetCount)
  wizard.destroy()
})

test('the name field is tracked correctly across keystrokes: the "name required" validation reason clears once non-empty', () => {
  const container = createFakeContainer()
  const wizard = createImportWizard(container, noopDeps(), () => {}, () => {})

  // `updateValidationUI` only runs on an actual `input` event — the very
  // first dispatch (an empty name) is what first populates the fake
  // `reasonsList` node in this test harness, matching "the field is still
  // empty" as its baseline.
  container.dispatch('input', { target: fakeTextInput('name', '') })
  assert.match(container.reasonsList.innerHTML, /nom du voyage est requis/i)

  for (const partial of ['V', 'Ve', 'Vel', 'Velo']) {
    container.dispatch('input', { target: fakeTextInput('name', partial) })
  }

  assert.doesNotMatch(container.reasonsList.innerHTML, /nom du voyage est requis/i, 'no character must be lost — the accumulated name must read as non-empty')
  assert.match(container.reasonsList.innerHTML, /date de départ est requise/i, 'other, still-unmet requirements stay reported')
  wizard.destroy()
})

test('the submit button stays disabled while required fields are missing, and updates without a full re-render', () => {
  const container = createFakeContainer()
  const wizard = createImportWizard(container, noopDeps(), () => {}, () => {})

  container.dispatch('input', { target: fakeTextInput('name', 'Velo Tour') })
  container.dispatch('input', { target: fakeTextInput('start-date', '2028-08-04') })

  // Still disabled (no GPX yet) — but this was computed via the lightweight
  // path, not a full render.
  assert.equal(container.submitButton.disabled, true)
  assert.equal(container.innerHTMLSetCount, 1)
  wizard.destroy()
})

test('destroy() removes the wizard\'s listeners — further input events are ignored', () => {
  const container = createFakeContainer()
  const wizard = createImportWizard(container, noopDeps(), () => {}, () => {})
  container.dispatch('input', { target: fakeTextInput('name', '') })
  assert.match(container.reasonsList.innerHTML, /nom du voyage est requis/i)
  wizard.destroy()

  container.dispatch('input', { target: fakeTextInput('name', 'Velo Tour') })

  // If the listener were still live, a non-empty name would clear this
  // reason — after destroy(), the event must be a complete no-op.
  assert.match(container.reasonsList.innerHTML, /nom du voyage est requis/i)
})
