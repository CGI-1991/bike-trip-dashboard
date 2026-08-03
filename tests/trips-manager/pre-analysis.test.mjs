import { installMinimalDOMParser } from '../support/minimal-dom-parser.mjs'

installMinimalDOMParser()

import assert from 'node:assert/strict'
import test from 'node:test'

import { preAnalyzeGpxFile, preAnalyzeGpxFiles } from '../../src/trips-manager/pre-analysis.ts'
import { buildGpxXml, simpleClimbTrack, toGpxImportFile } from '../import/gpx/support/fixtures.mjs'

test('pre-analysis of a valid GPX file reports distance/D+/D- and endpoints', async () => {
  const xml = buildGpxXml({ tracks: [simpleClimbTrack()] })
  const file = toGpxImportFile(xml, 'stage-1.gpx')
  const result = await preAnalyzeGpxFile(file)
  assert.equal(result.status, 'valid')
  assert.equal(result.errorMessage, null)
  assert.ok(result.distanceKm > 0)
  assert.equal(result.elevationGainM, 100)
  assert.equal(result.elevationLossM, 0)
  assert.match(result.sha256, /^[0-9a-f]{64}$/)
  assert.ok(result.sampledPoints.length > 0)
})

test('pre-analysis of an empty file reports invalid with a message, never throws', async () => {
  const file = toGpxImportFile('', 'empty.gpx')
  const result = await preAnalyzeGpxFile(file)
  assert.equal(result.status, 'invalid')
  assert.ok(result.errorMessage !== null && result.errorMessage.length > 0)
  assert.equal(result.distanceKm, null)
})

test('pre-analysis of a file with no usable route points reports invalid, not a crash', async () => {
  const xml = buildGpxXml({ tracks: [{ segments: [[{ lat: 45, lon: 6 }]] }] })
  const file = toGpxImportFile(xml, 'single-point.gpx')
  const result = await preAnalyzeGpxFile(file)
  assert.equal(result.status, 'invalid')
})

test('two byte-identical files hash to the same sha256, enabling strict-duplicate detection downstream', async () => {
  const xml = buildGpxXml({ tracks: [simpleClimbTrack()] })
  const a = await preAnalyzeGpxFile(toGpxImportFile(xml, 'a.gpx'))
  const b = await preAnalyzeGpxFile(toGpxImportFile(xml, 'b.gpx'))
  assert.equal(a.sha256, b.sha256)
})

test('preAnalyzeGpxFiles runs every file independently and preserves order', async () => {
  const good = toGpxImportFile(buildGpxXml({ tracks: [simpleClimbTrack()] }), 'good.gpx')
  const bad = toGpxImportFile('', 'bad.gpx')
  const results = await preAnalyzeGpxFiles([good, bad])
  assert.equal(results.length, 2)
  assert.equal(results[0].fileName, 'good.gpx')
  assert.equal(results[0].status, 'valid')
  assert.equal(results[1].fileName, 'bad.gpx')
  assert.equal(results[1].status, 'invalid')
})
