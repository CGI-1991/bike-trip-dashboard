import assert from 'node:assert/strict'
import test from 'node:test'

import {
  computeStagePreparationOrder,
  computeTripPreparationSummary,
  deriveStagePreparationStatus,
} from '../../src/trips-manager/stage-preparation.ts'
import { createGenericTripBundle } from '../trip-core/support/generic-trip-fixture.mjs'

// Fixture days: day-alpha (ride, 2027-05-10), day-bravo (off, 2027-05-11),
// day-charlie (transfer, 2027-05-12), day-delta (ride, 2027-05-13).

function withProviderStatus(bundle, provider, status) {
  return {
    ...bundle,
    enrichmentMetadata: {
      providers: [
        ...bundle.enrichmentMetadata.providers.filter((state) => state.provider !== provider),
        { provider, lastAttemptedAt: null, lastSuccessAt: null, status, message: null },
      ],
    },
  }
}

const BOTH_CONFIGURED = { routeEnrichmentConfigured: true, practicalPlacesConfigured: true }

// --- H-N: status derivation ---

test('H: a ride day whose providers were never attempted is "pending"', () => {
  const bundle = createGenericTripBundle()
  const status = deriveStagePreparationStatus(bundle, 'day-alpha', { runningDayId: null, staleDayIds: new Set(), ...BOTH_CONFIGURED })
  assert.equal(status, 'pending')
})

test('I: a ride day the orchestrator is actively working on is "running", regardless of persisted state', () => {
  const bundle = withProviderStatus(withProviderStatus(createGenericTripBundle(), 'postpass-route-enrichment', 'success'), 'postpass-practical-places', 'success')
  const status = deriveStagePreparationStatus(bundle, 'day-alpha', { runningDayId: 'day-alpha', staleDayIds: new Set(), ...BOTH_CONFIGURED })
  assert.equal(status, 'running')
})

test('J: both providers succeeded → "ready"', () => {
  let bundle = createGenericTripBundle()
  bundle = withProviderStatus(bundle, 'postpass-route-enrichment', 'success')
  bundle = withProviderStatus(bundle, 'postpass-practical-places', 'success')
  const status = deriveStagePreparationStatus(bundle, 'day-alpha', { runningDayId: null, staleDayIds: new Set(), ...BOTH_CONFIGURED })
  assert.equal(status, 'ready')
})

test('K: one provider partial, none in error → "partial"', () => {
  let bundle = createGenericTripBundle()
  bundle = withProviderStatus(bundle, 'postpass-route-enrichment', 'success')
  bundle = withProviderStatus(bundle, 'postpass-practical-places', 'partial')
  const status = deriveStagePreparationStatus(bundle, 'day-alpha', { runningDayId: null, staleDayIds: new Set(), ...BOTH_CONFIGURED })
  assert.equal(status, 'partial')
})

test('L: a provider in error with no success anywhere → "error"', () => {
  let bundle = createGenericTripBundle()
  bundle = withProviderStatus(bundle, 'postpass-route-enrichment', 'error')
  bundle = withProviderStatus(bundle, 'postpass-practical-places', 'error')
  const status = deriveStagePreparationStatus(bundle, 'day-alpha', { runningDayId: null, staleDayIds: new Set(), ...BOTH_CONFIGURED })
  assert.equal(status, 'error')
})

test('M: a day a local mutation marked stale reports "stale" even though its persisted state is still "success"', () => {
  let bundle = createGenericTripBundle()
  bundle = withProviderStatus(bundle, 'postpass-route-enrichment', 'success')
  bundle = withProviderStatus(bundle, 'postpass-practical-places', 'success')
  const status = deriveStagePreparationStatus(bundle, 'day-alpha', { runningDayId: null, staleDayIds: new Set(['day-alpha']), ...BOTH_CONFIGURED })
  assert.equal(status, 'stale')
})

test('OFF/transfer days have no Postpass status at all — always null, never gated', () => {
  const bundle = createGenericTripBundle()
  assert.equal(deriveStagePreparationStatus(bundle, 'day-bravo', { runningDayId: null, staleDayIds: new Set(), ...BOTH_CONFIGURED }), null)
  assert.equal(deriveStagePreparationStatus(bundle, 'day-charlie', { runningDayId: null, staleDayIds: new Set(), ...BOTH_CONFIGURED }), null)
})

test('no provider configured in this deployment/test → "ready" (never a permanently pending ride with nothing that will ever run)', () => {
  const bundle = createGenericTripBundle()
  const status = deriveStagePreparationStatus(bundle, 'day-alpha', { runningDayId: null, staleDayIds: new Set(), routeEnrichmentConfigured: false, practicalPlacesConfigured: false })
  assert.equal(status, 'ready')
})

// --- RC2 final-closeout section 18: per-stage POI precision on a trip-wide "partial" ---

function withStageErrors(bundle, stageErrors) {
  return { ...bundle, enrichmentMetadata: { ...bundle.enrichmentMetadata, practicalPlacesStageErrors: stageErrors } }
}

test('RC2 section 18: practicalPlacesStageErrors pinpoints only the genuinely-failing stage — the sibling ride day reads "ready", not "partial"', () => {
  let bundle = createGenericTripBundle()
  bundle = withProviderStatus(bundle, 'postpass-route-enrichment', 'success')
  bundle = withProviderStatus(bundle, 'postpass-practical-places', 'partial')
  bundle = withStageErrors(bundle, ['day-delta'])
  const context = { runningDayId: null, staleDayIds: new Set(), ...BOTH_CONFIGURED }
  assert.equal(deriveStagePreparationStatus(bundle, 'day-alpha', context), 'ready', 'day-alpha\'s own POI succeeded — silent, never "toutes les vignettes semblent partial"')
  assert.equal(deriveStagePreparationStatus(bundle, 'day-delta', context), 'partial', 'only day-delta is actually still missing something')
})

