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
