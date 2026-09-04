import '../storage/indexeddb/support/setup-fake-indexeddb.mjs'

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  computeAutomaticPausePlanForStage,
  ensureAutomaticPausePlans,
  isAutomaticPausePlanValid,
  resolvePersistedAutomaticPausePlan,
  tripNeedsAutomaticPausePlans,
  withAutomaticPausePlan,
} from '../../src/route-enrichment/automatic-pause-plan.ts'
import { runStoredTripAutomaticEnrichment, tripNeedsAutomaticEnrichment } from '../../src/route-enrichment/automatic-enrichment.ts'
import { stageFingerprintFor } from '../../src/route-enrichment/enrichment-jobs.ts'
import { computeStageWaypoints } from '../../src/analysis/waypoint-timeline.ts'
import { createTripRepository } from '../../src/storage/indexeddb/trip-repository.ts'
import { openTestDatabase } from '../storage/indexeddb/support/open-test-database.mjs'
import { createGenericTripBundle } from '../trip-core/support/generic-trip-fixture.mjs'

/**
 * Integrity-hardening sections 18-28/65-69 — the automatic pause plan
 * becomes a stable, PERSISTED result. `resolveAutomaticPlacedPauses`'s own
 * live C3 scoring is untouched (and still legitimately weather/departure-
 * time-sensitive, CDC C3 section 25/30) — what changes is that a stage's
 * CHOICE, once made, is written down and reused, never silently reshuffled
 * by a later re-render that happens to see different weather or a different
 * departure time.
 */

const KM_PER_DEGREE_LATITUDE = (Math.PI / 180) * 6_371

/** A straight 100 km line, real distance-addressable geometry (mirrors `hard-gates.test.mjs`'s own `line` helper). */
function line(lengthKm, pointCount = 400) {
  const delta = lengthKm / (pointCount - 1) / KM_PER_DEGREE_LATITUDE
  return Array.from({ length: pointCount }, (_value, index) => ({ latitude: 45 + index * delta, longitude: 6, altitudeM: 400 }))
}

/**
 * `createGenericTripBundle`'s first stage (`stage-alpha`/`route-alpha`),
 * stretched to a real 100 km line with two candidate villages near the
 * "main" pause slot (50 km) — one with an open bakery, one plain — so
 * departure-time/weather CAN flip which one C3 would pick live, giving the
 * persistence tests something real to pin against.
 */
function bundleWithTwoVillageCandidates() {
  const bundle = createGenericTripBundle()
  const stage = bundle.stages[0]
  const route = bundle.routes.find((candidate) => candidate.id === stage.sourceRouteId)
  route.geometry = { full: line(100), simplified: null }
  route.segments = [{ index: 0, name: null, distanceKm: 100, elevationGainM: 0, elevationLossM: 0 }]
  const provenance = { sourceType: 'osm', sourceId: null, fetchedAt: null, engineVersion: 'test', confidence: 'high', manuallyOverridden: false }
  const plainVillage = { id: 'village-plain', routeId: route.id, type: 'village', name: 'Plaine', latitude: 45, longitude: 6, elevationM: 400, trackDistanceKm: 49.5, osmFeatureType: 'village', lateralDistanceKm: null, provenance }
  const bakeryVillage = { id: 'village-bakery', routeId: route.id, type: 'village', name: 'Boulange', latitude: 45, longitude: 6, elevationM: 400, trackDistanceKm: 50.5, osmFeatureType: 'village', lateralDistanceKm: null, provenance }
  bundle.routePoints.push(plainVillage, bakeryVillage)
  stage.routePointIds = [...stage.routePointIds, plainVillage.id, bakeryVillage.id]
  // Cloned from the fixture's own existing practical place so every field
  // `validateTripBundle` requires (description/hidden/pinned/dayIds/...) is
  // present — only the fields this scenario actually cares about differ.
  const placeTemplate = bundle.practicalPlaces[0]
  bundle.practicalPlaces = [
    ...bundle.practicalPlaces,
    { ...placeTemplate, id: 'poi-bakery', stageId: stage.id, category: 'bakery', name: 'Boulangerie', trackDistanceKm: 50.5, detourKm: 0.05, openingHours: 'Mo 06:00-11:00' },
  ]
  const fingerprint = stageFingerprintFor(bundle, stage.id)
  bundle.enrichmentMetadata = {
    providers: bundle.enrichmentMetadata.providers,
    enrichmentJobs: [{
      stageId: stage.id,
      routeFingerprint: fingerprint,
      jobs: [
        { kind: 'structural', startKm: 0, endKm: 100, status: 'success', attempts: 1 },
        { kind: 'practical', startKm: 0, endKm: 100, status: 'success', attempts: 1 },
      ],
    }],
  }
  // 06:00 departure (Monday, `day.date` is a Monday in this fixture): the
  // moving ETA to the 50.5km bakery lands before its 11:00 closing time, so
  // it wins the slot over the plain village at 49.5km — empirically
  // confirmed against the real terrain-timing engine, not hand-computed.
  bundle.settings = { ...bundle.settings, days: [{ dayId: stage.dayId, departureTime: '06:00', totalBreakSeconds: null }] }
  return bundle
}

