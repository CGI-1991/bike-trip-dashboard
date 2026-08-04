import assert from 'node:assert/strict'
import test from 'node:test'

import { buildGenericOverviewRouteMapModel } from '../../src/ui/route-map-model.ts'

function waypoint(overrides = {}) {
  return {
    id: 'wp', kind: 'city', importance: 'major', visibleByDefault: true, name: 'Ville',
    trackDistanceKm: 5, latitude: 45.1, longitude: 6.2, elevationM: null, climbId: null,
    pauseDurationMinutes: null, elapsedMinutes: null, clockTime: null,
    ...overrides,
  }
}

test('each stage keeps its own disjoint line segment — never one continuous line across an OFF/transfer gap', () => {
  const model = buildGenericOverviewRouteMapModel([
    { waypoints: [], geometry: [[45, 6], [45.1, 6.1]] },
    { waypoints: [], geometry: [[48, 2], [48.1, 2.1]] },
  ])
  assert.deepEqual(model.coordinates, [[45, 6], [45.1, 6.1]])
  assert.deepEqual(model.extraLines, [[[48, 2], [48.1, 2.1]]])
})

test('a stage with no usable geometry (e.g. no GPX yet) is skipped entirely, not drawn as a degenerate point', () => {
  const model = buildGenericOverviewRouteMapModel([
    { waypoints: [], geometry: [] },
    { waypoints: [], geometry: [[48, 2], [48.1, 2.1]] },
  ])
  assert.deepEqual(model.coordinates, [[48, 2], [48.1, 2.1]])
  assert.deepEqual(model.extraLines, [])
})

test('markers from every stage are merged into one flat list, in stage order', () => {
  const model = buildGenericOverviewRouteMapModel([
    { waypoints: [waypoint({ id: 'a' })], geometry: [[45, 6], [45.1, 6.1]] },
    { waypoints: [waypoint({ id: 'b' })], geometry: [[48, 2], [48.1, 2.1]] },
  ])
  assert.deepEqual(model.markers.map((marker) => marker.id), ['a', 'b'])
})

test('no stages at all produces an empty, still-valid model', () => {
  const model = buildGenericOverviewRouteMapModel([])
  assert.deepEqual(model.coordinates, [])
  assert.deepEqual(model.extraLines, [])
  assert.deepEqual(model.markers, [])
})
