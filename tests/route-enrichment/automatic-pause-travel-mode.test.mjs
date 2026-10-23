import assert from 'node:assert/strict'
import test from 'node:test'

import {
  computeAutomaticPausePlanForStage,
  ensureAutomaticPausePlans,
  isAutomaticPausePlanValid,
  refreshAutomaticPausePlansForTravelMode,
  resolvePersistedAutomaticPausePlan,
  withAutomaticPausePlan,
} from '../../src/route-enrichment/automatic-pause-plan.ts'
import { stageFingerprintFor } from '../../src/route-enrichment/enrichment-jobs.ts'
import { computeStageTimingCurve, computeStageWaypoints } from '../../src/analysis/waypoint-timeline.ts'
import { createGenericTripBundle } from '../trip-core/support/generic-trip-fixture.mjs'

function ids(prefix = 'new') {
  let index = 0
  return () => `${prefix}-${index++}`
}

/** A bakery near halfway closes before a walker arrives, but after a cyclist. */
function preparedTrip() {
  const bundle = createGenericTripBundle()
  const stage = bundle.stages[0]
  const route = bundle.routes.find(candidate => candidate.id === stage.sourceRouteId)
  route.geometry = {
    full: Array.from({ length: 201 }, (_, index) => ({ latitude: 45 + (index / 2) / 111.195, longitude: 6, altitudeM: 400 })),
    simplified: null,
  }
  stage.distanceKm = 100
  stage.pauseDurationSeconds = 1800
  const provenance = { sourceType: 'osm', sourceId: null, fetchedAt: null, engineVersion: 'test', confidence: 'high', manuallyOverridden: false }
  for (const [id, name, km] of [['plain', 'Village', 49.5], ['bakery', 'Boulange', 50.5]]) {
    bundle.routePoints.push({ id, routeId: route.id, type: 'village', name, latitude: 45 + km / 111.195, longitude: 6, elevationM: 400, trackDistanceKm: km, osmFeatureType: 'village', lateralDistanceKm: null, provenance })
    stage.routePointIds.push(id)
  }
  bundle.practicalPlaces.push({ ...bundle.practicalPlaces[0], id: 'bakery-poi', stageId: stage.id, category: 'bakery', name: 'Boulangerie', trackDistanceKm: 50.5, detourKm: 0.05, openingHours: 'Mo 06:00-11:00' })
  bundle.settings = { ...bundle.settings, days: [{ dayId: stage.dayId, departureTime: '06:00', totalBreakSeconds: null }] }
  bundle.enrichmentMetadata = {
    ...bundle.enrichmentMetadata,
    enrichmentJobs: [{
      stageId: stage.id, routeFingerprint: stageFingerprintFor(bundle, stage.id), planVersion: 2,
      jobs: ['structural', 'practical'].map(kind => ({ kind, startKm: 0, endKm: 100, status: 'success', attempts: 1 })),
    }],
  }
  return bundle
}

test('a trip with no travel mode retains the exact cycling pause choice', () => {
  const bundle = preparedTrip()
  const stage = bundle.stages[0]
  const historical = computeAutomaticPausePlanForStage(bundle, stage.id, ids())
  const explicit = { ...bundle, settings: { ...bundle.settings, global: { ...bundle.settings.global, travelMode: 'cycling' } } }
  assert.deepEqual(computeAutomaticPausePlanForStage(explicit, stage.id, ids()), historical)
  assert.equal(historical[0].routePointId, 'bakery')
})

