import '../storage/indexeddb/support/setup-fake-indexeddb.mjs'

import assert from 'node:assert/strict'
import test from 'node:test'

import { runStoredTripAutomaticEnrichment } from '../../src/route-enrichment/automatic-enrichment.ts'
import { createTripRepository } from '../../src/storage/indexeddb/trip-repository.ts'
import { openTestDatabase } from '../storage/indexeddb/support/open-test-database.mjs'
import { createGenericTripBundle } from '../trip-core/support/generic-trip-fixture.mjs'

/**
 * DER-DES-DER sections 4/9-10/15/19 / tests D-H — the pipeline's chronology.
 *
 * IMPORT → endpoints (global) → structure (global) → then, per stage in
 * strict chronological order: POI → pauses → ready. The two global phases
 * come first because a stage's POI search needs its structural geography
 * (départ, arrivée, villes, cols) as its anchors, and its pauses need the
 * POI. Weather runs alongside and never gates anything.
 */

function withTwoEnrichableStages(bundle) {
  bundle.routes[1].geometry = {
    full: null,
    simplified: [
      { latitude: 46, longitude: 7, altitudeM: 800 },
      { latitude: 46.05, longitude: 7.1, altitudeM: 1000 },
      { latitude: 46.1, longitude: 7.2, altitudeM: 1200 },
    ],
  }
  return bundle
}

function recordingProviders(calls) {
  return {
    geocodingProvider: {
      id: 'stub-geocoding', sourceType: 'osm', attribution: 'x',
      async reverse() {
        calls.push('endpoints')
        return { name: 'Lieu', sourceId: 'stub:point' }
      },
    },
    routeEnrichmentProvider: {
      id: 'stub-structural',
      async findStructuralCandidates(search) {
        calls.push(`structural:${search.stageId}`)
        return { candidates: [], durationMs: 1, rawCandidateCount: 0, httpStatus: 200, payloadBytes: 0, startedAt: '2028-01-01T00:00:00.000Z', finishedAt: '2028-01-01T00:00:00.001Z' }
      },
    },
    practicalPlacesProvider: {
      id: 'stub-practical', sourceType: 'osm', attribution: 'x',
      async findCandidates(search) {
        calls.push(`practical:${search.stageId}`)
        return { candidates: [], durationMs: 1, rawCandidateCount: 0, httpStatus: 200, payloadBytes: 0, startedAt: '2028-01-01T00:00:00.000Z', finishedAt: '2028-01-01T00:00:00.001Z' }
      },
    },
  }
}

async function runPipeline(database, bundle, extra = {}) {
  const calls = []
  await createTripRepository(database).saveTripBundle(bundle)
  await runStoredTripAutomaticEnrichment({
    database,
    tripId: bundle.metadata.id,
    ...recordingProviders(calls),
    idFactory: (() => { let n = 0; return () => `gen-${n++}` })(),
    now: () => '2028-08-03T10:00:00.000Z',
    ...extra,
  })
  return calls
}

test('D: every endpoint lookup happens before any structural lookup', async () => {
  const database = await openTestDatabase()
  try {
    const calls = await runPipeline(database, withTwoEnrichableStages(createGenericTripBundle()))
    const lastEndpoint = calls.map((call) => call === 'endpoints').lastIndexOf(true)
    const firstStructural = calls.findIndex((call) => call.startsWith('structural:'))
    assert.ok(lastEndpoint >= 0 && firstStructural >= 0, `expected both phases in ${JSON.stringify(calls)}`)
    assert.ok(lastEndpoint < firstStructural, 'endpoints finish before structure begins')
  } finally {
    database.close()
  }
})

test('E: every structural lookup happens before any POI lookup — the POI anchors need the structure', async () => {
  const database = await openTestDatabase()
  try {
    const calls = await runPipeline(database, withTwoEnrichableStages(createGenericTripBundle()))
    const lastStructural = calls.map((call) => call.startsWith('structural:')).lastIndexOf(true)
    const firstPractical = calls.findIndex((call) => call.startsWith('practical:'))
    assert.ok(lastStructural >= 0 && firstPractical >= 0, `expected both phases in ${JSON.stringify(calls)}`)
    assert.ok(lastStructural < firstPractical, 'structure finishes globally before POI begins')
  } finally {
    database.close()
  }
})

test('sections 9-10/15: the two global phases are complete before the per-stage phase starts — never interleaved', async () => {
  const database = await openTestDatabase()
  try {
    const calls = await runPipeline(database, withTwoEnrichableStages(createGenericTripBundle()))
    const phases = calls.map((call) => call.split(':')[0])
    const firstPracticalIndex = phases.indexOf('practical')
    assert.ok(firstPracticalIndex > 0)
    assert.ok(!phases.slice(firstPracticalIndex).includes('structural'), 'no structural call after POI started')
    assert.ok(!phases.slice(firstPracticalIndex).includes('endpoints'), 'no endpoint call after POI started')
  } finally {
    database.close()
  }
})

test('section 15: stages are enriched in strict chronological order, never reordered by "today"', async () => {
  const database = await openTestDatabase()
  try {
    const bundle = withTwoEnrichableStages(createGenericTripBundle())
    const calls = await runPipeline(database, bundle)
    // One entry per stage, in the order they were first requested: a stage is
    // covered by several micro-segments, but never interleaved with another.
    const practicalOrder = calls
      .filter((call) => call.startsWith('practical:'))
      .map((call) => call.slice('practical:'.length))
      .filter((stageId, index, all) => all[index - 1] !== stageId)
    assert.deepEqual(practicalOrder, bundle.stages.map((stage) => stage.id), 'E1 then E2, the trip\'s own order')
  } finally {
    database.close()
  }
})

