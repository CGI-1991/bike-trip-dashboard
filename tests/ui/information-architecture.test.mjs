import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { renderDashboard } from '../../src/ui/render.ts'
import { renderDayHeader } from '../../src/ui/day-header.ts'
import { renderTripDayRouteTimeline } from '../../src/ui/route-engine.ts'
import { renderTripTimeline } from '../../src/ui/trip-plan.ts'

const rideDaySettings = {
  version: 1,
  days: ['J1', 'J2', 'J3', 'J4', 'J6', 'J7', 'J9', 'J10', 'J11', 'J12'].map((dayId) => ({
    dayId,
    averageSpeedKph: 18,
    departureTime: '08:00',
    totalBreakMinutes: 60,
  })),
}

test('detail exposes exactly Parcours and Météo', () => {
  const html = renderDashboard(rideDaySettings)
  assert.equal((html.match(/data-day-tab=/g) ?? []).length, 2)
  assert.match(html, />Parcours<.*>Météo</s)
  assert.doesNotMatch(html, />Chronologie<|>Points</)
  assert.doesNotMatch(html, /data-day-tab="(?:roadbook|sources)"/)
  assert.match(html, /data-day-header/)
})

test('Roadbook and Sources remain secondary, and the day editor lives in settings', () => {
  const html = renderDashboard(rideDaySettings)
  assert.match(html, /<details[^>]+data-roadbook-sheet/)
  assert.match(html, /<details[^>]+data-sources-sheet/)
  assert.equal((html.match(/name="pause-mode"/g) ?? []).length, 2)
  assert.match(html, /data-pause-save/)
  assert.match(html, /data-pause-restore/)
  assert.match(html, /data-day-departure-time/)
  assert.match(html, /data-day-average-speed/)
  assert.match(html, /data-day-total-break/)
  assert.match(html, /Réglages par étape/)
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

test('Parcours keeps every documented point, roadbook-only, no Détail toggle or technical detail block', () => {
  const progress = (elapsedMinutes, distanceKm) => ({ elapsedMinutes, distanceKm, altitudeM: 1_000, theoreticalTimeMinutes: 480 + elapsedMinutes })
  const waypoints = [
    { id: 'start', type: 'route-start', name: 'Départ', sourceFileNumber: 1, progress: progress(0, 0) },
    { id: 'col', type: 'summit', name: 'Sommet', sourceFileNumber: 1, progress: progress(240, 60) },
    { id: 'slope', type: 'slope-change', name: 'Pente', sourceFileNumber: 1, progress: progress(300, 80) },
    { id: 'end', type: 'route-end', name: 'Arrivée', sourceFileNumber: 1, progress: progress(360, 100) },
  ]
  const route = { waypoints, pauses: [{ pointId: 'ravito', durationMinutes: 30 }], settings: { averageSpeedKph: 18, departureTime: '08:00', totalBreakMinutes: 30 }, summary: { departureTimeMinutes: 480, waypointCount: 4, totalDurationMinutes: 360, pauseDurationMinutes: 30, firstSourceFileNumber: 1, lastSourceFileNumber: 1 } }
  const day = { type: 'ride', status: 'ready', day: { id: 'J1', gpxNumber: 1 }, route, arrivalTime: { totalMinutesFromDeparture: 360, clockMinutes: 840, dayOffset: 0 } }
  const report = { allPointMatches: [
    { id: 'ravito', dayId: 'J1', name: 'Val-d’Isère', type: 'resupply', resolution: 'matched', matchedTrackDistanceKm: 30, matchedElevationM: 1_000, eta: { totalMinutesFromDeparture: 120, clockMinutes: 600, dayOffset: 0 }, alternatives: [], overrideApplied: false, standaloneWaypoint: false, isResupplyCandidate: true },
    { id: 'col-1', dayId: 'J1', name: 'Col du Test', type: 'col', resolution: 'matched', matchedTrackDistanceKm: 60, matchedElevationM: 1_800, eta: { totalMinutesFromDeparture: 240, clockMinutes: 720, dayOffset: 0 }, alternatives: [], overrideApplied: false, standaloneWaypoint: false },
    { id: 'unused', dayId: 'J1', name: 'Ravito non retenu', type: 'resupply', resolution: 'informational', matchedTrackDistanceKm: 45, matchedElevationM: 900, matchDistanceM: 700, alternatives: [], overrideApplied: false, standaloneWaypoint: true },
  ], days: [{ dayId: 'J1', type: 'ride', roadbook: { id: 'J1', startName: 'Thonon', endName: 'Morzine' }, points: [] }] }
  const container = { innerHTML: '', dataset: {}, setAttribute() {} }
  renderTripDayRouteTimeline(container, day, report)
  assert.equal((container.innerHTML.match(/Val-d’Isère/g) ?? []).length, 1)
  assert.match(container.innerHTML, /Ravitaillement/)
  assert.match(container.innerHTML, /Pause 30 min/)
  assert.match(container.innerHTML, /Ravito non retenu/)
  assert.match(container.innerHTML, /Hors parcours · heure de référence/)
  assert.doesNotMatch(container.innerHTML, /route-point--generated/)
  assert.doesNotMatch(container.innerHTML, /data-route-detail-toggle/)
  assert.doesNotMatch(container.innerHTML, />Détail</)
  assert.doesNotMatch(container.innerHTML, /<details/)
  assert.doesNotMatch(container.innerHTML, /Rôle : |Distance à la trace|Pause inactive/)
  assert.doesNotMatch(container.innerHTML, /<table/)
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
