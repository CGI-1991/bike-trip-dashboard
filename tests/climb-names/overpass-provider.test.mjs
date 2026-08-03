import assert from 'node:assert/strict'
import test from 'node:test'

import { createOverpassClimbNameProvider } from '../../src/climb-names/overpass-provider.ts'

test('Overpass provider queries only named passes, saddles and peaks and normalizes their source', async () => {
  const requests = []
  const provider = createOverpassClimbNameProvider({
    minimumIntervalMs: 0,
    fetchFn: async (url, init) => {
      requests.push({ url, init })
      return {
        ok: true,
        status: 200,
        json: async () => ({ elements: [
          { type: 'node', id: 12, lat: 45.1, lon: 6.2, tags: { mountain_pass: 'yes', name: 'Pass Name', 'name:fr': 'Col Français', ele: '1 250' } },
          { type: 'node', id: 13, lat: 45.11, lon: 6.21, tags: { natural: 'peak', name: 'Sommet Test', ele: '1420' } },
          { type: 'node', id: 14, lat: 45.12, lon: 6.22, tags: { highway: 'primary', name: 'Route à ignorer' } },
        ] }),
      }
    },
  })

  const candidates = await provider.findCandidates({ coordinates: { latitude: 45.1, longitude: 6.2 }, elevationM: 1_250, radiusMeters: 500 })
  const query = requests[0].init.body.get('data')

  assert.match(query, /\[mountain_pass\]/)
  assert.match(query, /\[natural=saddle\]/)
  assert.match(query, /\[natural=peak\]/)
  assert.equal(candidates.length, 2)
  assert.deepEqual(candidates[0], {
    name: 'Col Français',
    featureType: 'mountain-pass',
    sourceId: 'overpass-osm:mountain-pass:node:12',
    coordinates: { latitude: 45.1, longitude: 6.2 },
    elevationM: 1_250,
  })
})

test('Overpass provider serializes calls with the shared OSM interval', async () => {
  let clock = 0
  const delays = []
  const provider = createOverpassClimbNameProvider({
    minimumIntervalMs: 1_100,
    nowMs: () => clock,
    sleep: async (milliseconds) => { delays.push(milliseconds); clock += milliseconds },
    fetchFn: async () => ({ ok: true, status: 200, json: async () => ({ elements: [] }) }),
  })
  const search = { coordinates: { latitude: 45, longitude: 6 }, elevationM: 1_000, radiusMeters: 500 }
  await provider.findCandidates(search)
  await provider.findCandidates(search)
  assert.deepEqual(delays, [1_100])
})
