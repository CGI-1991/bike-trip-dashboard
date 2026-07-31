// A minimal `fetch` stand-in that serves files straight from this repo's
// `public/` directory, keyed by the request URL's pathname. Lets any loader
// built around `fetch` + a base URL (e.g. `loadRgaLegacyTrip`) run for real
// under `node --test`, without a network call and without Vite's
// `import.meta.env.BASE_URL` (undefined outside a Vite build/dev server).

import { readFile } from 'node:fs/promises'

/**
 * @param {URL} projectRoot - typically `new URL('../../', import.meta.url)` from the calling test file.
 * @returns {typeof fetch} a fetch-compatible function reading from `public/` under `projectRoot`.
 */
export function createFakePublicFetch(projectRoot) {
  return async (url) => {
    const relativePath = new URL(url).pathname.replace(/^\//, '')
    try {
      const body = await readFile(new URL(`public/${relativePath}`, projectRoot), 'utf8')
      return { ok: true, status: 200, json: async () => JSON.parse(body) }
    } catch {
      return { ok: false, status: 404, json: async () => { throw new Error('not found') } }
    }
  }
}

/** A base URL safe to pass alongside `createFakePublicFetch` — any absolute origin works, nothing is actually requested over the network. */
export const FAKE_PUBLIC_BASE_URL = 'https://example.test/'
