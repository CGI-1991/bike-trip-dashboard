import assert from 'node:assert/strict'
import test from 'node:test'

import {
  countCalendarDays,
  nearestNextRideStage,
  nearestPreviousRideStage,
  resolveOffCoordinates,
  resolveOffLocation,
  resolveSharedInfoDayId,
  resolveTransferCoordinates,
  resolveTransferLocations,
} from '../../src/analysis/day-location-fill.ts'

function stage(overrides = {}) {
  return { id: 'stage-test', dayId: 'day-test', sourceRouteId: 'route-test', name: null, startLocationName: null, endLocationName: null, distanceKm: null, elevationGainM: null, elevationLossM: null, minAltitudeM: null, maxAltitudeM: null, movingDurationSeconds: null, pauseDurationSeconds: null, totalDurationSeconds: null, estimatedAverageSpeedKph: null, validationStatus: 'pending', metricsProvenance: null, climbIds: [], routePointIds: [], weatherRecordIds: [], ...overrides }
}

function day(overrides = {}) {
  return { id: 'day-test', index: 0, displayNumber: 1, date: null, type: 'off', stageId: null, startLocationName: null, endLocationName: null, accommodationId: null, notes: null, enrichmentStatus: 'not-started', ...overrides }
}

function route(overrides = {}) {
  return {
    id: 'route-test',
    sourceFileId: null,
    segments: [],
    geometry: { full: null, simplified: null },
    profile: null,
    parsingStatus: 'parsed',
    parsingErrors: [],
    provenance: { source: 'gpx', importedAt: '2027-01-01T00:00:00.000Z' },
    ...overrides,
  }
}

/** A 2-point geometry, one route endpoint at each coordinate given. */
function geometryFromEndpoints(start, end) {
  return { full: [{ latitude: start[0], longitude: start[1], altitudeM: null }, { latitude: end[0], longitude: end[1], altitudeM: null }], simplified: null }
}

