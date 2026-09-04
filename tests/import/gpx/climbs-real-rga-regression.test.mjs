// Polish-final sections 11, 60, 86-C: the real, un-synthetic RGA GPX files
// (`public/data/gpx/*.gpx`) are all genuinely mountain-relief (≥18 m of gain
// per km travelled — see the per-file assertion below), so the adaptive
// tuning introduced for rolling/mixed stages (`climb-detection.ts`) must
// never engage on any of them: their climb counts stay pinned to the exact
// values measured before that change. A drop here means a real alpine
// stage lost a climb it used to have — never acceptable, unlike a rolling
// fixture's count, which is deliberately not pinned this tightly elsewhere.

import { installMinimalDOMParser } from '../../support/minimal-dom-parser.mjs'

installMinimalDOMParser()

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { buildDistanceIndexedSeries, smoothElevation } from '../../../src/analysis/elevation-profile.ts'
import { buildTerrainSlopeProfile } from '../../../src/analysis/terrain-profile.ts'
import { detectClimbs } from '../../../src/analysis/climb-detection.ts'
import { analyzeGpxDocument } from '../../../src/import/gpx/analyze-gpx.ts'
import { parseGpxXml } from '../../../src/import/gpx/gpx-xml.ts'
import { routeId } from '../../../src/trip-core/index.ts'

const projectRoot = new URL('../../../', import.meta.url)
const manifest = JSON.parse(await readFile(new URL('public/data/gpx/manifest.json', projectRoot), 'utf8'))

// Measured directly from `public/data/gpx/*.gpx`, in manifest order —
// Thonon→Morzine, Morzine→Grand-Bornand, Grand-Bornand→Beaufort,
// Beaufort→Bourg-Saint-Maurice, Bourg-Saint-Maurice→Val-Cenis,
// Val-Cenis→Briançon, Briançon→Barcelonnette, Barcelonnette→Saint-Étienne,
// Saint-Étienne→Saint-Martin, Saint-Martin→Nice.
const EXPECTED_CLIMB_COUNTS = [5, 4, 3, 2, 6, 2, 5, 1, 1, 6]

function idFactory() {
  let counter = 0
  return () => `rga-regression-${counter++}`
}

test('every real RGA GPX file is genuinely mountain-relief (≥18 m D+/km) — the adaptive tuning never engages on these fixtures', async () => {
  for (const entry of manifest.files) {
    const xmlText = await readFile(new URL(`public/data/gpx/${entry.fileName}`, projectRoot), 'utf8')
    const analysis = analyzeGpxDocument(parseGpxXml(xmlText), entry.fileName)
    const gainPerKm = analysis.elevationGainM / analysis.distanceKm
    assert.ok(gainPerKm >= 18, `${entry.fileName}: expected mountain relief (≥18 m/km), got ${gainPerKm.toFixed(1)}`)
  }
})

test('climb counts on every real RGA GPX file are unchanged by the adaptive climb-detection tuning', async () => {
  assert.equal(manifest.files.length, EXPECTED_CLIMB_COUNTS.length, 'the manifest and the pinned expectations must stay in lockstep')
  for (const [index, entry] of manifest.files.entries()) {
    const xmlText = await readFile(new URL(`public/data/gpx/${entry.fileName}`, projectRoot), 'utf8')
    const analysis = analyzeGpxDocument(parseGpxXml(xmlText), entry.fileName)
    const terrainProfile = buildTerrainSlopeProfile(smoothElevation(buildDistanceIndexedSeries(analysis.points)))
    const climbs = detectClimbs(terrainProfile, analysis.waypoints, routeId('rga-regression-route'), idFactory(), 'rga-regression@1')
    assert.equal(climbs.length, EXPECTED_CLIMB_COUNTS[index], `${entry.fileName}: expected ${EXPECTED_CLIMB_COUNTS[index]} climb(s), got ${climbs.length}`)
  }
})
