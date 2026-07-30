const CACHE_PREFIX = 'bike-trip-dashboard-'
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

// GPX traces, JSON data, images, the manifest and its icons must always be
// served as themselves — never as the app shell — even when a browser (or an
// iOS "save file" flow) issues that request in navigate mode instead of a
// plain resource fetch.
const RESOURCE_EXTENSION_PATTERN = /\.(?:gpx|json|png|jpe?g|svg|webp|gif|ico|webmanifest)$/i

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const requestUrl = new URL(request.url)
  if (
    requestUrl.origin !== scopeUrl.origin ||
    !requestUrl.pathname.startsWith(scopeUrl.pathname)
  ) return

  requestUrl.search = ''
  const isKnownResource = PRECACHE_SET.has(requestUrl.href) || RESOURCE_EXTENSION_PATTERN.test(requestUrl.pathname)

  if (request.mode === 'navigate' && !isKnownResource) {
    event.respondWith(cachedShellResponse())
    return
  }

  if (isKnownResource) {
    event.respondWith(cachedResourceResponse(requestUrl.href, request))
  }
})
