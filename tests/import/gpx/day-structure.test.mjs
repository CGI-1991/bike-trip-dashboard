import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DayStructureError,
  StructureSlotError,
  applyDayStructure,
  defaultRideOnlyStructure,
  insertStructureSlot,
  removeStructureSlot,
} from '../../../src/import/gpx/day-structure.ts'
import { tripDayId } from '../../../src/trip-core/index.ts'

function rideDay(id, index, displayNumber, date, startLocationName, endLocationName) {
  return {
    id: tripDayId(id),
    index,
    displayNumber,
    date,
    type: 'ride',
    stageId: tripDayId(`${id}-stage`),
    startLocationName,
    endLocationName,
    accommodationId: null,
    notes: null,
    enrichmentStatus: 'not-started',
  }
}

function minimalBundle(days, { dated = true } = {}) {
  const startDate = dated ? days[0]?.date ?? '2027-06-01' : null
  const endDate = dated ? days[days.length - 1]?.date ?? startDate : null
  return {
    schemaVersion: 1,
    metadata: { id: 'trip-1', slug: 'trip-1', name: 'Trip', description: null, createdAt: 'x', updatedAt: 'x', startDate, endDate, timezone: dated ? 'Europe/Paris' : null, language: 'fr', units: 'metric', status: 'draft', schemaVersion: 1, engineVersion: 'test@1' },
    calendar: { startDate, endDate, timezone: dated ? 'Europe/Paris' : null },
    days,
    stages: [],
    sourceFiles: [],
    routes: [],
    climbs: [],
    routePoints: [],
    practicalPlaces: [],
    accommodations: [],
    weather: [],
    settings: { global: { referenceSpeedKph: 18, pausePlanMode: 'automatic' }, days: days.map((day) => ({ dayId: day.id, departureTime: '08:00', totalBreakSeconds: 1800 })), stages: [] },
    overrides: [],
    enrichmentMetadata: { providers: [] },
    generatedMetadata: { engineVersion: 'test@1', generatedAt: 'x', derivedDataStatus: 'fresh' },
  }
}

function idFactory(prefix = 'new') {
  let counter = 0
  return () => `${prefix}-${counter++}`
}

test('defaultRideOnlyStructure produces exactly one ride slot per stage', () => {
  assert.deepEqual(defaultRideOnlyStructure(3), [{ kind: 'ride' }, { kind: 'ride' }, { kind: 'ride' }])
})

test('applying the default structure to a ride-only bundle leaves it unchanged in content, only index/displayNumber recomputed identically', () => {
  const days = [
    rideDay('d1', 0, 1, '2027-06-01', 'A', 'B'),
    rideDay('d2', 1, 2, '2027-06-02', 'B', 'C'),
  ]
  const bundle = minimalBundle(days)
  const result = applyDayStructure(bundle, defaultRideOnlyStructure(2), idFactory())
  assert.equal(result.days.length, 2)
  assert.deepEqual(result.days.map((d) => d.id), ['d1', 'd2'])
  assert.deepEqual(result.days.map((d) => d.date), ['2027-06-01', '2027-06-02'])
})

test('inserting an OFF day shifts every subsequent date by one day', () => {
  const days = [
    rideDay('d1', 0, 1, '2027-06-01', 'A', 'B'),
    rideDay('d2', 1, 2, '2027-06-02', 'B', 'C'),
  ]
  const bundle = minimalBundle(days)
  const structure = [{ kind: 'ride' }, { kind: 'off', notes: 'Repos' }, { kind: 'ride' }]
  const result = applyDayStructure(bundle, structure, idFactory())
  assert.equal(result.days.length, 3)
  assert.deepEqual(result.days.map((d) => d.type), ['ride', 'off', 'ride'])
  assert.deepEqual(result.days.map((d) => d.date), ['2027-06-01', '2027-06-02', '2027-06-03'])
  assert.deepEqual(result.days.map((d) => d.index), [0, 1, 2])
  assert.deepEqual(result.days.map((d) => d.displayNumber), [1, 2, 3])
})

test('a brand-new OFF day starts with no manual override at all — never a baked-in snapshot (bug 5-9 closeout)', () => {
  // `resolveOffLocation`/`resolveTransferLocations` (`analysis/day-location-fill.ts`)
  // own the previous-ride/next-ride fallback chain now, resolved live on
  // every read from the *current* `RideStage` records — never baked into
  // `TripDay.startLocationName`/`endLocationName` at structure-application
  // time. Baking a snapshot here made it permanent and immune to a later
  // geocoding update on the neighbouring stage (see
  // `tests/analysis/day-location-fill.test.mjs` for the actual fallback
  // chain's coverage, including the start-of-trip fallback). `null` is the
  // only value that means "no manual override yet".
  const days = [rideDay('d1', 0, 1, '2027-06-01', 'A', 'Somewhere'), rideDay('d2', 1, 2, '2027-06-02', 'Somewhere', 'C')]
  const bundle = minimalBundle(days)
  const structure = [{ kind: 'ride' }, { kind: 'off' }, { kind: 'ride' }]
  const result = applyDayStructure(bundle, structure, idFactory())
  const offDay = result.days[1]
  assert.equal(offDay.startLocationName, null)
  assert.equal(offDay.endLocationName, null)
  assert.equal(offDay.stageId, null)
  assert.equal(offDay.notes, null)
})

test('an OFF day carries its notes through unchanged', () => {
  const days = [rideDay('d1', 0, 1, '2027-06-01', 'A', 'B')]
  const bundle = minimalBundle(days)
  const structure = [{ kind: 'ride' }, { kind: 'off', notes: 'Journée libre à Bourg' }]
  const result = applyDayStructure(bundle, structure, idFactory())
  assert.equal(result.days[1].notes, 'Journée libre à Bourg')
})

