import '../storage/indexeddb/support/setup-fake-indexeddb.mjs'

import assert from 'node:assert/strict'
import test from 'node:test'

import { enrichTripRoute } from '../../src/route-enrichment/enrichment.ts'
import {
  INITIAL_SEGMENT_KM,
  isStagePhaseComplete,
  MINIMUM_SEGMENT_KM,
  stageJobsFor,
} from '../../src/route-enrichment/enrichment-jobs.ts'
import { createGenericTripBundle } from '../trip-core/support/generic-trip-fixture.mjs'

/**
 * The resilience contract, end to end through the real structural engine:
 * a stretch of route that cannot be answered stays visibly unanswered, a
 * request that is too heavy is split rather than abandoned, and nothing
 * already obtained is ever thrown away or asked for twice.
 *
 * This is the Genappe → Middelkerke scenario in miniature.
 */

const KM_PER_DEGREE_LATITUDE = (Math.PI / 180) * 6_371

/** A straight north-south line of an exact length, so job counts are predictable. */
function longGeometry(lengthKm, pointCount = 600) {
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
  // Keep only the first stage enrichable, so the counts describe one stage.
  bundle.routes[1].geometry = { full: null, simplified: null }
  return bundle
}

function memoryCache() {
  const values = new Map()
  return {
    async get(identity) { return values.get(JSON.stringify(identity)) ?? null },
    async put(identity, results, storedAt) { values.set(JSON.stringify(identity), { results, storedAt }) },
  }
}

function candidate(overrides = {}) {
  return { osmType: 'node', osmId: '1', featureType: 'village', name: 'Village', latitude: 45.1, longitude: 6, elevationM: null, ...overrides }
}

function ok(candidates = []) {
  return { candidates, durationMs: 5, rawCandidateCount: candidates.length, httpStatus: 200, payloadBytes: 0, startedAt: '2028-01-01T00:00:00.000Z', finishedAt: '2028-01-01T00:00:00.005Z' }
}

async function run(bundle, cache, handler) {
  return enrichTripRoute({
    bundle,
    cache,
    provider: { id: 'stub-structural', async findStructuralCandidates(search) { return handler(search) } },
    idFactory: (() => { let n = 0; return () => `gen-${n++}` })(),
    now: () => '2028-08-03T10:00:00.000Z',
  })
}

const structuralJobs = (bundle, stageId) => (stageJobsFor(bundle, stageId)?.jobs ?? []).filter((job) => job.kind === 'structural')

// --- segmentation shape ----------------------------------------------------

test('a short stage is a single request — segmentation costs an easy route nothing', async () => {
  let calls = 0
  await run(withLongStage(15), memoryCache(), () => { calls += 1; return ok() })
  assert.equal(calls, 1)
})

test('a long stage is searched as several bounded requests, never one huge one', async () => {
  const lengths = []
  await run(withLongStage(205), memoryCache(), (search) => { lengths.push(search.routeLengthKm); return ok() })
  assert.ok(lengths.length >= 10, `expected a segmented search, got ${lengths.length} request(s)`)
  for (const length of lengths) assert.ok(length <= INITIAL_SEGMENT_KM + 0.001, `a request covered ${length} km`)
})

// --- the core contract: a failed stretch is NOT completion ------------------

test('THE Genappe case: a stage whose later stretch fails keeps its early results AND stays incomplete', async () => {
  const bundle = withLongStage(120)
  // Everything past 60 km fails, exactly like the reported symptom.
  const report = await run(bundle, memoryCache(), (search) => {
    const startsPast60 = search.geometry[0].latitude > 45 + (60 / KM_PER_DEGREE_LATITUDE)
    if (startsPast60) throw new Error('temps de recherche Postpass dépassé')
    return ok([candidate({ osmId: `seg-${search.geometry[0].latitude.toFixed(4)}` })])
  })

  assert.ok(report.localityCount > 0, 'the first stretch is kept — nothing acquired is thrown away')
  assert.equal(
    isStagePhaseComplete(report.bundle, bundle.stages[0].id, 'structural'),
    false,
    'and the stage is NOT complete: this is the inversion the whole milestone turns on',
  )
  const jobs = structuralJobs(report.bundle, bundle.stages[0].id)
  assert.ok(jobs.some((job) => job.status === 'success' || job.status === 'empty'), 'the early segments are recorded as done')
  assert.ok(jobs.some((job) => job.status === 'pending'), 'the later ones are recorded as still to do')
})

test('a resumed pass asks only for the stretches that are still missing', async () => {
  const cache = memoryCache()
  const bundle = withLongStage(120)
  const boundaryLat = 45 + (60 / KM_PER_DEGREE_LATITUDE)
  const first = await run(bundle, cache, (search) => {
    if (search.geometry[0].latitude > boundaryLat) throw new Error('timeout')
    return ok([candidate({ osmId: 'early' })])
  })

  const resumedRanges = []
  const second = await run(first.bundle, cache, (search) => {
    resumedRanges.push(search.geometry[0].latitude)
    return ok([candidate({ osmId: 'late' })])
  })
  assert.ok(resumedRanges.length > 0, 'the missing stretches are picked up')
  assert.ok(
    resumedRanges.every((latitude) => latitude > boundaryLat - 0.01),
    'and only those — nothing already answered is asked for twice',
  )
  assert.equal(isStagePhaseComplete(second.bundle, bundle.stages[0].id, 'structural'), true, 'the stage completes by itself, with no user action')
})

