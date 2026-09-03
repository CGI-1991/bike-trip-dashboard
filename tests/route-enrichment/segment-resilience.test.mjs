import '../storage/indexeddb/support/setup-fake-indexeddb.mjs'

import assert from 'node:assert/strict'
import test from 'node:test'

import { enrichTripRoute } from '../../src/route-enrichment/enrichment.ts'
import { RETRY_POSTPASS_SEGMENT_KM } from '../../src/route-enrichment/segmentation.ts'
import { createGenericTripBundle } from '../trip-core/support/generic-trip-fixture.mjs'

/**
 * DER-DES-DER sections 41-50 / tests BA-BF — a long stage's search is split,
 * and one slow segment never costs the whole stage.
 */

const KM_PER_DEGREE_LATITUDE = (Math.PI / 180) * 6_371

/** A straight north-south line of an exact length, so segment counts are predictable. */
function longGeometry(lengthKm, pointCount = 400) {
  const delta = lengthKm / (pointCount - 1) / KM_PER_DEGREE_LATITUDE
  return Array.from({ length: pointCount }, (_value, index) => ({
    latitude: 45 + index * delta,
    longitude: 6,
    altitudeM: 500,
  }))
}

function withLongStage(lengthKm) {
  const bundle = createGenericTripBundle()
  bundle.routes[0].geometry = { full: longGeometry(lengthKm), simplified: null }
  // Keep only the first stage enrichable, so the counts below describe one stage.
  bundle.routes[1].geometry = { full: null, simplified: null }
  return bundle
}

function memoryCache() {
  const values = new Map()
  return {
    async get(identity) { return values.get(JSON.stringify(identity)) ?? null },
    async put(identity, results, storedAt) { values.set(JSON.stringify(identity), { results, storedAt }) },
    get size() { return values.size },
  }
}

function candidate(overrides = {}) {
  return {
    osmType: 'node', osmId: '1', featureType: 'village', name: 'Village',
    latitude: 45.1, longitude: 6, elevationM: null, ...overrides,
  }
}

function provider(handler) {
  return { id: 'stub-structural', async findStructuralCandidates(search) { return handler(search) } }
}

function ok(candidates = []) {
  return { candidates, durationMs: 5, rawCandidateCount: candidates.length, httpStatus: 200, payloadBytes: 0, startedAt: '2028-01-01T00:00:00.000Z', finishedAt: '2028-01-01T00:00:00.005Z' }
}

async function run(bundle, cache, handler, extra = {}) {
  return enrichTripRoute({
    bundle, cache, provider: provider(handler),
    idFactory: (() => { let n = 0; return () => `gen-${n++}` })(),
    now: () => '2028-08-03T10:00:00.000Z',
    ...extra,
  })
}

test('AU/AV: a short stage is still ONE request — segmentation changes nothing for a normal stage', async () => {
  let calls = 0
  await run(withLongStage(50), memoryCache(), () => { calls += 1; return ok() })
  assert.equal(calls, 1)
})

test('AW/AX: a 205 km stage is searched as several bounded requests instead of one huge one', async () => {
  const lengths = []
  await run(withLongStage(205), memoryCache(), (search) => { lengths.push(search.routeLengthKm); return ok() })
  assert.ok(lengths.length >= 4, `expected several segment requests, got ${lengths.length}`)
  for (const length of lengths) assert.ok(length <= 60.001, `a segment covered ${length} km`)
})

test('BA/BB/BC: one failing segment never fails the stage — the others still run, and their results are kept', async () => {
  let calls = 0
  const report = await run(withLongStage(205), memoryCache(), () => {
    calls += 1
    if (calls === 2) throw new Error('temps de recherche Postpass dépassé')
    return ok([candidate({ osmId: `seg-${calls}` })])
  })
  assert.ok(calls >= 4, 'BC: the loop continued past the failure')
  assert.ok(report.localityCount > 0, 'BB: the successful segments\' results are retained')
})

test('BD: a stage with a failed segment reports as incomplete, so it keeps its "À compléter / Réessayer" affordance', async () => {
  let calls = 0
  const report = await run(withLongStage(205), memoryCache(), () => {
    calls += 1
    if (calls === 2) throw new Error('timeout')
    return ok([candidate({ osmId: `seg-${calls}` })])
  })
  assert.equal(report.networkErrorCount, 1, 'the stage is counted as incomplete exactly once, not once per segment')
  const state = report.bundle.enrichmentMetadata.providers.find((entry) => entry.provider === 'postpass-route-enrichment')
  assert.equal(state.status, 'partial', 'partial, not error — real data was acquired')
})

test('BE/section 48: a retry only re-requests the segments that failed — the successful ones come from cache', async () => {
  const cache = memoryCache()
  const bundle = withLongStage(205)
  let calls = 0
  let failingCall = 2
  await run(bundle, cache, () => {
    calls += 1
    if (calls === failingCall) throw new Error('timeout')
    return ok([candidate({ osmId: `seg-${calls}` })])
  })
  const callsAfterFirstPass = calls
  assert.ok(callsAfterFirstPass >= 4)

  // The retry: same segment length, so the successful segments hit the same
  // cache keys and only the failed one goes out again.
  failingCall = -1
  await run(bundle, cache, () => { calls += 1; return ok([candidate({ osmId: `retry-${calls}` })]) })
  assert.equal(calls - callsAfterFirstPass, 1, 'exactly one network call — the previously-failed segment only')
})

test('BF/section 49: a retry at the smaller length subdivides — never the same slow query again', async () => {
  const bundle = withLongStage(205)
  const normalLengths = []
  await run(bundle, memoryCache(), (search) => { normalLengths.push(search.routeLengthKm); return ok() })

  const retryLengths = []
  await run(bundle, memoryCache(), (search) => { retryLengths.push(search.routeLengthKm); return ok() }, { segmentLengthKm: RETRY_POSTPASS_SEGMENT_KM })

  assert.ok(retryLengths.length > normalLengths.length, 'more, smaller queries')
  for (const length of retryLengths) assert.ok(length <= RETRY_POSTPASS_SEGMENT_KM + 0.001, `a retry segment covered ${length} km`)
})

test('AZ/section 44: the 5 km overlap duplicates are deduplicated — the same OSM feature is never stored twice', async () => {
  // Every segment returns the SAME feature (as a boundary feature collected
  // by two neighbours genuinely would).
  const report = await run(withLongStage(205), memoryCache(), () => ok([candidate({ osmType: 'node', osmId: 'shared-boundary-village' })]))
  const generated = report.bundle.routePoints.filter((point) => point.provenance?.sourceId?.includes('shared-boundary-village'))
  assert.equal(generated.length, 1, 'collected by several segments, stored once')
})

test('section 50: a failed segment schedules no automatic retry — the pass simply ends', async () => {
  let calls = 0
  await run(withLongStage(205), memoryCache(), () => {
    calls += 1
    throw new Error('timeout')
  })
  // One call per segment, and not a single one more: no retry loop.
  const segmentCount = calls
  assert.ok(segmentCount >= 4 && segmentCount <= 6, `expected one attempt per segment, got ${segmentCount}`)
})
