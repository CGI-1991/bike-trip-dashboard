// Informative timing only (CDC section 28) — no fragile thresholds, no
// pass/fail gate on duration. Logged so a human can eyeball regressions;
// the assertions here only check the pipeline actually completed.

import { installMinimalDOMParser } from '../../support/minimal-dom-parser.mjs'

installMinimalDOMParser()

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { analyzeGpxDocument } from '../../../src/import/gpx/analyze-gpx.ts'
import { parseGpxXml } from '../../../src/import/gpx/gpx-xml.ts'
import { buildGpxXml, toGpxImportFile } from './support/fixtures.mjs'
import { runImport } from './support/run-import.mjs'

const projectRoot = new URL('../../../', import.meta.url)
const manifest = JSON.parse(await readFile(new URL('public/data/gpx/manifest.json', projectRoot), 'utf8'))

function climbFile(name, startLat) {
  const xml = buildGpxXml({
    tracks: [{ segments: [Array.from({ length: 50 }, (_, index) => ({ lat: startLat + index * 0.0005, lon: 6 + index * 0.0005, ele: 1000 + index * 5 }))] }],
  })
  return toGpxImportFile(xml, name)
}

test('performance (informative): parsing one RGA GPX file', async () => {
  const fileName = manifest.files[0].fileName
  const xmlText = await readFile(new URL(`public/data/gpx/${fileName}`, projectRoot), 'utf8')
  const startedAt = performance.now()
  const analysis = analyzeGpxDocument(parseGpxXml(xmlText), fileName)
  const durationMs = performance.now() - startedAt
  console.log(`[perf] parse 1 RGA GPX (${fileName}, ${analysis.points.length} points): ${durationMs.toFixed(1)} ms`)
  assert.ok(analysis.points.length > 0)
})

test('performance (informative): parsing all 10 RGA GPX files', async () => {
  const startedAt = performance.now()
  let totalPoints = 0
  for (const entry of manifest.files) {
    const xmlText = await readFile(new URL(`public/data/gpx/${entry.fileName}`, projectRoot), 'utf8')
    totalPoints += analyzeGpxDocument(parseGpxXml(xmlText), entry.fileName).points.length
  }
  const durationMs = performance.now() - startedAt
  console.log(`[perf] parse ${manifest.files.length} RGA GPX files (${totalPoints} points total): ${durationMs.toFixed(1)} ms`)
  assert.ok(totalPoints > 0)
})

test('performance (informative): building and persisting a synthetic multi-stage TripBundle', async () => {
  const files = Array.from({ length: 10 }, (_, index) => climbFile(`stage-${index + 1}.gpx`, 45 + index))
  const startedAt = performance.now()
  const { result, database } = await runImport(files, { startDate: '2027-06-01', timezone: 'Europe/Paris' })
  const durationMs = performance.now() - startedAt
  try {
    console.log(`[perf] build + persist a synthetic ${files.length}-stage TripBundle: ${durationMs.toFixed(1)} ms`)
    assert.equal(result.ok, true)
  } finally {
    database.close()
  }
})
