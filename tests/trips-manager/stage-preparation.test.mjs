import assert from 'node:assert/strict'
import test from 'node:test'

import {
  computeStagePreparationOrder,
  deriveStagePreparationStatus,
  isDayDetailOpenable,
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

// --- O: reload never yields a phantom "running" ---

test('O: after a reload (no in-memory running/stale state at all), a never-attempted ride is "pending", never "running"', () => {
  const bundle = createGenericTripBundle()
  const status = deriveStagePreparationStatus(bundle, 'day-alpha', { runningDayId: null, staleDayIds: new Set(), ...BOTH_CONFIGURED })
  assert.notEqual(status, 'running')
  assert.equal(status, 'pending')
})

// --- P-T: gating ---

test('P/Q: pending and running are not openable', () => {
  assert.equal(isDayDetailOpenable('pending'), false)
  assert.equal(isDayDetailOpenable('running'), false)
})

test('R/S/T: ready, partial and error are all openable — a network hiccup never blocks the day forever', () => {
  assert.equal(isDayDetailOpenable('ready'), true)
  assert.equal(isDayDetailOpenable('partial'), true)
  assert.equal(isDayDetailOpenable('error'), true)
})

test('stale (a ready day being refreshed) stays openable — the previous snapshot is still shown', () => {
  assert.equal(isDayDetailOpenable('stale'), true)
})

test('null (OFF/transfer) is always openable', () => {
  assert.equal(isDayDetailOpenable(null), true)
})

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
