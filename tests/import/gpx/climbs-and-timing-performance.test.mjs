// Informative timing only (CDC section 19) — no fragile thresholds.

import { installMinimalDOMParser } from '../../support/minimal-dom-parser.mjs'

installMinimalDOMParser()

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { buildDistanceIndexedSeries, smoothElevation } from '../../../src/analysis/elevation-profile.ts'
import { buildTerrainSlopeProfile } from '../../../src/analysis/terrain-profile.ts'
import { detectClimbs } from '../../../src/analysis/climb-detection.ts'
import { computeStageTiming } from '../../../src/analysis/timing.ts'
import { analyzeGpxDocument } from '../../../src/import/gpx/analyze-gpx.ts'
import { parseGpxXml } from '../../../src/import/gpx/gpx-xml.ts'
import { routeId } from '../../../src/trip-core/index.ts'
import { buildGpxXml, toGpxImportFile } from './support/fixtures.mjs'
import { runImport } from './support/run-import.mjs'

const projectRoot = new URL('../../../', import.meta.url)
const manifest = JSON.parse(await readFile(new URL('public/data/gpx/manifest.json', projectRoot), 'utf8'))
const settings = { referenceSpeedKph: 18, departureTime: '08:00', totalBreakMinutes: 60 }

function idFactory() {
  let counter = 0
  return () => `perf-${counter++}`
}

async function analyzeOneFile(fileName) {
  const xmlText = await readFile(new URL(`public/data/gpx/${fileName}`, projectRoot), 'utf8')
  const analysis = analyzeGpxDocument(parseGpxXml(xmlText), fileName)
  const terrainProfile = buildTerrainSlopeProfile(smoothElevation(buildDistanceIndexedSeries(analysis.points)))
  return { analysis, terrainProfile }
}

test('performance (informative): full profile analysis (elevation + terrain + grade) of one RGA GPX file', async () => {
  const fileName = manifest.files[0].fileName
  const startedAt = performance.now()
  const { terrainProfile } = await analyzeOneFile(fileName)
  const durationMs = performance.now() - startedAt
  console.log(`[perf] elevation+terrain profile for 1 RGA GPX (${fileName}, ${terrainProfile.length} resampled points): ${durationMs.toFixed(1)} ms`)
  assert.ok(terrainProfile.length > 0)
})

test('performance (informative): climb detection on one RGA GPX file', async () => {
  const fileName = manifest.files[0].fileName
  const { analysis, terrainProfile } = await analyzeOneFile(fileName)
  const startedAt = performance.now()
  const climbs = detectClimbs(terrainProfile, analysis.waypoints, routeId('perf-route'), idFactory(), 'perf@1')
  const durationMs = performance.now() - startedAt
  console.log(`[perf] climb detection for 1 RGA GPX (${fileName}): ${durationMs.toFixed(1)} ms, ${climbs.length} climb(s)`)
  assert.ok(durationMs >= 0)
})

test('performance (informative): full analysis (profile + climbs + timing) of all 10 RGA GPX files', async () => {
  const startedAt = performance.now()
  let totalClimbs = 0
  for (const entry of manifest.files) {
    const { analysis, terrainProfile } = await analyzeOneFile(entry.fileName)
    const climbs = detectClimbs(terrainProfile, analysis.waypoints, routeId('perf-route'), idFactory(), 'perf@1')
    computeStageTiming(terrainProfile, analysis.distanceKm, settings)
    totalClimbs += climbs.length
  }
  const durationMs = performance.now() - startedAt
  console.log(`[perf] full profile+climbs+timing analysis for ${manifest.files.length} RGA GPX files (${totalClimbs} climbs total): ${durationMs.toFixed(1)} ms`)
  assert.ok(totalClimbs >= 0)
})

test('performance (informative): importing 10 synthetic stages with climbs + timing, persisted atomically', async () => {
  const files = Array.from({ length: 10 }, (_, index) => {
    const startLat = 45 + index
    const segments = [[]]
    for (let i = 0; i <= 200; i++) segments[0].push({ lat: startLat + i * 0.0004, lon: 6 + i * 0.0004, ele: 1000 + Math.sin(i / 15) * 100 + i * 3 })
    return toGpxImportFile(buildGpxXml({ tracks: [{ segments }] }), `stage-${index + 1}.gpx`)
  })
  const startedAt = performance.now()
  const { result, database } = await runImport(files, { startDate: '2027-06-01', timezone: 'Europe/Paris' })
  const durationMs = performance.now() - startedAt
  try {
    console.log(`[perf] import 10 synthetic stages with climbs+timing, persisted: ${durationMs.toFixed(1)} ms (${result.ok ? result.bundle.climbs.length : 'n/a'} climbs total)`)
    assert.equal(result.ok, true)
  } finally {
    database.close()
  }
})
