import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

import { offlineResources } from '../../scripts/offline-resources.mjs'
import {
  bindNetworkStatus,
  getServiceWorkerUrl,
  normalizeBaseUrl,
  registerServiceWorker,
  updateNetworkStatus,
} from '../../src/pwa.ts'

const rootUrl = new URL('../../', import.meta.url)

function projectFile(relativePath) {
  return new URL(relativePath, rootUrl)
}

test('the web manifest is base-safe, standalone and has installable PNG icons', () => {
  const manifest = JSON.parse(readFileSync(projectFile('public/manifest.webmanifest'), 'utf8'))
  assert.equal(manifest.id, './')
  assert.equal(manifest.start_url, './')
  assert.equal(manifest.scope, './')
  assert.equal(manifest.display, 'standalone')
  assert.equal(manifest.lang, 'fr')
  assert.match(manifest.theme_color, /^#[0-9a-f]{6}$/i)
  assert.match(manifest.background_color, /^#[0-9a-f]{6}$/i)
  assert.ok(manifest.categories.includes('travel'))

  const icons = new Map(manifest.icons.map((icon) => [`${icon.sizes}:${icon.purpose}`, icon]))
  assert.ok(icons.has('192x192:any'))
  assert.ok(icons.has('512x512:any'))
  assert.ok(icons.has('512x512:maskable'))

  for (const icon of manifest.icons) {
    const bytes = readFileSync(projectFile(`public/${icon.src}`))
    const [width, height] = icon.sizes.split('x').map(Number)
    assert.equal(bytes.subarray(1, 4).toString('ascii'), 'PNG')
    assert.equal(bytes.readUInt32BE(16), width)
    assert.equal(bytes.readUInt32BE(20), height)
  }
})

test('the offline inventory contains the shell data and exactly ten real GPX files', () => {
  const gpxResources = offlineResources.filter((resource) => resource.endsWith('.gpx'))
  assert.equal(gpxResources.length, 10)
  assert.deepEqual(
    offlineResources.filter((resource) => resource.startsWith('data/trip/')),
    [
      'data/trip/accommodations.json',
      'data/trip/roadbook.json',
      'data/trip/roadbook-overrides.json',
    ],
  )
  assert.ok(offlineResources.includes('data/gpx/manifest.json'))
  assert.ok(offlineResources.includes('manifest.webmanifest'))
  assert.ok(offlineResources.includes('data/practical/practical-points.json'))
  assert.ok(!offlineResources.includes('data/practical/rga-practical-points.kml'))

  for (const resource of offlineResources) {
    assert.doesNotMatch(resource, /^https?:|open-meteo|openstreetmap/i)
    assert.ok(existsSync(projectFile(`public/${resource}`)), `${resource} must exist`)
  }
})

test('the service worker is scoped, atomic and never intercepts external weather or map requests', () => {
  const source = readFileSync(projectFile('scripts/service-worker.template.js'), 'utf8')
  assert.match(source, /CACHE_PREFIX = 'rga-2026-'/)
  assert.match(source, /CACHE_VERSION = '__CACHE_VERSION__'/)
  assert.match(source, /cache\.addAll\(PRECACHE_URLS\)/)
  assert.match(source, /name\.startsWith\(CACHE_PREFIX\) && name !== CACHE_NAME/)
  assert.match(source, /caches\.delete\(name\)/)
  assert.match(source, /requestUrl\.origin !== scopeUrl\.origin/)
  assert.match(source, /requestUrl\.pathname\.startsWith\(scopeUrl\.pathname\)/)
  assert.match(source, /request\.mode === 'navigate'/)
  assert.match(source, /cachedShellResponse\(\)/)
  assert.doesNotMatch(source, /skipWaiting/)
  assert.doesNotMatch(source, /open-meteo|openstreetmap|tileLayer/i)

  const viteSource = readFileSync(projectFile('vite.config.ts'), 'utf8')
  assert.match(viteSource, /base: '\/rga-2026-dashboard\/'/)
  assert.match(viteSource, /fileName: 'sw\.js'/)
  assert.match(viteSource, /configResolved\(config\)[\s\S]*projectRoot = config\.root/)
  assert.match(viteSource, /hash\.update\(readFileSync\(resolve\(projectRoot, 'public', resource\)\)\)/)
  assert.match(viteSource, /for \(const resource of offlineResources\)/)
})

test('service worker registration respects the GitHub Pages base and bypasses HTTP caches', async () => {
  assert.equal(normalizeBaseUrl('rga-2026-dashboard'), '/rga-2026-dashboard/')
  assert.equal(getServiceWorkerUrl('/rga-2026-dashboard/'), '/rga-2026-dashboard/sw.js')
  let registrationCall = null
  const registration = { scope: '/rga-2026-dashboard/' }
  const serviceWorker = {
    async register(url, options) {
      registrationCall = { url, options }
      return registration
    },
  }

  assert.equal(
    await registerServiceWorker('/rga-2026-dashboard/', serviceWorker),
    registration,
  )
  assert.deepEqual(registrationCall, {
    url: '/rga-2026-dashboard/sw.js',
    options: {
      scope: '/rga-2026-dashboard/',
      updateViaCache: 'none',
    },
  })
})

test('the online state controls a discreet, reversible offline indicator', () => {
  const element = { hidden: false, textContent: '' }
  updateNetworkStatus(element, false)
  assert.equal(element.hidden, false)
  assert.match(element.textContent, /Mode hors ligne/)
  updateNetworkStatus(element, true)
  assert.equal(element.hidden, true)
  assert.equal(element.textContent, '')

  const listeners = new Map()
  const target = {
    navigator: { onLine: true },
    addEventListener(type, listener) {
      listeners.set(type, listener)
    },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type)
    },
  }
  const unbind = bindNetworkStatus(element, target)
  assert.equal(element.hidden, true)
  target.navigator.onLine = false
  listeners.get('offline')()
  assert.equal(element.hidden, false)
  unbind()
  assert.equal(listeners.size, 0)
})

test('HTML installation metadata uses the Vite base placeholder', () => {
  const html = readFileSync(projectFile('index.html'), 'utf8')
  assert.match(html, /rel="manifest" href="%BASE_URL%manifest\.webmanifest"/)
  assert.match(html, /rel="apple-touch-icon" href="%BASE_URL%icons\/icon-192\.png"/)
  assert.match(html, /apple-mobile-web-app-capable/)
})
