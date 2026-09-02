import assert from 'node:assert/strict'
import test from 'node:test'

import { formatTransferModeLabel, isKnownTransferMode, TRANSFER_MODE_LABELS } from '../../src/ui/trips/transfer-mode-labels.ts'
import { TRANSFER_MODES } from '../../src/trip-core/index.ts'

test('every one of the 7 fixed TRANSFER_MODES has its own French label, no more, no fewer', () => {
  assert.deepEqual(Object.keys(TRANSFER_MODE_LABELS).sort(), [...TRANSFER_MODES].sort())
  for (const code of TRANSFER_MODES) assert.ok(isKnownTransferMode(code))
})

test('formatTransferModeLabel: a known code shows its canonical French label', () => {
  assert.equal(formatTransferModeLabel('train'), 'Train')
  assert.equal(formatTransferModeLabel('bike'), 'Vélo')
})

test('formatTransferModeLabel: a legacy/free-text value (not one of the 7 codes) shows back verbatim — never dropped, never retranslated', () => {
  assert.equal(formatTransferModeLabel('TGV'), 'TGV')
  assert.equal(formatTransferModeLabel('Train'), 'Train', 'R2\'s own capitalized free text is not one of the lowercase codes, and stays exactly as stored')
})

test('formatTransferModeLabel: absent/blank stays null, never fabricated', () => {
  assert.equal(formatTransferModeLabel(undefined), null)
  assert.equal(formatTransferModeLabel(null), null)
  assert.equal(formatTransferModeLabel('   '), null)
})

test('isKnownTransferMode: rejects anything outside the 7-value list', () => {
  assert.equal(isKnownTransferMode('TGV'), false)
  assert.equal(isKnownTransferMode(''), false)
})
