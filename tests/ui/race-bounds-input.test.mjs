import './support/dom-shim.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { raceInputOffsetM } from '../../src/ui/trips/race-bounds-view.ts'

test('new course distances use the closest tenth of a kilometre', () => {
  assert.equal(raceInputOffsetM(1.234, 50), 1200)
  assert.equal(raceInputOffsetM(1.26, 50), 1300)
  assert.equal(raceInputOffsetM(.04, 50), 0)
  assert.equal(raceInputOffsetM(49.876, 50), 49900)
  assert.ok(raceInputOffsetM(-.01, 50) < 0, 'negative input remains invalid')
  assert.ok(raceInputOffsetM(51, 50) > 50000, 'out-of-route input remains invalid')
})

test('the displayed last tenth retains the exact GPX endpoint, even when rounded up', () => {
  for (const length of [50.014, 50.051, .03]) {
    assert.equal(raceInputOffsetM(length, length), length * 1000)
    if (Number(length.toFixed(1)) > 0) assert.equal(raceInputOffsetM(Number(length.toFixed(1)), length), length * 1000)
    assert.equal(raceInputOffsetM(0, length), 0)
  }
})