function idFactory(prefix = 'auto-pause') {
  let index = 0
  return () => `${prefix}-${index++}`
}

// --- pure computation --------------------------------------------------

test('computeAutomaticPausePlanForStage picks a real anchor and persists it in the exact shape computeStageWaypoints already understands as manualPauses', () => {
  const bundle = bundleWithTwoVillageCandidates()
  const stage = bundle.stages[0]
  const pauses = computeAutomaticPausePlanForStage(bundle, stage.id, idFactory())
  assert.ok(pauses !== null)
  assert.equal(pauses.length, 1, 'one candidate wins the single 30-minute-budget slot near 50km')
  const [pause] = pauses
  assert.equal(pause.routePointId, 'village-bakery', 'at the bundle\'s 06:00 departure, the open bakery wins the slot')
  assert.equal(pause.origin, 'automatic')
  assert.equal(pause.active, true)
  assert.equal(pause.durationSeconds % 300, 0, 'always a multiple of 5 minutes')
})

test('a stage with no real candidate at all produces a valid, empty plan — never a fabricated anchor', () => {
  const bundle = createGenericTripBundle()
  const stage = bundle.stages[0] // route-alpha: only start/end points, no village/town/col
  const pauses = computeAutomaticPausePlanForStage(bundle, stage.id, idFactory())
  assert.deepEqual(pauses, [])
})

test('an unresolvable stage (no day, no route) returns null — nothing to attach a plan to', () => {
  const bundle = createGenericTripBundle()
  const pauses = computeAutomaticPausePlanForStage(bundle, 'does-not-exist', idFactory())
  assert.equal(pauses, null)
})

// --- validity / persistence primitives ----------------------------------

test('withAutomaticPausePlan then isAutomaticPausePlanValid: a freshly written plan is valid against the stage\'s current fingerprint', () => {
  const bundle = bundleWithTwoVillageCandidates()
  const stage = bundle.stages[0]
  const pauses = computeAutomaticPausePlanForStage(bundle, stage.id, idFactory())
  const withPlan = withAutomaticPausePlan(bundle, stage.id, pauses)
  assert.equal(isAutomaticPausePlanValid(withPlan, stage.id), true)
  assert.equal(withPlan.enrichmentMetadata.automaticPausePlans.length, 1)
})

test('a plan whose stored fingerprint no longer matches the stage\'s current route is invalid — the GPX genuinely changed', () => {
  const bundle = bundleWithTwoVillageCandidates()
  const stage = bundle.stages[0]
  const pauses = computeAutomaticPausePlanForStage(bundle, stage.id, idFactory())
  const withPlan = withAutomaticPausePlan(bundle, stage.id, pauses)
  const staleFingerprint = {
    ...withPlan,
    enrichmentMetadata: {
      ...withPlan.enrichmentMetadata,
      automaticPausePlans: withPlan.enrichmentMetadata.automaticPausePlans.map((plan) => ({ ...plan, routeFingerprint: 'stale-fingerprint' })),
    },
  }
  assert.equal(isAutomaticPausePlanValid(staleFingerprint, stage.id), false)
})

test('resolvePersistedAutomaticPausePlan returns undefined for custom mode, for no plan, and for an invalid plan', () => {
  const bundle = bundleWithTwoVillageCandidates()
  const stage = bundle.stages[0]
  assert.equal(resolvePersistedAutomaticPausePlan(bundle, stage.id), undefined, 'nothing persisted yet')

  const pauses = computeAutomaticPausePlanForStage(bundle, stage.id, idFactory())
  const withPlan = withAutomaticPausePlan(bundle, stage.id, pauses)
  const resolved = resolvePersistedAutomaticPausePlan(withPlan, stage.id)
  assert.equal(resolved.length, 1)
  assert.equal(resolved[0].routePointId, 'village-bakery')

  const customMode = {
    ...withPlan,
    settings: { ...withPlan.settings, stages: [{ stageId: stage.id, pausePlanMode: 'custom', pauses: [] }] },
  }
  assert.equal(resolvePersistedAutomaticPausePlan(customMode, stage.id), undefined, 'custom mode never reads the persisted automatic plan')
})

