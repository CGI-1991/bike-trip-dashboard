import '../storage/indexeddb/support/setup-fake-indexeddb.mjs'

import assert from 'node:assert/strict'
import test from 'node:test'

import { runStoredTripAutomaticEnrichment } from '../../src/route-enrichment/automatic-enrichment.ts'
import {
  isStagePhaseComplete,
  isStructuralGloballyComplete,
  stageAutomaticPausesAllowed,
  stageJobsFor,
} from '../../src/route-enrichment/enrichment-jobs.ts'
import { computeStageWaypoints } from '../../src/analysis/waypoint-timeline.ts'
import { createTripRepository } from '../../src/storage/indexeddb/trip-repository.ts'
import { openTestDatabase } from '../storage/indexeddb/support/open-test-database.mjs'
import { createGenericTripBundle } from '../trip-core/support/generic-trip-fixture.mjs'

/**
 * The three gates that make "ready" mean something:
 *
 *   every stage's structure complete → POI may start
 *   a stage's POI complete          → its pauses may be computed
 *   neither                          → nothing is shown as final
 *
 * They exist because a half-enriched stage does not produce a worse result,
 * it produces a misleading one: a POI search around half a map, or a pause
 * plan that quietly ignores everything past the point enrichment reached.
 */

const KM_PER_DEGREE_LATITUDE = (Math.PI / 180) * 6_371

function line(lengthKm, startLat, pointCount = 400) {
  const delta = lengthKm / (pointCount - 1) / KM_PER_DEGREE_LATITUDE
  return Array.from({ length: pointCount }, (_value, index) => ({
    latitude: startLat + index * delta,
    longitude: 6,
    altitudeM: 400,
  }))
}

/** The prompt's own worked example: a 120 km stage whose 60–80 km stretch times out. */
function bundleWithLongStage(lengthKm = 120) {
  const bundle = createGenericTripBundle()
  bundle.routes[0].geometry = { full: line(lengthKm, 45), simplified: null }
  bundle.routes[1].geometry = { full: line(30, 47), simplified: null }
  return bundle
}

function structuralProvider(handler) {
  return { id: 'stub-structural', async findStructuralCandidates(search) { return handler(search) } }
}

function practicalProvider(handler) {
  return { id: 'stub-practical', sourceType: 'osm', attribution: 'x', async findCandidates(search) { return handler(search) } }
}

const okStructural = () => ({ candidates: [], durationMs: 1, rawCandidateCount: 0, httpStatus: 200, payloadBytes: 0, startedAt: '2028-01-01T00:00:00.000Z', finishedAt: '2028-01-01T00:00:00.001Z' })
const okPractical = okStructural

async function runPipeline(database, bundle, { structural, practical } = {}) {
  await createTripRepository(database).saveTripBundle(bundle)
  await runStoredTripAutomaticEnrichment({
    database,
    tripId: bundle.metadata.id,
    routeEnrichmentProvider: structuralProvider(structural ?? okStructural),
    practicalPlacesProvider: practicalProvider(practical ?? okPractical),
    idFactory: (() => { let n = 0; return () => `gen-${n++}` })(),
    now: () => '2028-08-03T10:00:00.000Z',
  })
  return createTripRepository(database).loadTripBundle(bundle.metadata.id)
}

/** Whether a request covers ground at or past `km` along the first stage. */
const startsPast = (search, km, startLat = 45) => search.geometry[0].latitude >= startLat + (km / KM_PER_DEGREE_LATITUDE) - 1e-9

// --- the prompt's central scenario -----------------------------------------

