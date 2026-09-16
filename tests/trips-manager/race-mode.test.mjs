import assert from 'node:assert/strict'
import test from 'node:test'

import { applyRaceMode, hasConfiguredStagePauses, isRaceModeEnabled } from '../../src/trips-manager/race-mode.ts'
import { resolveStagePauseSettings } from '../../src/analysis/waypoint-timeline.ts'
import { computeRideArrivalEta } from '../../src/trips-manager/trip-day-temporal-state.ts'
import { validateTripBundle } from '../../src/trip-core/index.ts'
import { createLinkedTripBundle, withVillages } from './support/linked-trip-fixture.mjs'
import { createGenericTripBundle } from '../trip-core/support/generic-trip-fixture.mjs'

/** The three-ride fixture, given a real automatic pause budget to strip. */
function bundleWithPauses() {
  const bundle = withVillages(createLinkedTripBundle({ rideCount: 2 }))
  return {
    ...bundle,
    stages: bundle.stages.map((stage) => ({ ...stage, pauseDurationSeconds: 1_800, totalDurationSeconds: (stage.movingDurationSeconds ?? 0) + 1_800 })),
    settings: { ...bundle.settings, days: bundle.settings.days.map((entry) => ({ ...entry, totalBreakSeconds: 1_800 })) },
  }
}

test('an existing trip is in Classique mode by default — an absent setting is never read as Course/Tour', () => {
  assert.equal(isRaceModeEnabled(createLinkedTripBundle({ rideCount: 2 })), false)
  assert.equal(isRaceModeEnabled(createGenericTripBundle()), false)
})

test('confirmation is only asked for when there is genuinely something to remove', () => {
  assert.equal(hasConfiguredStagePauses(bundleWithPauses()), true)
  const withoutPauses = createLinkedTripBundle({ rideCount: 2 })
  assert.equal(hasConfiguredStagePauses(withoutPauses), false)
  // A saved manual stop counts too, even with a zero automatic budget.
  assert.equal(hasConfiguredStagePauses(createGenericTripBundle()), true)
})

test('Course/Tour strips every in-stage pause and re-times the stages without them', () => {
  const before = bundleWithPauses()
  const after = applyRaceMode(before, true)

  assert.equal(after.settings.global.raceMode, true)
  for (const stage of after.stages) {
    assert.equal(stage.pauseDurationSeconds, 0)
    assert.equal(stage.totalDurationSeconds, stage.movingDurationSeconds)
  }
  assert.deepEqual(after.settings.stages, [], 'saved manual plans are removed, not hidden')
  assert.ok(after.settings.days.every((entry) => entry.totalBreakSeconds === 0))
  assert.deepEqual(after.enrichmentMetadata.automaticPausePlans, [])
  assert.equal(validateTripBundle(after).ok, true)
})

test('an ETA in Course/Tour mode no longer includes any pause time', () => {
  const before = bundleWithPauses()
  const after = applyRaceMode(before, true)
  const day = before.days[0]
  const etaBefore = computeRideArrivalEta(before, day).minutesFromDayStart
  const etaAfter = computeRideArrivalEta(after, after.days[0]).minutesFromDayStart
  assert.ok(etaAfter < etaBefore, 'the pause budget stops being folded into the arrival time')
})

test('resolveStagePauseSettings short-circuits to an explicitly empty plan in Course/Tour mode', () => {
  const stageSettings = { stageId: 'stage-0', pausePlanMode: 'custom', pauses: [{ id: 'p1', active: true, routePointId: 'point-1', durationSeconds: 900, order: 0, origin: 'custom' }] }
  assert.deepEqual(resolveStagePauseSettings('automatic', stageSettings, true), { mode: 'custom', manualPauses: [], pausesDisabled: true })
  // Without race mode the historical shape is unchanged, `pausesDisabled` included (absent).
  assert.deepEqual(resolveStagePauseSettings('automatic', undefined), { mode: 'automatic', manualPauses: [] })
})

test('OFF days, transfers, POI and lodging are structurally out of Course/Tour’s reach', () => {
  const before = createGenericTripBundle()
  const after = applyRaceMode(before, true)
  assert.deepEqual(after.days.filter((day) => day.type !== 'ride'), before.days.filter((day) => day.type !== 'ride'))
  assert.deepEqual(after.practicalPlaces, before.practicalPlaces, 'a POI is a place on the route, never a planned stop')
  assert.deepEqual(after.accommodations, before.accommodations)
  assert.equal(validateTripBundle(after).ok, true)
})

test('leaving Course/Tour re-estimates an automatic budget rather than staying silently at zero', () => {
  const raceBundle = applyRaceMode(bundleWithPauses(), true)
  const back = applyRaceMode(raceBundle, false)
  assert.equal(back.settings.global.raceMode, false)
  assert.ok(back.stages.every((stage) => (stage.pauseDurationSeconds ?? 0) > 0), 'a coherent pause plan comes back')
  assert.equal(validateTripBundle(back).ok, true)
})

test('applying the mode a trip already has returns the very same bundle — nothing to save', () => {
  const bundle = createLinkedTripBundle({ rideCount: 2 })
  assert.equal(applyRaceMode(bundle, false), bundle)
})