// --- the actual stability guarantee --------------------------------------

test('THE core guarantee: a departure-time change that WOULD flip live C3 scoring never moves the already-persisted anchor', () => {
  const bundle = bundleWithTwoVillageCandidates()
  const stage = bundle.stages[0]
  const route = bundle.routes.find((candidate) => candidate.id === stage.sourceRouteId)

  // Computed and persisted once, at the bundle's own 06:00 departure — the
  // open bakery wins.
  const pauses = computeAutomaticPausePlanForStage(bundle, stage.id, idFactory())
  const persistedBundle = withAutomaticPausePlan(bundle, stage.id, pauses)

  // A departure-time edit (CDC section 32: never triggers a Postpass, and by
  // this feature's own contract never re-selects the anchor either) — a much
  // later departure means the bakery (open only 06:00-11:00) is now closed
  // by the time the rider would reach it.
  const daySettings = { dayId: stage.dayId, departureTime: '13:00', totalBreakSeconds: null }
  const laterBundle = { ...persistedBundle, settings: { ...persistedBundle.settings, days: [daySettings] } }

  // Proof the flip is real: a FRESH live computation at 13:00 would indeed
  // choose the plain village instead (no bakery bonus, bakery now closed).
  const freshChoice = computeAutomaticPausePlanForStage(laterBundle, stage.id, idFactory('fresh'))
  assert.equal(freshChoice[0].routePointId, 'village-plain', 'sanity check: recomputing live at 13:00 genuinely picks the OTHER village')

  // The actual guarantee: the persisted plan, fed through the normal render
  // path, still shows the ORIGINAL anchor — only ETA/opening-status may
  // differ, never the anchor itself.
  const persistedManualPauses = resolvePersistedAutomaticPausePlan(laterBundle, stage.id)
  const waypoints = computeStageWaypoints({
    stage, route, routePoints: laterBundle.routePoints, climbs: laterBundle.climbs,
    settings: { referenceSpeedKph: laterBundle.settings.global.referenceSpeedKph, departureTime: '13:00' },
    manualPauses: persistedManualPauses,
  })
  const placedPause = waypoints.find((waypoint) => waypoint.pauseDurationMinutes !== null)
  assert.equal(placedPause.id, 'village-bakery', 'the persisted plan keeps the ORIGINAL anchor despite the departure-time change')
})

test('ensureAutomaticPausePlans never recomputes an already-valid plan, even once the bundle\'s weather changes', () => {
  const bundle = bundleWithTwoVillageCandidates()
  const stage = bundle.stages[0]
  const firstPass = ensureAutomaticPausePlans(bundle, idFactory())
  const firstPlan = firstPass.enrichmentMetadata.automaticPausePlans.find((entry) => entry.stageId === stage.id)
  assert.ok(firstPlan)

  const withWeather = {
    ...firstPass,
    weather: [{ id: 'w1', dayId: stage.dayId, precipitationMm: 12, windSpeedKph: 5, temperatureMaxC: 20 }],
  }
  const secondPass = ensureAutomaticPausePlans(withWeather, idFactory('second'))
  assert.equal(secondPass, withWeather, 'nothing needed doing — returned by reference, no recomputation at all')
  const secondPlan = secondPass.enrichmentMetadata.automaticPausePlans.find((entry) => entry.stageId === stage.id)
  assert.deepEqual(secondPlan, firstPlan, 'the exact same plan survives a weather change untouched')
})

test('ensureAutomaticPausePlans is a no-op for a stage still incomplete, and for a stage in custom mode', () => {
  const bundle = createGenericTripBundle()
  const stage = bundle.stages[0]
  assert.equal(tripNeedsAutomaticPausePlans(bundle), false, 'no enrichmentJobs at all yet — not "fully enriched" by this feature\'s own gate')
  const untouched = ensureAutomaticPausePlans(bundle, idFactory())
  assert.equal(untouched, bundle)

  const complete = bundleWithTwoVillageCandidates()
  const customComplete = { ...complete, settings: { ...complete.settings, stages: [{ stageId: stage.id, pausePlanMode: 'custom', pauses: [] }] } }
  assert.equal(tripNeedsAutomaticPausePlans(customComplete), false, 'custom mode is never a candidate for an automatic plan')
  assert.equal(ensureAutomaticPausePlans(customComplete, idFactory()), customComplete)
})

// --- orchestration: the real pipeline ------------------------------------

