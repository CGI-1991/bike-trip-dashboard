// Minimal, purpose-built DOM shim shared by `tests/ui/*` — not a general
// jsdom replacement (this repo has no jsdom dependency). Only defines the
// global constructors a module under test uses for `instanceof` checks
// (`Element`/`HTMLElement`/`HTMLButtonElement`/`HTMLInputElement`/
// `HTMLSelectElement`/`HTMLTextAreaElement`). Idempotent — safe to import
// from more than one test file in the same process.
if (globalThis.Element === undefined) {
  globalThis.Element = class Element {}
  globalThis.HTMLElement = class HTMLElement extends globalThis.Element {}
  globalThis.HTMLInputElement = class HTMLInputElement extends globalThis.HTMLElement {}
  globalThis.HTMLSelectElement = class HTMLSelectElement extends globalThis.HTMLElement {}
  globalThis.HTMLButtonElement = class HTMLButtonElement extends globalThis.HTMLElement {}
  globalThis.HTMLTextAreaElement = class HTMLTextAreaElement extends globalThis.HTMLElement {}
  globalThis.HTMLDialogElement = class HTMLDialogElement extends globalThis.HTMLElement {}
}

// `CSS.escape` (used by `trips-manager.ts`'s own `[data-action="toggle-*"]`
// handlers to build an `id` selector from `aria-controls`) doesn't exist in
// plain Node. A minimal, spec-adjacent-enough polyfill for the simple
// ASCII/hyphenated ids this app ever generates — not a full CSSOM
// implementation.
if (globalThis.CSS === undefined) {
  globalThis.CSS = { escape: (value) => String(value).replaceAll(/([^a-zA-Z0-9_-])/g, '\\$1') }
}

// `src/ui/trips/trip-editor.ts::escapeHtml` builds a real `<span>` and reads
// `.innerHTML` back off its own `.textContent` assignment — the one render
// helper in `tests/ui/*` that needs an actual (if tiny) `document`, unlike
// every other UI module's manual string-replace `escapeHtml`. A minimal
// stand-in, scoped to exactly that one use, not a general `document` shim.
if (globalThis.document === undefined) {
  globalThis.document = {
    createElement(tagName) {
      if (tagName !== 'span') throw new Error(`dom-shim: document.createElement('${tagName}') is not supported — only 'span' (escapeHtml) is stubbed`)
      let text = ''
      return {
        set textContent(value) { text = value },
        get textContent() { return text },
        get innerHTML() {
          return text
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#039;')
        },
      }
    },
  }
}
