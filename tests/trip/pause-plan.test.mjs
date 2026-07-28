import assert from 'node:assert/strict'
import test from 'node:test'

import { createContextualPauseAnchors, getPauseCount, getPauseDurationShares, loadPausePlan, pausePlanStorageKey, savePausePlan } from '../../src/trip/pause-plan.ts'

test('derives pause count from estimated moving time', () => {
  assert.equal(getPauseCount(239), 1)
  assert.equal(getPauseCount(240), 2)
  assert.equal(getPauseCount(360), 3)
  assert.equal(getPauseCount(480), 4)
})

test('uses the confirmed duration distributions', () => {
  assert.deepEqual(getPauseDurationShares(1), [1])
  assert.deepEqual(getPauseDurationShares(2), [0.35, 0.65])
  assert.deepEqual(getPauseDurationShares(3), [0.25, 0.5, 0.25])
  assert.deepEqual(getPauseDurationShares(4), [0.15, 0.35, 0.35, 0.15])
})

test('places contextual pauses on existing GPX profile positions', () => {
  const positions = [0, 20, 40, 60, 80, 100].map((weightedDistanceKm) => ({ weightedDistanceKm, distanceKm: weightedDistanceKm, latitude: weightedDistanceKm, longitude: 0, sourceFileNumber: 1, sourceFileName: 'x.gpx', elevationGainM: 0, elevationLossM: 0, altitudeM: 0, localSlopePercent: 0, speedMultiplier: 1 }))
  const profile = { summary: { weightedDistanceKm: 100 }, waypointSeeds: positions.map((position, index) => ({ id: String(index), type: 'time-marker', name: String(index), position })), segments: [{ startPosition: positions[0], endPosition: positions.at(-1) }] }
  const anchors = createContextualPauseAnchors(profile, 12.5)
  assert.equal(anchors.length, 4)
  assert.ok(anchors.every(({ position }) => positions.includes(position)))
})

test('persists pause overrides under the versioned key', () => {
  const values = new Map()
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }
  const plan = { version: 1, overrides: [{ dayId: 'J6', disabledPauseIds: ['context-1'], replacements: {} }] }
  assert.equal(savePausePlan(plan, storage), true)
  assert.ok(values.has(pausePlanStorageKey))
  assert.deepEqual(loadPausePlan(storage), plan)
})
