import assert from 'node:assert/strict'
import test from 'node:test'

import { buildTripOverview } from '../../src/ui/trips/trip-overview-view.ts'
import { createGenericTripBundle } from '../trip-core/support/generic-trip-fixture.mjs'

/**
 * Aperçu is the screen a rider glances at, so it is the screen where a false
 * "looks ready" does the most damage: a pause plan drawn from half a stage's
 * geography looks exactly like a finished one.
 *
 * So an incomplete stage shows no automatic pause on Aperçu — while the
 * traveller's own custom pauses, which never depended on enrichment, stay
 * visible throughout.
 */

const STAGE_ID = 'stage-alpha'

/** A real locality on the stage, good enough for a pause to anchor on. */
function withAnchor(bundle) {
  bundle.routePoints.push({
    id: 'village-mid', routeId: bundle.routes[0].id, type: 'passage', name: 'Mi-parcours',
    latitude: 45.2, longitude: 6.35, elevationM: 300, trackDistanceKm: 16,
    osmFeatureType: 'village', lateralDistanceKm: 0.2,
    provenance: { sourceType: 'osm', sourceId: 'postpass:village:mid', fetchedAt: null, engineVersion: 'route-enrichment@4', confidence: 'high', manuallyOverridden: false },
  })
  bundle.stages[0].routePointIds.push('village-mid')
  return bundle
}

function withJobs(bundle, statuses) {
  const sourceFile = bundle.sourceFiles.find((file) => file.id === bundle.routes[0].sourceFileId)
  bundle.enrichmentMetadata = {
    providers: [
      { provider: 'postpass-route-enrichment', lastAttemptedAt: '2028-01-01T00:00:00.000Z', lastSuccessAt: '2028-01-01T00:00:00.000Z', status: 'success', message: null },
      { provider: 'postpass-practical-places', lastAttemptedAt: '2028-01-01T00:00:00.000Z', lastSuccessAt: '2028-01-01T00:00:00.000Z', status: 'success', message: null },
    ],
    enrichmentJobs: [{
      stageId: STAGE_ID,
      routeFingerprint: `sha256:${sourceFile.sha256}`,
      jobs: [
        { kind: 'structural', startKm: 0, endKm: 20, status: statuses.structural, attempts: 1 },
        { kind: 'practical', startKm: 0, endKm: 20, status: statuses.practical, attempts: 1 },
      ],
    }],
  }
  return bundle
}

/** Every pause the Aperçu view would draw, across both its map layers. */
function overviewPauses(bundle) {
  const overview = buildTripOverview(bundle, { now: '2027-05-10T06:00:00.000Z' })
  const stages = [...(overview.mapStages ?? []), ...(overview.mapDetailStages ?? [])]
  return stages.flatMap((stage) => (stage.waypoints ?? []).filter((waypoint) => waypoint.pauseDurationMinutes !== null))
}

test('an incomplete stage draws NO automatic pause on Aperçu, even with a real place to anchor one on', () => {
  const bundle = withJobs(withAnchor(createGenericTripBundle()), { structural: 'success', practical: 'pending' })
  assert.deepEqual(overviewPauses(bundle), [], 'a plan built on half a stage would look finished while ignoring the rest')
})

test('the same stage, once complete, does draw its automatic pauses', () => {
  const bundle = withJobs(withAnchor(createGenericTripBundle()), { structural: 'success', practical: 'success' })
  assert.ok(overviewPauses(bundle).length > 0, 'the gate suppresses pauses, it does not remove the feature')
})

test('a stage whose structure is still incomplete draws none either', () => {
  const bundle = withJobs(withAnchor(createGenericTripBundle()), { structural: 'pending', practical: 'pending' })
  assert.deepEqual(overviewPauses(bundle), [])
})

test('a custom pause stays visible on Aperçu throughout — the traveller\'s own choice never waits on enrichment', () => {
  const bundle = withJobs(withAnchor(createGenericTripBundle()), { structural: 'success', practical: 'pending' })
  bundle.settings.stages = [{
    stageId: STAGE_ID,
    pausePlanMode: 'custom',
    pauses: [{ id: 'p1', active: true, routePointId: 'village-mid', durationSeconds: 1_800, order: 0, origin: 'custom' }],
  }]
  const pauses = overviewPauses(bundle)
  assert.ok(pauses.some((waypoint) => waypoint.pauseDurationMinutes === 30), 'the custom pause is drawn regardless')
})
