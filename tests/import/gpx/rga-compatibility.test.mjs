// Non-regression check (CDC section 27): the generic pipeline must keep
// reproducing the RGA's historical geometry/distance/raw-altitude structure
// for its ten canonical GPX files. D+/D- intentionally no longer match the
// historical point-to-point accumulation: the generic importer now computes
// user-facing ascent/descent from a 150 m smoothed altitude series to avoid
// GPX noise inflation. The historical raw D+/D- remain useful here as an
// upper-bound regression reference only.

import { installMinimalDOMParser } from '../../support/minimal-dom-parser.mjs'

installMinimalDOMParser()

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { analyzeGpxDocument } from '../../../src/import/gpx/analyze-gpx.ts'
import { parseGpxXml } from '../../../src/import/gpx/gpx-xml.ts'

const projectRoot = new URL('../../../', import.meta.url)
const golden = JSON.parse(await readFile(new URL('tests/golden/rga-2026/rga-2026-golden.json', projectRoot), 'utf8'))

test('the golden master has the ten RGA files this test compares against', () => {
  assert.equal(golden.legacy.gpxTechnical.length, 10)
})

for (const reference of golden.legacy.gpxTechnical) {
  test(`${reference.fileName} — geometry/distance/raw altitude stay compatible while D+/D- are noise-reduced`, async () => {
    assert.equal(reference.status, 'success')

    const xmlText = await readFile(new URL(`public/data/gpx/${reference.fileName}`, projectRoot), 'utf8')
    const analysis = analyzeGpxDocument(parseGpxXml(xmlText), reference.fileName)

    assert.equal(Math.round(analysis.distanceKm * 1000) / 1000, reference.distanceKm, 'distanceKm (haversine, reused algorithm)')
    assert.ok(analysis.elevationGainM !== null && Number.isFinite(analysis.elevationGainM), 'smoothed elevationGainM (D+) is available')
    assert.ok(analysis.elevationLossM !== null && Number.isFinite(analysis.elevationLossM), 'smoothed elevationLossM (D-) is available')
    assert.ok(analysis.elevationGainM >= 0, 'smoothed D+ stays non-negative')
    assert.ok(analysis.elevationLossM >= 0, 'smoothed D- stays non-negative')
    assert.ok(analysis.elevationGainM <= reference.elevationGainM, '150 m smoothing must not exceed historical raw D+')
    assert.ok(analysis.elevationLossM <= reference.elevationLossM, '150 m smoothing must not exceed historical raw D-')
    assert.equal(analysis.minAltitudeM, reference.minElevationM, 'minAltitudeM remains raw GPX altitude')
    assert.equal(analysis.maxAltitudeM, reference.maxElevationM, 'maxAltitudeM remains raw GPX altitude')
    assert.equal(analysis.points.length, reference.totalPoints, 'totalPoints')
    assert.equal(analysis.segmentCount, reference.segmentCount, 'segmentCount')
    assert.equal(analysis.segmentCount > 1, reference.hasMultipleSegments, 'hasMultipleSegments')
    assert.equal(analysis.waypoints.length, reference.waypointCount, 'waypointCount')
  })
}