test('an explicit walking switch refreshes only automatic plans with walking ETA and the new pause budget', () => {
  const original = ensureAutomaticPausePlans(preparedTrip(), ids('old'))
  const stage = original.stages[0]
  const previousPlan = original.enrichmentMetadata.automaticPausePlans[0]
  assert.equal(previousPlan.pauses[0].routePointId, 'bakery')
  const walking = {
    ...original,
    settings: { ...original.settings, global: { ...original.settings.global, travelMode: 'walking', referenceSpeedKph: 4.5 } },
    stages: original.stages.map(candidate => candidate.id === stage.id ? { ...candidate, pauseDurationSeconds: 3600 } : candidate),
  }
  const refreshed = refreshAutomaticPausePlansForTravelMode(walking, ids())
  const plan = refreshed.enrichmentMetadata.automaticPausePlans.find(candidate => candidate.stageId === stage.id)
  assert.notDeepEqual(plan, previousPlan)
  assert.equal(plan.pauses[0].routePointId, 'plain', 'the bakery is closed at the walking ETA')
  assert.equal(plan.pauses.reduce((sum, pause) => sum + pause.durationSeconds, 0), 3600)
  assert.equal(isAutomaticPausePlanValid(refreshed, stage.id), true)
  assert.equal(refreshed.routes, original.routes)
  assert.equal(refreshed.practicalPlaces, original.practicalPlaces)
  assert.equal(refreshed.enrichmentMetadata.enrichmentJobs, original.enrichmentMetadata.enrichmentJobs)

  const input = {
    stage: refreshed.stages[0], route: refreshed.routes[0], routePoints: refreshed.routePoints, climbs: refreshed.climbs,
    settings: { referenceSpeedKph: 4.5, travelMode: 'walking', departureTime: '06:00' },
    manualPauses: resolvePersistedAutomaticPausePlan(refreshed, stage.id),
  }
  const waypoints = computeStageWaypoints(input)
  const curve = computeStageTimingCurve(input)
  const arrival = waypoints.at(-1)
  assert.equal(waypoints.reduce((sum, point) => sum + (point.pauseDurationMinutes ?? 0), 0), 60)
  assert.equal(curve.clockTimeAt(arrival.trackDistanceKm), arrival.clockTime)
  assert.equal(ensureAutomaticPausePlans(refreshed, () => assert.fail('a later render must reuse the new plan')), refreshed)
})

test('custom pause settings and dormant plans survive a mixed-mode trip refresh unchanged', () => {
  let bundle = ensureAutomaticPausePlans(preparedTrip(), ids('old'))
  const customStage = bundle.stages[1]
  const manualPauses = [{ id: 'my-pause', active: true, routePointId: customStage.routePointIds[0], durationSeconds: 1500, order: 0, origin: 'custom' }]
  const customSettings = { stageId: customStage.id, pausePlanMode: 'custom', pauses: manualPauses }
  bundle = { ...bundle, settings: { ...bundle.settings, stages: [...bundle.settings.stages, customSettings] } }
  bundle = withAutomaticPausePlan(bundle, customStage.id, [])
  const dormant = bundle.enrichmentMetadata.automaticPausePlans.find(plan => plan.stageId === customStage.id)
  const updated = refreshAutomaticPausePlansForTravelMode(bundle, ids())
  assert.equal(updated.settings, bundle.settings)
  assert.equal(updated.settings.stages.find(entry => entry.stageId === customStage.id), customSettings)
  assert.equal(updated.settings.stages.find(entry => entry.stageId === customStage.id).pauses, manualPauses)
  assert.equal(updated.enrichmentMetadata.automaticPausePlans.find(plan => plan.stageId === customStage.id), dormant)
})

test('incomplete stages discard the previous automatic plan and wait for the existing enrichment gate', () => {
  const prepared = ensureAutomaticPausePlans(preparedTrip(), ids('old'))
  const stage = prepared.stages[0]
  const pending = {
    ...prepared,
    enrichmentMetadata: {
      ...prepared.enrichmentMetadata,
      enrichmentJobs: prepared.enrichmentMetadata.enrichmentJobs.map(entry => ({ ...entry, jobs: entry.jobs.map(job => job.kind === 'practical' ? { ...job, status: 'pending' } : job) })),
    },
  }
  const result = refreshAutomaticPausePlansForTravelMode(pending, () => assert.fail('no selection before enrichment completes'))
  assert.equal(isAutomaticPausePlanValid(result, stage.id), false)
  assert.equal(resolvePersistedAutomaticPausePlan(result, stage.id), undefined)
  assert.equal(result.enrichmentMetadata.enrichmentJobs, pending.enrichmentMetadata.enrichmentJobs)
})

test('a wholly custom trip is an exact no-op with no new ids or metadata allocations', () => {
  const bundle = preparedTrip()
  bundle.settings = { ...bundle.settings, global: { ...bundle.settings.global, pausePlanMode: 'custom' } }
  assert.equal(refreshAutomaticPausePlansForTravelMode(bundle, () => assert.fail('custom pauses are never rebuilt')), bundle)
})