test('a fully complete stage costs nothing on the next pass — not even a cache read', async () => {
  const cache = memoryCache()
  const bundle = withLongStage(60)
  const first = await run(bundle, cache, () => ok([candidate()]))
  assert.equal(isStagePhaseComplete(first.bundle, bundle.stages[0].id, 'structural'), true)

  let calls = 0
  await run(first.bundle, cache, () => { calls += 1; return ok() })
  assert.equal(calls, 0)
})

// --- subdivision -----------------------------------------------------------

test('a too-heavy request is split rather than abandoned — the retry happens inside the same pass', async () => {
  const lengths = []
  let failFirst = true
  await run(withLongStage(60), memoryCache(), (search) => {
    lengths.push(search.routeLengthKm)
    // Fail the very first (20 km) request once; its halves must then be tried.
    if (failFirst) {
      failFirst = false
      throw new Error('timeout')
    }
    return ok()
  })
  const halved = lengths.filter((length) => length > INITIAL_SEGMENT_KM / 2 - 1 && length < INITIAL_SEGMENT_KM / 2 + 1)
  assert.ok(halved.length >= 2, `expected the failed 20 km job to be tried as two ~10 km halves, saw ${JSON.stringify(lengths)}`)
})

test('subdivision replaces the parent — a completed stage never keeps both the parent range and its halves', async () => {
  const bundle = withLongStage(40)
  let failFirst = true
  const report = await run(bundle, memoryCache(), () => {
    if (failFirst) {
      failFirst = false
      throw new Error('timeout')
    }
    return ok()
  })
  const jobs = structuralJobs(report.bundle, bundle.stages[0].id)
  const ranges = jobs.map((job) => `${job.startKm}-${job.endKm}`)
  assert.equal(new Set(ranges).size, ranges.length, 'no duplicate ranges')
  // No job may contain another: a parent left alongside its children would
  // mean the same ground is both outstanding and done.
  for (const outer of jobs) {
    for (const inner of jobs) {
      if (outer === inner) continue
      const contains = inner.startKm >= outer.startKm && inner.endKm <= outer.endKm
      assert.ok(!contains, `${outer.startKm}-${outer.endKm} still contains ${inner.startKm}-${inner.endKm}`)
    }
  }
})

test('subdivision is bounded — a provider that always fails does not produce a retry storm', async () => {
  let calls = 0
  await run(withLongStage(40), memoryCache(), () => {
    calls += 1
    throw new Error('timeout')
  })
  // Without a budget this would keep halving to the floor for every job.
  assert.ok(calls <= 12, `expected a bounded number of attempts, got ${calls}`)
  assert.ok(calls >= 2, 'but it must genuinely try to subdivide at least once')
})

test('nothing is ever split below the floor', async () => {
  const bundle = withLongStage(40)
  const report = await run(bundle, memoryCache(), () => { throw new Error('timeout') })
  for (const job of structuralJobs(report.bundle, bundle.stages[0].id)) {
    assert.ok(job.endKm - job.startKm >= MINIMUM_SEGMENT_KM - 0.001, `a job shrank to ${job.endKm - job.startKm} km`)
  }
})

// --- offline is not "too heavy" -------------------------------------------

test('an offline failure parks the work instead of splitting it — halving helps nothing without a connection', async () => {
  const bundle = withLongStage(60)
  let calls = 0
  const report = await run(bundle, memoryCache(), () => {
    calls += 1
    // What a failed `fetch` looks like in a browser.
    const error = new TypeError('Failed to fetch')
    throw error
  })
  assert.equal(calls, 1, 'it stops at the first sign the network is gone — no subdivision, no storm')
  const jobs = structuralJobs(report.bundle, bundle.stages[0].id)
  assert.ok(jobs.every((job) => job.status === 'waiting-for-network'), 'the whole stage is parked, ready to resume')
  assert.equal(isStagePhaseComplete(report.bundle, bundle.stages[0].id, 'structural'), false, 'and never mistaken for complete')
})

test('parked work resumes and completes once the connection is back', async () => {
  const cache = memoryCache()
  const bundle = withLongStage(60)
  const offline = await run(bundle, cache, () => { throw new TypeError('Failed to fetch') })
  const online = await run(offline.bundle, cache, () => ok([candidate()]))
  assert.equal(isStagePhaseComplete(online.bundle, bundle.stages[0].id, 'structural'), true)
})

// --- overlap ---------------------------------------------------------------

test('a feature collected by two neighbouring segments is stored once', async () => {
  const bundle = withLongStage(120)
  const report = await run(bundle, memoryCache(), () => ok([candidate({ osmType: 'node', osmId: 'shared-boundary-village' })]))
  const stored = report.bundle.routePoints.filter((point) => point.provenance?.sourceId?.includes('shared-boundary-village'))
  assert.equal(stored.length, 1)
})