test('a brand-new transfer also starts with no manual override — resolved live via resolveTransferLocations, never baked (bug 5-9 closeout)', () => {
  const days = [rideDay('d1', 0, 1, '2027-06-01', 'A', 'Gare X'), rideDay('d2', 1, 2, '2027-06-02', 'Gare Y', 'C')]
  const bundle = minimalBundle(days)
  const structure = [{ kind: 'ride' }, { kind: 'transfer', notes: 'Train' }, { kind: 'ride' }]
  const result = applyDayStructure(bundle, structure, idFactory())
  const transfer = result.days[1]
  assert.equal(transfer.type, 'transfer')
  assert.equal(transfer.startLocationName, null)
  assert.equal(transfer.endLocationName, null)
  assert.equal(transfer.stageId, null)
  assert.equal(transfer.notes, 'Train')
})

test('a transfer at the very end of the trip also stores null, never a placeholder string — the "unknown" display text is a UI concern, not persisted data', () => {
  const days = [rideDay('d1', 0, 1, '2027-06-01', 'A', 'B')]
  const bundle = minimalBundle(days)
  const structure = [{ kind: 'ride' }, { kind: 'transfer' }]
  const result = applyDayStructure(bundle, structure, idFactory())
  assert.equal(result.days[1].startLocationName, null)
  assert.equal(result.days[1].endLocationName, null)
})

test('the calendar/metadata endDate is recomputed to match the new total day count', () => {
  const days = [rideDay('d1', 0, 1, '2027-06-01', 'A', 'B'), rideDay('d2', 1, 2, '2027-06-02', 'B', 'C')]
  const bundle = minimalBundle(days)
  const structure = [{ kind: 'ride' }, { kind: 'off' }, { kind: 'off' }, { kind: 'ride' }]
  const result = applyDayStructure(bundle, structure, idFactory())
  assert.equal(result.calendar.endDate, '2027-06-04')
  assert.equal(result.metadata.endDate, '2027-06-04')
})

test('an undated bundle stays undated after structure insertion — no synthetic date appears', () => {
  const days = [
    { ...rideDay('d1', 0, 1, null, 'A', 'B') },
    { ...rideDay('d2', 1, 2, null, 'B', 'C') },
  ]
  const bundle = minimalBundle(days, { dated: false })
  const structure = [{ kind: 'ride' }, { kind: 'off' }, { kind: 'ride' }]
  const result = applyDayStructure(bundle, structure, idFactory())
  assert.ok(result.days.every((day) => day.date === null))
  assert.equal(result.calendar.startDate, null)
  assert.equal(result.calendar.endDate, null)
})

test('settings.days is filtered to only the days that still exist after restructuring', () => {
  const days = [rideDay('d1', 0, 1, '2027-06-01', 'A', 'B')]
  const bundle = minimalBundle(days)
  const structure = [{ kind: 'ride' }, { kind: 'off' }]
  const result = applyDayStructure(bundle, structure, idFactory())
  // The original settings.days entry for d1 survives; no entry exists for the new OFF day (never fabricated).
  assert.equal(result.settings.days.length, 1)
  assert.equal(result.settings.days[0].dayId, 'd1')
})

test('a mismatched ride-slot count throws a DayStructureError rather than silently truncating', () => {
  const days = [rideDay('d1', 0, 1, '2027-06-01', 'A', 'B')]
  const bundle = minimalBundle(days)
  assert.throws(() => applyDayStructure(bundle, [{ kind: 'ride' }, { kind: 'ride' }], idFactory()), DayStructureError)
})

test('newly-created OFF/transfer day ids are unique and distinct from the original ride day ids', () => {
  const days = [rideDay('d1', 0, 1, '2027-06-01', 'A', 'B'), rideDay('d2', 1, 2, '2027-06-02', 'B', 'C')]
  const bundle = minimalBundle(days)
  const structure = [{ kind: 'ride' }, { kind: 'off' }, { kind: 'transfer' }, { kind: 'ride' }]
  const result = applyDayStructure(bundle, structure, idFactory())
  const ids = result.days.map((day) => day.id)
  assert.equal(new Set(ids).size, ids.length)
});

[
  ['insertStructureSlot inserts right after the given position', () => {
    const slots = defaultRideOnlyStructure(2)
    const result = insertStructureSlot(slots, 0, { kind: 'off' })
    assert.deepEqual(result, [{ kind: 'ride' }, { kind: 'off' }, { kind: 'ride' }])
  }],
  ['insertStructureSlot at position -1 inserts at the very start', () => {
    const slots = defaultRideOnlyStructure(2)
    const result = insertStructureSlot(slots, -1, { kind: 'transfer' })
    assert.deepEqual(result, [{ kind: 'transfer' }, { kind: 'ride' }, { kind: 'ride' }])
  }],
  ['removeStructureSlot removes an off/transfer slot', () => {
    const slots = [{ kind: 'ride' }, { kind: 'off' }, { kind: 'ride' }]
    assert.deepEqual(removeStructureSlot(slots, 1), [{ kind: 'ride' }, { kind: 'ride' }])
  }],
  ['removeStructureSlot refuses to remove a ride slot', () => {
    const slots = [{ kind: 'ride' }, { kind: 'off' }]
    assert.throws(() => removeStructureSlot(slots, 0), StructureSlotError)
  }],
  ['insertStructureSlot/removeStructureSlot never mutate their input', () => {
    const slots = defaultRideOnlyStructure(2)
    const snapshot = JSON.parse(JSON.stringify(slots))
    insertStructureSlot(slots, 0, { kind: 'off' })
    assert.deepEqual(slots, snapshot)
  }],
].forEach(([name, fn]) => test(name, fn))
