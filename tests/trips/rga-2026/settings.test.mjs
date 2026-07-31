import assert from 'node:assert/strict'
import test from 'node:test'

import { createRgaLegacyTripBundle } from '../../../src/trips/rga-2026/load-rga-legacy-trip.ts'
import { loadRgaLegacySnapshotFromDisk } from './support/load-snapshot.mjs'

const { snapshot } = await loadRgaLegacySnapshotFromDisk()
const bundle = createRgaLegacyTripBundle(snapshot)

test('global reference speed matches the historical default (18 km/h)', () => {
  assert.equal(bundle.settings.global.referenceSpeedKph, 18)
  assert.equal(bundle.settings.global.referenceSpeedKph, snapshot.defaultSettings.referenceSpeedKph)
})

test('exactly the ten ride days get a departure-time/break-budget entry, never the OFF days', () => {
  const rideDayIds = new Set(bundle.days.filter((day) => day.type === 'ride').map((day) => day.id))
  assert.equal(bundle.settings.days.length, 10)
  for (const entry of bundle.settings.days) assert.ok(rideDayIds.has(entry.dayId))
})

test('departure time and break budget come from the historical default settings, not from any browser preference', () => {
  for (const entry of bundle.settings.days) {
    assert.equal(entry.departureTime, snapshot.defaultSettings.departureTime)
    assert.equal(entry.totalBreakSeconds, snapshot.defaultSettings.totalBreakMinutes * 60)
  }
})

test('no stage-level pause override is fabricated — automatic mode applies uniformly', () => {
  assert.deepEqual(bundle.settings.stages, [])
  assert.equal(bundle.settings.global.pausePlanMode, 'automatic')
})

test('the constructor runs with no window, document, localStorage or sessionStorage in scope', () => {
  // A pure Node test environment already has none of these globals — this
  // assertion documents that fact rather than polyfilling it away, so a
  // future accidental `window`/`localStorage` reference in the adapter would
  // surface as a ReferenceError here instead of silently working under Vite.
  assert.equal(typeof window, 'undefined')
  assert.equal(typeof document, 'undefined')
  assert.equal(typeof localStorage, 'undefined')
  assert.equal(typeof sessionStorage, 'undefined')
  // createRgaLegacyTripBundle(snapshot) above already ran successfully in this same
  // environment, which is the actual proof the constructor never touches any of them.
  assert.ok(bundle.settings)
})
