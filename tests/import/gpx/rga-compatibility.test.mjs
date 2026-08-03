// Non-regression check (CDC section 27): the new generic pipeline must
// reproduce the RGA's own historical distance/D+/D-/altitude/point numbers
// for its ten canonical GPX files. This never reconstructs the RGA
// `TripBundle` with the new pipeline and never touches
// `tests/golden/rga-2026/rga-2026-golden.json` — it only reads the already
// generated golden values as a reference and re-derives the same technical
// figures independently, through `src/import/gpx/analyze-gpx.ts`.

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
  test(`${reference.fileName} — distance/D+/D-/altitude/points match the historical pipeline`, async () => {
    assert.equal(reference.status, 'success')

    const xmlText = await readFile(new URL(`public/data/gpx/${reference.fileName}`, projectRoot), 'utf8')
    const analysis = analyzeGpxDocument(parseGpxXml(xmlText), reference.fileName)

    assert.equal(Math.round(analysis.distanceKm * 1000) / 1000, reference.distanceKm, 'distanceKm (haversine, reused algorithm)')
    assert.equal(analysis.elevationGainM === null ? null : Math.round(analysis.elevationGainM), reference.elevationGainM, 'elevationGainM (D+)')
    assert.equal(analysis.elevationLossM === null ? null : Math.round(analysis.elevationLossM), reference.elevationLossM, 'elevationLossM (D-)')
    assert.equal(analysis.minAltitudeM, reference.minElevationM, 'minAltitudeM')
    assert.equal(analysis.maxAltitudeM, reference.maxElevationM, 'maxAltitudeM')
    assert.equal(analysis.points.length, reference.totalPoints, 'totalPoints')
    assert.equal(analysis.segmentCount, reference.segmentCount, 'segmentCount')
    assert.equal(analysis.segmentCount > 1, reference.hasMultipleSegments, 'hasMultipleSegments')
    assert.equal(analysis.waypoints.length, reference.waypointCount, 'waypointCount')
  })
}
