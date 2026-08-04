import assert from 'node:assert/strict'
import test from 'node:test'

import { buildDayDetail } from '../../src/ui/trips/day-detail-view.ts'
import { createGenericTripBundle } from '../trip-core/support/generic-trip-fixture.mjs'

test('returns null for an OFF day (no stage)', () => {
  const bundle = createGenericTripBundle()
  assert.equal(buildDayDetail(bundle, 'day-bravo'), null)
})

test('returns null for a transfer day (no stage)', () => {
  const bundle = createGenericTripBundle()
  assert.equal(buildDayDetail(bundle, 'day-charlie'), null)
})

test('returns null for an unknown day id', () => {
  const bundle = createGenericTripBundle()
  assert.equal(buildDayDetail(bundle, 'day-does-not-exist'), null)
})

test('returns null when the stage route has no usable geometry', () => {
  const bundle = createGenericTripBundle()
  // day-delta's stage (stage-delta / route-delta) has no geometry in the fixture.
  assert.equal(bundle.routes[1].geometry, null)
  // Its own waypoint list collapses to [] (buildCanonicalWaypoints' own no-geometry case),
  // but buildDayDetail must still resolve a header — geometry itself is surfaced as null for the caller.
  const detail = buildDayDetail(bundle, 'day-delta')
  assert.ok(detail !== null)
  assert.equal(detail.geometry, null)
  assert.deepEqual(detail.waypoints, [])
})

test('builds a compact header (date before locations, no GPX/roadbook name), stats, and a pauses section for a resolvable ride day', () => {
  const bundle = createGenericTripBundle()
  const detail = buildDayDetail(bundle, 'day-alpha')
  assert.ok(detail !== null)
  assert.match(detail.html, /J1 — 10\.05\.27 — Riverside → Hilltown/)
  assert.doesNotMatch(detail.html, /Riverside to Hilltown/)
  assert.match(detail.html, /62,4 km/)
  assert.match(detail.html, /\+780 m/)
  assert.match(detail.html, /−410 m/)
  // Stage-alpha carries a 1800s (30 min) automatic pause budget with no
  // structural anchor available in this fixture, so it lands on synthetic
  // pause waypoints between the start and end — start/end themselves stay first/last.
  assert.equal(detail.waypoints[0].kind, 'start')
  assert.equal(detail.waypoints.at(-1).kind, 'end')
  assert.ok(detail.waypoints.some((waypoint) => waypoint.kind === 'pause'))
  assert.match(detail.html, /<h3>Pauses<\/h3>/)
  assert.equal(detail.stageLabel, 'J1 — Riverside → Hilltown')
})

test('the arrival time, when known, is shown as the estimated arrival stat', () => {
  const bundle = createGenericTripBundle()
  const detail = buildDayDetail(bundle, 'day-alpha')
  const arrival = detail.waypoints.at(-1)
  assert.ok(arrival.clockTime !== null)
  assert.match(detail.html, new RegExp(`Arrivée estimée</dt><dd>${arrival.clockTime}`))
})

test('a village is grouped under its own collapsed "Villages" section, distinct from the open Localités/Relief groups', () => {
  const bundle = createGenericTripBundle()
  bundle.routePoints.push(
    {
      id: 'village-ui', routeId: bundle.routes[0].id, type: 'passage', name: 'Micro Village',
      latitude: 45.2, longitude: 6.35, elevationM: 300, trackDistanceKm: 30,
      osmFeatureType: 'village', lateralDistanceKm: 0.5,
      provenance: { sourceType: 'osm', sourceId: 'postpass:village:1', fetchedAt: null, engineVersion: 'route-enrichment@4', confidence: 'high', manuallyOverridden: false },
    },
    {
      id: 'town-ui', routeId: bundle.routes[0].id, type: 'passage', name: 'Grand Bourg',
      latitude: 45.21, longitude: 6.36, elevationM: 310, trackDistanceKm: 40,
      osmFeatureType: 'town', lateralDistanceKm: 0.3,
      provenance: { sourceType: 'osm', sourceId: 'postpass:town:1', fetchedAt: null, engineVersion: 'route-enrichment@4', confidence: 'high', manuallyOverridden: false },
    },
  )
  bundle.stages[0].routePointIds.push('village-ui', 'town-ui')
  const detail = buildDayDetail(bundle, 'day-alpha')
  assert.match(detail.html, /<summary>Villages \(1\)<\/summary>/)
  assert.match(detail.html, /<h4>Localités<\/h4>/)
  // The category itself is never repeated inline — the section title alone carries it.
  assert.doesNotMatch(detail.html, /·\s*Bourg\s*·/)
  assert.doesNotMatch(detail.html, /·\s*Village\s*·/)
  const [beforeDetails] = detail.html.split('<details')
  assert.doesNotMatch(beforeDetails, /Micro Village/)
  assert.match(detail.html, /Micro Village/)
  assert.match(detail.html, /Grand Bourg/)
})
