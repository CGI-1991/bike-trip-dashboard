import '../storage/indexeddb/support/setup-fake-indexeddb.mjs'

import assert from 'node:assert/strict'
import test from 'node:test'

import { runStoredTripAutomaticEnrichment } from '../../src/route-enrichment/automatic-enrichment.ts'
import { enrichableStageFingerprints, isStructuralGloballyComplete } from '../../src/route-enrichment/enrichment-jobs.ts'
import { resetEnrichmentForRecalculation } from '../../src/route-enrichment/settled-stages.ts'
import { createRouteEnrichmentCacheRepository } from '../../src/storage/indexeddb/route-enrichment-cache-repository.ts'
import { createTripRepository } from '../../src/storage/indexeddb/trip-repository.ts'
import { openTestDatabase } from '../storage/indexeddb/support/open-test-database.mjs'
import { createGenericTripBundle } from '../trip-core/support/generic-trip-fixture.mjs'

/**
 * "Recalculer les données du parcours" is the one deliberate way to make a
 * finished trip re-query everything — for a trip prepared months ahead, whose
 * shops and services may since have changed. Everything else about the
 * pipeline is designed never to do that.
 */

const ok = () => ({ candidates: [], durationMs: 1, rawCandidateCount: 0, httpStatus: 200, payloadBytes: 0, startedAt: '2028-01-01T00:00:00.000Z', finishedAt: '2028-01-01T00:00:00.001Z' })

async function enrich(database, tripId, counters, now) {
  await runStoredTripAutomaticEnrichment({
    database,
    tripId,
    routeEnrichmentProvider: { id: 's', async findStructuralCandidates() { counters.structural += 1; return ok() } },
    practicalPlacesProvider: { id: 'p', sourceType: 'osm', attribution: 'x', async findCandidates() { counters.practical += 1; return ok() } },
    idFactory: (() => { let n = 0; return () => `gen-${now}-${n++}` })(),
    now: () => now,
  })
}

test('a complete trip re-queries everything after an explicit recalculation, and nothing before it', async () => {
  const database = await openTestDatabase()
  try {
    const bundle = createGenericTripBundle()
    const repository = createTripRepository(database)
    await repository.saveTripBundle(bundle)
    const counters = { structural: 0, practical: 0 }

    await enrich(database, bundle.metadata.id, counters, '2028-08-03T10:00:00.000Z')
    const afterFirst = { ...counters }
    assert.ok(afterFirst.structural > 0 && afterFirst.practical > 0)

    // Reopening changes nothing: the trip is finished.
    await enrich(database, bundle.metadata.id, counters, '2028-08-04T10:00:00.000Z')
    assert.deepEqual(counters, afterFirst, 'a finished trip costs nothing on reopen')

    // The deliberate action — exactly what the editor performs: forget the
    // job record AND the cached answers, since the point is to pick up
    // changes in OSM itself.
    const stored = await repository.loadTripBundle(bundle.metadata.id)
    await createRouteEnrichmentCacheRepository(database).clearForRouteFingerprints(enrichableStageFingerprints(stored))
    await repository.saveTripBundle(resetEnrichmentForRecalculation(stored))
    await enrich(database, bundle.metadata.id, counters, '2028-08-05T10:00:00.000Z')

    assert.ok(counters.structural > afterFirst.structural, 'structure is genuinely re-queried')
    assert.ok(counters.practical > afterFirst.practical, 'and so are the POI')
    const recalculated = await repository.loadTripBundle(bundle.metadata.id)
    assert.equal(isStructuralGloballyComplete(recalculated), true, 'and it completes again')
  } finally {
    database.close()
  }
})

test('recalculation preserves every manual value — pauses, notes, lodging, transfers, overrides, departure time', async () => {
  const database = await openTestDatabase()
  try {
    const bundle = createGenericTripBundle()
    bundle.settings.stages = [{
      stageId: bundle.stages[0].id,
      pausePlanMode: 'custom',
      pauses: [{ id: 'p1', active: true, routePointId: bundle.routePoints[0].id, durationSeconds: 900, order: 0, origin: 'custom' }],
    }]
    bundle.settings.days[0].departureTime = '06:30'
    bundle.days[1].notes = 'Réserver le gîte'
    bundle.days[2].transferMode = 'train'
    bundle.days[2].startLocationName = 'Chez un ami'
    const repository = createTripRepository(database)
    await repository.saveTripBundle(bundle)
    const counters = { structural: 0, practical: 0 }
    await enrich(database, bundle.metadata.id, counters, '2028-08-03T10:00:00.000Z')

    const before = await repository.loadTripBundle(bundle.metadata.id)
    await createRouteEnrichmentCacheRepository(database).clearForRouteFingerprints(enrichableStageFingerprints(before))
    await repository.saveTripBundle(resetEnrichmentForRecalculation(before))
    await enrich(database, bundle.metadata.id, counters, '2028-08-05T10:00:00.000Z')
    const after = await repository.loadTripBundle(bundle.metadata.id)

    assert.deepEqual(after.settings.stages, before.settings.stages, 'custom pauses survive')
    assert.equal(after.settings.days.find((entry) => entry.dayId === bundle.days[0].id)?.departureTime, '06:30')
    assert.equal(after.days.find((day) => day.id === bundle.days[1].id)?.notes, 'Réserver le gîte')
    assert.equal(after.days.find((day) => day.id === bundle.days[2].id)?.transferMode, 'train')
    assert.equal(after.days.find((day) => day.id === bundle.days[2].id)?.startLocationName, 'Chez un ami')
    assert.deepEqual(after.accommodations, before.accommodations)
  } finally {
    database.close()
  }
})
