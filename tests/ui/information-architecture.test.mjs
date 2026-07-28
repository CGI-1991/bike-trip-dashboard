import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { renderDashboard } from '../../src/ui/render.ts'
import { renderDayHeader } from '../../src/ui/day-header.ts'
import { getUniqueDisplayPoints, renderDayPoints } from '../../src/ui/day-points.ts'
import { renderTripDayRouteTimeline } from '../../src/ui/route-engine.ts'
import { renderTripTimeline } from '../../src/ui/trip-plan.ts'

const settings = { averageSpeedKph: 18, departureTime: '08:00', totalBreakMinutes: 60 }

test('detail exposes exactly the three permanent tabs', () => {
  const html = renderDashboard(settings)
  assert.equal((html.match(/data-day-tab=/g) ?? []).length, 3)
  assert.match(html, />Chronologie<.*>Points<.*>Météo</s)
  assert.doesNotMatch(html, /data-day-tab="(?:roadbook|sources)"/)
  assert.match(html, /data-day-header/)
})

test('Roadbook and Sources remain secondary, and pause editor has two modes', () => {
  const html = renderDashboard(settings)
  assert.match(html, /<details[^>]+data-roadbook-sheet/)
  assert.match(html, /<details[^>]+data-sources-sheet/)
  assert.equal((html.match(/name="pause-mode"/g) ?? []).length, 2)
  assert.match(html, /data-pause-save/)
  assert.match(html, /data-pause-restore/)
})

test('unique day header owns route metrics once', () => {
  const container = { innerHTML: '' }
  const timeline = { type: 'ride', status: 'ready', day: { id: 'J1', dayNumber: 1, type: 'ride', startName: 'Thonon', endName: 'Morzine' }, startTime: '08:00', arrivalTime: { clockMinutes: 900 }, route: { summary: { distanceKm: 120.4, elevationGainM: 2500 } } }
  renderDayHeader(container, timeline, 'orange')
  assert.equal((container.innerHTML.match(/<dt>Distance<\/dt>/g) ?? []).length, 1)
  assert.equal((container.innerHTML.match(/<dt>D\+<\/dt>/g) ?? []).length, 1)
  assert.equal((container.innerHTML.match(/<dt>Départ<\/dt>/g) ?? []).length, 1)
  assert.equal((container.innerHTML.match(/<dt>ETA<\/dt>/g) ?? []).length, 1)
  assert.match(container.innerHTML, /Orange · prudence/)
})

test('one place produces one normal Points object', () => {
  const base = { dayId: 'J1', name: 'Val-d’Isère', matchedTrackDistanceKm: 50, resolution: 'informational', type: 'passage' }
  const route = { ...base, id: 'route', resolution: 'matched' }
  const report = { type: 'ride', points: [base, route] }
  const points = getUniqueDisplayPoints(report)
  assert.equal(points.length, 1)
  assert.equal(points[0].id, 'route')
})

test('Points keeps the Bonette as non-ridden but drops combined editorial labels', () => {
  const cime = { id: 'j10-option-cime-de-la-bonette', name: 'Cime de la Bonette', resolution: 'excluded', type: 'summit' }
  const group = { id: 'group', name: 'Tignes / Val-d’Isère', resolution: 'informational', type: 'pause' }
  const points = getUniqueDisplayPoints({ type: 'ride', points: [cime, group] })
  assert.deepEqual(points.map(({ id }) => id), ['j10-option-cime-de-la-bonette'])
})

test('Points exposes the six user-facing filters and never technical role names', () => {
  const container = { innerHTML: '', dataset: {} }
  const point = { id: 'j03-passage-crest-voland', dayId: 'J3', name: 'Crest-Voland', type: 'village', matchedTrackDistanceKm: 42, matchedElevationM: 1_230, eta: { clockMinutes: 720, dayOffset: 0 }, resolution: 'excluded', notes: 'Référence locale.' }
  renderDayPoints(container, { type: 'ride', points: [point] }, null)
  for (const label of ['Tous', 'Cols et sommets', 'Pauses et ravitos', 'Villages et passages', 'Départ et arrivée', 'Hors parcours']) assert.match(container.innerHTML, new RegExp(label))
  assert.match(container.innerHTML, /Météo à proximité/)
  assert.doesNotMatch(container.innerHTML, />route-point<|>weather-reference</)
})

