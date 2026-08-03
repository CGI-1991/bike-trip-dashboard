import assert from 'node:assert/strict'
import test from 'node:test'

import { sha256Hex } from '../../../src/import/gpx/hash.ts'
import { buildSourceFile, validateGpxImportFile } from '../../../src/import/gpx/source-file.ts'
import { toGpxImportFile } from './support/fixtures.mjs'

test('sha256Hex returns a 64-character lowercase hex digest', async () => {
  const bytes = new TextEncoder().encode('hello-gpx').buffer
  const hash = await sha256Hex(bytes)
  assert.match(hash, /^[0-9a-f]{64}$/)
})

test('sha256Hex is deterministic for empty input too, and differs from non-empty input', async () => {
  const emptyHashA = await sha256Hex(new ArrayBuffer(0))
  const emptyHashB = await sha256Hex(new ArrayBuffer(0))
  const nonEmptyHash = await sha256Hex(new TextEncoder().encode('x').buffer)
  assert.equal(emptyHashA, emptyHashB)
  assert.notEqual(emptyHashA, nonEmptyHash)
})

test('sha256Hex is deterministic and content-sensitive', async () => {
  const a = await sha256Hex(new TextEncoder().encode('content-a').buffer)
  const b = await sha256Hex(new TextEncoder().encode('content-a').buffer)
  const c = await sha256Hex(new TextEncoder().encode('content-b').buffer)
  assert.equal(a, b)
  assert.notEqual(a, c)
})

test('an empty file is rejected', () => {
  const file = toGpxImportFile('', 'empty.gpx')
  const issues = validateGpxImportFile(file)
  assert.ok(issues.some((issue) => issue.code === 'invalid-file'))
})

test('a missing name is rejected', () => {
  const file = toGpxImportFile('<gpx></gpx>', '  ')
  const issues = validateGpxImportFile(file)
  assert.ok(issues.some((issue) => issue.code === 'invalid-file'))
})

test('a wrong extension is rejected', () => {
  const file = toGpxImportFile('<gpx></gpx>', 'track.kml')
  const issues = validateGpxImportFile(file)
  assert.ok(issues.some((issue) => issue.code === 'invalid-file'))
})

test('an unexpected MIME type is rejected when one is provided', () => {
  const file = toGpxImportFile('<gpx></gpx>', 'track.gpx', { mimeType: 'image/png' })
  const issues = validateGpxImportFile(file)
  assert.ok(issues.some((issue) => issue.code === 'invalid-file'))
})

test('a null MIME type is accepted (many OSes never set one for .gpx)', () => {
  const file = toGpxImportFile('<gpx></gpx>', 'track.gpx', { mimeType: null })
  assert.deepEqual(validateGpxImportFile(file), [])
})

test('an inconsistent sizeBytes/bytes pair is rejected', () => {
  const file = toGpxImportFile('<gpx></gpx>', 'track.gpx', { sizeBytes: 999 })
  const issues = validateGpxImportFile(file)
  assert.ok(issues.some((issue) => issue.code === 'invalid-file'))
})

test('a valid .gpx file passes with no issues', () => {
  const file = toGpxImportFile('<gpx></gpx>', 'track.gpx')
  assert.deepEqual(validateGpxImportFile(file), [])
})

test('buildSourceFile defaults mimeType to application/gpx+xml when the input file carried none (the model field is non-nullable)', () => {
  const file = toGpxImportFile('<gpx></gpx>', 'track.gpx', { mimeType: null })
  const sourceFile = buildSourceFile(file, 'source-1', 'a'.repeat(64), '2027-01-01T00:00:00.000Z', 'success', [])
  assert.equal(sourceFile.mimeType, 'application/gpx+xml')
})
