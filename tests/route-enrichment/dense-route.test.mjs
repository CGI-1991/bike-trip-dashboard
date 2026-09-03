import '../storage/indexeddb/support/setup-fake-indexeddb.mjs'

import assert from 'node:assert/strict'
import test from 'node:test'

import { enrichTripRoute } from '../../src/route-enrichment/enrichment.ts'
import {
  INITIAL_SEGMENT_KM,
  isStagePhaseComplete,
  planStageJobs,
  stageRouteLengthKm,
} from '../../src/route-enrichment/enrichment-jobs.ts'
import { createGenericTripBundle } from '../trip-core/support/generic-trip-fixture.mjs'

/**
 * The reported failure was on a Belgian route, not an alpine one, and that
 * matters: kilometres are a poor proxy for how expensive a query is. A dense
 * lowland corridor can carry an order of magnitude more OSM objects per
 * kilometre than a mountain road of the same length.
 *
 * These tests model that asymmetry explicitly — a provider whose failures
 * depend on how many objects a stretch contains rather than on how long it
 * is — so the strategy cannot quietly come to depend on the RGA's own
 * favourable density.
 */

const KM_PER_DEGREE_LATITUDE = (Math.PI / 180) * 6_371

function line(lengthKm, pointCount = 800) {
  const delta = lengthKm / (pointCount - 1) / KM_PER_DEGREE_LATITUDE
  return Array.from({ length: pointCount }, (_value, index) => ({
    latitude: 45 + index * delta,
    longitude: 6,
    altitudeM: 30,
  }))
}

function bundleOfLength(lengthKm) {
  const bundle = createGenericTripBundle()
  bundle.routes[0].geometry = { full: line(lengthKm), simplified: null }
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

function villagesFor(search, perKm) {
  const lengthKm = search.routeLengthKm ?? 0
  const count = Math.max(0, Math.round(lengthKm * perKm))
  return Array.from({ length: count }, (_value, index) => ({
    osmType: 'node',
    osmId: `${search.geometry[0].latitude.toFixed(5)}-${index}`,
    featureType: 'village',
    name: `Village ${index}`,
    latitude: search.geometry[0].latitude,
    longitude: 6,
    elevationM: null,
  }))
}

/**
 * A provider that fails whenever a request would return more than
 * `objectLimit` objects — the behaviour a real overloaded endpoint
 * approximates, and the reason length alone is the wrong lever.
 */
function densityLimitedProvider(perKm, objectLimit, counters) {
  return {
    id: 'stub-dense',
    async findStructuralCandidates(search) {
      counters.calls += 1
      const candidates = villagesFor(search, perKm)
      if (candidates.length > objectLimit) {
        counters.rejected += 1
        throw new Error('temps de recherche Postpass dépassé')
      }
      return { candidates, durationMs: 5, rawCandidateCount: candidates.length, httpStatus: 200, payloadBytes: 0, startedAt: '2028-01-01T00:00:00.000Z', finishedAt: '2028-01-01T00:00:00.005Z' }
    },
  }
}

async function run(bundle, cache, provider) {
  return enrichTripRoute({
    bundle, cache, provider,
    idFactory: (() => { let n = 0; return () => `gen-${n++}` })(),
    now: () => '2028-08-03T10:00:00.000Z',
  })
}

test('the starting segment length is small enough to be plausible on a dense route', () => {
  assert.equal(INITIAL_SEGMENT_KM, 20)
  const bundle = bundleOfLength(120)
  const jobs = planStageJobs(stageRouteLengthKm(bundle, bundle.stages[0].id), 'structural')
  assert.ok(jobs.length >= 6, 'a 120 km route is not attempted as one or two giant queries')
})

test('a dense route whose 20 km segments are too heavy still completes, by subdividing', async () => {
  const counters = { calls: 0, rejected: 0 }
  const bundle = bundleOfLength(60)
  // 4 objects/km: a 20 km segment yields 80 (over the limit), a 10 km one 40 (under).
  const report = await run(bundle, memoryCache(), densityLimitedProvider(4, 50, counters))

  assert.ok(counters.rejected > 0, 'the initial 20 km segments really were too heavy')
  assert.equal(
    isStagePhaseComplete(report.bundle, bundle.stages[0].id, 'structural'),
    true,
    'and the stage completed anyway — this is exactly what a dense corridor needs',
  )
  assert.ok(report.localityCount > 0, 'with real places found along it')
})

test('the same route on sparse terrain completes without any subdivision at all', async () => {
  const counters = { calls: 0, rejected: 0 }
  const bundle = bundleOfLength(60)
  // 0.5 objects/km: every 20 km segment is comfortably under the limit.
  const report = await run(bundle, memoryCache(), densityLimitedProvider(0.5, 50, counters))
  assert.equal(counters.rejected, 0, 'an easy route pays nothing for the dense route’s safety net')
  assert.equal(isStagePhaseComplete(report.bundle, bundle.stages[0].id, 'structural'), true)
})

test('a very dense route subdivides further still, and stops before the floor', async () => {
  const counters = { calls: 0, rejected: 0 }
  const bundle = bundleOfLength(40)
  // 20 objects/km: only a ~2.5 km segment stays under the limit.
  const report = await run(bundle, memoryCache(), densityLimitedProvider(20, 55, counters))
  const jobs = (report.bundle.enrichmentMetadata.enrichmentJobs ?? [])
    .find((entry) => entry.stageId === bundle.stages[0].id)?.jobs.filter((job) => job.kind === 'structural') ?? []
  assert.ok(jobs.some((job) => job.endKm - job.startKm <= 5.001), 'it really did keep halving')
  for (const job of jobs) assert.ok(job.endKm - job.startKm >= 2.5 - 0.001, 'but never past the floor')
})

test('a dense route covers its WHOLE length — never just the first stretch', async () => {
  const counters = { calls: 0, rejected: 0 }
  const bundle = bundleOfLength(120)
  const cache = memoryCache()
  // Resume until nothing is outstanding, exactly as reopening the trip does.
  let current = bundle
  for (let attempt = 0; attempt < 6; attempt++) {
    const report = await run(current, cache, densityLimitedProvider(4, 50, counters))
    current = report.bundle
    if (isStagePhaseComplete(current, bundle.stages[0].id, 'structural')) break
  }
  assert.equal(isStagePhaseComplete(current, bundle.stages[0].id, 'structural'), true)

  const jobs = (current.enrichmentMetadata.enrichmentJobs ?? [])
    .find((entry) => entry.stageId === bundle.stages[0].id)?.jobs.filter((job) => job.kind === 'structural') ?? []
  const covered = jobs.filter((job) => job.status === 'success' || job.status === 'empty')
  assert.ok(Math.max(...covered.map((job) => job.endKm)) > 100, 'the far end of the route was genuinely searched')
  assert.equal(Math.min(...covered.map((job) => job.startKm)), 0, 'and so was the near end')
})
