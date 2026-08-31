import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildPostpassMultiPoint,
  buildPostpassPracticalPlacesQuery,
  createPostpassPracticalPlacesProvider,
  parsePostpassPracticalPlacesFeatureCollection,
  PRACTICAL_PLACES_ANCHOR_RADIUS_METERS,
  PRACTICAL_PLACES_CORRIDOR_RADIUS_METERS,
} from '../../src/practical-places/postpass-provider.ts'

const geometry = [
  { latitude: 45, longitude: 6, altitudeM: 100 },
  { latitude: 45.1, longitude: 6.2, altitudeM: 500 },
]
const anchors = [{ latitude: 45.05, longitude: 6.1 }, { latitude: 45.08, longitude: 6.15 }]

function search(overrides = {}) {
  return { stageId: 'stage-test', routeFingerprint: 'sha256:test', geometry, routeLengthKm: 62, anchors, corridorRadiusMeters: PRACTICAL_PLACES_CORRIDOR_RADIUS_METERS, anchorRadiusMeters: PRACTICAL_PLACES_ANCHOR_RADIUS_METERS, ...overrides }
}

function feature(properties, overrides = {}) {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [6.1, 45.05] },
    properties: { osm_type: 'N', osm_id: 42, ...properties },
    ...overrides,
  }
}

// --- SQL shape (CDC section 11-12) -----------------------------------------

