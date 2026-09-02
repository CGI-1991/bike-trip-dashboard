import assert from 'node:assert/strict'
import test from 'node:test'

import { computeCandidateOpeningStatus } from '../../src/ui/trips/pause-recommendation-view.ts'

// R2.1 sections 9-10 (tests K/L/M/N): opening status per candidate, plus a
// short "would be open with a different departure" hint — only when
// genuinely useful.

const MONDAY = 1
const noon = 12 * 60 // 12:00

test('K: no opening hours at all for this candidate — nothing to show (never a fake "Horaires inconnus" for a spot with no commerce)', () => {
  assert.equal(computeCandidateOpeningStatus(null, MONDAY, noon), null)
  assert.equal(computeCandidateOpeningStatus('   ', MONDAY, noon), null)
})

test('K: open at the current ETA', () => {
  const result = computeCandidateOpeningStatus('Mo-Fr 08:00-18:00', MONDAY, noon)
  assert.deepEqual(result, { label: 'Ouvert à l’ETA', scenarioHint: null })
})

test('K: unrecognizable/complex opening_hours expression — "Horaires inconnus", no scenario hint fabricated', () => {
  const result = computeCandidateOpeningStatus('Mo-Fr 08:00-18:00; PH off', MONDAY, noon)
  assert.deepEqual(result, { label: 'Horaires inconnus', scenarioHint: null })
})

test('M: closed at the current ETA, but genuinely open with a -1h/+1h departure — the closest coherent alternative wins over ±2h', () => {
  // Closed at noon (12:00); still open at 11:00 (-1h, within 08:00-11:30)
  // AND at 10:00 (-2h, same range) — the closer -1h must be preferred.
  const result = computeCandidateOpeningStatus('Mo 08:00-11:30,14:00-18:00', MONDAY, noon)
  assert.equal(result.label, 'Fermé à l’ETA')
  assert.equal(result.scenarioHint, 'ouvert avec départ −1 h')
})

test('N: closed at the current ETA AND at every one of the 5 scenarios — no scenario hint at all, never a comparison line for nothing useful', () => {
  const result = computeCandidateOpeningStatus('Mo 20:00-22:00', MONDAY, noon)
  assert.deepEqual(result, { label: 'Fermé à l’ETA', scenarioHint: null })
})

test('closed now, open with +1h specifically (no -1h/-2h help) — the +1h hint is used', () => {
  const result = computeCandidateOpeningStatus('Mo 13:00-18:00', MONDAY, noon)
  assert.equal(result.label, 'Fermé à l’ETA')
  assert.equal(result.scenarioHint, 'ouvert avec départ +1 h')
})

test('never fabricates a scenario hint when the candidate is already open — no comparison needed', () => {
  const result = computeCandidateOpeningStatus('24/7', MONDAY, noon)
  assert.deepEqual(result, { label: 'Ouvert à l’ETA', scenarioHint: null })
})