test('compact chronology keeps retained pauses and cols, but not an unretained ravito', () => {
  const progress = (elapsedMinutes, distanceKm) => ({ elapsedMinutes, distanceKm, altitudeM: 1_000, theoreticalTimeMinutes: 480 + elapsedMinutes })
  const waypoints = [
    { id: 'start', type: 'route-start', name: 'Départ', sourceFileNumber: 1, progress: progress(0, 0) },
    { id: 'pause', type: 'pause-start', name: 'Pause', sourceFileNumber: 1, progress: progress(120, 30) },
    { id: 'col', type: 'summit', name: 'Sommet', sourceFileNumber: 1, progress: progress(240, 60) },
    { id: 'end', type: 'route-end', name: 'Arrivée', sourceFileNumber: 1, progress: progress(360, 100) },
  ]
  const route = { waypoints, pauses: [{ startWaypointId: 'pause', durationMinutes: 30 }], settings: { averageSpeedKph: 18, departureTime: '08:00', totalBreakMinutes: 30 }, summary: { departureTimeMinutes: 480, waypointCount: 4, totalDurationMinutes: 360, pauseDurationMinutes: 30, firstSourceFileNumber: 1, lastSourceFileNumber: 1 } }
  const day = { type: 'ride', status: 'ready', day: { id: 'J1', gpxNumber: 1 }, route, arrivalTime: { totalMinutesFromDeparture: 360, clockMinutes: 840, dayOffset: 0 } }
  const report = {
    waypointLinks: [{ dayId: 'J1', waypointId: 'pause', roadbookPointIds: ['ravito'], primaryRoadbookPointId: 'ravito', displayName: 'Val-d’Isère' }, { dayId: 'J1', waypointId: 'col', roadbookPointIds: ['col-1'], primaryRoadbookPointId: 'col-1', displayName: 'Col du Test' }],
    standaloneWaypoints: [{ dayId: 'J1', type: 'resupply', name: 'Ravito non retenu', roadbookPointIds: ['unused'], eta: { totalMinutesFromDeparture: 180, clockMinutes: 660, dayOffset: 0 }, trackDistanceKm: 45, altitudeM: 900 }],
    allPointMatches: [{ id: 'ravito', type: 'resupply' }, { id: 'col-1', type: 'col' }],
  }
  const container = { innerHTML: '', dataset: {}, setAttribute() {} }
  renderTripDayRouteTimeline(container, day, report)
  assert.equal((container.innerHTML.match(/Val-d’Isère/g) ?? []).length, 1)
  assert.match(container.innerHTML, /Pause 30 min · ravitaillement/)
  assert.match(container.innerHTML, /data-route-waypoint-type="summit"[\s\S]*data-route-compact-visible="true"/)
  assert.match(container.innerHTML, /data-route-waypoint-type="resupply"[\s\S]*data-route-compact-visible="false"/)
  assert.match(container.innerHTML, /Afficher le parcours détaillé/)
})

test('Voyage cards contain structure and weather slot, never diagnostics', () => {
  const route = { summary: { distanceKm: 100, elevationGainM: 2_000 } }
  const day = { type: 'ride', status: 'ready', day: { id: 'J1', dayNumber: 1, type: 'ride', name: 'Thonon → Morzine', gpxNumber: 1, startName: 'Thonon', endName: 'Morzine' }, route, startTime: '08:00', arrivalTime: { totalMinutesFromDeparture: 420, clockMinutes: 900, dayOffset: 0 } }
  const timeline = { settings: { departureTime: '08:00' }, days: [day], summary: { unavailableRideDays: 0, availableRideDays: 10, totalDays: 12, rideDays: 10, offDays: 2 } }
  const container = { innerHTML: '', dataset: {}, setAttribute() {} }
  renderTripTimeline(container, timeline, 'J1')
  assert.match(container.innerHTML, /100,0 km/)
  assert.match(container.innerHTML, /data-trip-day-weather="J1"/)
  assert.doesNotMatch(container.innerHTML, /diagnostic|coordonnées|index GPX/i)
})

test('Today is structurally limited to one alert and one recommendation', () => {
  const source = readFileSync(new URL('../../src/main.ts', import.meta.url), 'utf8')
  assert.equal((source.match(/class="today-alert"/g) ?? []).length, 1)
  assert.equal((source.match(/class="today-recommendation"/g) ?? []).length, 1)
  assert.equal((source.match(/class="today-next-point"/g) ?? []).length, 1)
})

test('Weather keeps three alerts maximum and off-route references separate', () => {
  const source = readFileSync(new URL('../../src/ui/weather-detail.ts', import.meta.url), 'utf8')
  assert.match(source, /\.slice\(0, 3\)/)
  assert.match(source, /data-weather-references/)
  assert.match(source, /Météo des lieux proches et arrêts possibles/)
})
