import assert from 'node:assert/strict'
import test from 'node:test'

import {
  isStagePhaseComplete,
  isStructuralGloballyComplete,
  stageRouteLengthKm,
} from '../../src/route-enrichment/enrichment-jobs.ts'
import { migrateEnrichmentJobs, resetEnrichmentForRecalculation } from '../../src/route-enrichment/settled-stages.ts'
import { createGenericTripBundle } from '../trip-core/support/generic-trip-fixture.mjs'

/**
 * Migrating a trip saved under the previous, stage-level completion model.
 *
 * That model stamped a stage's route fingerprint as soon as the stage had
 * been ATTEMPTED — including when some of its segments timed out. So a saved
 * trip can be internally contradictory: provider `partial`, yet every stage
 * marked settled. Read naively it looks finished and is never touched again,
 * which is how a stage stayed enriched over its first stretch only.
 *
 * The migration therefore has to judge whether the old record is credible,
 * and it must get BOTH directions right: a healthy trip must not be
 * needlessly re-queried, and a doubtful one must not be trusted.
 */

const STRUCTURAL = 'postpass-route-enrichment'
const PRACTICAL = 'postpass-practical-places'

function providerState(provider, status, settledFingerprints) {
  return {
    provider,
    lastAttemptedAt: '2028-01-01T00:00:00.000Z',
    lastSuccessAt: status === 'success' ? '2028-01-01T00:00:00.000Z' : null,
    status,
    message: null,
    ...(settledFingerprints === undefined ? {} : { settledFingerprints }),
  }
}

/** The fingerprint the old model would have stamped for the fixture's one enrichable route. */
function fingerprintOf(bundle) {
  const sourceFile = bundle.sourceFiles.find((file) => file.id === bundle.routes[0].sourceFileId)
  return `sha256:${sourceFile.sha256}`
}

function legacyBundle(structuralStatus, practicalStatus) {
  const bundle = createGenericTripBundle()
  const fingerprint = fingerprintOf(bundle)
  bundle.enrichmentMetadata = {
    providers: [
      providerState(STRUCTURAL, structuralStatus, [fingerprint]),
      providerState(PRACTICAL, practicalStatus, [fingerprint]),
    ],
  }
  return bundle
}

const stageId = () => createGenericTripBundle().stages[0].id

// --- the healthy trip: migrate to complete, never re-fetch -----------------

test('a legacy trip whose providers both succeeded migrates straight to complete — and needs no network at all', () => {
  const migrated = migrateEnrichmentJobs(legacyBundle('success', 'success'))
  assert.equal(isStagePhaseComplete(migrated, stageId(), 'structural'), true)
  assert.equal(isStagePhaseComplete(migrated, stageId(), 'practical'), true)
  assert.equal(isStructuralGloballyComplete(migrated), true)
})

test('the migrated healthy trip records what the old pass actually did — one whole-route job per phase, not an invented segmented history', () => {
  const migrated = migrateEnrichmentJobs(legacyBundle('success', 'success'))
  const record = migrated.enrichmentMetadata.enrichmentJobs.find((entry) => entry.stageId === stageId())
  const structural = record.jobs.filter((job) => job.kind === 'structural')
  assert.equal(structural.length, 1)
  assert.equal(structural[0].startKm, 0)
  assert.ok(Math.abs(structural[0].endKm - stageRouteLengthKm(migrated, stageId())) < 0.01)
  assert.equal(structural[0].status, 'success')
})

// --- the doubtful trip: this is the Genappe → Middelkerke case -------------

test('a legacy trip marked settled while its provider says "partial" is NOT trusted — the stage is incomplete and gets fresh work', () => {
  const migrated = migrateEnrichmentJobs(legacyBundle('partial', 'success'))
  assert.equal(
    isStagePhaseComplete(migrated, stageId(), 'structural'),
    false,
    'the old record stamped this stage despite a failed segment; it cannot be believed',
  )
  assert.equal(isStructuralGloballyComplete(migrated), false)
  const record = migrated.enrichmentMetadata.enrichmentJobs.find((entry) => entry.stageId === stageId())
  const structural = record.jobs.filter((job) => job.kind === 'structural')
  assert.ok(structural.length > 1, 'a real segmented plan, ready to be worked through')
  assert.ok(structural.every((job) => job.status === 'pending'))
})

