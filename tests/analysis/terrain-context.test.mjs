import assert from 'node:assert/strict'
import test from 'node:test'

import {
  computeTripElevationGainPerKm,
  deriveTerrainLabelFromElevationGainPerKm,
  deriveTripTerrainContext,
  resolveEffectiveMountainMode,
  TRIP_TERRAIN_LABELS,
} from '../../src/analysis/terrain-context.ts'

function bundleWithStages(stages, mountainMode) {
  return { stages, settings: { global: { referenceSpeedKph: 18, pausePlanMode: 'automatic', mountainMode } } }
}

test('computeTripElevationGainPerKm aggregates distance and elevation gain across every stage with known metrics', () => {
  const bundle = bundleWithStages([
    { distanceKm: 50, elevationGainM: 500 },
    { distanceKm: 50, elevationGainM: 300 },
  ])
  assert.equal(computeTripElevationGainPerKm(bundle), 8)
})

test('computeTripElevationGainPerKm ignores a stage with unknown (null) metrics rather than throwing or producing NaN', () => {
  const bundle = bundleWithStages([
    { distanceKm: 60, elevationGainM: 720 },
    { distanceKm: null, elevationGainM: null },
  ])
  assert.equal(computeTripElevationGainPerKm(bundle), 12)
})

test('computeTripElevationGainPerKm is 0 (never NaN/negative) for a trip with no distance data at all', () => {
  assert.equal(computeTripElevationGainPerKm(bundleWithStages([])), 0)
  assert.equal(computeTripElevationGainPerKm(bundleWithStages([{ distanceKm: null, elevationGainM: null }])), 0)
})

test('deriveTerrainLabelFromElevationGainPerKm: below the mixed threshold is rolling, up to the mountain threshold is mixed, at/above it is mountain', () => {
  assert.equal(deriveTerrainLabelFromElevationGainPerKm(0), 'rolling')
  assert.equal(deriveTerrainLabelFromElevationGainPerKm(9.9), 'rolling')
  assert.equal(deriveTerrainLabelFromElevationGainPerKm(10), 'mixed')
  assert.equal(deriveTerrainLabelFromElevationGainPerKm(17.9), 'mixed')
  assert.equal(deriveTerrainLabelFromElevationGainPerKm(18), 'mountain')
  assert.equal(deriveTerrainLabelFromElevationGainPerKm(40), 'mountain')
})

test('deriveTripTerrainContext: no override (undefined mountainMode, incl. every pre-D3.1 bundle) is automatic and derives its label live', () => {
  const rolling = bundleWithStages([{ distanceKm: 100, elevationGainM: 400 }], undefined)
  const context = deriveTripTerrainContext(rolling)
  assert.equal(context.mode, 'automatic')
  assert.equal(context.label, 'rolling')
  assert.equal(context.effectiveMountainMode, false)

  const mountain = bundleWithStages([{ distanceKm: 40, elevationGainM: 1200 }], undefined)
  const mountainContext = deriveTripTerrainContext(mountain)
  assert.equal(mountainContext.mode, 'automatic')
  assert.equal(mountainContext.label, 'mountain')
  assert.equal(mountainContext.effectiveMountainMode, true)
})

test('deriveTripTerrainContext: legacy mountainMode: true forces mountain regardless of the trip\'s own aggregate profile', () => {
  const flatButForced = bundleWithStages([{ distanceKm: 100, elevationGainM: 100 }], true)
  const context = deriveTripTerrainContext(flatButForced)
  assert.equal(context.mode, 'forced-mountain')
  assert.equal(context.label, 'mountain')
  assert.equal(context.effectiveMountainMode, true)
})

test('deriveTripTerrainContext: legacy mountainMode: false forces normal — a genuinely mountainous auto-label is downgraded to mixed, never silently left as mountain', () => {
  const alpineButForcedNormal = bundleWithStages([{ distanceKm: 40, elevationGainM: 1200 }], false)
  const context = deriveTripTerrainContext(alpineButForcedNormal)
  assert.equal(context.mode, 'forced-normal')
  assert.equal(context.label, 'mixed')
  assert.equal(context.effectiveMountainMode, false)

  const rollingForcedNormal = bundleWithStages([{ distanceKm: 100, elevationGainM: 400 }], false)
  assert.equal(deriveTripTerrainContext(rollingForcedNormal).label, 'rolling')
})

test('resolveEffectiveMountainMode returns the same boolean as .effectiveMountainMode on the full context', () => {
  const bundle = bundleWithStages([{ distanceKm: 40, elevationGainM: 1200 }], undefined)
  assert.equal(resolveEffectiveMountainMode(bundle), deriveTripTerrainContext(bundle).effectiveMountainMode)
  assert.equal(resolveEffectiveMountainMode(bundle), true)
})

test('TRIP_TERRAIN_LABELS covers exactly the three labels with French display text (CDC D3.1 section 14 — no 12-category classifier)', () => {
  assert.deepEqual(Object.keys(TRIP_TERRAIN_LABELS).sort(), ['mixed', 'mountain', 'rolling'])
  assert.equal(TRIP_TERRAIN_LABELS.rolling, 'Roulant')
  assert.equal(TRIP_TERRAIN_LABELS.mixed, 'Mixte')
  assert.equal(TRIP_TERRAIN_LABELS.mountain, 'Montagneux')
})
