import assert from 'node:assert/strict'
import test from 'node:test'

import { applyClimbDetectionSensitivity, recomputeTripClimbs, resolveClimbDetectionSensitivity } from '../../src/trips-manager/climb-sensitivity.ts'
import { validateTripBundle } from '../../src/trip-core/index.ts'
import { createLinkedTripBundle } from './support/linked-trip-fixture.mjs'

/**
 * One ride day whose route really goes up and down: a long climb, then a
 * short côte, then a descent — enough relief for the slider to have
 * something to change its mind about.
 */
function hillyBundle() {
  const sections = [
    { lengthKm: 2, gradientPercent: -0.5 },
    { lengthKm: 7, gradientPercent: 6 },
    { lengthKm: 5, gradientPercent: -6 },
    { lengthKm: 1, gradientPercent: 4.5 },
    { lengthKm: 5, gradientPercent: -3 },
  ]
  const points = [{ latitude: 45, longitude: 6, altitudeM: 200 }]
  let distanceKm = 0
  let altitudeM = 200
  for (const section of sections) {
    const steps = Math.round(section.lengthKm / 0.05)
    for (let step = 0; step < steps; step++) {
      distanceKm += 0.05
      altitudeM += (section.gradientPercent / 100) * 50
      // 1 degree of longitude at 45°N is about 78.7 km.
      points.push({ latitude: 45, longitude: 6 + distanceKm / 78.7, altitudeM })
    }
  }

  const bundle = createLinkedTripBundle({ rideCount: 1 })
  return {
    ...bundle,
    routes: bundle.routes.map((route) => ({ ...route, geometry: { full: points, simplified: null } })),
    stages: bundle.stages.map((stage) => ({ ...stage, distanceKm, elevationGainM: 465 })),
  }
}

let counter = 0
const idFactory = () => `generated-climb-${counter++}`

test('a bundle saved before the setting existed reads as the historical calibration', () => {
  assert.equal(resolveClimbDetectionSensitivity(createLinkedTripBundle({ rideCount: 1 })), 'standard')
})

test('a sensitivity change genuinely re-derives the climbs, and the setting is stored with the trip', () => {
  const bundle = hillyBundle()
  const standard = recomputeTripClimbs(bundle, 'standard', idFactory)
  const flat = applyClimbDetectionSensitivity(standard, 'flat', idFactory)

  assert.equal(flat.settings.global.climbDetectionSensitivity, 'flat')
  assert.ok(flat.climbs.length >= standard.climbs.length, 'a more sensitive setting never loses a climb')
  assert.ok(flat.climbs.length > 0)
  assert.equal(validateTripBundle(flat).ok, true)
})

test('Montagne keeps only the major ascent where Pays plat also counts the short côte', () => {
  const bundle = hillyBundle()
  const mountain = applyClimbDetectionSensitivity(bundle, 'mountain', idFactory)
  const flat = applyClimbDetectionSensitivity(bundle, 'flat', idFactory)
  assert.ok(flat.climbs.length > mountain.climbs.length, 'the two ends of the slider genuinely differ on the same GPX')
})

test('each stage’s climbIds follow the recomputed climbs — no dangling reference survives', () => {
  const flat = applyClimbDetectionSensitivity(hillyBundle(), 'flat', idFactory)
  const climbIds = new Set(flat.climbs.map((climb) => climb.id))
  for (const stage of flat.stages) {
    for (const id of stage.climbIds) assert.ok(climbIds.has(id))
  }
  assert.equal(validateTripBundle(flat).ok, true)
})

test('a real name already attached to a climb survives the recomputation', () => {
  const bundle = recomputeTripClimbs(hillyBundle(), 'standard', idFactory)
  const named = {
    ...bundle,
    climbs: bundle.climbs.map((climb, index) => (index === 0
      ? { ...climb, name: 'Col du Test', provenance: { ...climb.provenance, sourceType: 'osm', engineVersion: 'climb-name-enrichment@1' } }
      : climb)),
  }
  const recomputed = applyClimbDetectionSensitivity(named, 'rolling', idFactory)
  assert.ok(recomputed.climbs.some((climb) => climb.name === 'Col du Test'), 'the name follows its summit rather than being thrown away')
})

test('changing the sensitivity never touches the GPX, the geometry or the trip’s own distance/D+', () => {
  const before = hillyBundle()
  const after = applyClimbDetectionSensitivity(before, 'flat', idFactory)
  assert.deepEqual(after.routes, before.routes)
  assert.deepEqual(after.sourceFiles, before.sourceFiles)
  assert.deepEqual(after.stages.map((stage) => [stage.distanceKm, stage.elevationGainM]), before.stages.map((stage) => [stage.distanceKm, stage.elevationGainM]))
})

test('a persisted automatic pause plan is invalidated, because it was scored on the previous climb set', () => {
  const bundle = {
    ...hillyBundle(),
    enrichmentMetadata: { providers: [], automaticPausePlans: [{ stageId: 'stage-0', routeFingerprint: 'sha256:x', pauses: [] }] },
  }
  const after = applyClimbDetectionSensitivity(bundle, 'flat', idFactory)
  assert.deepEqual(after.enrichmentMetadata.automaticPausePlans, [])
})

test('applying the sensitivity a trip already has returns the very same bundle — nothing to save', () => {
  const bundle = hillyBundle()
  assert.equal(applyClimbDetectionSensitivity(bundle, 'standard', idFactory), bundle)
})

test('a route with no usable geometry keeps its existing climbs rather than losing them', () => {
  const bundle = createLinkedTripBundle({ rideCount: 1 })
  const withoutGeometry = {
    ...bundle,
    routes: bundle.routes.map((route) => ({ ...route, geometry: null })),
    climbs: [{
      id: 'climb-kept', routeId: 'route-0', name: 'Col existant', startDistanceKm: 1, endDistanceKm: 4,
      elevationGainM: 300, averageGradientPercent: 7, maxGradientPercent: 11, startAltitudeM: 100, endAltitudeM: 400,
      confidence: 'probable',
      provenance: { sourceType: 'generated', sourceId: null, fetchedAt: null, engineVersion: 'test', confidence: 'medium', manuallyOverridden: false },
    }],
    stages: bundle.stages.map((stage) => ({ ...stage, climbIds: ['climb-kept'] })),
  }
  const after = recomputeTripClimbs(withoutGeometry, 'flat', idFactory)
  assert.deepEqual(after.climbs.map((climb) => climb.id), ['climb-kept'])
})
