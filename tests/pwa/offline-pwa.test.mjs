import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

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
  assert.match(source, /CACHE_PREFIX = 'bike-trip-dashboard-'/)
  assert.match(source, /CACHE_VERSION = '__CACHE_VERSION__'/)
  assert.match(source, /cache\.addAll\(PRECACHE_URLS\)/)
  assert.match(source, /name\.startsWith\(CACHE_PREFIX\) && name !== CACHE_NAME/)
  assert.match(source, /caches\.delete\(name\)/)
  assert.match(source, /requestUrl\.origin !== scopeUrl\.origin/)
  assert.match(source, /requestUrl\.pathname\.startsWith\(scopeUrl\.pathname\)/)
  assert.match(source, /request\.mode === 'navigate' && !isKnownResource/)
  assert.match(source, /RESOURCE_EXTENSION_PATTERN.*gpx.*json/)
  assert.match(source, /cachedShellResponse\(\)/)
  assert.doesNotMatch(source, /skipWaiting/)
  assert.doesNotMatch(source, /open-meteo|openstreetmap|tileLayer/i)

  const viteSource = readFileSync(projectFile('vite.config.ts'), 'utf8')
  assert.match(viteSource, /base: '\/bike-trip-dashboard\/'/)
  assert.match(viteSource, /fileName: 'sw\.js'/)
  assert.match(viteSource, /configResolved\(config\)[\s\S]*projectRoot = config\.root/)
  assert.match(viteSource, /hash\.update\(readFileSync\(resolve\(publicDir, resource\)\)\)/)
  assert.match(viteSource, /for \(const resource of allOfflineResources\)/)
  assert.match(viteSource, /collectOfflineResources\(publicDir\)/)
})

