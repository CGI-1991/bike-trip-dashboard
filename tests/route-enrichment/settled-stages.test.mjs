import assert from 'node:assert/strict'
import test from 'node:test'

import {
  enrichableStageFingerprints,
  providerHasPendingStages,
  resetEnrichmentForRecalculation,
  unsettleStageForRetry,
  withSettledFingerprints,
} from '../../src/route-enrichment/settled-stages.ts'
import { createGenericTripBundle } from '../trip-core/support/generic-trip-fixture.mjs'

/**
 * DER-DES-DER sections 26/31-37 — "has this provider already finished with
 * this stage?" is answered from an explicit record, never inferred from the
 * absence of an error.
 */

const PROVIDER = 'postpass-practical-places'

function withProvider(bundle, overrides = {}) {
  return {
    ...bundle,
    enrichmentMetadata: {
      ...bundle.enrichmentMetadata,
      providers: [{ provider: PROVIDER, lastAttemptedAt: null, lastSuccessAt: null, status: 'pending', message: null, ...overrides }],
    },
  }
}

/** The generic fixture's route2 has no geometry by default; give it some so both stages are enrichable. */
function withTwoEnrichableStages(bundle) {
  bundle.routes[1].geometry = {
    full: null,
    simplified: [
      { latitude: 46, longitude: 7, altitudeM: 800 },
      { latitude: 46.1, longitude: 7.2, altitudeM: 1200 },
    ],
  }
  return bundle
}

// --- the enrichable set -----------------------------------------------------

test('enrichableStageFingerprints only counts stages with usable route geometry', () => {
  assert.equal(enrichableStageFingerprints(createGenericTripBundle()).length, 1, 'route2 has no geometry in the base fixture')
  assert.equal(enrichableStageFingerprints(withTwoEnrichableStages(createGenericTripBundle())).length, 2)
})

// --- AC-AI / sections 31-32: the one-shot gate ------------------------------

test('section 32: with no settled record at all, the historical status gate still applies (a legacy bundle keeps working)', () => {
  const bundle = createGenericTripBundle()
  assert.equal(providerHasPendingStages(withProvider(bundle, { status: 'partial' }), PROVIDER), true)
  assert.equal(providerHasPendingStages(withProvider(bundle, { status: 'success' }), PROVIDER), false)
})

test('AC: once every enrichable stage is settled, the provider has nothing pending — whatever its status says', () => {
  const bundle = withTwoEnrichableStages(createGenericTripBundle())
  const settled = enrichableStageFingerprints(bundle)
  for (const status of ['success', 'partial', 'error']) {
    assert.equal(
      providerHasPendingStages(withProvider(bundle, { status, settledFingerprints: settled }), PROVIDER),
      false,
      `status ${status}: a settled stage is settled, error or not (section 50: no automatic retry)`,
    )
  }
})

test('section 40: a partially-settled trip still has pending work — the pass resumes at what is missing, never from scratch', () => {
  const bundle = withTwoEnrichableStages(createGenericTripBundle())
  const [first] = enrichableStageFingerprints(bundle)
  assert.equal(providerHasPendingStages(withProvider(bundle, { status: 'pending', settledFingerprints: [first] }), PROVIDER), true)
})

test('a trip with nothing enrichable at all never has pending work', () => {
  const bundle = createGenericTripBundle()
  bundle.routes[0].geometry = { full: null, simplified: null }
  assert.equal(providerHasPendingStages(withProvider(bundle, { status: 'pending' }), PROVIDER), false)
})

// --- section 33: what DOES invalidate a settled stage -----------------------

test('section 33: replacing a route\'s GPX changes its fingerprint, so that stage becomes pending again on its own', () => {
  const bundle = withTwoEnrichableStages(createGenericTripBundle())
  const settled = withProvider(bundle, { status: 'success', settledFingerprints: enrichableStageFingerprints(bundle) })
  assert.equal(providerHasPendingStages(settled, PROVIDER), false)
  const replaced = structuredClone(settled)
  replaced.sourceFiles[0].sha256 = 'f'.repeat(64)
  assert.equal(providerHasPendingStages(replaced, PROVIDER), true)
})

test('withSettledFingerprints drops fingerprints that no longer belong to the trip, so the record cannot grow unbounded', () => {
  const bundle = createGenericTripBundle()
  const state = { provider: PROVIDER, lastAttemptedAt: null, lastSuccessAt: null, status: 'success', message: null, settledFingerprints: ['route:gone:old-geometry'] }
  const updated = withSettledFingerprints(bundle, state, enrichableStageFingerprints(bundle))
  assert.deepEqual(updated.settledFingerprints, enrichableStageFingerprints(bundle))
  assert.ok(!updated.settledFingerprints.includes('route:gone:old-geometry'))
})