test('F/G/section 19: each stage\'s POI result is PERSISTED before the next stage is even requested', async () => {
  const database = await openTestDatabase()
  try {
    const bundle = withTwoEnrichableStages(createGenericTripBundle())
    await createTripRepository(database).saveTripBundle(bundle)
    const repository = createTripRepository(database)
    const settledWhenSecondStarted = []

    await runStoredTripAutomaticEnrichment({
      database,
      tripId: bundle.metadata.id,
      routeEnrichmentProvider: {
        id: 'stub-structural',
        async findStructuralCandidates() {
          return { candidates: [], durationMs: 1, rawCandidateCount: 0, httpStatus: 200, payloadBytes: 0, startedAt: '2028-01-01T00:00:00.000Z', finishedAt: '2028-01-01T00:00:00.001Z' }
        },
      },
      practicalPlacesProvider: {
        id: 'stub-practical', sourceType: 'osm', attribution: 'x',
        async findCandidates(search) {
          // Read the persisted state at the moment THIS stage's request goes
          // out: by the time E2 is requested, E1 must already be recorded.
          const stored = await repository.loadTripBundle(bundle.metadata.id)
          const completedStages = (stored.enrichmentMetadata.enrichmentJobs ?? [])
            .filter((entry) => entry.jobs.some((job) => job.kind === 'practical' && (job.status === 'success' || job.status === 'empty')))
            .length
          settledWhenSecondStarted.push({ stageId: search.stageId, settledCount: completedStages })
          return { candidates: [], durationMs: 1, rawCandidateCount: 0, httpStatus: 200, payloadBytes: 0, startedAt: '2028-01-01T00:00:00.000Z', finishedAt: '2028-01-01T00:00:00.001Z' }
        },
      },
      idFactory: (() => { let n = 0; return () => `gen-${n++}` })(),
      now: () => '2028-08-03T10:00:00.000Z',
    })

    // One observation per stage: nothing persisted when E1's first request
    // goes out, E1 already persisted by the time E2's does.
    const perStage = settledWhenSecondStarted.filter((entry, index, all) => all[index - 1]?.stageId !== entry.stageId)
    assert.equal(perStage.length, 2)
    assert.equal(perStage[0].settledCount, 0, 'nothing persisted yet when E1 goes out')
    assert.equal(perStage[1].settledCount, 1, 'E1 is already persisted when E2 goes out — progressive, not a single save at the end')
  } finally {
    database.close()
  }
})

test('sections 38-39: a cancelled pass stops cleanly and keeps everything it had already persisted — no rollback', async () => {
  const database = await openTestDatabase()
  try {
    const bundle = withTwoEnrichableStages(createGenericTripBundle())
    await createTripRepository(database).saveTripBundle(bundle)
    let practicalCalls = 0
    let stillActive = true

    await runStoredTripAutomaticEnrichment({
      database,
      tripId: bundle.metadata.id,
      shouldContinue: () => stillActive,
      routeEnrichmentProvider: {
        id: 'stub-structural',
        async findStructuralCandidates() {
          return { candidates: [], durationMs: 1, rawCandidateCount: 0, httpStatus: 200, payloadBytes: 0, startedAt: '2028-01-01T00:00:00.000Z', finishedAt: '2028-01-01T00:00:00.001Z' }
        },
      },
      practicalPlacesProvider: {
        id: 'stub-practical', sourceType: 'osm', attribution: 'x',
        async findCandidates() {
          practicalCalls += 1
          // Another trip takes over right after the first stage.
          stillActive = false
          return { candidates: [], durationMs: 1, rawCandidateCount: 0, httpStatus: 200, payloadBytes: 0, startedAt: '2028-01-01T00:00:00.000Z', finishedAt: '2028-01-01T00:00:00.001Z' }
        },
      },
      idFactory: (() => { let n = 0; return () => `gen-${n++}` })(),
      now: () => '2028-08-03T10:00:00.000Z',
    })

    const stored = await createTripRepository(database).loadTripBundle(bundle.metadata.id)
    const completed = (stored.enrichmentMetadata.enrichmentJobs ?? [])
      .filter((entry) => entry.jobs.some((job) => job.kind === 'practical' && (job.status === 'success' || job.status === 'empty')))
      .map((entry) => entry.stageId)
    assert.deepEqual(completed, [bundle.stages[0].id], 'what the first stage achieved is kept, and only the rest stays outstanding')
    assert.ok(practicalCalls >= 1)
  } finally {
    database.close()
  }
})

test('AC/AD/AE: reopening a fully-settled trip performs no provider call whatsoever', async () => {
  const database = await openTestDatabase()
  try {
    const bundle = withTwoEnrichableStages(createGenericTripBundle())
    await runPipeline(database, bundle)
    const secondPassCalls = []
    await runStoredTripAutomaticEnrichment({
      database,
      tripId: bundle.metadata.id,
      ...recordingProviders(secondPassCalls),
      idFactory: (() => { let n = 0; return () => `gen2-${n++}` })(),
      now: () => '2028-08-04T10:00:00.000Z',
    })
    assert.deepEqual(secondPassCalls, [], 'section 31: opening the trip again is 0 calls')
  } finally {
    database.close()
  }
})
