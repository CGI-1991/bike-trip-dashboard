import assert from 'node:assert/strict'
import test from 'node:test'

import { createRgaLegacyTripBundle } from '../../../src/trips/rga-2026/load-rga-legacy-trip.ts'
import { loadRgaLegacySnapshotFromDisk } from './support/load-snapshot.mjs'

const { snapshot } = await loadRgaLegacySnapshotFromDisk()
const bundle = createRgaLegacyTripBundle(snapshot)

test('the calendar matches the historical source exactly: 2026-08-12 to 2026-08-23, Europe/Paris', () => {
  assert.equal(bundle.calendar.startDate, '2026-08-12')
  assert.equal(bundle.calendar.endDate, '2026-08-23')
  assert.equal(bundle.calendar.timezone, 'Europe/Paris')
})

test('metadata dates and timezone are identical to calendar (the required projection)', () => {
  assert.equal(bundle.metadata.startDate, bundle.calendar.startDate)
  assert.equal(bundle.metadata.endDate, bundle.calendar.endDate)
  assert.equal(bundle.metadata.timezone, bundle.calendar.timezone)
})

test('day dates are continuous civil days with no gap or overlap', () => {
  const sorted = [...bundle.days].sort((left, right) => left.index - right.index)
  const dates = sorted.map((day) => day.date)
  assert.equal(new Set(dates).size, 12)
  for (let i = 1; i < dates.length; i++) {
    const previous = new Date(`${dates[i - 1]}T00:00:00Z`)
    const current = new Date(`${dates[i]}T00:00:00Z`)
    assert.equal((current - previous) / 86_400_000, 1, `day ${i} must be exactly one civil day after day ${i - 1}`)
  }
  assert.equal(dates[0], bundle.calendar.startDate)
  assert.equal(dates.at(-1), bundle.calendar.endDate)
})