function structuralProvider(handler) {
  return { id: 'stub-structural', async findStructuralCandidates(search) { return handler(search) } }
}
function practicalProvider(handler) {
  return { id: 'stub-practical', sourceType: 'osm', attribution: 'x', async findCandidates(search) { return handler(search) } }
}
const okStructural = () => ({ candidates: [], durationMs: 1, rawCandidateCount: 0, httpStatus: 200, payloadBytes: 0, startedAt: '2028-01-01T00:00:00.000Z', finishedAt: '2028-01-01T00:00:00.001Z' })
const okPractical = okStructural

test('the real automatic-enrichment pipeline computes and persists a stage\'s pause plan right after its POI phase completes', async () => {
  const database = await openTestDatabase()
  try {
    const bundle = createGenericTripBundle()
    bundle.routes[0].geometry = { full: line(40), simplified: null }
    bundle.routes[1].geometry = { full: line(30), simplified: null }
    const repository = createTripRepository(database)
    await repository.saveTripBundle(bundle)

    // Placed near the 20km mark (the middle of this 40km stage, well clear
    // of the départ/arrivée edge buffer) — not at the query's own segment
    // start, since a real Postpass answer can report a place found anywhere
    // within the queried area.
    const middleLatitude = 45 + 20 / KM_PER_DEGREE_LATITUDE
    await runStoredTripAutomaticEnrichment({
      database, tripId: bundle.metadata.id,
      routeEnrichmentProvider: structuralProvider((search) => ({
        ...okStructural(),
        candidates: search.stageId === bundle.stages[0].id
          ? [{ osmType: 'node', osmId: 'v1', featureType: 'village', name: 'Village', latitude: middleLatitude, longitude: 6, elevationM: null }]
          : [],
        rawCandidateCount: search.stageId === bundle.stages[0].id ? 1 : 0,
      })),
      practicalPlacesProvider: practicalProvider(okPractical),
      idFactory: idFactory('pipeline'), now: () => '2028-08-03T10:00:00.000Z',
    })

    const stored = await repository.loadTripBundle(bundle.metadata.id)
    const plan = stored.enrichmentMetadata.automaticPausePlans?.find((entry) => entry.stageId === bundle.stages[0].id)
    assert.ok(plan, 'a plan was persisted for the now-fully-enriched stage')
    assert.equal(plan.pauses.length, 1)
    assert.equal(plan.pauses[0].routePointId, stored.routePoints.find((point) => point.name === 'Village').id)

    // A second automatic pass (e.g. reopening the trip) must not recompute
    // it — `tripNeedsAutomaticEnrichment` itself must now report nothing left
    // to do for this trip.
    assert.equal(tripNeedsAutomaticEnrichment(stored, { routeEnrichmentProvider: {}, practicalPlacesProvider: {} }), false)
  } finally {
    database.close()
  }
})

test('a trip whose structural/practical work was ALREADY complete before this feature existed still gets its plan backfilled on its next open', async () => {
  const database = await openTestDatabase()
  try {
    const bundle = bundleWithTwoVillageCandidates()
    // Simulate "already fully enriched, from a session before this feature
    // existed": enrichmentJobs already complete, but genuinely no
    // automaticPausePlans field at all yet, and the provider states already
    // read `success` (so neither structural nor practical is "needed").
    bundle.enrichmentMetadata = {
      ...bundle.enrichmentMetadata,
      providers: [
        { provider: 'postpass-route-enrichment', lastAttemptedAt: '2028-01-01T00:00:00.000Z', lastSuccessAt: '2028-01-01T00:00:00.000Z', status: 'success', message: null },
        { provider: 'postpass-practical-places', lastAttemptedAt: '2028-01-01T00:00:00.000Z', lastSuccessAt: '2028-01-01T00:00:00.000Z', status: 'success', message: null },
      ],
    }
    const repository = createTripRepository(database)
    await repository.saveTripBundle(bundle)

    let structuralCalls = 0
    let practicalCalls = 0
    const report = await runStoredTripAutomaticEnrichment({
      database, tripId: bundle.metadata.id,
      routeEnrichmentProvider: structuralProvider(() => { structuralCalls += 1; return okStructural() }),
      practicalPlacesProvider: practicalProvider(() => { practicalCalls += 1; return okPractical() }),
      idFactory: idFactory('backfill'), now: () => '2028-08-03T10:00:00.000Z',
    })

    assert.equal(structuralCalls, 0, 'already-complete work is never re-attempted')
    assert.equal(practicalCalls, 0, 'already-complete work is never re-attempted')
    assert.equal(report.routeAttempted, false)
    assert.equal(report.practicalPlacesAttempted, false)
    const plan = report.bundle.enrichmentMetadata.automaticPausePlans?.find((entry) => entry.stageId === bundle.stages[0].id)
    assert.ok(plan, 'the plan was backfilled with zero network calls of its own')
  } finally {
    database.close()
  }
})
