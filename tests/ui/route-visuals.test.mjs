import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { sampleElevationProfile } from '../../src/ui/elevation-profile.ts'
import { buildRouteDisplayPoints } from '../../src/ui/route-engine.ts'

test('elevation profile samples a long GPX while preserving endpoints', () => {
  const points = Array.from({ length: 1_000 }, (_, index) => ({ latitude: 45 + index / 100_000, longitude: 6, elevationM: 1_000 + Math.sin(index / 20) * 500 }))
  const samples = sampleElevationProfile({ segments: [{ points }] }, 120)
  assert.equal(samples.length, 120)
  assert.equal(samples[0].altitudeM, points[0].elevationM)
  assert.equal(samples.at(-1).altitudeM, points.at(-1).elevationM)
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

test('Parcours is built only from documented points — no technical route-start/route-end card, ever', () => {
  const route = {
    waypoints: [],
    pauses: [],
    settings: { averageSpeedKph: 18, departureTime: '08:00', totalBreakMinutes: 0 },
    summary: { departureTimeMinutes: 480, waypointCount: 2, totalDurationMinutes: 360, pauseDurationMinutes: 0, firstSourceFileNumber: 1, lastSourceFileNumber: 1 },
  }
  const report = {
    allPointMatches: [
      { id: 'j01-start', dayId: 'J1', name: 'Gare de Thonon-les-Bains', type: 'start', resolution: 'matched', matchMethod: 'endpoint', matchedTrackDistanceKm: 0, matchedElevationM: 400, eta: { totalMinutesFromDeparture: 0, clockMinutes: 480, dayOffset: 0 }, alternatives: [], overrideApplied: false, standaloneWaypoint: false },
      { id: 'j01-end', dayId: 'J1', name: 'Morzine', type: 'end', resolution: 'matched', matchMethod: 'endpoint', matchedTrackDistanceKm: 100, matchedElevationM: 1_000, eta: { totalMinutesFromDeparture: 360, clockMinutes: 840, dayOffset: 0 }, alternatives: [], overrideApplied: false, standaloneWaypoint: false },
    ],
  }
  const points = buildRouteDisplayPoints(route, 'J1', report)
  const html = points.map(({ html }) => html).join('')
  assert.equal(points.length, 2)
  assert.equal((html.match(/Gare de Thonon-les-Bains/g) ?? []).length, 1)
  assert.equal((html.match(/Morzine/g) ?? []).length, 1)
  assert.equal(points.filter((point) => point.distanceKm === 0).length, 1)
  assert.equal(points.filter((point) => point.distanceKm === 100).length, 1)
})

test('J1 resolves the precise departure/arrival labels through the roadbook day and merges the confirmed accommodation', () => {
  const progress = (elapsedMinutes, distanceKm) => ({ elapsedMinutes, distanceKm, altitudeM: 1_000, theoreticalTimeMinutes: 480 + elapsedMinutes })
  const waypoints = [
    { id: 'route-start-1', type: 'route-start', name: 'Départ', sourceFileNumber: 1, progress: progress(0, 0) },
    { id: 'route-end-1', type: 'route-end', name: 'Arrivée', sourceFileNumber: 1, progress: progress(360, 100) },
  ]
  const route = {
    waypoints,
    pauses: [],
    settings: { averageSpeedKph: 18, departureTime: '08:00', totalBreakMinutes: 0 },
    summary: { departureTimeMinutes: 480, waypointCount: 2, totalDurationMinutes: 360, pauseDurationMinutes: 0, firstSourceFileNumber: 1, lastSourceFileNumber: 1 },
  }
  const startPoint = { id: 'j01-start', dayId: 'J1', name: 'Thonon-les-Bains', type: 'start', resolution: 'matched', matchMethod: 'endpoint', matchedTrackDistanceKm: 0, matchedElevationM: 400, eta: { totalMinutesFromDeparture: 0, clockMinutes: 480, dayOffset: 0 }, linkedWaypointId: 'route-start-1', alternatives: [], overrideApplied: false, standaloneWaypoint: false }
  const endPoint = { id: 'j01-end', dayId: 'J1', name: 'Morzine', type: 'end', resolution: 'matched', matchMethod: 'endpoint', matchedTrackDistanceKm: 100, matchedElevationM: 1_000, eta: { totalMinutesFromDeparture: 360, clockMinutes: 840, dayOffset: 0 }, linkedWaypointId: 'route-end-1', alternatives: [], overrideApplied: false, standaloneWaypoint: false }
  const colPoint = { id: 'j01-col-col-du-feu', dayId: 'J1', name: 'Col du Feu', type: 'col', resolution: 'matched', matchedTrackDistanceKm: 40, matchedElevationM: 1_200, eta: { totalMinutesFromDeparture: 120, clockMinutes: 600, dayOffset: 0 }, alternatives: [], overrideApplied: false, standaloneWaypoint: false }
  const report = {
    allPointMatches: [startPoint, colPoint, endPoint],
    days: [{ dayId: 'J1', type: 'ride', roadbook: { id: 'J1', startName: 'Thonon-les-Bains', endName: 'Morzine' }, points: [startPoint, colPoint, endPoint] }],
  }
  const accommodation = { name: 'Hôtel Le Soly', address: '234 Route de la Manche, 74110 Morzine' }

  const points = buildRouteDisplayPoints(route, 'J1', report, accommodation)
  const html = points.map(({ html }) => html).join('')

  assert.match(html, /Gare de Thonon-les-Bains/)
  assert.match(html, /Départ · Thonon-les-Bains/)
  assert.match(html, /Hôtel Le Soly/)
  assert.match(html, /Arrivée · Morzine/)
  assert.doesNotMatch(html, /<strong>Thonon-les-Bains<\/strong>/)

  assert.match(html, /data-route-point-category="start"/)
  assert.match(html, /data-route-point-category="finish"/)
  assert.match(html, /data-route-point-category="col-summit"/)
})

test('detail structure orders map, profile, download and tabs', () => {
  const source = readFileSync(new URL('../../src/ui/render.ts', import.meta.url), 'utf8')
  const map = source.indexOf('data-route-map')
  const profile = source.indexOf('data-elevation-profile')
  const download = source.indexOf('data-gpx-download')
  const tabs = source.indexOf('data-day-tab')
  assert.ok(map > 0 && map < profile && profile < download && download < tabs)
})
