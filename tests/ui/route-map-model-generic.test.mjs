import assert from 'node:assert/strict'
import test from 'node:test'

import { buildGenericRouteMapModel } from '../../src/ui/route-map-model.ts'

function waypoint(overrides = {}) {
  return {
    id: 'wp', kind: 'city', importance: 'major', visibleByDefault: true, name: 'Ville',
    trackDistanceKm: 5, latitude: 45.1, longitude: 6.2, elevationM: null, climbId: null,
    pauseDurationMinutes: null, elapsedMinutes: null, clockTime: null,
    ...overrides,
  }
}

test('every canonical waypoint kind maps to a distinct, sensible marker category', () => {
  const cases = [
    ['start', 'start'], ['end', 'finish'], ['city', 'locality-major'], ['town', 'locality-major'],
    ['village', 'locality-minor'], ['mountain-pass', 'col-summit'],
    ['saddle', 'col-summit'], ['climb', 'col-summit'], ['pause', 'passage'],
  ]
  for (const [kind, category] of cases) {
    const model = buildGenericRouteMapModel([waypoint({ id: kind, kind })], [])
    assert.equal(model.markers[0].category, category, `${kind} should map to ${category}`)
  }
})

test('coordinates are passed through unchanged and markers are never off-route', () => {
  const geometry = [[45, 6], [45.1, 6.2]]
  const model = buildGenericRouteMapModel([waypoint()], geometry)
  assert.equal(model.coordinates, geometry)
  assert.equal(model.markers[0].offRoute, false)
})

test('a sub-label with rounded elevation appears only when elevation is known', () => {
  const withElevation = buildGenericRouteMapModel([waypoint({ elevationM: 1234.6 })], [])
  const withoutElevation = buildGenericRouteMapModel([waypoint({ elevationM: null })], [])
  assert.equal(withElevation.markers[0].subLabel, '1235 m')
  assert.equal(withoutElevation.markers[0].subLabel, undefined)
})

test('a pause duration flags the marker as an active pause; no pause leaves it inactive with no duration field', () => {
  const paused = buildGenericRouteMapModel([waypoint({ pauseDurationMinutes: 15 })], [])
  const unpaused = buildGenericRouteMapModel([waypoint({ pauseDurationMinutes: null })], [])
  assert.equal(paused.markers[0].pauseActive, true)
  assert.equal(paused.markers[0].pauseDurationMinutes, 15)
  assert.equal(unpaused.markers[0].pauseActive, false)
  assert.equal('pauseDurationMinutes' in unpaused.markers[0], false)
})

test('produces one marker per waypoint, in the same order', () => {
  const waypoints = [waypoint({ id: 'a', trackDistanceKm: 0 }), waypoint({ id: 'b', trackDistanceKm: 5 }), waypoint({ id: 'c', trackDistanceKm: 10 })]
  const model = buildGenericRouteMapModel(waypoints, [])
  assert.deepEqual(model.markers.map((marker) => marker.id), ['a', 'b', 'c'])
})
