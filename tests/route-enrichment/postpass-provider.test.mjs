import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildPostpassLineString,
  buildPostpassStructuralQuery,
  createPostpassRouteEnrichmentProvider,
  DEFAULT_POSTPASS_TIMEOUT_MS,
  parsePostpassFeatureCollection,
  POSTPASS_LANDMARK_BBOX_EXPAND_DEGREES,
  POSTPASS_LOCALITY_BBOX_EXPAND_DEGREES,
} from '../../src/route-enrichment/postpass-provider.ts'
import {
  STRUCTURAL_LANDMARK_COLLECTION_RADIUS_METERS,
  STRUCTURAL_LOCALITY_COLLECTION_RADIUS_METERS,
} from '../../src/route-enrichment/types.ts'

const geometry = [
  { latitude: 45, longitude: 6, altitudeM: 100 },
  { latitude: 45.1, longitude: 6.2, altitudeM: 500 },
]

function search(overrides = {}) {
  return {
    stageId: 'stage-test', routeFingerprint: 'sha256:test', geometry, routeLengthKm: 120,
    localityCollectionRadiusMeters: STRUCTURAL_LOCALITY_COLLECTION_RADIUS_METERS,
    landmarkCollectionRadiusMeters: STRUCTURAL_LANDMARK_COLLECTION_RADIUS_METERS,
    ...overrides,
  }
}

function feature(featureType, overrides = {}) {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [6.1, 45.05] },
    properties: {
      osm_type: 'N', osm_id: 42, name: `Name ${featureType}`, elevation: featureType === 'mountain-pass' ? '1234' : null,
      feature_type: featureType,
    },
    ...overrides,
  }
}

test('SQL builds one numeric LINESTRING query for city/town/village/mountain_pass/saddle only — V1 final scope', () => {
  const hostile = "stage'; DROP TABLE postpass_point; --"
  const sql = buildPostpassStructuralQuery(search({ stageId: hostile, routeFingerprint: hostile }))
  assert.match(buildPostpassLineString(geometry), /^LINESTRING\(6 45,6\.2 45\.1\)$/)
  assert.match(sql, /ST_GeomFromText\('LINESTRING\(6 45,6\.2 45\.1\)', 4326\)/)
  assert.match(sql, /postpass_pointpolygon/)
  assert.match(sql, /ST_PointOnSurface/)
  assert.match(sql, /source\.geom && ST_Expand/)
  assert.match(sql, /ST_Expand\(route\.geom, 0\.04\)/)
  assert.match(sql, /ST_Expand\(route\.geom, 0\.01\)/)
  assert.match(sql, /ST_DWithin\(source\.geom::geography, route\.geom::geography, 1800\)/)
  assert.match(sql, /ST_DWithin\(source\.geom::geography, route\.geom::geography, 500\)/)
  assert.match(sql, /'city'/)
  assert.match(sql, /'town'/)
  assert.match(sql, /'village'/)
  assert.match(sql, /'mountain_pass'/)
  assert.match(sql, /'saddle'/)
  // Stability/UX hardening 2026-08-04: hamlet/peak definitively dropped —
  // never searched, never stored, never displayed, never used as a pause anchor.
  assert.doesNotMatch(sql, /'hamlet'|'peak'/)
  assert.doesNotMatch(sql, /drinking_water|shelter|toilets|restaurant|shop|bicycle|sports/)
  assert.doesNotMatch(sql, /DROP TABLE/)
  assert.doesNotMatch(sql, /;\s*$/)
})

test('exactly one Postpass query per stage, regardless of route length (no chunking for the V1 final, reduced scope)', () => {
  const sql = buildPostpassStructuralQuery(search())
  assert.equal((sql.match(/\bWITH\b/g) ?? []).length, 1, 'a single WITH ... candidates CTE — never split into multiple queries')
})

test('bbox preselection remains wider than collection radii at 60 degrees latitude', () => {
  const conservativeLongitudeMetersPerDegree = 111_320 * Math.cos(60 * Math.PI / 180)
  assert.ok(POSTPASS_LOCALITY_BBOX_EXPAND_DEGREES * conservativeLongitudeMetersPerDegree > STRUCTURAL_LOCALITY_COLLECTION_RADIUS_METERS)
  assert.ok(POSTPASS_LANDMARK_BBOX_EXPAND_DEGREES * conservativeLongitudeMetersPerDegree > STRUCTURAL_LANDMARK_COLLECTION_RADIUS_METERS)
})

