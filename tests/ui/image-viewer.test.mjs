import assert from 'node:assert/strict'
import test from 'node:test'

import { openImageViewer, renderImageViewerDialog } from '../../src/ui/image-viewer.ts'

function fakeDialog() {
  const elements = {
    '[data-image-viewer-title]': { textContent: '' },
    '[data-image-viewer-source]': { textContent: '' },
    '[data-image-viewer-image]': { hidden: false, alt: '', src: '', onerror: null },
    '[data-image-viewer-error]': { hidden: true },
    '[data-image-viewer-open-external]': { href: '' },
  }
  let showModalCalls = 0
  return {
    elements,
    get showModalCalls() { return showModalCalls },
    querySelector: (selector) => elements[selector] ?? null,
    showModal: () => { showModalCalls++ },
  }
}

test('openImageViewer fills the title, source, image src/alt and external-open link, then opens modally', () => {
  const dialog = fakeDialog()
  openImageViewer(dialog, { title: 'Col du Feu', imageUrl: 'https://example.test/col-du-feu.jpg', sourceLabel: 'Alpes4ever' })
  assert.equal(dialog.elements['[data-image-viewer-title]'].textContent, 'Col du Feu')
  assert.equal(dialog.elements['[data-image-viewer-source]'].textContent, 'Alpes4ever')
  assert.equal(dialog.elements['[data-image-viewer-image]'].src, 'https://example.test/col-du-feu.jpg')
  assert.match(dialog.elements['[data-image-viewer-image]'].alt, /Col du Feu/)
  assert.equal(dialog.elements['[data-image-viewer-image]'].hidden, false)
  assert.equal(dialog.elements['[data-image-viewer-error]'].hidden, true)
  assert.equal(dialog.elements['[data-image-viewer-open-external]'].href, 'https://example.test/col-du-feu.jpg')
  assert.equal(dialog.showModalCalls, 1)
})

test('a failed image load hides the image and reveals the fallback message, while "Ouvrir dans le navigateur" keeps working', () => {
  const dialog = fakeDialog()
  openImageViewer(dialog, { title: 'Col du Feu', imageUrl: 'https://example.test/col-du-feu.jpg', sourceLabel: 'Alpes4ever' })
  dialog.elements['[data-image-viewer-image]'].onerror()
  assert.equal(dialog.elements['[data-image-viewer-image]'].hidden, true)
  assert.equal(dialog.elements['[data-image-viewer-error]'].hidden, false)
  assert.equal(dialog.elements['[data-image-viewer-open-external]'].href, 'https://example.test/col-du-feu.jpg')
})

test('re-opening the viewer for a different col resets any previous error state', () => {
  const dialog = fakeDialog()
  openImageViewer(dialog, { title: 'Col A', imageUrl: 'https://example.test/a.jpg', sourceLabel: 'Source A' })
  dialog.elements['[data-image-viewer-image]'].onerror()
  assert.equal(dialog.elements['[data-image-viewer-error]'].hidden, false)

  openImageViewer(dialog, { title: 'Col B', imageUrl: 'https://example.test/b.jpg', sourceLabel: 'Source B' })
  assert.equal(dialog.elements['[data-image-viewer-error]'].hidden, true)
  assert.equal(dialog.elements['[data-image-viewer-image]'].hidden, false)
  assert.equal(dialog.elements['[data-image-viewer-title]'].textContent, 'Col B')
})

test('the dialog markup wires a single top-right close, external-open (noopener noreferrer) and error-fallback affordances', () => {
  const html = renderImageViewerDialog()
  assert.match(html, /id="image-viewer-dialog"/)
  assert.match(html, /data-image-viewer-open-external[^>]*target="_blank"[^>]*rel="noopener noreferrer"/)
  assert.match(html, /data-image-viewer-error[^>]*hidden/)
  assert.equal((html.match(/data-image-viewer-close/g) ?? []).length, 1, 'only the top-right Fermer control remains — the footer one was removed')
  const headerEnd = html.indexOf('</header>')
  assert.ok(html.indexOf('data-image-viewer-close') < headerEnd, 'the single Fermer control must be the one in the header')
  const footerMatch = /<footer>([^]*?)<\/footer>/.exec(html)
  assert.ok(footerMatch)
  assert.doesNotMatch(footerMatch[1], /data-image-viewer-close/, 'the footer must keep only "Ouvrir dans le navigateur"')
  assert.doesNotMatch(html, /<iframe/i)
})
