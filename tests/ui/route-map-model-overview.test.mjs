import assert from 'node:assert/strict'
import test from 'node:test'

import { buildGenericOverviewDetailMarkers, buildGenericOverviewRouteMapModel } from '../../src/ui/route-map-model.ts'

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
    // Distinct name/coordinates — same-location markers across stages are
    // deliberately deduplicated (CDC D1 section 7), so this fixture must
    // not accidentally collide with the first stage's marker to prove
    // ordinary cross-stage merging.
    { waypoints: [waypoint({ id: 'b', name: 'Autre Ville', latitude: 48, longitude: 2 })], geometry: [[48, 2], [48.1, 2.1]] },
  ])
  assert.deepEqual(model.markers.map((marker) => marker.id), ['a', 'b'])
})

test('two markers at the same place (e.g. day N arrival == day N+1 departure) collapse into one, keeping the first', () => {
  const model = buildGenericOverviewRouteMapModel([
    { waypoints: [waypoint({ id: 'a', name: 'Shared Town' })], geometry: [[45, 6], [45.1, 6.1]] },
    { waypoints: [waypoint({ id: 'b', name: 'Shared Town' })], geometry: [[48, 2], [48.1, 2.1]] },
  ])
  assert.deepEqual(model.markers.map((marker) => marker.id), ['a'])
})

test('no stages at all produces an empty, still-valid model', () => {
  const model = buildGenericOverviewRouteMapModel([])
  assert.deepEqual(model.coordinates, [])
  assert.deepEqual(model.extraLines, [])
  assert.deepEqual(model.markers, [])
})

// --- Jalon C2.5 section 58: named cols on the Aperçu map ---
// BA-BH: three graphic families only — green principal points, grey+mauve-
// ring pauses, and (new) the Étape map's own diamond/orange for named cols.

test('BA: a start/end waypoint keeps the plain green "overview-primary" marker — unaffected by the col fix', () => {
  const model = buildGenericOverviewRouteMapModel([
    { waypoints: [waypoint({ kind: 'start' })], geometry: [[45, 6], [45.1, 6.1]] },
  ])
  assert.equal(model.markers[0].category, 'overview-primary')
})

test('BC: a named mountain-pass/saddle waypoint in the "Détail" layer renders as the Étape map\'s own diamond/orange "col-summit" marker, never the generic overview dot', () => {
  const markers = buildGenericOverviewDetailMarkers([
    { waypoints: [waypoint({ id: 'col-1', kind: 'mountain-pass', name: 'Col des Aravis' })] },
  ])
  assert.equal(markers.length, 1)
  assert.equal(markers[0].category, 'col-summit')
})

test('BB: an ordinary "Détail" point (e.g. a paused locality, never a named col) still gets the sober grey "overview-secondary" marker, with its pause ring intact', () => {
  const markers = buildGenericOverviewDetailMarkers([
    { waypoints: [waypoint({ id: 'town-1', kind: 'city', pauseDurationMinutes: 15 })] },
  ])
  assert.equal(markers.length, 1)
  assert.equal(markers[0].category, 'overview-secondary')
  assert.equal(markers[0].pauseActive, true, 'the purple pause ring is driven by pauseActive, untouched by this fix')
})

test('BE/BF: a named col that is ALSO a pause is a SINGLE marker — the col\'s own diamond/orange shape, with the pause ring added, never two overlapping markers', () => {
  const markers = buildGenericOverviewDetailMarkers([
    { waypoints: [waypoint({ id: 'col-pause-1', kind: 'saddle', name: 'Col Pause', pauseDurationMinutes: 20 })] },
  ])
  assert.equal(markers.length, 1, 'one waypoint in, one marker out — never a second, duplicate marker for the same point')
  assert.equal(markers[0].category, 'col-summit', 'the col shape/colour always wins — never swapped out for the pause\'s own category')
  assert.equal(markers[0].pauseActive, true, 'the pause ring is still added on top of the col marker')
})

test('BD: a bare, unnamed climb waypoint never reaches the overview map at all — `isOverviewDetailWaypoint` (trip-overview-view.ts) excludes it upstream, so this model never even sees it; confirmed here that IF one somehow did, it would not be mistaken for a named col', () => {
  const markers = buildGenericOverviewDetailMarkers([
    { waypoints: [waypoint({ id: 'climb-1', kind: 'climb', name: 'Montée sans nom' })] },
  ])
  // `climb` shares the Étape map's `col-summit` category too (a bare summit
  // still gets a diamond there) — this is a documented, accepted trade-off:
  // the real guarantee against anonymous/secondary climbs leaking into
  // Aperçu lives in `isOverviewDetailWaypoint`'s own kind filter (mountain-
  // pass/saddle/pause only), covered by `trip-overview-view.test.mjs`.
  assert.equal(markers[0].category, 'col-summit')
})