test('a legacy trip whose provider says "error" is treated the same way — attempted is not completed', () => {
  const migrated = migrateEnrichmentJobs(legacyBundle('error', 'error'))
  assert.equal(isStagePhaseComplete(migrated, stageId(), 'structural'), false)
  assert.equal(isStagePhaseComplete(migrated, stageId(), 'practical'), false)
})

test('the two phases are judged independently — a healthy structural pass survives a doubtful POI one', () => {
  const migrated = migrateEnrichmentJobs(legacyBundle('success', 'partial'))
  assert.equal(isStagePhaseComplete(migrated, stageId(), 'structural'), true, 'no needless re-query of good structural data')
  assert.equal(isStagePhaseComplete(migrated, stageId(), 'practical'), false, 'but the doubtful POI work is picked up again')
})

// --- shape and idempotence -------------------------------------------------

test('a trip that was never enriched at all migrates to a fully pending plan', () => {
  const migrated = migrateEnrichmentJobs(createGenericTripBundle())
  const record = migrated.enrichmentMetadata.enrichmentJobs.find((entry) => entry.stageId === stageId())
  assert.ok(record.jobs.length > 0)
  assert.ok(record.jobs.every((job) => job.status === 'pending'))
})

test('migration is idempotent — running it twice changes nothing and returns the very same object', () => {
  const once = migrateEnrichmentJobs(legacyBundle('success', 'success'))
  const twice = migrateEnrichmentJobs(once)
  assert.equal(twice, once, 'returned by reference, so a caller can skip a pointless save')
})

test('a stage whose route changed since the record was written is replanned rather than trusted', () => {
  const migrated = migrateEnrichmentJobs(legacyBundle('success', 'success'))
  assert.equal(isStagePhaseComplete(migrated, stageId(), 'structural'), true)
  const replaced = structuredClone(migrated)
  replaced.sourceFiles[0].sha256 = 'c'.repeat(64) // a different GPX for that route
  assert.equal(isStagePhaseComplete(replaced, stageId(), 'structural'), false)
})

test('a trip with no enrichable geometry at all is left untouched', () => {
  const bundle = createGenericTripBundle()
  bundle.routes[0].geometry = { full: null, simplified: null }
  assert.equal(migrateEnrichmentJobs(bundle), bundle)
})

// --- "Recalculer les données du parcours" ----------------------------------

test('the recalculation reset discards every job AND the legacy marks, so nothing can re-derive "already complete"', () => {
  const migrated = migrateEnrichmentJobs(legacyBundle('success', 'success'))
  assert.equal(isStagePhaseComplete(migrated, stageId(), 'structural'), true)

  const reset = resetEnrichmentForRecalculation(migrated)
  assert.equal(reset.enrichmentMetadata.enrichmentJobs, undefined)
  for (const state of reset.enrichmentMetadata.providers) {
    assert.equal(state.status, 'pending')
    assert.equal(state.settledFingerprints, undefined, 'the old marks go too — otherwise migration would resurrect the state just discarded')
  }
  assert.equal(isStagePhaseComplete(migrateEnrichmentJobs(reset), stageId(), 'structural'), false)
})

test('the reset touches provider bookkeeping only — custom pauses, notes, lodging, transfers and overrides all survive', () => {
  const bundle = legacyBundle('success', 'success')
  bundle.settings.stages = [{
    stageId: bundle.stages[0].id,
    pausePlanMode: 'custom',
    pauses: [{ id: 'p1', active: true, routePointId: bundle.routePoints[0].id, durationSeconds: 900, order: 0, origin: 'custom' }],
  }]
  bundle.days[1].notes = 'Réserver le gîte'
  bundle.days[2].transferMode = 'train'
  bundle.days[2].startLocationName = 'Chez un ami'
  bundle.settings.days[0].departureTime = '06:30'

  const reset = resetEnrichmentForRecalculation(bundle)
  assert.deepEqual(reset.settings, bundle.settings, 'custom pauses and departure times preserved')
  assert.deepEqual(reset.days, bundle.days, 'notes, lodging, transfers and location overrides preserved')
  assert.deepEqual(reset.accommodations, bundle.accommodations)
  assert.deepEqual(reset.routes, bundle.routes)
})