test('exactly one query per stage: one corridor branch (500 m) and one anchor branch (800 m), combined with OR — never per-anchor', () => {
  const sql = buildPostpassPracticalPlacesQuery(search())
  assert.equal((sql.match(/\bWITH\b/g) ?? []).length, 1)
  assert.match(sql, /postpass_pointpolygon/)
  assert.match(sql, /ST_PointOnSurface/)
  assert.match(sql, /ST_DWithin\(source\.geom::geography, route\.geom::geography, 500\)/)
  assert.match(sql, /ST_DWithin\(source\.geom::geography, anchors\.geom::geography, 800\)/)
  assert.match(sql, /MULTIPOINT\(/)
  assert.match(buildPostpassMultiPoint(anchors), /^MULTIPOINT\(6\.1 45\.05,6\.15 45\.08\)$/)
})

test('SQL only ever selects the tag combinations C2 needs — never restaurant/fast_food/cafe/sports/greengrocer/deli', () => {
  const sql = buildPostpassPracticalPlacesQuery(search())
  assert.match(sql, /drinking_water/)
  assert.match(sql, /shelter/)
  assert.match(sql, /toilets/)
  assert.match(sql, /bicycle_repair_station/)
  assert.match(sql, /bicycle/)
  assert.match(sql, /bakery/)
  assert.match(sql, /supermarket/)
  assert.doesNotMatch(sql, /restaurant|fast_food|cafe|sports|greengrocer|deli/)
})

test('no anchors: the anchor branch and MULTIPOINT are dropped entirely, corridor categories still queried', () => {
  const sql = buildPostpassPracticalPlacesQuery(search({ anchors: [] }))
  assert.doesNotMatch(sql, /MULTIPOINT/)
  assert.doesNotMatch(sql, /anchors\.geom/)
  assert.match(sql, /ST_DWithin\(source\.geom::geography, route\.geom::geography, 500\)/)
})

test('requested tag columns cover everything CDC section 12 lists', () => {
  const sql = buildPostpassPracticalPlacesQuery(search())
  for (const column of ['name', 'amenity', 'shop', 'opening_hours', 'access', 'fee', 'operator', 'brand', 'website', 'phone', 'drinking_water', 'wheelchair']) {
    assert.match(sql, new RegExp(`tags->>'${column}'`), `missing column ${column}`)
  }
})

// --- Categorisation (CDC sections 4-9, tests A-M) ---------------------------

function parseOne(properties) {
  return parsePostpassPracticalPlacesFeatureCollection({ type: 'FeatureCollection', features: [feature(properties)] }).candidates[0]
}

test('C/D: shop=bicycle and bicycle_repair_station both map to bike-service', () => {
  assert.equal(parseOne({ shop: 'bicycle' }).category, 'bike-service')
  assert.equal(parseOne({ amenity: 'bicycle_repair_station' }).category, 'bike-service')
})

test('E: shop=sports is never even a candidate (excluded server-side, no client fallback)', () => {
  assert.equal(parseOne({ shop: 'sports' }), undefined)
})

test('F: supermarket/convenience/grocery all map to Supermarché', () => {
  for (const shop of ['supermarket', 'convenience', 'grocery']) assert.equal(parseOne({ shop }).category, 'supermarket')
})

test('G: greengrocer/deli are never candidates', () => {
  assert.equal(parseOne({ shop: 'greengrocer' }), undefined)
  assert.equal(parseOne({ shop: 'deli' }), undefined)
})

test('H: shop=bakery maps to Boulangerie', () => {
  assert.equal(parseOne({ shop: 'bakery' }).category, 'bakery')
})

test('I: amenity=drinking_water maps to Eau', () => {
  assert.equal(parseOne({ amenity: 'drinking_water' }).category, 'water')
})

test('J: a fountain is Eau only when drinking_water=yes is explicit', () => {
  assert.equal(parseOne({ amenity: 'fountain', drinking_water: 'yes' }).category, 'water')
  assert.equal(parseOne({ amenity: 'fountain' }), undefined)
  assert.equal(parseOne({ amenity: 'fountain', drinking_water: 'no' }), undefined)
})

test('K: amenity=shelter maps to Abris', () => {
  assert.equal(parseOne({ amenity: 'shelter' }).category, 'shelter')
})

test('L: amenity=toilets maps to Toilette', () => {
  assert.equal(parseOne({ amenity: 'toilets' }).category, 'toilet')
})

test('M: a toilet with access=private or access=no is dropped outright, not merely hidden', () => {
  assert.equal(parseOne({ amenity: 'toilets', access: 'private' }), undefined)
  assert.equal(parseOne({ amenity: 'toilets', access: 'no' }), undefined)
  // Unset/other access is never excluded automatically.
  assert.equal(parseOne({ amenity: 'toilets', access: 'yes' }).category, 'toilet')
  assert.equal(parseOne({ amenity: 'toilets' }).category, 'toilet')
})

test('useful tags carry only the allow-listed subset, mapped back to real OSM keys', () => {
  const candidate = parseOne({ amenity: 'toilets', access: 'yes', fee: 'yes', opening_hours: '24/7', wheelchair: 'yes', contact_website: 'https://example.test' })
  assert.deepEqual(candidate.usefulTags, { access: 'yes', fee: 'yes', opening_hours: '24/7', wheelchair: 'yes', 'contact:website': 'https://example.test' })
})

test('name resolution prefers the plain name tag; missing name is null, never fabricated', () => {
  assert.equal(parseOne({ amenity: 'drinking_water', name: 'Fontaine du Parc' }).name, 'Fontaine du Parc')
  assert.equal(parseOne({ amenity: 'drinking_water' }).name, null)
})

// --- Provider wiring (CDC section 2) ----------------------------------------

test('the provider issues exactly one POST per findCandidates call and reports the Postpass attribution', async () => {
  let requestCount = 0
  const provider = createPostpassPracticalPlacesProvider({
    fetchFn: async () => {
      requestCount++
      return {
        ok: true, status: 200,
        async json() { return { type: 'FeatureCollection', features: [feature({ amenity: 'drinking_water' })] } },
      }
    },
  })
  assert.equal(provider.id, 'postpass-practical-places')
  assert.match(provider.attribution, /OpenStreetMap contributors.*Postpass/)
  const result = await provider.findCandidates(search())
  assert.equal(requestCount, 1)
  assert.equal(result.candidates.length, 1)
  assert.equal(result.candidates[0].category, 'water')
})
