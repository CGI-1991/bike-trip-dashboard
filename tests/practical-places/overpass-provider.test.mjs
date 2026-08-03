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
            { type: 'node', id: 3, lat: 45.003, lon: 6.003, tags: { amenity: 'cafe', name: 'Café' } },
            { type: 'way', id: 4, center: { lat: 45.004, lon: 6.004 }, tags: { amenity: 'restaurant', name: 'Table', cuisine: 'regional' } },
            { type: 'node', id: 5, lat: 45.005, lon: 6.005, tags: { shop: 'convenience', name: 'Épicerie' } },
            { type: 'node', id: 6, lat: 45.006, lon: 6.006, tags: { shop: 'bicycle', name: 'Cycles' } },
            { type: 'node', id: 7, lat: 45.007, lon: 6.007, tags: { amenity: 'toilets', fee: 'no' } },
            { type: 'node', id: 8, lat: 45.008, lon: 6.008, tags: { tourism: 'museum', name: 'Hors périmètre' } },
          ] }
        },
      }
    },
  })

  const candidates = await provider.findCandidates({ geometry, radiusMeters: 300 })
  const query = requests[0].init.body.get('data')
  assert.match(query, /amenity~"\^\(drinking_water\|cafe/)
  assert.match(query, /restaurant\|fast_food/)
  assert.match(query, /deli\|bicycle/)
  assert.match(query, /out body center;/)
  assert.doesNotMatch(query, /out center tags;/)
  assert.doesNotMatch(query, /tourism/)
  assert.deepEqual(candidates.map((candidate) => candidate.category), [
    'water', 'bakery', 'cafe-or-ice-cream', 'fast-food', 'supermarket', 'bike-service', 'toilet',
  ])
  assert.equal(candidates[0].name, null)
  assert.deepEqual(candidates[3].usefulTags, { amenity: 'restaurant', cuisine: 'regional' })
  assert.deepEqual({ latitude: candidates[3].latitude, longitude: candidates[3].longitude }, { latitude: 45.004, longitude: 6.004 })
  assert.deepEqual(diagnostics.map((diagnostic) => diagnostic.stage), ['request', 'response', 'parsed'])
  assert.equal(diagnostics[0].query, query)
  assert.equal(diagnostics[0].endpoint, 'https://overpass-api.de/api/interpreter')
  assert.equal(diagnostics[1].httpStatus, 200)
  assert.equal(diagnostics[2].rawElementCount, 8)
  assert.equal(diagnostics[2].parsedCandidateCount, 7)
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