test('LINESTRING rejects non-numeric or out-of-range GPX coordinates', () => {
  assert.throws(() => buildPostpassLineString([{ latitude: 45, longitude: 6 }, { latitude: Number.NaN, longitude: 7 }]), /invalide/)
  assert.throws(() => buildPostpassLineString([{ latitude: 45, longitude: 6 }, { latitude: 91, longitude: 7 }]), /invalide/)
})

test('GeoJSON parsing keeps city, town, village, mountain-pass and saddle with OSM identity and elevation — hamlet/peak are never even parsed', () => {
  const parsed = parsePostpassFeatureCollection({
    type: 'FeatureCollection',
    features: [
      feature('city'),
      feature('town', { properties: { osm_type: 'W', osm_id: '43', name: 'Town', elevation: null, feature_type: 'town' } }),
      feature('mountain-pass'),
      feature('saddle'),
      feature('village'),
      feature('hamlet'),
      feature('peak'),
      feature(undefined, { properties: { osm_type: 'N', osm_id: 99, name: 'Unknown', elevation: null, feature_type: 'shelter' } }),
    ],
  })
  assert.equal(parsed.rawCandidateCount, 8)
  assert.deepEqual(parsed.candidates.map((candidate) => candidate.featureType), ['city', 'town', 'mountain-pass', 'saddle', 'village'])
  assert.deepEqual(parsed.candidates.map((candidate) => candidate.osmType), ['node', 'way', 'node', 'node', 'node'])
  assert.equal(parsed.candidates[2].elevationM, 1234)
})

test('provider performs exactly one POST and returns parsed diagnostics', async () => {
  const requests = []
  const diagnostics = []
  let tick = 100
  const provider = createPostpassRouteEnrichmentProvider({
    now: () => '2028-08-03T10:00:00.000Z',
    nowMs: () => tick += 5,
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    fetchFn: async (url, init) => {
      requests.push({ url, init })
      return { ok: true, status: 200, async json() { return { type: 'FeatureCollection', features: [feature('city'), feature('saddle')] } } }
    },
  })
  const result = await provider.findStructuralCandidates(search())
  assert.equal(requests.length, 1)
  assert.equal(requests[0].init.method, 'POST')
  assert.match(String(requests[0].init.body), /^data=/)
  assert.equal(result.rawCandidateCount, 2)
  assert.deepEqual(result.candidates.map((candidate) => candidate.featureType), ['city', 'saddle'])
  assert.deepEqual(diagnostics.map((diagnostic) => diagnostic.stage), ['request', 'response', 'parsed'])
  assert.deepEqual(diagnostics.at(-1).counts, { city: 1, town: 0, village: 0, 'mountain-pass': 0, saddle: 1 })
})

test('the default timeout leaves real-world margin above what browser smoke-testing observed (~15s aborts)', () => {
  // Stability hardening 2026-08-04: real-browser smoke testing observed
  // requests aborting right at the previous 15_000 ms ceiling — too tight
  // a margin for real network/server latency. No hard-coded "must be
  // exactly 30000" so a future, deliberate, benchmark-justified change to
  // this constant does not need to touch this test — only the margin
  // above the previously-too-tight value matters here.
  assert.ok(DEFAULT_POSTPASS_TIMEOUT_MS >= 25_000, `expected a generous timeout, got ${DEFAULT_POSTPASS_TIMEOUT_MS} ms`)
})

test('HTTP errors reject and are never converted into an empty successful result', async () => {
  const provider = createPostpassRouteEnrichmentProvider({
    fetchFn: async () => ({ ok: false, status: 503, async json() { return {} } }),
  })
  await assert.rejects(provider.findStructuralCandidates(search()), /503/)
})

test('client timeout aborts a slow request without retry', async () => {
  let calls = 0
  const provider = createPostpassRouteEnrichmentProvider({
    requestTimeoutMs: 5,
    fetchFn: async (_url, init) => {
      calls++
      return await new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
      })
    },
  })
  await assert.rejects(provider.findStructuralCandidates(search()), /délai de 5 ms/)
  assert.equal(calls, 1)
})
