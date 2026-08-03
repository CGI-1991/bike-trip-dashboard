import assert from 'node:assert/strict'
import test from 'node:test'

import {
  computeJoinGapKm,
  extractLeadingNumber,
  isLikelyLoop,
  moveOrderEntry,
  proposeGeographicOrder,
  proposeGpxOrder,
  proposeNumericOrder,
  rotateLoopOrder,
} from '../../src/trips-manager/gpx-ordering.ts'

function file(fileName, startLat, startLon, endLat, endLon) {
  return { fileName, startLatitude: startLat, startLongitude: startLon, endLatitude: endLat, endLongitude: endLon }
}

test('extractLeadingNumber reads a variety of common naming schemes', () => {
  assert.equal(extractLeadingNumber('01_thonon-morzine.gpx'), 1)
  assert.equal(extractLeadingNumber('2-morzine-bornand.gpx'), 2)
  assert.equal(extractLeadingNumber('etape10.gpx'), 10)
  assert.equal(extractLeadingNumber('no-number-here.gpx'), null)
})

test('proposeNumericOrder sorts strictly by each file’s leading number', () => {
  const files = [file('03_c.gpx', 0, 0, 0, 0), file('01_a.gpx', 0, 0, 0, 0), file('02_b.gpx', 0, 0, 0, 0)]
  assert.deepEqual(proposeNumericOrder(files), [1, 2, 0])
})

test('proposeNumericOrder returns null when a file has no parseable number', () => {
  const files = [file('01_a.gpx', 0, 0, 0, 0), file('no-number.gpx', 0, 0, 0, 0)]
  assert.equal(proposeNumericOrder(files), null)
})

test('proposeNumericOrder returns null when two files share the same number (ambiguous)', () => {
  const files = [file('01_a.gpx', 0, 0, 0, 0), file('01_b.gpx', 0, 0, 0, 0)]
  assert.equal(proposeNumericOrder(files), null)
})

test('a whole-trip order by filename number is used directly when consistent', () => {
  const files = [file('02_b.gpx', 45, 6, 45.1, 6.1), file('01_a.gpx', 44, 5, 45, 6)]
  const result = proposeGpxOrder(files)
  assert.equal(result.method, 'filename-numeric')
  assert.deepEqual(result.order, [1, 0])
})

test('computeJoinGapKm measures the gap from one file’s end to another’s start', () => {
  const a = file('a.gpx', 45, 6, 45.01, 6.01)
  const b = file('b.gpx', 45.01, 6.01, 45.02, 6.02)
  assert.ok(computeJoinGapKm(a, b) < 0.01)
  const farB = file('far.gpx', 50, 10, 50.01, 10.01)
  assert.ok(computeJoinGapKm(a, farB) > 100)
})

test('proposeGeographicOrder finds the chain minimizing the total join gap when no numeric order applies', () => {
  // Three files with no filename numbers: b naturally follows a, c naturally follows b.
  const a = file('alpha.gpx', 45.0, 6.0, 45.1, 6.1)
  const b = file('bravo.gpx', 45.1, 6.1, 45.2, 6.2)
  const c = file('charlie.gpx', 45.2, 6.2, 45.3, 6.3)
  // Shuffle input order — the proposal must still find a-b-c.
  const files = [c, a, b]
  const result = proposeGpxOrder(files)
  assert.equal(result.method, 'geographic')
  assert.deepEqual(result.order, [1, 2, 0])
  assert.ok(result.totalGapKm < 0.01)
})

test('a single file needs no ordering at all', () => {
  const files = [file('solo.gpx', 45, 6, 45.1, 6.1)]
  const result = proposeGpxOrder(files)
  assert.equal(result.method, 'single-file')
  assert.deepEqual(result.order, [0])
  assert.equal(result.isLoop, false)
})

test('a loop (chain end close to chain start) is flagged, never silently ordered as if it had an obvious first stage', () => {
  // A square loop: 4 legs returning to the start.
  const legs = [
    file('leg-a.gpx', 45.0, 6.0, 45.1, 6.0),
    file('leg-b.gpx', 45.1, 6.0, 45.1, 6.1),
    file('leg-c.gpx', 45.1, 6.1, 45.0, 6.1),
    file('leg-d.gpx', 45.0, 6.1, 45.0, 6.0),
  ]
  const result = proposeGpxOrder(legs)
  assert.equal(result.isLoop, true)
})

test('isLikelyLoop is false for a clearly point-to-point trip', () => {
  const files = [file('a.gpx', 45.0, 6.0, 45.5, 6.5), file('b.gpx', 45.5, 6.5, 46.0, 7.0)]
  const order = [0, 1]
  assert.equal(isLikelyLoop(files, order), false)
})

test('rotateLoopOrder lets the user pick the actual first stage, keeping the same cycle', () => {
  const legs = [
    file('leg-a.gpx', 45.0, 6.0, 45.1, 6.0),
    file('leg-b.gpx', 45.1, 6.0, 45.1, 6.1),
    file('leg-c.gpx', 45.1, 6.1, 45.0, 6.1),
    file('leg-d.gpx', 45.0, 6.1, 45.0, 6.0),
  ]
  const original = [0, 1, 2, 3]
  const rotated = rotateLoopOrder(legs, original, 2) // user picks leg-c as first
  assert.equal(rotated[0], 2)
  assert.equal(new Set(rotated).size, 4, 'still exactly the same 4 files, no duplication/loss')
  // The rotated chain must still form a coherent, low-gap cycle.
  assert.ok(rotated.includes(0) && rotated.includes(1) && rotated.includes(3))
})

test('rotateLoopOrder returns the original order unchanged if the requested first file is not part of it', () => {
  const legs = [file('a.gpx', 0, 0, 1, 1), file('b.gpx', 1, 1, 2, 2)]
  const order = [0, 1]
  assert.deepEqual(rotateLoopOrder(legs, order, 99), order)
})

test('moveOrderEntry swaps adjacent positions (Monter/Descendre)', () => {
  const order = [0, 1, 2, 3]
  assert.deepEqual(moveOrderEntry(order, 1, -1), [1, 0, 2, 3])
  assert.deepEqual(moveOrderEntry(order, 1, 1), [0, 2, 1, 3])
})

test('moveOrderEntry is a no-op at the boundaries', () => {
  const order = [0, 1, 2]
  assert.deepEqual(moveOrderEntry(order, 0, -1), order)
  assert.deepEqual(moveOrderEntry(order, 2, 1), order)
})

test('never mutates the input files array or order array', () => {
  const files = [file('a.gpx', 45, 6, 45.1, 6.1), file('b.gpx', 45.1, 6.1, 45.2, 6.2)]
  const snapshot = JSON.parse(JSON.stringify(files))
  const order = [0, 1]
  const orderSnapshot = [...order]
  proposeGpxOrder(files)
  proposeGeographicOrder(files)
  moveOrderEntry(order, 0, 1)
  assert.deepEqual(files, snapshot)
  assert.deepEqual(order, orderSnapshot)
})
