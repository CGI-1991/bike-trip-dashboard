import { installMinimalDOMParser } from '../../support/minimal-dom-parser.mjs'

installMinimalDOMParser()

import assert from 'node:assert/strict'
import test from 'node:test'

import { calculateHaversineDistanceKm } from '../../../src/gpx/parser.ts'
import { analyzeGpxDocument } from '../../../src/import/gpx/analyze-gpx.ts'
import { parseGpxXml } from '../../../src/import/gpx/gpx-xml.ts'
import { GpxImportError } from '../../../src/import/gpx/types.ts'
import { buildGpxXml, simpleClimbTrack } from './support/fixtures.mjs'

function analyze(xml, fileName = 'stage.gpx') {
  return analyzeGpxDocument(parseGpxXml(xml), fileName)
}

test('computes a positive distance reusing the historical haversine algorithm', () => {
  const climb = simpleClimbTrack()
  const xml = buildGpxXml({ tracks: [climb] })
  const analysis = analyze(xml)

  const toPoint = ({ lat, lon }) => ({ latitude: lat, longitude: lon })
  const [a, b, c] = climb.segments[0].map(toPoint)
  const expectedDistanceKm = calculateHaversineDistanceKm(a, b) + calculateHaversineDistanceKm(b, c)

  assert.ok(analysis.distanceKm > 0)
  assert.equal(analysis.distanceKm, expectedDistanceKm)
})

test('computes D+/D- on a known monotonic climb: gain=100, loss=0', () => {
  const xml = buildGpxXml({ tracks: [simpleClimbTrack()] })
  const analysis = analyze(xml)
  assert.equal(analysis.elevationGainM, 100)
  assert.equal(analysis.elevationLossM, 0)
  assert.equal(analysis.minAltitudeM, 1000)
  assert.equal(analysis.maxAltitudeM, 1100)
})

test('computes D+ and D- separately on an out-and-back profile', () => {
  const xml = buildGpxXml({
    tracks: [
      {
        segments: [
          [
            { lat: 45, lon: 6, ele: 500 },
            { lat: 45.001, lon: 6.001, ele: 700 },
            { lat: 45.002, lon: 6.002, ele: 550 },
          ],
        ],
      },
    ],
  })
  const analysis = analyze(xml)
  assert.equal(analysis.elevationGainM, 200)
  assert.equal(analysis.elevationLossM, 150)
})

test('builds a resampled elevation profile at the recommended 50 m step, strictly increasing distances', () => {
  const xml = buildGpxXml({ tracks: [simpleClimbTrack()] })
  const analysis = analyze(xml)
  assert.ok(analysis.profile !== null)
  assert.equal(analysis.profile.resampleIntervalMeters, 50)
  assert.ok(analysis.profile.points.length >= 2)
  for (let index = 1; index < analysis.profile.points.length; index++) {
    assert.ok(analysis.profile.points[index].distanceKm > analysis.profile.points[index - 1].distanceKm)
  }
  const last = analysis.profile.points[analysis.profile.points.length - 1]
  assert.equal(Math.round(last.distanceKm * 1e9), Math.round(analysis.distanceKm * 1e9))
})

test('no exploitable altitude: D+/D-/min/max are null, profile is null, a non-blocking issue is raised, the file still imports', () => {
  const xml = buildGpxXml({ tracks: [{ segments: [[{ lat: 45, lon: 6 }, { lat: 45.01, lon: 6.01 }]] }] })
  const analysis = analyze(xml)
  assert.equal(analysis.elevationGainM, null)
  assert.equal(analysis.elevationLossM, null)
  assert.equal(analysis.minAltitudeM, null)
  assert.equal(analysis.maxAltitudeM, null)
  assert.equal(analysis.profile, null)
  assert.equal(analysis.hasAltitude, false)
  assert.ok(analysis.issues.some((issue) => issue.code === 'missing-altitude' && issue.severity === 'warning'))
  assert.ok(analysis.distanceKm > 0)
})

test('a discontinuity between two concatenated segments is reported, never silently merged away', () => {
  const xml = buildGpxXml({
    tracks: [
      {
        segments: [
          [{ lat: 45, lon: 6 }, { lat: 45.001, lon: 6.001 }],
          // far away: several kilometers from the first segment's end point
          [{ lat: 46, lon: 7 }, { lat: 46.001, lon: 7.001 }],
        ],
      },
    ],
  })
  const analysis = analyze(xml)
  assert.equal(analysis.points.length, 4, 'points are still concatenated, never dropped')
  assert.ok(analysis.issues.some((issue) => issue.code === 'gpx-discontinuity' && issue.severity === 'warning'))
})

test('an invalid coordinate is excluded (never silently corrected) and reported, while valid points still build a route', () => {
  const xml = '<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>' +
    '<trkpt lat="45" lon="6"></trkpt><trkpt lat="200" lon="6.01"></trkpt><trkpt lat="45.02" lon="6.02"></trkpt>' +
    '</trkseg></trk></gpx>'
  const analysis = analyze(xml)
  assert.equal(analysis.points.length, 2)
  assert.ok(analysis.issues.some((issue) => issue.code === 'invalid-coordinate'))
})

test('an invalid longitude on a waypoint excludes it from the analysis waypoints, with an issue', () => {
  const xml = buildGpxXml({
    tracks: [simpleClimbTrack()],
    waypoints: [{ name: 'Bad', lat: 45, lon: 200 }, { name: 'Good', lat: 45, lon: 6 }],
  })
  const analysis = analyze(xml)
  assert.equal(analysis.waypoints.length, 1)
  assert.equal(analysis.waypoints[0].name, 'Good')
  assert.ok(analysis.issues.some((issue) => issue.code === 'invalid-coordinate' && issue.context?.waypointIndex === 0))
})

test('zero usable points (an empty trkseg, no rte) throws no-route-points', () => {
  const xml = buildGpxXml({ tracks: [{ segments: [[]] }] })
  assert.throws(() => analyze(xml), (error) => error instanceof GpxImportError && error.code === 'no-route-points')
})

test('a single point (below the minimum of 2) throws no-route-points', () => {
  const xml = buildGpxXml({ tracks: [{ segments: [[{ lat: 45, lon: 6 }]] }] })
  assert.throws(() => analyze(xml), (error) => error instanceof GpxImportError && error.code === 'no-route-points')
})

test('a document with no track, route or waypoint at all throws unsupported-content', () => {
  const xml = buildGpxXml({})
  assert.throws(() => analyze(xml), (error) => error instanceof GpxImportError && error.code === 'unsupported-content')
})

test('falls back to rte/rtept as the geometry source when no trk is present', () => {
  const xml = buildGpxXml({ routes: [{ name: 'Route only', points: [{ lat: 45, lon: 6, ele: 100 }, { lat: 45.01, lon: 6.01, ele: 150 }] }] })
  const analysis = analyze(xml)
  assert.equal(analysis.points.length, 2)
  assert.equal(analysis.name, 'Route only')
  assert.equal(analysis.elevationGainM, 50)
})

test('trackCount/segmentCount reflect what was actually detected in the file', () => {
  const xml = buildGpxXml({
    tracks: [
      { segments: [[{ lat: 45, lon: 6 }, { lat: 45.01, lon: 6.01 }], [{ lat: 45.02, lon: 6.02 }, { lat: 45.03, lon: 6.03 }]] },
      { segments: [[{ lat: 46, lon: 7 }, { lat: 46.01, lon: 7.01 }]] },
    ],
  })
  const analysis = analyze(xml)
  assert.equal(analysis.trackCount, 2)
  assert.equal(analysis.segmentCount, 3)
})
