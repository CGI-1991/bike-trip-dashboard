import assert from 'node:assert/strict'
import test from 'node:test'

import { createOverpassPracticalPlacesProvider } from '../../src/practical-places/overpass-provider.ts'

const geometry = [
  { latitude: 45, longitude: 6, altitudeM: null },
  { latitude: 45.01, longitude: 6.01, altitudeM: null },
]

test('Overpass practical provider requests only the useful multi-category allow-list and normalizes nodes and way centers', async () => {
  const requests = []
  const diagnostics = []
  const provider = createOverpassPracticalPlacesProvider({
    minimumIntervalMs: 0,
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    fetchFn: async (url, init) => {
      requests.push({ url, init })
      return {
        ok: true,
        status: 200,
        async json() {
          return { elements: [
            { type: 'node', id: 1, lat: 45.001, lon: 6.001, tags: { amenity: 'drinking_water' } },
            { type: 'node', id: 2, lat: 45.002, lon: 6.002, tags: { shop: 'bakery', name: 'Le Pain' } },
            { type: 'node', id: 3, lat: 45.003, lon: 6.003, tags: { amenity: 'cafe', name: 'Café ignoré' } },
            { type: 'way', id: 4, center: { lat: 45.004, lon: 6.004 }, tags: { amenity: 'restaurant', name: 'Table', cuisine: 'regional' } },
            { type: 'node', id: 5, lat: 45.005, lon: 6.005, tags: { shop: 'convenience', name: 'Épicerie' } },
            { type: 'node', id: 6, lat: 45.006, lon: 6.006, tags: { shop: 'bicycle', name: 'Cycles' } },
            { type: 'node', id: 7, lat: 45.007, lon: 6.007, tags: { amenity: 'toilets', fee: 'no' } },
            { type: 'node', id: 8, lat: 45.008, lon: 6.008, tags: { tourism: 'museum', name: 'Hors périmètre' } },
            { type: 'node', id: 9, lat: 45.009, lon: 6.009, tags: { amenity: 'shelter' } },
            { type: 'node', id: 10, lat: 45.009, lon: 6.009, tags: { shop: 'sports', name: 'Sport Test' } },
            { type: 'node', id: 11, lat: 45.009, lon: 6.009, tags: { amenity: 'fast_food', name: 'Snack Test' } },
            { type: 'node', id: 12, lat: 45.009, lon: 6.009, tags: { amenity: 'bicycle_repair_station' } },
            { type: 'node', id: 13, lat: 45.009, lon: 6.009, tags: { shop: 'grocery', name: 'Épicerie Test' } },
          ] }
        },
      }
    },
  })

  const candidates = await provider.findCandidates({ geometry, radiusMeters: 300 })
  const query = requests[0].init.body.get('data')
  assert.match(query, /amenity~"\^\(drinking_water\|restaurant/)
  assert.match(query, /restaurant\|fast_food/)
  assert.match(query, /deli\|bicycle/)
  assert.match(query, /bicycle\|sports/)
  assert.doesNotMatch(query, /cafe/)
  assert.doesNotMatch(query, /around:/)
  assert.match(query, /nwr\(44\.9973\d+,5\.9961\d+,45\.0126\d+,6\.0138\d+\)/)
  assert.match(query, /\[timeout:10\]/)
  assert.match(query, /out body center;/)
  assert.doesNotMatch(query, /out center tags;/)
  assert.doesNotMatch(query, /tourism/)
  assert.deepEqual(candidates.map((candidate) => candidate.category), [
    'water', 'bakery', 'fast-food', 'supermarket', 'bike-service', 'toilet', 'shelter', 'sports', 'fast-food', 'bike-service', 'supermarket',
  ])
  assert.equal(candidates[0].name, null)
  assert.deepEqual(candidates[2].usefulTags, { amenity: 'restaurant', cuisine: 'regional' })
  assert.deepEqual({ latitude: candidates[2].latitude, longitude: candidates[2].longitude }, { latitude: 45.004, longitude: 6.004 })
  assert.deepEqual(diagnostics.map((diagnostic) => diagnostic.stage), ['request', 'response', 'parsed'])
  assert.equal(diagnostics[0].query, query)
  assert.equal(diagnostics[0].endpoint, 'https://overpass-api.de/api/interpreter')
  assert.equal(diagnostics[1].httpStatus, 200)
  assert.equal(diagnostics[2].rawElementCount, 13)
  assert.equal(diagnostics[2].parsedCandidateCount, 11)
})

test('Overpass practical provider rate-limits sequential searches', async () => {
  let clock = 0
  const delays = []
  const provider = createOverpassPracticalPlacesProvider({
    minimumIntervalMs: 1_100,
    nowMs: () => clock,
    sleep: async (milliseconds) => { delays.push(milliseconds); clock += milliseconds },
    fetchFn: async () => ({ ok: true, status: 200, json: async () => ({ elements: [] }) }),
  })
  await provider.findCandidates({ geometry, radiusMeters: 300 })
  await provider.findCandidates({ geometry, radiusMeters: 300 })
  assert.deepEqual(delays, [1_100])
})

test('Overpass practical provider retries a transient 504 without recording it as an empty success', async () => {
  let calls = 0
  const endpoints = []
  const diagnostics = []
  const provider = createOverpassPracticalPlacesProvider({
    baseUrls: ['https://endpoint-a.test/interpreter', 'https://endpoint-b.test/interpreter'],
    minimumIntervalMs: 0,
    retryBackoffMs: 1,
    sleep: async () => undefined,
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    fetchFn: async (url) => {
      endpoints.push(url)
      calls++
      if (calls === 1) return { ok: false, status: 504, json: async () => ({}) }
      return { ok: true, status: 200, json: async () => ({ elements: [{ type: 'node', id: 1, lat: 45, lon: 6, tags: { amenity: 'drinking_water' } }] }) }
    },
  })
  const result = await provider.findCandidates({ geometry, radiusMeters: 300 })
  assert.equal(calls, 2)
  assert.deepEqual(endpoints, ['https://endpoint-a.test/interpreter', 'https://endpoint-b.test/interpreter'])
  assert.equal(result.length, 1)
  assert.ok(diagnostics.some((diagnostic) => diagnostic.stage === 'retry' && diagnostic.httpStatus === 504))
})
