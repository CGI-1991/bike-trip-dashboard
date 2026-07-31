import assert from 'node:assert/strict'
import test from 'node:test'

import { createRgaLegacyTripBundle } from '../../../src/trips/rga-2026/load-rga-legacy-trip.ts'
import { loadRgaLegacySnapshotFromDisk } from './support/load-snapshot.mjs'

const { snapshot } = await loadRgaLegacySnapshotFromDisk()
const bundle = createRgaLegacyTripBundle(snapshot)

function dayByDisplayNumber(displayNumber) {
  return bundle.days.find((day) => day.displayNumber === displayNumber)
}

test('a day with no historical notes (J1) has TripDay.notes === null', () => {
  const j1 = snapshot.roadbook.days.find((day) => day.id === 'J1')
  assert.deepEqual(j1.notes, [])
  assert.equal(dayByDisplayNumber(1).notes, null)
})

test('a day with one historical note (J6) carries it verbatim', () => {
  const j6 = snapshot.roadbook.days.find((day) => day.id === 'J6')
  assert.equal(j6.notes.length, 1)
  assert.equal(dayByDisplayNumber(6).notes, j6.notes[0])
})

test('ambiance text is never folded into TripDay.notes', () => {
  const j1 = snapshot.roadbook.days.find((day) => day.id === 'J1')
  assert.ok(j1.ambiance.length > 0)
  assert.equal(dayByDisplayNumber(1).notes, null) // ambiance exists but notes stays null
})

test('multiple historical notes would be joined with a single newline (synthetic case)', async () => {
  const { createRgaLegacyTripBundle: create } = await import('../../../src/trips/rga-2026/load-rga-legacy-trip.ts')
  const twoNotes = ['Première note.', 'Deuxième note.']
  const broken = {
    ...snapshot,
    roadbook: {
      ...snapshot.roadbook,
      days: snapshot.roadbook.days.map((day) => (day.id === 'J1' ? { ...day, notes: twoNotes } : day)),
    },
  }
  const rebuilt = create(broken)
  const j1 = rebuilt.days.find((day) => day.displayNumber === 1)
  assert.equal(j1.notes, twoNotes.join('\n'))
})
