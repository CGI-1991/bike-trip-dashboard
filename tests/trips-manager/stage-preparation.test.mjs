import assert from 'node:assert/strict'
import test from 'node:test'

import {
  computeStagePreparationOrder,
  computeTripPreparationSummary,
  deriveStagePreparationStatus,
} from '../../src/trips-manager/stage-preparation.ts'
import { stageFingerprintFor } from '../../src/route-enrichment/enrichment-jobs.ts'
import { createGenericTripBundle } from '../trip-core/support/generic-trip-fixture.mjs'

// Fixture days: day-alpha (ride, 2027-05-10), day-bravo (off, 2027-05-11),
// day-charlie (transfer, 2027-05-12), day-delta (ride, 2027-05-13).

/**
 * A stage's preparation status is now derived from its micro-job record —
 * the only thing that can honestly say what has and has not been answered.
 * These helpers write that record directly.
 */
function withJobs(bundle, stageId, kind, statuses) {
  const others = (bundle.enrichmentMetadata.enrichmentJobs ?? []).filter((entry) => entry.stageId !== stageId)
  const existing = (bundle.enrichmentMetadata.enrichmentJobs ?? []).find((entry) => entry.stageId === stageId)
  const kept = (existing?.jobs ?? []).filter((job) => job.kind !== kind)
  const added = statuses.map((status, index) => ({ kind, startKm: index * 10, endKm: (index + 1) * 10, status, attempts: 1 }))
  return {
    ...bundle,
    enrichmentMetadata: {
      ...bundle.enrichmentMetadata,
      enrichmentJobs: [...others, {
        stageId,
        routeFingerprint: stageFingerprintFor(bundle, stageId),
        jobs: [...kept, ...added],
      }],
    },
  }
}

/** Both phases of one stage, all micro-jobs in the same state. */
function withStageJobStatus(bundle, stageId, status) {
  return withJobs(withJobs(bundle, stageId, 'structural', [status]), stageId, 'practical', [status])
}

/** Every enrichable stage of the trip in the same state. */
function withAllStagesJobStatus(bundle, status) {
  return bundle.stages.reduce((current, stage) => withStageJobStatus(current, stage.id, status), bundle)
}

const BOTH_CONFIGURED = { routeEnrichmentConfigured: true, practicalPlacesConfigured: true }

// --- H-N: status derivation ---

test('H: a ride day whose providers were never attempted is "pending"', () => {
  const bundle = createGenericTripBundle()
  const status = deriveStagePreparationStatus(bundle, 'day-alpha', { runningDayId: null, staleDayIds: new Set(), ...BOTH_CONFIGURED })
  assert.equal(status, 'pending')
})

test('I: a ride day the orchestrator is actively working on is "running", regardless of persisted state', () => {
  const bundle = withAllStagesJobStatus(createGenericTripBundle(), 'success')
  const status = deriveStagePreparationStatus(bundle, 'day-alpha', { runningDayId: 'day-alpha', staleDayIds: new Set(), ...BOTH_CONFIGURED })
  assert.equal(status, 'running')
})

test('J: every micro-job of both phases answered → "ready"', () => {
  const bundle = withAllStagesJobStatus(createGenericTripBundle(), 'success')
  const status = deriveStagePreparationStatus(bundle, 'day-alpha', { runningDayId: null, staleDayIds: new Set(), ...BOTH_CONFIGURED })
  assert.equal(status, 'ready')
})

test('J: a confirmed-empty answer counts as answered — an empty stretch of countryside is a real result', () => {
  const bundle = withAllStagesJobStatus(createGenericTripBundle(), 'empty')
  assert.equal(deriveStagePreparationStatus(bundle, 'day-alpha', { runningDayId: null, staleDayIds: new Set(), ...BOTH_CONFIGURED }), 'ready')
})

test('K: some micro-jobs answered and some still outstanding → "partial"', () => {
  let bundle = createGenericTripBundle()
  bundle = withJobs(bundle, 'stage-alpha', 'structural', ['success', 'success'])
  bundle = withJobs(bundle, 'stage-alpha', 'practical', ['success', 'pending'])
  const status = deriveStagePreparationStatus(bundle, 'day-alpha', { runningDayId: null, staleDayIds: new Set(), ...BOTH_CONFIGURED })
  assert.equal(status, 'partial')
})

test('nothing answered yet → "pending", never "error" — outstanding work is not a failure', () => {
  const bundle = withAllStagesJobStatus(createGenericTripBundle(), 'pending')
  const status = deriveStagePreparationStatus(bundle, 'day-alpha', { runningDayId: null, staleDayIds: new Set(), ...BOTH_CONFIGURED })
  assert.equal(status, 'pending')
})