test('a 120 km stage whose middle stretch times out: successes kept, stage incomplete, ZERO POI calls, no pauses', async () => {
  const database = await openTestDatabase()
  try {
    const bundle = bundleWithLongStage(120)
    let practicalCalls = 0
    const stored = await runPipeline(database, bundle, {
      structural: (search) => {
        // The 60–80 km stretch of the first stage never answers.
        if (search.stageId === bundle.stages[0].id && startsPast(search, 60) && !startsPast(search, 80)) throw new Error('timeout')
        return okStructural()
      },
      practical: () => { practicalCalls += 1; return okPractical() },
    })

    const jobs = (stageJobsFor(stored, bundle.stages[0].id)?.jobs ?? []).filter((job) => job.kind === 'structural')
    assert.ok(jobs.some((job) => job.status === 'success' || job.status === 'empty'), 'the stretches that answered are kept')
    assert.ok(jobs.some((job) => job.status === 'pending'), 'the stretch that did not is still outstanding')

    assert.equal(isStagePhaseComplete(stored, bundle.stages[0].id, 'structural'), false, 'the stage is not structurally complete')
    assert.equal(isStructuralGloballyComplete(stored), false, 'so the trip is not either')
    assert.equal(practicalCalls, 0, 'and NOT ONE POI request was made')
    assert.equal(stageAutomaticPausesAllowed(stored, bundle.stages[0].id), false, 'nor may any automatic pause be shown')
  } finally {
    database.close()
  }
})

test('the same trip completes by itself on the next open, and only then does POI work begin', async () => {
  const database = await openTestDatabase()
  try {
    const bundle = bundleWithLongStage(120)
    let failing = true
    await runPipeline(database, bundle, {
      structural: (search) => {
        if (failing && search.stageId === bundle.stages[0].id && startsPast(search, 60) && !startsPast(search, 80)) throw new Error('timeout')
        return okStructural()
      },
      practical: okPractical,
    })

    // Second open: the network is well again. Nothing else changed.
    failing = false
    let practicalCalls = 0
    await runStoredTripAutomaticEnrichment({
      database,
      tripId: bundle.metadata.id,
      routeEnrichmentProvider: structuralProvider(okStructural),
      practicalPlacesProvider: practicalProvider(() => { practicalCalls += 1; return okPractical() }),
      idFactory: (() => { let n = 0; return () => `gen2-${n++}` })(),
      now: () => '2028-08-04T10:00:00.000Z',
    })

    const stored = await createTripRepository(database).loadTripBundle(bundle.metadata.id)
    assert.equal(isStructuralGloballyComplete(stored), true, 'it healed with no user action at all')
    assert.ok(practicalCalls > 0, 'and only now did the POI phase start')
  } finally {
    database.close()
  }
})

// --- structural → practical ------------------------------------------------

test('one incomplete stage out of two blocks POI for the WHOLE trip, not just for itself', async () => {
  const database = await openTestDatabase()
  try {
    const bundle = bundleWithLongStage(40)
    let practicalCalls = 0
    const stored = await runPipeline(database, bundle, {
      // The SECOND stage fails entirely; the first is perfectly fine.
      structural: (search) => {
        if (search.stageId === bundle.stages[1].id) throw new Error('timeout')
        return okStructural()
      },
      practical: () => { practicalCalls += 1; return okPractical() },
    })
    assert.equal(isStagePhaseComplete(stored, bundle.stages[0].id, 'structural'), true, 'stage 1 is genuinely done')
    assert.equal(practicalCalls, 0, 'yet no POI work starts anywhere — the gate is trip-wide by design')
  } finally {
    database.close()
  }
})

test('with every stage structurally complete, POI work proceeds normally', async () => {
  const database = await openTestDatabase()
  try {
    const bundle = bundleWithLongStage(40)
    let practicalCalls = 0
    const stored = await runPipeline(database, bundle, { practical: () => { practicalCalls += 1; return okPractical() } })
    assert.equal(isStructuralGloballyComplete(stored), true)
    assert.ok(practicalCalls > 0)
  } finally {
    database.close()
  }
})

// --- practical → pauses ----------------------------------------------------

test('a stage with complete structure but incomplete POI may not compute its pauses', async () => {
  const database = await openTestDatabase()
  try {
    const bundle = bundleWithLongStage(40)
    const stored = await runPipeline(database, bundle, {
      // The 40 km stage is covered by two jobs (0–20 and 19–40): fail only
      // the later one, so its POI phase is genuinely partial.
      practical: (search) => {
        if (search.stageId === bundle.stages[0].id && startsPast(search, 10)) throw new Error('timeout')
        return okPractical()
      },
    })
    assert.equal(isStagePhaseComplete(stored, bundle.stages[0].id, 'structural'), true)
    assert.equal(isStagePhaseComplete(stored, bundle.stages[0].id, 'practical'), false)
    assert.equal(stageAutomaticPausesAllowed(stored, bundle.stages[0].id), false)
  } finally {
    database.close()
  }
})

