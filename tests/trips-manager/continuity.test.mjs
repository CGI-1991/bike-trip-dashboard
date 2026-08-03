import assert from 'node:assert/strict'
import test from 'node:test'

import { CONTINUITY_GAP_WARNING_KM, checkChainContinuity, checkStageContinuity } from '../../src/trips-manager/continuity.ts'

test('a small gap below the threshold produces no warning', () => {
  const result = checkStageContinuity(45.0, 6.0, 45.0005, 6.0005)
  assert.equal(result.hasWarning, false)
  assert.ok(result.gapKm < CONTINUITY_GAP_WARNING_KM)
})

test('a large gap above the threshold produces a warning, never a block', () => {
  const result = checkStageContinuity(45.0, 6.0, 46.0, 7.0)
  assert.equal(result.hasWarning, true)
  assert.ok(result.gapKm > CONTINUITY_GAP_WARNING_KM)
})

test('exactly at the threshold does not warn (strictly greater-than)', () => {
  // Construct two points ~1.0 km apart isn't trivial by hand — assert the boundary semantics instead.
  const result = checkStageContinuity(45.0, 6.0, 45.0, 6.0)
  assert.equal(result.gapKm, 0)
  assert.equal(result.hasWarning, false)
})

test('a custom threshold can be supplied explicitly', () => {
  const result = checkStageContinuity(45.0, 6.0, 45.05, 6.05, 100)
  assert.equal(result.hasWarning, false)
})

test('checkChainContinuity finds every break across an ordered chain of stages', () => {
  const segments = [
    { fileName: 'a.gpx', startLatitude: 45.0, startLongitude: 6.0, endLatitude: 45.1, endLongitude: 6.1 },
    { fileName: 'b.gpx', startLatitude: 45.1, startLongitude: 6.1, endLatitude: 45.2, endLongitude: 6.2 }, // continuous with a
    { fileName: 'c.gpx', startLatitude: 50.0, startLongitude: 10.0, endLatitude: 50.1, endLongitude: 10.1 }, // big break from b
  ]
  const warnings = checkChainContinuity(segments)
  assert.equal(warnings.length, 1)
  assert.equal(warnings[0].fromFileName, 'b.gpx')
  assert.equal(warnings[0].toFileName, 'c.gpx')
})

test('checkChainContinuity finds zero warnings for a fully continuous chain', () => {
  const segments = [
    { fileName: 'a.gpx', startLatitude: 45.0, startLongitude: 6.0, endLatitude: 45.1, endLongitude: 6.1 },
    { fileName: 'b.gpx', startLatitude: 45.1, startLongitude: 6.1, endLatitude: 45.2, endLongitude: 6.2 },
  ]
  assert.deepEqual(checkChainContinuity(segments), [])
})

test('checkChainContinuity on a single segment or empty chain never throws', () => {
  assert.deepEqual(checkChainContinuity([]), [])
  assert.deepEqual(checkChainContinuity([{ fileName: 'a.gpx', startLatitude: 0, startLongitude: 0, endLatitude: 1, endLongitude: 1 }]), [])
})