test('a stage blocked on connectivity says so — the one case the app cannot resolve by itself', () => {
  let bundle = createGenericTripBundle()
  bundle = withJobs(bundle, 'stage-alpha', 'structural', ['success', 'waiting-for-network'])
  bundle = withJobs(bundle, 'stage-alpha', 'practical', ['pending'])
  const status = deriveStagePreparationStatus(bundle, 'day-alpha', { runningDayId: null, staleDayIds: new Set(), ...BOTH_CONFIGURED })
  assert.equal(status, 'waiting-for-network')
})

test('M: a day a local mutation marked stale reports "stale" even though its record says complete', () => {
  const bundle = withAllStagesJobStatus(createGenericTripBundle(), 'success')
  const status = deriveStagePreparationStatus(bundle, 'day-alpha', { runningDayId: null, staleDayIds: new Set(['day-alpha']), ...BOTH_CONFIGURED })
  assert.equal(status, 'stale')
})

test('only the configured phases count — with no POI provider, a stage is ready on its structural work alone', () => {
  let bundle = createGenericTripBundle()
  bundle = withJobs(bundle, 'stage-alpha', 'structural', ['success'])
  bundle = withJobs(bundle, 'stage-alpha', 'practical', ['pending'])
  const status = deriveStagePreparationStatus(bundle, 'day-alpha', {
    runningDayId: null, staleDayIds: new Set(), routeEnrichmentConfigured: true, practicalPlacesConfigured: false,
  })
  assert.equal(status, 'ready')
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

// --- per-stage precision: one incomplete stage never marks its siblings ----

test('one incomplete stage never marks its siblings — each reads its own record', () => {
  let bundle = createGenericTripBundle()
  bundle = withStageJobStatus(bundle, 'stage-alpha', 'success')
  bundle = withJobs(bundle, 'stage-delta', 'structural', ['success'])
  bundle = withJobs(bundle, 'stage-delta', 'practical', ['success', 'pending'])
  const context = { runningDayId: null, staleDayIds: new Set(), ...BOTH_CONFIGURED }
  assert.equal(deriveStagePreparationStatus(bundle, 'day-alpha', context), 'ready', "day-alpha's own work is finished — silent")
  assert.equal(deriveStagePreparationStatus(bundle, 'day-delta', context), 'partial', 'only day-delta still has something to do')
})

test('every stage complete reads ready everywhere', () => {
  const bundle = withAllStagesJobStatus(createGenericTripBundle(), 'success')
  const context = { runningDayId: null, staleDayIds: new Set(), ...BOTH_CONFIGURED }
  assert.equal(deriveStagePreparationStatus(bundle, 'day-alpha', context), 'ready')
  assert.equal(deriveStagePreparationStatus(bundle, 'day-delta', context), 'ready')
})

test('a bundle with no job record at all reads pending — never ready by default', () => {
  const bundle = createGenericTripBundle()
  const context = { runningDayId: null, staleDayIds: new Set(), ...BOTH_CONFIGURED }
  assert.equal(deriveStagePreparationStatus(bundle, 'day-alpha', context), 'pending')
  assert.equal(deriveStagePreparationStatus(bundle, 'day-delta', context), 'pending')
})

// --- RC2 final-closeout sections 19-20: "Mes voyages" preparation summary ---

test('computeTripPreparationSummary: null once every ride day is ready — silence when healthy', () => {
  const bundle = withAllStagesJobStatus(createGenericTripBundle(), 'success')
  assert.equal(computeTripPreparationSummary(bundle, { runningDayId: null, staleDayIds: new Set(), ...BOTH_CONFIGURED }), null)
})

test('computeTripPreparationSummary: a ready/total count while the trip is actively being prepared', () => {
  let bundle = withStageJobStatus(createGenericTripBundle(), 'stage-alpha', 'success')
  bundle = withStageJobStatus(bundle, 'stage-delta', 'pending')
  const summary = computeTripPreparationSummary(bundle, { runningDayId: 'day-delta', staleDayIds: new Set(), ...BOTH_CONFIGURED })
  assert.deepEqual(summary, { ready: 1, total: 2 })
})

// DER-DES-DER section 54: only the trip actually being enriched right now
// may show this — every other trip's card stays silent.
test('section 54: no summary at all when nothing is running, even for a trip left incomplete', () => {
  let bundle = withStageJobStatus(createGenericTripBundle(), 'stage-alpha', 'success')
  bundle = withStageJobStatus(bundle, 'stage-delta', 'pending')
  assert.equal(
    computeTripPreparationSummary(bundle, { runningDayId: null, staleDayIds: new Set(), ...BOTH_CONFIGURED }),
    null,
    'a settled-but-incomplete trip is the stage card\'s business, not "Mes voyages"',
  )
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
