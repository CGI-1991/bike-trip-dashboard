import './support/setup-fake-indexeddb.mjs'

import assert from 'node:assert/strict'
import test from 'node:test'

import { createTripRepository } from '../../../src/storage/indexeddb/trip-repository.ts'
import { openTestDatabase } from './support/open-test-database.mjs'
import { applyRaceMode } from '../../../src/trips-manager/race-mode.ts'
import { createLinkedTripBundle, withLodging } from '../../trips-manager/support/linked-trip-fixture.mjs'

// Everything this milestone added is optional and additive, so the real
// question is whether it survives one full save → reload cycle through the
// existing storage layer, and whether a bundle that has none of it still
// loads exactly as before.

test('stage names, linked days, Course/Tour and the detection sensitivity all survive a save and a reload', async () => {
  const database = await openTestDatabase()
  try {
    const base = createLinkedTripBundle({ rideCount: 3, links: [1] })
    const bundle = applyRaceMode({
      ...withLodging(base, 'day-0', { id: 'lodging-a', name: 'Gîte A' }),
      stages: base.stages.map((stage, index) => (index === 0 ? { ...stage, customName: 'Étape reine' } : stage)),
      settings: { ...base.settings, global: { ...base.settings.global, climbDetectionSensitivity: 'flat' } },
    }, true)

    const repository = createTripRepository(database)
    await repository.saveTripBundle(bundle)
    const reloaded = await repository.loadTripBundle(bundle.metadata.id)

    assert.equal(reloaded.stages[0].customName, 'Étape reine')
    assert.equal(reloaded.stages[1].customName, undefined)
    assert.equal(reloaded.days[1].sameCalendarDayAsPrevious, true)
    assert.equal(reloaded.days[2].sameCalendarDayAsPrevious, undefined)
    assert.deepEqual(reloaded.days.map((day) => day.date), ['2028-06-01', '2028-06-01', '2028-06-02'])
    assert.equal(reloaded.calendar.endDate, '2028-06-02')
    assert.equal(reloaded.settings.global.raceMode, true)
    assert.equal(reloaded.settings.global.climbDetectionSensitivity, 'flat')
    assert.equal(reloaded.days[0].accommodationId, 'lodging-a')
  } finally {
    database.close()
  }
})

test('a trip carrying none of the new fields reloads exactly as it was saved', async () => {
  const database = await openTestDatabase()
  try {
    const bundle = createLinkedTripBundle({ rideCount: 2 })
    const repository = createTripRepository(database)
    await repository.saveTripBundle(bundle)
    const reloaded = await repository.loadTripBundle(bundle.metadata.id)

    assert.deepEqual(reloaded.days, bundle.days)
    assert.deepEqual(reloaded.stages, bundle.stages)
    assert.deepEqual(reloaded.settings.global, bundle.settings.global)
    assert.equal(reloaded.settings.global.raceMode, undefined)
    assert.equal(reloaded.settings.global.climbDetectionSensitivity, undefined)
  } finally {
    database.close()
  }
})
