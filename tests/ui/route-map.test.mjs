import assert from 'node:assert/strict'
import test from 'node:test'

import { buildRouteMapModel } from '../../src/ui/route-map-model.ts'

const progress = (elapsedMinutes, distanceKm) => ({ elapsedMinutes, distanceKm, altitudeM: 1_000, theoreticalTimeMinutes: 480 + elapsedMinutes })

function buildFixture({ accommodation = null } = {}) {
  const gpx = {
    segments: [
      {
        points: [
          { latitude: 46.37, longitude: 6.48, elevationM: 400 },
          { latitude: 46.3, longitude: 6.5, elevationM: 900 },
          { latitude: 46.18, longitude: 6.71, elevationM: 1_000 },
        ],
      },
    ],
  }
  const timeline = {
    day: { id: 'J1', gpxNumber: 1 },
    route: {
      pauses: [
        { id: 'pause-1', name: 'Col du Feu', durationMinutes: 20, latitude: 46.25, longitude: 6.6, pointId: 'j01-col-col-du-feu' },
      ],
    },
  }
  const startPoint = { id: 'j01-start', dayId: 'J1', type: 'start', resolution: 'matched', name: 'Thonon-les-Bains', sourceLatitude: 46.37, sourceLongitude: 6.48 }
  const colPoint = { id: 'j01-col-col-du-feu', dayId: 'J1', type: 'col', resolution: 'matched', name: 'Col du Feu', sourceLatitude: 46.3, sourceLongitude: 6.5 }
  const passagePoint = { id: 'j01-passage-lullin', dayId: 'J1', type: 'passage', resolution: 'matched', name: 'Lullin', sourceLatitude: 46.28, sourceLongitude: 6.52 }
  const endPoint = { id: 'j01-end', dayId: 'J1', type: 'end', resolution: 'matched', name: 'Morzine', sourceLatitude: 46.18, sourceLongitude: 6.71 }
  const report = {
    days: [
      {
        dayId: 'J1',
        type: 'ride',
        roadbook: { id: 'J1', startName: 'Thonon-les-Bains', endName: 'Morzine' },
        points: [startPoint, colPoint, passagePoint, endPoint],
      },
    ],
  }
  return buildRouteMapModel(gpx, timeline, report, accommodation)
}

test('builds one marker per documented point, classified into the four route-marker categories', () => {
  const model = buildFixture()
  const byId = new Map(model.markers.map((marker) => [marker.id, marker]))

  assert.equal(byId.get('J1-start').category, 'start')
  assert.equal(byId.get('J1-start').name, 'Gare de Thonon-les-Bains')
  assert.equal(byId.get('J1-start').subLabel, 'Départ · Thonon-les-Bains')

  assert.equal(byId.get('J1-finish').category, 'finish')
  assert.equal(byId.get('J1-finish').name, 'Morzine')

  assert.equal(byId.get('j01-col-col-du-feu').category, 'col-summit')
  assert.equal(byId.get('j01-col-col-du-feu').pauseActive, true, 'the col is linked to the pause anchor')
  assert.equal(byId.get('j01-col-col-du-feu').pauseDurationMinutes, 20)

  assert.equal(byId.get('j01-passage-lullin').category, 'passage')
  assert.equal(byId.get('j01-passage-lullin').pauseActive, false)
})

test('a pause linked to a documented point never becomes a second, duplicate marker', () => {
  const model = buildFixture()
  assert.equal(model.markers.filter((marker) => marker.id.startsWith('pause-')).length, 0)
})

test('the arrival merges with a confirmed accommodation naming the same locality, no separate lodging marker', () => {
  const model = buildFixture({ accommodation: { name: 'Hôtel Le Soly', address: '234 Route de la Manche, 74110 Morzine' } })
  const finish = model.markers.find((marker) => marker.id === 'J1-finish')
  assert.equal(finish.name, 'Hôtel Le Soly')
  assert.equal(model.markers.some((marker) => marker.id === 'J1-lodging'), false)
})

test('an accommodation with real coordinates but a different locality gets its own marker instead of a fabricated merge', () => {
  const model = buildFixture({
    accommodation: { name: 'Airbnb Bourg-Saint-Maurice', address: '86 Rue des Diables Bleus, 73700 Bourg-Saint-Maurice', latitude: 45.6, longitude: 6.7 },
  })
  const finish = model.markers.find((marker) => marker.id === 'J1-finish')
  assert.equal(finish.name, 'Morzine')
  const lodging = model.markers.find((marker) => marker.id === 'J1-lodging')
  assert.ok(lodging)
  assert.deepEqual(lodging.coordinate, [45.6, 6.7])
})
