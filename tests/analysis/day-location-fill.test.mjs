import assert from 'node:assert/strict'
import test from 'node:test'

import { countCalendarDays, nearestNextRideStage, nearestPreviousRideStage, resolveOffLocation, resolveTransferLocations } from '../../src/analysis/day-location-fill.ts'

function stage(overrides = {}) {
  return { id: 'stage-test', dayId: 'day-test', sourceRouteId: 'route-test', name: null, startLocationName: null, endLocationName: null, distanceKm: null, elevationGainM: null, elevationLossM: null, minAltitudeM: null, maxAltitudeM: null, movingDurationSeconds: null, pauseDurationSeconds: null, totalDurationSeconds: null, estimatedAverageSpeedKph: null, validationStatus: 'pending', metricsProvenance: null, climbIds: [], routePointIds: [], weatherRecordIds: [], ...overrides }
}

function day(overrides = {}) {
  return { id: 'day-test', index: 0, displayNumber: 1, date: null, type: 'off', stageId: null, startLocationName: null, endLocationName: null, accommodationId: null, notes: null, enrichmentStatus: 'not-started', ...overrides }
}

function bundle(days, stages) {
  return { days, stages }
}

test('nearestPreviousRideStage / nearestNextRideStage skip over any number of intervening OFF/transfer days', () => {
  const days = [
    day({ id: 'd0', index: 0, type: 'ride', stageId: 's0' }),
    day({ id: 'd1', index: 1, type: 'off' }),
    day({ id: 'd2', index: 2, type: 'transfer' }),
    day({ id: 'd3', index: 3, type: 'off' }),
    day({ id: 'd4', index: 4, type: 'ride', stageId: 's4' }),
  ]
  const stages = [stage({ id: 's0', endLocationName: 'Briançon' }), stage({ id: 's4', startLocationName: 'Faucon' })]
  const b = bundle(days, stages)
  assert.equal(nearestPreviousRideStage(b, 3)?.id, 's0')
  assert.equal(nearestNextRideStage(b, 1)?.id, 's4')
})

test('resolveOffLocation: falls back to the previous ride day\'s arrival', () => {
  const days = [day({ id: 'd0', index: 0, type: 'ride', stageId: 's0' }), day({ id: 'd1', index: 1, type: 'off' })]
  const stages = [stage({ id: 's0', endLocationName: 'Briançon' })]
  const result = resolveOffLocation(bundle(days, stages), days[1])
  assert.equal(result.name, 'Briançon')
  assert.equal(result.autoFilled, true)
})

test('resolveOffLocation: falls back to the next ride day\'s departure when there is no previous ride day', () => {
  const days = [day({ id: 'd0', index: 0, type: 'off' }), day({ id: 'd1', index: 1, type: 'ride', stageId: 's1' })]
  const stages = [stage({ id: 's1', startLocationName: 'Briançon' })]
  const result = resolveOffLocation(bundle(days, stages), days[0])
  assert.equal(result.name, 'Briançon')
  assert.equal(result.autoFilled, true)
})

test('resolveOffLocation: a manual override always wins over the computed default', () => {
  const days = [
    day({ id: 'd0', index: 0, type: 'ride', stageId: 's0' }),
    day({ id: 'd1', index: 1, type: 'off', startLocationName: 'Gap (choix manuel)' }),
  ]
  const stages = [stage({ id: 's0', endLocationName: 'Briançon' })]
  const result = resolveOffLocation(bundle(days, stages), days[1])
  assert.equal(result.name, 'Gap (choix manuel)')
  assert.equal(result.autoFilled, false)
})

test('resolveOffLocation: genuinely unknown (no neighbour at all) stays null, never fabricated', () => {
  const days = [day({ id: 'd0', index: 0, type: 'off' })]
  const result = resolveOffLocation(bundle(days, []), days[0])
  assert.equal(result.name, null)
})

test('resolveTransferLocations: origin from the previous ride day, destination from the next', () => {
  const days = [
    day({ id: 'd0', index: 0, type: 'ride', stageId: 's0' }),
    day({ id: 'd1', index: 1, type: 'transfer' }),
    day({ id: 'd2', index: 2, type: 'ride', stageId: 's2' }),
  ]
  const stages = [stage({ id: 's0', endLocationName: 'Nice' }), stage({ id: 's2', startLocationName: 'Marseille' })]
  const result = resolveTransferLocations(bundle(days, stages), days[1])
  assert.equal(result.origin, 'Nice')
  assert.equal(result.destination, 'Marseille')
  assert.equal(result.originAutoFilled, true)
  assert.equal(result.destinationAutoFilled, true)
})

test('resolveTransferLocations: an override on just one side leaves the other auto-filled', () => {
  const days = [
    day({ id: 'd0', index: 0, type: 'ride', stageId: 's0' }),
    day({ id: 'd1', index: 1, type: 'transfer', startLocationName: 'Gare de Nice' }),
    day({ id: 'd2', index: 2, type: 'ride', stageId: 's2' }),
  ]
  const stages = [stage({ id: 's0', endLocationName: 'Nice' }), stage({ id: 's2', startLocationName: 'Marseille' })]
  const result = resolveTransferLocations(bundle(days, stages), days[1])
  assert.equal(result.origin, 'Gare de Nice')
  assert.equal(result.originAutoFilled, false)
  assert.equal(result.destination, 'Marseille')
  assert.equal(result.destinationAutoFilled, true)
})

test('countCalendarDays: a dedicated transfer (or the historical absence of transferTiming) counts as its own calendar day', () => {
  const days = [
    day({ id: 'd0', index: 0, type: 'ride', stageId: 's0' }),
    day({ id: 'd1', index: 1, type: 'transfer' }),
    day({ id: 'd2', index: 2, type: 'transfer', transferTiming: 'dedicated' }),
    day({ id: 'd3', index: 3, type: 'ride', stageId: 's3' }),
  ]
  assert.equal(countCalendarDays(days), 4)
})

test('countCalendarDays: after_previous/before_next transfers never inflate the count — they share a neighbour\'s calendar date', () => {
  const days = [
    day({ id: 'd0', index: 0, type: 'ride', stageId: 's0' }),
    day({ id: 'd1', index: 1, type: 'transfer', transferTiming: 'after_previous' }),
    day({ id: 'd2', index: 2, type: 'ride', stageId: 's2' }),
    day({ id: 'd3', index: 3, type: 'transfer', transferTiming: 'before_next' }),
    day({ id: 'd4', index: 4, type: 'ride', stageId: 's4' }),
  ]
  assert.equal(countCalendarDays(days), 3, 'only the 3 ride days count — both attached transfers share a neighbour\'s date')
})

test('a changed neighbouring stage is reflected immediately — nothing was ever persisted onto the OFF/transfer day itself', () => {
  const days = [day({ id: 'd0', index: 0, type: 'ride', stageId: 's0' }), day({ id: 'd1', index: 1, type: 'off' })]
  const stagesBefore = [stage({ id: 's0', endLocationName: 'Briançon' })]
  const stagesAfter = [stage({ id: 's0', endLocationName: 'Gap' })]
  assert.equal(resolveOffLocation(bundle(days, stagesBefore), days[1]).name, 'Briançon')
  assert.equal(resolveOffLocation(bundle(days, stagesAfter), days[1]).name, 'Gap')
})