function bundle(days, stages, routes = []) {
  return { days, stages, routes }
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

test('resolveOffCoordinates: falls back to the previous ride stage\'s own route-geometry endpoint', () => {
  const days = [day({ id: 'd0', index: 0, type: 'ride', stageId: 's0' }), day({ id: 'd1', index: 1, type: 'off' })]
  const stages = [stage({ id: 's0', sourceRouteId: 'r0' })]
  const routes = [route({ id: 'r0', geometry: geometryFromEndpoints([44.1, 6.1], [44.9, 6.9]) })]
  const result = resolveOffCoordinates(bundle(days, stages, routes), days[1])
  assert.deepEqual(result, { latitude: 44.9, longitude: 6.9, elevationM: 0, autoFilled: true })
})

test('resolveOffCoordinates: no previous ride stage falls back to the next ride stage\'s own start endpoint', () => {
  const days = [day({ id: 'd0', index: 0, type: 'off' }), day({ id: 'd1', index: 1, type: 'ride', stageId: 's1' })]
  const stages = [stage({ id: 's1', sourceRouteId: 'r1' })]
  const routes = [route({ id: 'r1', geometry: geometryFromEndpoints([45.1, 5.1], [45.9, 5.9]) })]
  const result = resolveOffCoordinates(bundle(days, stages, routes), days[0])
  assert.deepEqual(result, { latitude: 45.1, longitude: 5.1, elevationM: 0, autoFilled: true })
})

test('resolveOffCoordinates: a manual "Choisir sur la carte" override always wins outright, autoFilled false', () => {
  const days = [
    day({ id: 'd0', index: 0, type: 'ride', stageId: 's0' }),
    day({ id: 'd1', index: 1, type: 'off', overrideStartLatitude: 43.5, overrideStartLongitude: 4.5 }),
  ]
  const stages = [stage({ id: 's0', sourceRouteId: 'r0' })]
  const routes = [route({ id: 'r0', geometry: geometryFromEndpoints([44.1, 6.1], [44.9, 6.9]) })]
  const result = resolveOffCoordinates(bundle(days, stages, routes), days[1])
  assert.deepEqual(result, { latitude: 43.5, longitude: 4.5, elevationM: 0, autoFilled: false })
})

test('resolveOffCoordinates: genuinely unknown (no neighbour, no override, no geometry) stays null, never fabricated', () => {
  const days = [day({ id: 'd0', index: 0, type: 'off' })]
  assert.equal(resolveOffCoordinates(bundle(days, []), days[0]), null)
})

test('resolveTransferCoordinates: origin from the previous ride stage, destination from the next, each independently overridable', () => {
  const days = [
    day({ id: 'd0', index: 0, type: 'ride', stageId: 's0' }),
    day({ id: 'd1', index: 1, type: 'transfer', overrideEndLatitude: 46.0, overrideEndLongitude: 7.0 }),
    day({ id: 'd2', index: 2, type: 'ride', stageId: 's2' }),
  ]
  const stages = [stage({ id: 's0', sourceRouteId: 'r0' }), stage({ id: 's2', sourceRouteId: 'r2' })]
  const routes = [
    route({ id: 'r0', geometry: geometryFromEndpoints([44.1, 6.1], [44.9, 6.9]) }),
    route({ id: 'r2', geometry: geometryFromEndpoints([45.1, 8.1], [45.9, 8.9]) }),
  ]
  const result = resolveTransferCoordinates(bundle(days, stages, routes), days[1])
  assert.deepEqual(result.origin, { latitude: 44.9, longitude: 6.9, elevationM: 0, autoFilled: true }, 'origin auto-filled from the previous ride stage\'s arrival point')
  assert.deepEqual(result.destination, { latitude: 46.0, longitude: 7.0, elevationM: 0, autoFilled: false }, 'destination overridden manually — the next stage\'s own start point is ignored')
})

test('resolveTransferCoordinates: neither side resolvable stays null on both sides', () => {
  const days = [day({ id: 'd0', index: 0, type: 'transfer' })]
  const result = resolveTransferCoordinates(bundle(days, []), days[0])
  assert.equal(result.origin, null)
  assert.equal(result.destination, null)
})

test('resolveSharedInfoDayId: an after_previous transfer resolves to the calendar-adjacent previous day\'s id', () => {
  const days = [
    day({ id: 'd0', index: 0, type: 'ride', stageId: 's0' }),
    day({ id: 'd1', index: 1, type: 'transfer', transferTiming: 'after_previous' }),
  ]
  assert.equal(resolveSharedInfoDayId(bundle(days, []), days[1]), 'd0')
})

test('resolveSharedInfoDayId: a dedicated or before_next transfer, and a ride day, all resolve to themselves', () => {
  const dedicated = day({ id: 'd0', index: 0, type: 'transfer', transferTiming: 'dedicated' })
  const beforeNext = day({ id: 'd1', index: 1, type: 'transfer', transferTiming: 'before_next' })
  const untimed = day({ id: 'd2', index: 2, type: 'transfer' })
  const ride = day({ id: 'd4', index: 4, type: 'ride', stageId: 's4' })
  const days = [dedicated, beforeNext, untimed, ride]
  const b = bundle(days, [])
  assert.equal(resolveSharedInfoDayId(b, dedicated), 'd0')
  assert.equal(resolveSharedInfoDayId(b, beforeNext), 'd1')
  assert.equal(resolveSharedInfoDayId(b, untimed), 'd2', 'the historical absence of transferTiming is treated as dedicated, same as countCalendarDays')
  assert.equal(resolveSharedInfoDayId(b, ride), 'd4')
})

test('resolveSharedInfoDayId: an after_previous transfer with no calendar-adjacent day at all falls back to its own id, never crashes', () => {
  const days = [day({ id: 'd0', index: 0, type: 'transfer', transferTiming: 'after_previous' })]
  assert.equal(resolveSharedInfoDayId(bundle(days, []), days[0]), 'd0')
})

// --- RC2 final-closeout sections 32-35: OFF days share the previous day's séjour ---

test('RC2 section 32: an OFF day with no manual location override shares Infos with the immediately preceding day', () => {
  const days = [
    day({ id: 'd0', index: 0, type: 'ride', stageId: 's0' }),
    day({ id: 'd1', index: 1, type: 'off' }),
  ]
  assert.equal(resolveSharedInfoDayId(bundle(days, []), days[1]), 'd0', 'an OFF right after a ride day shares that ride day\'s own séjour (section 33)')
})

test('RC2 section 32: an OFF day with its own manual location override stays its own Infos owner', () => {
  const days = [
    day({ id: 'd0', index: 0, type: 'ride', stageId: 's0' }),
    day({ id: 'd1', index: 1, type: 'off', startLocationName: 'Somewhere Else' }),
  ]
  assert.equal(resolveSharedInfoDayId(bundle(days, []), days[1]), 'd1', 'a genuinely different place never inherits a neighbour\'s séjour')
})

test('RC2 section 34: Ride → OFF → OFF — both consecutive OFF days resolve to the SAME ride day, never a chain of separate copies', () => {
  const days = [
    day({ id: 'd0', index: 0, type: 'ride', stageId: 's0' }),
    day({ id: 'd1', index: 1, type: 'off' }),
    day({ id: 'd2', index: 2, type: 'off' }),
  ]
  const b = bundle(days, [])
  assert.equal(resolveSharedInfoDayId(b, days[1]), 'd0')
  assert.equal(resolveSharedInfoDayId(b, days[2]), 'd0', 'chained transitively through the first OFF day, to the same ultimate owner')
})

test('RC2 section 34: a later OFF day with its own override breaks the chain and becomes its own new anchor for anything sharing further down', () => {
  const days = [
    day({ id: 'd0', index: 0, type: 'ride', stageId: 's0' }),
    day({ id: 'd1', index: 1, type: 'off', startLocationName: 'Different Town' }),
    day({ id: 'd2', index: 2, type: 'off' }),
  ]
  const b = bundle(days, [])
  assert.equal(resolveSharedInfoDayId(b, days[1]), 'd1')
  assert.equal(resolveSharedInfoDayId(b, days[2]), 'd1', 'shares with its own immediate predecessor, not the ride day two steps back')
})

test('RC2 section 32: an OFF day right after a before_next transfer keeps its own Infos — that transfer never carries a séjour to share', () => {
  const days = [
    day({ id: 'd0', index: 0, type: 'transfer', transferTiming: 'before_next' }),
    day({ id: 'd1', index: 1, type: 'off' }),
  ]
  assert.equal(resolveSharedInfoDayId(bundle(days, []), days[1]), 'd1')
})

test('RC2 sections 33-34: an after_previous transfer following an OFF day chains through to that OFF day\'s own owner', () => {
  const days = [
    day({ id: 'd0', index: 0, type: 'ride', stageId: 's0' }),
    day({ id: 'd1', index: 1, type: 'off' }),
    day({ id: 'd2', index: 2, type: 'transfer', transferTiming: 'after_previous' }),
  ]
  const b = bundle(days, [])
  assert.equal(resolveSharedInfoDayId(b, days[2]), 'd0')
})