test('service worker registration respects the GitHub Pages base and bypasses HTTP caches', async () => {
  assert.equal(normalizeBaseUrl('bike-trip-dashboard'), '/bike-trip-dashboard/')
  assert.equal(getServiceWorkerUrl('/bike-trip-dashboard/'), '/bike-trip-dashboard/sw.js')
  let registrationCall = null
  const registration = { scope: '/bike-trip-dashboard/' }
  const serviceWorker = {
    async register(url, options) {
      registrationCall = { url, options }
      return registration
    },
  }

  assert.equal(
    await registerServiceWorker('/bike-trip-dashboard/', serviceWorker),
    registration,
  )
  assert.deepEqual(registrationCall, {
    url: '/bike-trip-dashboard/sw.js',
    options: {
      scope: '/bike-trip-dashboard/',
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

test('the running service worker never serves the app shell for a GPX, JSON, image or manifest request, even in navigate mode', async () => {
  const template = readFileSync(projectFile('scripts/service-worker.template.js'), 'utf8')
  const source = template
    .replace('__CACHE_VERSION__', 'test')
    .replace('__BUILD_ASSETS__', JSON.stringify(['assets/app.js']))
    .replace('__OFFLINE_RESOURCES__', JSON.stringify(['data/gpx/01_route-des-grandes-alpes.gpx', 'data/trip/roadbook.json']))

  const listeners = new Map()
  const fakeCache = {
    addAll: async () => {},
    match: async (urlOrRequest) => {
      const url = typeof urlOrRequest === 'string' ? urlOrRequest : urlOrRequest.url
      return { markerFor: url }
    },
  }
  const sandbox = {
    self: {
      registration: { scope: 'https://example.test/bike-trip-dashboard/' },
      addEventListener: (type, listener) => listeners.set(type, listener),
      clients: { claim: async () => {} },
    },
    caches: { open: async () => fakeCache, keys: async () => [], delete: async () => true },
    fetch: async () => { throw new Error('a real network fetch should never be needed for an already-cached resource in this test') },
    URL,
    Promise,
  }
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox)

  const fetchHandler = listeners.get('fetch')
  assert.equal(typeof fetchHandler, 'function')

  async function dispatch(pathname, mode) {
    let respondWithPromise = null
    const request = { method: 'GET', mode, url: `https://example.test/bike-trip-dashboard/${pathname}` }
    fetchHandler({ request, respondWith: (promise) => { respondWithPromise = promise } })
    return respondWithPromise === null ? null : respondWithPromise
  }

  const shellUrl = 'https://example.test/bike-trip-dashboard/'
  const gpxUrl = 'https://example.test/bike-trip-dashboard/data/gpx/01_route-des-grandes-alpes.gpx'
  const jsonUrl = 'https://example.test/bike-trip-dashboard/data/trip/roadbook.json'

  assert.deepEqual(await dispatch('', 'navigate'), { markerFor: shellUrl }, 'a real HTML navigation still gets the shell')
  assert.deepEqual(await dispatch('data/gpx/01_route-des-grandes-alpes.gpx', 'navigate'), { markerFor: gpxUrl }, 'a GPX requested in navigate mode must never receive the shell')
  assert.deepEqual(await dispatch('data/gpx/01_route-des-grandes-alpes.gpx', 'no-cors'), { markerFor: gpxUrl })
  assert.deepEqual(await dispatch('data/trip/roadbook.json', 'navigate'), { markerFor: jsonUrl })
  assert.equal(await dispatch('assets/some-unlisted-chunk.js', 'no-cors'), null, 'an unlisted same-origin asset falls through to the network unmodified')
})

test('the manifest is served network-first, self-healing a stale cached copy, and only falls back to cache when actually offline', async () => {
  // Stability hardening 2026-08-04: real-browser smoke testing observed a
  // "Manifest: Line 1, column 1, Syntax error" symptom consistent with an
  // old, not-yet-superseded service worker still serving a stale/bad cached
  // manifest response. Cache-first (the strategy used for every other
  // known resource) would keep doing that indefinitely; network-first for
  // the manifest specifically self-heals on the very next successful
  // request instead.
  const template = readFileSync(projectFile('scripts/service-worker.template.js'), 'utf8')
  const source = template
    .replace('__CACHE_VERSION__', 'test')
    .replace('__BUILD_ASSETS__', JSON.stringify(['assets/app.js']))
    .replace('__OFFLINE_RESOURCES__', JSON.stringify(['manifest.webmanifest']))

  const listeners = new Map()
  const stored = new Map()
  const fakeCache = {
    addAll: async () => {},
    match: async (urlOrRequest) => {
      const url = typeof urlOrRequest === 'string' ? urlOrRequest : urlOrRequest.url
      return stored.get(url) ?? undefined
    },
    put: async (urlOrRequest, response) => {
      const url = typeof urlOrRequest === 'string' ? urlOrRequest : urlOrRequest.url
      stored.set(url, response)
    },
  }
  function networkResponse(markerFor) {
    return { ok: true, status: 200, markerFor, clone: () => ({ markerFor }) }
  }
  let networkBehavior = () => networkResponse('fresh-network-response')
  const sandbox = {
    self: {
      registration: { scope: 'https://example.test/bike-trip-dashboard/' },
      addEventListener: (type, listener) => listeners.set(type, listener),
      clients: { claim: async () => {} },
    },
    caches: { open: async () => fakeCache, keys: async () => [], delete: async () => true },
    fetch: async () => networkBehavior(),
    Response: { error: () => ({ markerFor: 'network-error-response' }) },
    URL,
    Promise,
  }
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox)

  const fetchHandler = listeners.get('fetch')
  async function dispatchManifest() {
    let respondWithPromise = null
    const request = { method: 'GET', mode: 'no-cors', url: 'https://example.test/bike-trip-dashboard/manifest.webmanifest' }
    fetchHandler({ request, respondWith: (promise) => { respondWithPromise = promise } })
    return respondWithPromise
  }
  const manifestUrl = 'https://example.test/bike-trip-dashboard/manifest.webmanifest'

  // Online: always the fresh network response, and a clone of it gets cached for later.
  const first = await dispatchManifest()
  assert.equal(first.markerFor, 'fresh-network-response')
  assert.deepEqual(stored.get(manifestUrl), { markerFor: 'fresh-network-response' })

  // A later, DIFFERENT network response (e.g. a fixed manifest after a bad
  // one was previously cached) is served immediately — never masked by
  // whatever is sitting in the cache.
  networkBehavior = () => networkResponse('updated-network-response')
  const second = await dispatchManifest()
  assert.equal(second.markerFor, 'updated-network-response')
  assert.deepEqual(stored.get(manifestUrl), { markerFor: 'updated-network-response' })

  // Offline: falls back to whatever was last successfully cached, never a network error surfacing as a broken manifest.
  networkBehavior = () => { throw new Error('offline') }
  const third = await dispatchManifest()
  assert.deepEqual(third, { markerFor: 'updated-network-response' })
})

test('HTML installation metadata uses the Vite base placeholder and both mobile-web-app-capable metas', () => {
  const html = readFileSync(projectFile('index.html'), 'utf8')
  assert.match(html, /rel="manifest" href="%BASE_URL%manifest\.webmanifest"/)
  assert.match(html, /rel="apple-touch-icon" href="%BASE_URL%icons\/icon-192\.png"/)
  assert.match(html, /<meta name="mobile-web-app-capable" content="yes" \/>/)
  assert.match(html, /<meta name="apple-mobile-web-app-capable" content="yes" \/>/)
})

test('the Vite base path is declared exactly once and never contains a duplicated segment', () => {
  const viteSource = readFileSync(projectFile('vite.config.ts'), 'utf8')
  const matches = [...viteSource.matchAll(/base:\s*'([^']+)'/g)]
  assert.equal(matches.length, 1, 'vite.config.ts must declare `base` exactly once')
  const basePath = matches[0][1]
  const segments = basePath.split('/').filter((segment) => segment !== '')
  assert.equal(new Set(segments).size, segments.length, `base path segments must all be distinct, got "${basePath}"`)
})

test('a fresh production build never doubles the base path in the emitted HTML or manifest link', (t) => {
  const distIndexUrl = projectFile('dist/index.html')
  if (!existsSync(distIndexUrl)) {
    t.skip('dist/index.html is produced by `npm run build`, not guaranteed to exist before this test runs')
    return
  }
  const html = readFileSync(distIndexUrl, 'utf8')
  assert.doesNotMatch(html, /\/bike-trip-dashboard\/bike-trip-dashboard\//)
  assert.match(html, /href="\/bike-trip-dashboard\/manifest\.webmanifest"/)
  assert.match(html, /href="\/bike-trip-dashboard\/icons\/icon-192\.png"/)
})
