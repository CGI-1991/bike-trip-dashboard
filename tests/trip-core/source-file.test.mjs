import assert from 'node:assert/strict'
import test from 'node:test'

import { validateTripBundle } from '../../src/trip-core/validation/trip-bundle.ts'
import { createGenericTripBundle } from './support/generic-trip-fixture.mjs'

function issueCodes(result) {
  assert.equal(result.ok, false)
  return result.issues.map((issue) => issue.code)
}

test('a 64-character hex sha256, lower or upper case, is accepted', () => {
  const bundle = createGenericTripBundle()
  bundle.sourceFiles[0].sha256 = 'A'.repeat(32) + 'f'.repeat(32)
  assert.equal(validateTripBundle(bundle).ok, true)
})

test('a sha256 shorter than 64 hex characters is rejected', () => {
  const bundle = createGenericTripBundle()
  bundle.sourceFiles[0].sha256 = 'a'.repeat(63)
  assert.ok(issueCodes(validateTripBundle(bundle)).includes('invalid-value'))
})

test('a sha256 with a non-hex character is rejected', () => {
  const bundle = createGenericTripBundle()
  bundle.sourceFiles[0].sha256 = 'g'.repeat(64)
  assert.ok(issueCodes(validateTripBundle(bundle)).includes('invalid-value'))
})

test('an arbitrary non-empty string is not accepted as a sha256', () => {
  const bundle = createGenericTripBundle()
  bundle.sourceFiles[0].sha256 = 'not-a-real-hash'
  assert.ok(issueCodes(validateTripBundle(bundle)).includes('invalid-value'))
})

test('sizeBytes must be a non-negative integer', () => {
  const bundle = createGenericTripBundle()
  bundle.sourceFiles[0].sizeBytes = -1
  assert.ok(issueCodes(validateTripBundle(bundle)).includes('invalid-value'))
})

test('an empty string inside parsingErrors is rejected', () => {
  const bundle = createGenericTripBundle()
  bundle.sourceFiles[0].parsingErrors = ['']
  assert.ok(issueCodes(validateTripBundle(bundle)).includes('invalid-type'))
})

test('a non-empty parsingErrors entry is accepted', () => {
  const bundle = createGenericTripBundle()
  bundle.sourceFiles[1].parsingErrors = ['unexpected end of file']
  bundle.sourceFiles[1].parsingStatus = 'error'
  assert.equal(validateTripBundle(bundle).ok, true)
})
