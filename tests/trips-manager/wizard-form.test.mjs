import assert from 'node:assert/strict'
import test from 'node:test'

import { validateWizardForm } from '../../src/trips-manager/wizard-form.ts'

function file(fileName, status = 'valid', isUnresolvedStrictDuplicate = false, removed = false) {
  return { fileName, status, isUnresolvedStrictDuplicate, removed }
}

function form(overrides = {}) {
  return { name: 'Mon voyage', startDate: '2027-06-01', files: [file('a.gpx')], ...overrides }
}

test('a fully valid form can create the trip', () => {
  const result = validateWizardForm(form())
  assert.equal(result.canCreate, true)
  assert.deepEqual(result.reasons, [])
})

test('an empty name blocks creation', () => {
  const result = validateWizardForm(form({ name: '' }))
  assert.equal(result.canCreate, false)
  assert.ok(result.reasons.some((reason) => reason.includes('nom')))
})

test('a whitespace-only name blocks creation', () => {
  const result = validateWizardForm(form({ name: '   ' }))
  assert.equal(result.canCreate, false)
})

test('a missing startDate blocks creation', () => {
  const result = validateWizardForm(form({ startDate: null }))
  assert.equal(result.canCreate, false)
  assert.ok(result.reasons.some((reason) => reason.includes('départ')))
})

test('an empty-string startDate blocks creation', () => {
  const result = validateWizardForm(form({ startDate: '' }))
  assert.equal(result.canCreate, false)
})

test('zero valid GPX files blocks creation', () => {
  const result = validateWizardForm(form({ files: [file('a.gpx', 'invalid')] }))
  assert.equal(result.canCreate, false)
  assert.ok(result.reasons.some((reason) => reason.includes('GPX')))
})

test('an unresolved strict duplicate blocks creation even with other valid files', () => {
  const result = validateWizardForm(form({ files: [file('a.gpx'), file('b.gpx', 'valid', true)] }))
  assert.equal(result.canCreate, false)
  assert.ok(result.reasons.some((reason) => reason.toLowerCase().includes('doublon')))
})

test('a removed strict-duplicate file no longer blocks creation', () => {
  const result = validateWizardForm(form({ files: [file('a.gpx'), file('b.gpx', 'valid', true, true)] }))
  assert.equal(result.canCreate, true)
})

test('an invalid file alongside a valid one does not block creation on its own', () => {
  const result = validateWizardForm(form({ files: [file('a.gpx'), file('bad.gpx', 'invalid')] }))
  assert.equal(result.canCreate, true)
})

test('multiple problems are all reported at once, not just the first one found', () => {
  const result = validateWizardForm({ name: '', startDate: null, files: [file('a.gpx', 'invalid')] })
  assert.equal(result.canCreate, false)
  assert.equal(result.reasons.length, 3)
})
