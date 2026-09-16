import assert from 'node:assert/strict'
import test from 'node:test'

import { deriveTerrainLabelFromElevationGainPerKm } from '../../src/analysis/terrain-context.ts'

// All that survives of the old "Terrain" concept is the relief tier climb
// detection adapts its dip-merge tolerance to. The Normal/Montagne selector
// that used to sit on top of it is gone, along with every preference that
// could hide a detected climb.

test('the relief tier follows elevation gain per kilometre, with stable boundaries', () => {
  assert.equal(deriveTerrainLabelFromElevationGainPerKm(0), 'rolling')
  assert.equal(deriveTerrainLabelFromElevationGainPerKm(9.9), 'rolling')
  assert.equal(deriveTerrainLabelFromElevationGainPerKm(10), 'mixed')
  assert.equal(deriveTerrainLabelFromElevationGainPerKm(17.9), 'mixed')
  assert.equal(deriveTerrainLabelFromElevationGainPerKm(18), 'mountain')
  assert.equal(deriveTerrainLabelFromElevationGainPerKm(60), 'mountain')
})