test('once both phases are complete, the stage may compute its pauses', async () => {
  const database = await openTestDatabase()
  try {
    const bundle = bundleWithLongStage(40)
    const stored = await runPipeline(database, bundle)
    assert.equal(stageAutomaticPausesAllowed(stored, bundle.stages[0].id), true)
  } finally {
    database.close()
  }
})

// --- and the gate really does suppress the pauses ---------------------------

test('an incomplete stage produces NO automatic pause, even where real places were already found', async () => {
  const database = await openTestDatabase()
  try {
    const bundle = bundleWithLongStage(120)
    // A real village on the stretch that DID answer: the engine has enough
    // to place a pause on, and must still refuse to.
    const stored = await runPipeline(database, bundle, {
      structural: (search) => {
        if (search.stageId === bundle.stages[0].id && startsPast(search, 60) && !startsPast(search, 80)) throw new Error('timeout')
        return {
          ...okStructural(),
          candidates: [{ osmType: 'node', osmId: `v-${search.geometry[0].latitude.toFixed(4)}`, featureType: 'village', name: 'Village', latitude: search.geometry[0].latitude, longitude: 6, elevationM: null }],
          rawCandidateCount: 1,
        }
      },
    })

    const stage = stored.stages.find((candidate) => candidate.id === bundle.stages[0].id)
    const route = stored.routes.find((candidate) => candidate.id === stage.sourceRouteId)
    assert.ok(stored.routePoints.some((point) => point.name === 'Village'), 'real places WERE found on the answered stretch')

    const waypoints = computeStageWaypoints({
      stage,
      route,
      routePoints: stored.routePoints,
      climbs: stored.climbs,
      settings: { referenceSpeedKph: 20, departureTime: '08:00' },
      automaticPausesAllowed: stageAutomaticPausesAllowed(stored, stage.id),
    })
    assert.ok(waypoints.length > 0, 'the stage still renders its route and places')
    assert.ok(
      waypoints.every((waypoint) => waypoint.pauseDurationMinutes === null),
      'but not one pause — a plan built on half a stage would look finished while ignoring the rest',
    )
  } finally {
    database.close()
  }
})

test('a manual pause is never gated — the traveller\'s own choices do not depend on enrichment', async () => {
  const database = await openTestDatabase()
  try {
    const bundle = bundleWithLongStage(120)
    const stored = await runPipeline(database, bundle, {
      structural: (search) => {
        if (search.stageId === bundle.stages[0].id && startsPast(search, 60)) throw new Error('timeout')
        return {
          ...okStructural(),
          candidates: [{ osmType: 'node', osmId: 'manual-anchor', featureType: 'village', name: 'Halte', latitude: 45.1, longitude: 6, elevationM: null }],
          rawCandidateCount: 1,
        }
      },
    })
    const stage = stored.stages.find((candidate) => candidate.id === bundle.stages[0].id)
    const route = stored.routes.find((candidate) => candidate.id === stage.sourceRouteId)
    const anchor = stored.routePoints.find((point) => point.name === 'Halte')
    assert.ok(anchor !== undefined)

    const waypoints = computeStageWaypoints({
      stage,
      route,
      routePoints: stored.routePoints,
      climbs: stored.climbs,
      settings: { referenceSpeedKph: 20, departureTime: '08:00' },
      manualPauses: [{ id: 'p1', routePointId: anchor.id, durationMinutes: 30, order: 0 }],
      automaticPausesAllowed: false,
    })
    assert.ok(
      waypoints.some((waypoint) => waypoint.pauseDurationMinutes === 30),
      'a custom pause stays visible whatever the enrichment state',
    )
  } finally {
    database.close()
  }
})
