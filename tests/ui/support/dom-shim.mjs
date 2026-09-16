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

// Two modules under test build a real element rather than a string:
// `src/ui/trips/trip-editor.ts::escapeHtml` uses a `<span>` and reads
// `.innerHTML` back off its own `.textContent`, and
// `trips-manager.ts::reportScheduleResolution` appends a `<p>` status line.
// A minimal stand-in for exactly those two, not a general `document` shim.
if (globalThis.document === undefined) {
  const SUPPORTED_TAGS = new Set(['span', 'p'])
  globalThis.document = {
    createElement(tagName) {
      if (!SUPPORTED_TAGS.has(tagName)) throw new Error(`dom-shim: document.createElement('${tagName}') is not supported — only ${[...SUPPORTED_TAGS].join('/')} are stubbed`)
      let text = ''
      const attributes = new Map()
      return {
        className: '',
        set textContent(value) { text = value },
        get textContent() { return text },
        setAttribute(name, value) { attributes.set(name, value) },
        getAttribute(name) { return attributes.get(name) ?? null },
        remove() {},
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
