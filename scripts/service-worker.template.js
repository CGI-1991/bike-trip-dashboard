const CACHE_PREFIX = 'rga-2026-'
const CACHE_VERSION = '__CACHE_VERSION__'
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_VERSION}`
const BUILD_ASSETS = __BUILD_ASSETS__
const OFFLINE_RESOURCES = __OFFLINE_RESOURCES__
const scopeUrl = new URL(self.registration.scope)
const scopedUrl = (path = '') => new URL(path, scopeUrl).href
const PRECACHE_URLS = [
  scopedUrl(),
  ...BUILD_ASSETS.map(scopedUrl),
  ...OFFLINE_RESOURCES.map(scopedUrl),
]
const PRECACHE_SET = new Set(PRECACHE_URLS)

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names
          .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
          .map((name) => caches.delete(name)),
      ))
      .then(() => self.clients.claim()),
  )
})

async function cachedShellResponse() {
  const cache = await caches.open(CACHE_NAME)
  return cache.match(scopedUrl())
}

async function cachedResourceResponse(url, request) {
  const cache = await caches.open(CACHE_NAME)
  return (await cache.match(url)) ?? fetch(request)
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const requestUrl = new URL(request.url)
  if (
    requestUrl.origin !== scopeUrl.origin ||
    !requestUrl.pathname.startsWith(scopeUrl.pathname)
  ) return

  if (request.mode === 'navigate') {
    event.respondWith(cachedShellResponse())
    return
  }

  requestUrl.search = ''
  if (PRECACHE_SET.has(requestUrl.href)) {
    event.respondWith(cachedResourceResponse(requestUrl.href, request))
  }
})
