import assert from 'node:assert/strict'
import test from 'node:test'

import { createNominatimGeocodingProvider, shortNominatimName } from '../../src/geocoding/nominatim-provider.ts'

test('Nominatim provider requests reverse JSON and returns a concise locality with OSM provenance', async () => {
  let requestedUrl = null
  const provider = createNominatimGeocodingProvider({
    minimumIntervalMs: 0,
    fetchFn: async (url) => {
      requestedUrl = new URL(url)
      return {
        ok: true,
        status: 200,
        json: async () => ({
          place_id: 10,
          osm_type: 'relation',
          osm_id: 20,
          display_name: 'Rue du Test, Quartier, Longue Province, Belgique',
          address: { road: 'Rue du Test', town: 'Ville Courte', country: 'Belgique' },
        }),
      }
    },
  })

  const result = await provider.reverse({ latitude: 50.123, longitude: 4.567 })

  assert.deepEqual(result, { name: 'Ville Courte', sourceId: 'nominatim:relation:20' })
  assert.equal(requestedUrl.origin + requestedUrl.pathname, 'https://nominatim.openstreetmap.org/reverse')
  assert.equal(requestedUrl.searchParams.get('lat'), '50.123')
  assert.equal(requestedUrl.searchParams.get('lon'), '4.567')
  assert.equal(requestedUrl.searchParams.get('layer'), 'address')
  assert.equal(requestedUrl.searchParams.get('accept-language'), 'fr')
})

test('short Nominatim names avoid verbose display addresses', () => {
  assert.equal(shortNominatimName({ address: { village: 'Petit-Lieu' }, display_name: 'Petit-Lieu, Canton, Région, Pays' }), 'Petit-Lieu')
  assert.equal(shortNominatimName({ address: { road: 'Route des Crêtes', county: 'Val de Test' } }), 'Route des Crêtes, Val de Test')
})
