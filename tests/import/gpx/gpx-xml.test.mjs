import { installMinimalDOMParser } from '../../support/minimal-dom-parser.mjs'

installMinimalDOMParser()

import assert from 'node:assert/strict'
import test from 'node:test'

import { GpxXmlParseError, parseGpxXml } from '../../../src/import/gpx/gpx-xml.ts'
import { buildGpxXml, simpleClimbTrack } from './support/fixtures.mjs'

test('parses a GPX 1.1 document with a single track/segment', () => {
  const xml = buildGpxXml({ version: '1.1', tracks: [simpleClimbTrack()] })
  const document = parseGpxXml(xml)
  assert.equal(document.tracks.length, 1)
  assert.equal(document.tracks[0].segments.length, 1)
  assert.equal(document.tracks[0].segments[0].points.length, 3)
  assert.equal(document.tracks[0].name, 'Synthetic climb')
})

test('parses a GPX 1.0 document identically (namespace-blind, version-blind)', () => {
  const xml = buildGpxXml({ version: '1.0', namespaceUri: 'http://www.topografix.com/GPX/1/0', tracks: [simpleClimbTrack()] })
  const document = parseGpxXml(xml)
  assert.equal(document.tracks[0].segments[0].points.length, 3)
})

test('parses a document using a namespace prefix on every element', () => {
  const xml = buildGpxXml({ namespacePrefix: 'gpx', tracks: [simpleClimbTrack('Prefixed track')] })
  const document = parseGpxXml(xml)
  assert.equal(document.tracks[0].name, 'Prefixed track')
  assert.equal(document.tracks[0].segments[0].points.length, 3)
})

test('parses rte/rtept as an independent geometry source from trk', () => {
  const xml = buildGpxXml({
    routes: [{ name: 'Route A', points: [{ lat: 45, lon: 6 }, { lat: 45.01, lon: 6.01 }] }],
  })
  const document = parseGpxXml(xml)
  assert.equal(document.tracks.length, 0)
  assert.equal(document.routes.length, 1)
  assert.equal(document.routes[0].points.length, 2)
  assert.equal(document.routes[0].name, 'Route A')
})

test('parses multiple segments inside one track, preserving document order', () => {
  const xml = buildGpxXml({
    tracks: [
      {
        name: 'Two segments',
        segments: [
          [{ lat: 45, lon: 6 }, { lat: 45.001, lon: 6.001 }],
          [{ lat: 46, lon: 7 }, { lat: 46.001, lon: 7.001 }],
        ],
      },
    ],
  })
  const document = parseGpxXml(xml)
  assert.equal(document.tracks[0].segments.length, 2)
  assert.equal(document.tracks[0].segments[0].points[0].latitude, 45)
  assert.equal(document.tracks[0].segments[1].points[0].latitude, 46)
})

test('parses a waypoint with name/description/elevation', () => {
  const xml = buildGpxXml({ waypoints: [{ name: 'Col', desc: 'Mountain pass', lat: 45.2, lon: 6.2, ele: 1800 }] })
  const document = parseGpxXml(xml)
  assert.deepEqual(document.waypoints[0], { name: 'Col', description: 'Mountain pass', latitude: 45.2, longitude: 6.2, elevationM: 1800 })
})

test('altitude is optional: a point with no <ele> yields elevationM null, never a fabricated 0', () => {
  const xml = buildGpxXml({ tracks: [{ segments: [[{ lat: 45, lon: 6 }, { lat: 45.01, lon: 6.01 }]] }] })
  const document = parseGpxXml(xml)
  assert.equal(document.tracks[0].segments[0].points[0].elevationM, null)
})

test('timestamps are optional and parsed verbatim when present', () => {
  const xml = buildGpxXml({
    tracks: [{ segments: [[{ lat: 45, lon: 6, time: '2027-01-01T08:00:00Z' }, { lat: 45.01, lon: 6.01 }]] }],
  })
  const document = parseGpxXml(xml)
  assert.equal(document.tracks[0].segments[0].points[0].timestamp, '2027-01-01T08:00:00Z')
  assert.equal(document.tracks[0].segments[0].points[1].timestamp, null)
})

test('falls back to <metadata><name> when no track/route name is present', () => {
  const xml = buildGpxXml({ metadataName: 'From metadata', tracks: [{ segments: [[{ lat: 45, lon: 6 }, { lat: 45.01, lon: 6.01 }]] }] })
  const document = parseGpxXml(xml)
  assert.equal(document.tracks[0].name, null)
  assert.equal(document.metadataName, 'From metadata')
})

test('out-of-range or missing coordinates are not thrown on here — reported as NaN for analyze-gpx to validate', () => {
  const xml = '<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg><trkpt lat="200" lon="6"></trkpt><trkpt lon="6"></trkpt></trkseg></trk></gpx>'
  const document = parseGpxXml(xml)
  assert.equal(document.tracks[0].segments[0].points[0].latitude, 200)
  assert.ok(Number.isNaN(document.tracks[0].segments[0].points[1].latitude))
})

// Real malformed-XML detection (`containsParserError`, mirroring the
// historical `src/gpx/parser.ts`) depends on the browser's own `DOMParser`
// producing a `parsererror` element — the lightweight Node shim used for
// tests (`tests/support/minimal-dom-parser.mjs`, shared with the historical
// parser's own test setup) has no XML well-formedness checking at all, so
// that specific branch cannot be exercised here in either module. A missing
// document/root, however, is a real, environment-independent throw path.
test('an empty or rootless document throws GpxXmlParseError', () => {
  assert.throws(() => parseGpxXml(''), GpxXmlParseError)
})

test('a well-formed XML document whose root is not <gpx> throws GpxXmlParseError', () => {
  assert.throws(() => parseGpxXml('<?xml version="1.0"?><notgpx></notgpx>'), GpxXmlParseError)
})

test('zero track points (an empty trkseg) parses without throwing — analyze-gpx decides what to do with it', () => {
  const xml = buildGpxXml({ tracks: [{ segments: [[]] }] })
  const document = parseGpxXml(xml)
  assert.equal(document.tracks[0].segments[0].points.length, 0)
})