test('withSettledFingerprints is deterministic and idempotent — two identical passes persist the same value, no churn', () => {
  const bundle = withTwoEnrichableStages(createGenericTripBundle())
  const state = { provider: PROVIDER, lastAttemptedAt: null, lastSuccessAt: null, status: 'success', message: null }
  const once = withSettledFingerprints(bundle, state, enrichableStageFingerprints(bundle))
  const twice = withSettledFingerprints(bundle, once, enrichableStageFingerprints(bundle))
  assert.deepEqual(twice.settledFingerprints, once.settledFingerprints)
})

// --- sections 48/52: the explicit per-stage retry ---------------------------

test('BE/section 48: unsettleStageForRetry forgets exactly one stage — every other stage stays settled and is still skipped', () => {
  const bundle = withTwoEnrichableStages(createGenericTripBundle())
  const settled = withProvider(bundle, { status: 'partial', settledFingerprints: enrichableStageFingerprints(bundle) })
  const retried = unsettleStageForRetry(settled, bundle.stages[1].dayId)
  const remaining = retried.enrichmentMetadata.providers[0].settledFingerprints
  assert.equal(remaining.length, 1, 'only the retried stage was forgotten')
  assert.equal(providerHasPendingStages(retried, PROVIDER), true)
})

test('unsettleStageForRetry leaves a provider with no settled record untouched — it is already on the status gate', () => {
  const bundle = withTwoEnrichableStages(createGenericTripBundle())
  const settled = withProvider(bundle, { status: 'partial' })
  const retried = unsettleStageForRetry(settled, bundle.stages[0].dayId)
  assert.equal(retried.enrichmentMetadata.providers[0].settledFingerprints, undefined)
})

test('unsettleStageForRetry on an unknown day is a harmless no-op', () => {
  const bundle = withProvider(createGenericTripBundle(), { status: 'partial', settledFingerprints: ['x'] })
  assert.equal(unsettleStageForRetry(bundle, 'day-does-not-exist'), bundle)
})

// --- AJ-AO / sections 34-37: "Recalculer les données du parcours" -----------

test('AL/AM: the recalculation reset makes every provider pending again, so the next pass genuinely re-queries every stage', () => {
  const bundle = withTwoEnrichableStages(createGenericTripBundle())
  const settled = withProvider(bundle, { status: 'success', settledFingerprints: enrichableStageFingerprints(bundle) })
  assert.equal(providerHasPendingStages(settled, PROVIDER), false)

  const reset = resetEnrichmentForRecalculation(settled)
  assert.equal(reset.enrichmentMetadata.providers[0].status, 'pending')
  assert.equal(reset.enrichmentMetadata.providers[0].settledFingerprints, undefined)
  assert.equal(providerHasPendingStages(reset, PROVIDER), true)
})

test('AL: clearing the settled record alone would NOT be enough — the reset must also drop a "success" status', () => {
  const bundle = createGenericTripBundle()
  const settled = withProvider(bundle, { status: 'success', settledFingerprints: enrichableStageFingerprints(bundle) })
  const reset = resetEnrichmentForRecalculation(settled)
  assert.notEqual(reset.enrichmentMetadata.providers[0].status, 'success')
})

test('AN/AO/section 37: the reset touches provider bookkeeping only — custom pauses, notes, lodging, transfers and overrides all survive', () => {
  const bundle = createGenericTripBundle()
  bundle.settings.stages = [{
    stageId: bundle.stages[0].id,
    pausePlanMode: 'custom',
    pauses: [{ id: 'p1', active: true, routePointId: bundle.routePoints[0].id, durationSeconds: 900, order: 0, origin: 'custom' }],
  }]
  bundle.days[1].notes = 'Réserver le gîte'
  bundle.days[2].transferMode = 'train'
  bundle.days[2].startLocationName = 'Chez un ami'
  bundle.settings.days[0].departureTime = '06:30'
  const settled = withProvider(bundle, { status: 'success', settledFingerprints: enrichableStageFingerprints(bundle) })

  const reset = resetEnrichmentForRecalculation(settled)
  assert.deepEqual(reset.settings.stages, settled.settings.stages, 'AN: custom pauses preserved')
  assert.deepEqual(reset.days, settled.days, 'AO: notes, lodging, transfers and location overrides preserved')
  assert.deepEqual(reset.settings.days, settled.settings.days, 'departure times preserved')
  assert.deepEqual(reset.accommodations, settled.accommodations)
  assert.deepEqual(reset.routes, settled.routes)
})

test('the reset also clears the per-stage POI error list — it described the previous pass, not the new one', () => {
  const bundle = createGenericTripBundle()
  const settled = {
    ...withProvider(bundle, { status: 'partial', settledFingerprints: enrichableStageFingerprints(bundle) }),
  }
  settled.enrichmentMetadata = { ...settled.enrichmentMetadata, practicalPlacesStageErrors: ['day-alpha'] }
  const reset = resetEnrichmentForRecalculation(settled)
  assert.equal(reset.enrichmentMetadata.practicalPlacesStageErrors, undefined)
})