test('RC2 section 18: an empty practicalPlacesStageErrors (every stage settled) reads "ready" everywhere, even while the trip-wide aggregate is still "partial"', () => {
  let bundle = createGenericTripBundle()
  bundle = withProviderStatus(bundle, 'postpass-route-enrichment', 'success')
  bundle = withProviderStatus(bundle, 'postpass-practical-places', 'partial')
  bundle = withStageErrors(bundle, [])
  const context = { runningDayId: null, staleDayIds: new Set(), ...BOTH_CONFIGURED }
  assert.equal(deriveStagePreparationStatus(bundle, 'day-alpha', context), 'ready')
  assert.equal(deriveStagePreparationStatus(bundle, 'day-delta', context), 'ready')
})

test('RC2 section 18: a legacy bundle with no practicalPlacesStageErrors at all falls back to the coarse trip-wide value for every stage, exactly like before', () => {
  let bundle = createGenericTripBundle()
  bundle = withProviderStatus(bundle, 'postpass-route-enrichment', 'success')
  bundle = withProviderStatus(bundle, 'postpass-practical-places', 'partial')
  const context = { runningDayId: null, staleDayIds: new Set(), ...BOTH_CONFIGURED }
  assert.equal(deriveStagePreparationStatus(bundle, 'day-alpha', context), 'partial')
  assert.equal(deriveStagePreparationStatus(bundle, 'day-delta', context), 'partial')
})

// --- RC2 final-closeout sections 19-20: "Mes voyages" preparation summary ---

test('computeTripPreparationSummary: null once every ride day is ready — silence when healthy', () => {
  let bundle = createGenericTripBundle()
  bundle = withProviderStatus(bundle, 'postpass-route-enrichment', 'success')
  bundle = withProviderStatus(bundle, 'postpass-practical-places', 'success')
  assert.equal(computeTripPreparationSummary(bundle, { runningDayId: null, staleDayIds: new Set(), ...BOTH_CONFIGURED }), null)
})

test('computeTripPreparationSummary: a ready/total count while at least one ride day isn\'t ready yet', () => {
  let bundle = createGenericTripBundle()
  bundle = withProviderStatus(bundle, 'postpass-route-enrichment', 'success')
  bundle = withProviderStatus(bundle, 'postpass-practical-places', 'partial')
  bundle = withStageErrors(bundle, ['day-delta'])
  const summary = computeTripPreparationSummary(bundle, { runningDayId: null, staleDayIds: new Set(), ...BOTH_CONFIGURED })
  assert.deepEqual(summary, { ready: 1, total: 2 })
})

test('computeTripPreparationSummary: null for a trip with no ride day at all', () => {
  const bundle = { ...createGenericTripBundle(), days: createGenericTripBundle().days.filter((day) => day.type !== 'ride') }
  assert.equal(computeTripPreparationSummary(bundle, { runningDayId: null, staleDayIds: new Set(), ...BOTH_CONFIGURED }), null)
})

// --- O: reload never yields a phantom "running" ---

test('O: after a reload (no in-memory running/stale state at all), a never-attempted ride is "pending", never "running"', () => {
  const bundle = createGenericTripBundle()
  const status = deriveStagePreparationStatus(bundle, 'day-alpha', { runningDayId: null, staleDayIds: new Set(), ...BOTH_CONFIGURED })
  assert.notEqual(status, 'running')
  assert.equal(status, 'pending')
})

// --- R3 sections 41-42: Postpass status is display-only, never a gate ------
// `isDayDetailOpenable` (and the gating it powered in `trips-manager.ts`'s
// `open-day-detail` handler) was removed outright — a ride's own
// route/profil/timing/timeline never depended on Postpass in the first
// place, and the strictly-sequential per-stage enrichment pass meant EVERY
// ride day stayed blocked for the whole pass, not just the one stage being
// enriched. `deriveStagePreparationStatus` itself is untouched — it still
// drives the small, honest indicator glyph (tests above), just never a
// click gate any more. The end-to-end "a pending/running stage still
// opens" behaviour is covered in `tests/ui/trips-manager-stage-preparation.
// test.mjs` (tests S-V, CDC section 51), closer to the real click path.

// --- A-D: priority ordering ---

test('A: before the trip starts, ride days are processed in plain chronological order', () => {
  const bundle = createGenericTripBundle()
  const order = computeStagePreparationOrder(bundle, '2027-05-01')
  assert.deepEqual(order, ['day-alpha', 'day-delta'])
})

test('E: OFF/transfer days are never included in the preparation order', () => {
  const bundle = createGenericTripBundle()
  const order = computeStagePreparationOrder(bundle, '2027-05-01')
  assert.ok(!order.includes('day-bravo'))
  assert.ok(!order.includes('day-charlie'))
})

test('B/C/D: mid-trip, the priority day comes first, future rides next, past incomplete rides last', () => {
  const bundle = createGenericTripBundle()
  // day-delta (2027-05-13) is the priority day once day-alpha (2027-05-10) is already ridden.
  const order = computeStagePreparationOrder(bundle, '2027-05-13')
  assert.deepEqual(order, ['day-delta', 'day-alpha'], 'the priority ride first, the already-past ride last')
})

test('an undated trip (no priority day at all) falls back to plain chronological order', () => {
  const bundle = createGenericTripBundle({ dated: false })
  const order = computeStagePreparationOrder(bundle, null)
  assert.deepEqual(order, ['day-alpha', 'day-delta'])
})
