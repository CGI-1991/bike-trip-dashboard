import assert from 'node:assert/strict'
import test from 'node:test'

import { downloadGpx, renderGpxShareDialog, shareGpx } from '../../src/ui/gpx-share.ts'

function stubFetch(status, body = 'gpx-content') {
  const original = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: status >= 200 && status < 300,
    status,
    blob: async () => new Blob([body], { type: 'application/gpx+xml' }),
  })
  return () => { globalThis.fetch = original }
}

function fakeDocument() {
  const clicks = []
  return {
    body: { append() {} },
    createElement() {
      const anchor = { href: '', download: '', rel: '', click: () => clicks.push(anchor), remove: () => {} }
      return anchor
    },
    clicks,
  }
}

test('shareGpx uses navigator.share with a real GPX File when canShare reports true', async () => {
  const restore = stubFetch(200)
  const shared = []
  const nav = { canShare: () => true, share: async (data) => { shared.push(data) } }
  const result = await shareGpx({ url: '/data/gpx/J1.gpx', filename: 'J1-Thonon-Morzine.gpx' }, nav, fakeDocument())
  assert.equal(result, 'shared')
  assert.equal(shared.length, 1)
  assert.equal(shared[0].files[0].name, 'J1-Thonon-Morzine.gpx')
  assert.equal(shared[0].files[0].type, 'application/gpx+xml')
  restore()
})

test('a user-cancelled native share returns "cancelled" without falling back to a download', async () => {
  const restore = stubFetch(200)
  const doc = fakeDocument()
  const nav = { canShare: () => true, share: async () => { throw new DOMException('cancelled', 'AbortError') } }
  const result = await shareGpx({ url: '/data/gpx/J1.gpx', filename: 'J1.gpx' }, nav, doc)
  assert.equal(result, 'cancelled')
  assert.equal(doc.clicks.length, 0, 'no download must be triggered on a native cancel')
  restore()
})

test('shareGpx falls back to a direct download when file sharing is unsupported', async () => {
  const restore = stubFetch(200)
  const doc = fakeDocument()
  const result = await shareGpx({ url: '/data/gpx/J1.gpx', filename: 'J1.gpx' }, { canShare: () => false }, doc)
  assert.equal(result, 'downloaded')
  assert.equal(doc.clicks.length, 1)
  assert.equal(doc.clicks[0].download, 'J1.gpx')
  restore()
})

test('shareGpx falls back to a download when navigator.share itself fails for a reason other than an abort', async () => {
  const restore = stubFetch(200)
  const doc = fakeDocument()
  const nav = { canShare: () => true, share: async () => { throw new Error('boom') } }
  const result = await shareGpx({ url: '/data/gpx/J1.gpx', filename: 'J1.gpx' }, nav, doc)
  assert.equal(result, 'downloaded')
  assert.equal(doc.clicks.length, 1)
  restore()
})

test('downloadGpx always triggers a direct download, regardless of any share support', async () => {
  const restore = stubFetch(200)
  const doc = fakeDocument()
  await downloadGpx({ url: '/data/gpx/J1.gpx', filename: 'J1.gpx' }, doc)
  assert.equal(doc.clicks.length, 1)
  assert.equal(doc.clicks[0].download, 'J1.gpx')
  restore()
})

test('a failed GPX fetch throws a clear error instead of silently downloading nothing', async () => {
  const restore = stubFetch(404)
  await assert.rejects(() => downloadGpx({ url: '/data/gpx/missing.gpx', filename: 'J1.gpx' }, fakeDocument()), /404/)
  restore()
})

test('the GPX share dialog exposes Partager / enregistrer, Télécharger and a single top-right Fermer', () => {
  const html = renderGpxShareDialog()
  assert.match(html, /id="gpx-share-dialog"/)
  assert.match(html, /data-gpx-share-action[^>]*>Partager \/ enregistrer/)
  assert.match(html, /data-gpx-direct-download[^>]*>Télécharger/)
  assert.equal((html.match(/data-gpx-share-close/g) ?? []).length, 1, 'only the top-right Fermer control remains — the footer one was removed')
  const headerEnd = html.indexOf('</header>')
  assert.ok(html.indexOf('data-gpx-share-close') < headerEnd, 'the single Fermer control must be the one in the header')
})
