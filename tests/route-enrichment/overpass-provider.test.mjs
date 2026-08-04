import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOverpassRouteQuery, createOverpassRouteEnrichmentProvider } from '../../src/route-enrichment/overpass-provider.ts'

const geometry = [{ latitude: 45, longitude: 6, altitudeM: 100 }, { latitude: 45.1, longitude: 6.1, altitudeM: 500 }]

test('route queries keep landmarks and city/town/village separate and never request hamlets', () => {
  const localities = buildOverpassRouteQuery({ kind: 'localities', geometry, radiusMeters: 1_500 })
  const landmarks = buildOverpassRouteQuery({ kind: 'landmarks', geometry, radiusMeters: 500 })
  assert.match(localities, /city\|town\|village/)
  assert.doesNotMatch(localities, /hamlet/)
  assert.doesNotMatch(localities, /around:/)
  assert.match(localities, /nwr\(44\.9865\d+,5\.9809\d+,45\.1134\d+,6\.1190\d+\)/)
  assert.match(landmarks, /mountain_pass=yes/)
  assert.match(landmarks, /natural=saddle/)
  assert.match(landmarks, /natural=peak/)
  assert.doesNotMatch(landmarks, /around:/)
  assert.match(landmarks, /nwr\(44\.9955\d+,5\.9936\d+,45\.1044\d+,6\.1063\d+\)/)
  assert.match(localities, /\[timeout:10\]/)
  assert.match(landmarks, /out body center/)
})

for (const status of [504, 429]) {
  test(`a transient HTTP ${status} is retried and then succeeds`, async () => {
    let calls = 0
    const delays = []
    const endpoints = []
    const provider = createOverpassRouteEnrichmentProvider({
      baseUrls: ['https://endpoint-a.test/interpreter', 'https://endpoint-b.test/interpreter'],
      minimumIntervalMs: 0,
      retryBackoffMs: 10,
      sleep: async (milliseconds) => { delays.push(milliseconds) },
      fetchFn: async (url) => {
        endpoints.push(url)
        calls++
        if (calls === 1) return { ok: false, status, json: async () => ({}) }
        return { ok: true, status: 200, json: async () => ({ elements: [{ type: 'node', id: 1, lat: 45.05, lon: 6.05, tags: { place: 'town', name: 'Testville' } }] }) }
      },
    })
    const result = await provider.findCandidates({ kind: 'localities', geometry, radiusMeters: 1_500 })
    assert.equal(calls, 2)
    assert.deepEqual(endpoints, ['https://endpoint-a.test/interpreter', 'https://endpoint-b.test/interpreter'])
    assert.deepEqual(delays, [10])
    assert.equal(result[0].featureType, 'town')
  })
}

test('hamlet is ignored during parsing even if an unexpected provider response contains one', async () => {
  const provider = createOverpassRouteEnrichmentProvider({
    minimumIntervalMs: 0,
    fetchFn: async () => ({ ok: true, status: 200, json: async () => ({ elements: [
      { type: 'node', id: 1, lat: 45, lon: 6, tags: { place: 'hamlet', name: 'Petit lieu' } },
      { type: 'node', id: 2, lat: 45, lon: 6, tags: { place: 'village', name: 'Village' } },
    ] }) }),
  })
  const result = await provider.findCandidates({ kind: 'localities', geometry, radiusMeters: 1_500 })
  assert.deepEqual(result.map((candidate) => candidate.featureType), ['village'])
})

test('an AbortController timeout on endpoint A immediately fails over to endpoint B', async () => {
  const endpoints = []
  const abortedSignals = []
  const provider = createOverpassRouteEnrichmentProvider({
    baseUrls: ['https://endpoint-a.test/interpreter', 'https://endpoint-b.test/interpreter'],
    minimumIntervalMs: 0,
    requestTimeoutMs: 5,
    retryBackoffMs: 0,
    sleep: async () => undefined,
    fetchFn: async (url, init) => {
      endpoints.push(url)
      if (url.includes('endpoint-b')) return { ok: true, status: 200, json: async () => ({ elements: [] }) }
      return await new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          abortedSignals.push(init.signal.aborted)
          reject(new DOMException('Timed out', 'AbortError'))
        }, { once: true })
      })
    },
  })
  const result = await provider.findCandidates({ kind: 'localities', geometry, radiusMeters: 1_500 })
  assert.deepEqual(result, [])
  assert.deepEqual(endpoints, ['https://endpoint-a.test/interpreter', 'https://endpoint-b.test/interpreter'])
  assert.deepEqual(abortedSignals, [true])
})

test('two transient endpoint failures reject the chunk instead of becoming an empty success', async () => {
  const endpoints = []
  const provider = createOverpassRouteEnrichmentProvider({
    baseUrls: ['https://endpoint-a.test/interpreter', 'https://endpoint-b.test/interpreter'],
    minimumIntervalMs: 0,
    retryBackoffMs: 0,
    sleep: async () => undefined,
    fetchFn: async (url) => {
      endpoints.push(url)
      return { ok: false, status: 503, json: async () => ({}) }
    },
  })
  await assert.rejects(
    provider.findCandidates({ kind: 'localities', geometry, radiusMeters: 1_500 }),
    /503/,
  )
  assert.deepEqual(endpoints, ['https://endpoint-a.test/interpreter', 'https://endpoint-b.test/interpreter'])
})
