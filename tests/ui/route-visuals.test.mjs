import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { sampleElevationProfile } from '../../src/ui/elevation-profile.ts'
import { setRouteDetail } from '../../src/ui/route-engine.ts'

test('elevation profile samples a long GPX while preserving endpoints', () => {
  const points = Array.from({ length: 1_000 }, (_, index) => ({ latitude: 45 + index / 100_000, longitude: 6, elevationM: 1_000 + Math.sin(index / 20) * 500 }))
  const samples = sampleElevationProfile({ segments: [{ points }] }, 120)
  assert.equal(samples.length, 120)
  assert.equal(samples[0].altitudeM, points[0].elevationM)
  assert.equal(samples.at(-1).altitudeM, points.at(-1).elevationM)
})

test('Detail switch changes generated point visibility in the DOM model', () => {
  const generated = [{ hidden: true }, { hidden: true }]
  const input = { setAttribute(name, value) { this[name] = value } }
  const container = { dataset: {}, querySelectorAll: () => generated, querySelector: () => input }
  setRouteDetail(container, true)
  assert.ok(generated.every(({ hidden }) => hidden === false))
  assert.equal(input['aria-checked'], 'true')
  setRouteDetail(container, false)
  assert.ok(generated.every(({ hidden }) => hidden === true))
})

test('Leaflet map uses OSM attribution, compact interaction and no test tile request', () => {
  const source = readFileSync(new URL('../../src/ui/route-map.ts', import.meta.url), 'utf8')
  const packageJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  assert.equal(packageJson.dependencies.leaflet, '^1.9.4')
  assert.match(source, /from 'leaflet'/)
  assert.match(source, /tile\.openstreetmap\.org/)
  assert.match(source, /© OpenStreetMap contributors/)
  assert.match(source, /dragging: interactive/)
  assert.match(source, /scrollWheelZoom: false/)
  assert.match(source, /tileerror/)
})

test('detail structure orders map, profile, download and tabs', () => {
  const source = readFileSync(new URL('../../src/ui/render.ts', import.meta.url), 'utf8')
  const map = source.indexOf('data-route-map')
  const profile = source.indexOf('data-elevation-profile')
  const download = source.indexOf('data-gpx-download')
  const tabs = source.indexOf('data-day-tab')
  assert.ok(map > 0 && map < profile && profile < download && download < tabs)
})
