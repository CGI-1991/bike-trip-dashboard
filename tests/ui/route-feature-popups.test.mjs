import './support/dom-shim.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createLinkedTripBundle } from '../trips-manager/support/linked-trip-fixture.mjs'
import { buildRaceCourse } from '../../src/analysis/race-bounds.ts'
import { applyRaceSegmentChange } from '../../src/analysis/race-segments.ts'
import { DEFAULT_RACE_SEGMENT_ALERTS } from '../../src/trip-core/index.ts'
import { buildGenericRouteMapModel, buildRaceSegmentMapLines } from '../../src/ui/route-map-model.ts'
import { withRouteFeatureMarkers } from '../../src/ui/trips/route-feature-markers.ts'

function fixture() {
  const base = createLinkedTripBundle(), bundle = { ...base, settings: { ...base.settings, global: { ...base.settings.global, raceMode: true } } }
  const stage = bundle.stages[0], course = buildRaceCourse(bundle, stage)
  const updated = applyRaceSegmentChange(bundle, stage.id, { kind: 'add', id: 'segment', fields: { name: '<img> Grimpeur', type: 'climb', startOffsetM: 1000, endOffsetM: 5000, alerts: DEFAULT_RACE_SEGMENT_ALERTS } }, course.fingerprint, '2026-10-26T12:00:00Z')
  const segment = updated.stages[0].raceSegments[0]
  const points = [{ id: 'climb', kind: 'climb', name: '<script>Montée', climbId: 'auto', latitude: 45, longitude: 6.2, elevationM: 200, pauseDurationMinutes: null },
    { id: 'segment-point', kind: 'race-segment', name: segment.name, raceSegmentId: segment.id, climbId: null, latitude: 45, longitude: 6.01, elevationM: 100, pauseDurationMinutes: null }]
  const model = buildGenericRouteMapModel(points, [[45, 6], [45, 6.5]])
  const climbs = [{ id: 'auto', startDistanceKm: 8, endDistanceKm: 12, elevationGainM: 200, averageGradientPercent: 5 }]
  return { course, segment, points, model, climbs }
}

test('tap popups reuse saved climb and segment statistics and escape names', () => {
  const f = fixture(), decorated = withRouteFeatureMarkers(f.model, f.points, f.climbs, f.course, [f.segment])
  assert.equal(decorated.coordinates, f.model.coordinates)
  assert.equal(decorated.markers.length, 2)
  const climb = decorated.markers[0].popupHtml, segment = decorated.markers[1].popupHtml
  assert.match(climb, /4,0 km/); assert.match(climb, /200 m/); assert.match(climb, /5,0 %/)
  assert.match(climb, /&lt;script&gt;/); assert.doesNotMatch(climb, /<script>/)
  assert.match(segment, /&lt;img&gt;/); assert.match(segment, /4,0 km/)
  assert.equal(decorated.markers[1].category, 'race-climb')
  assert.match(buildRaceSegmentMapLines(f.course, [f.segment])[0].popupHtml, /4,0 km/)
  assert.equal(f.model.markers[0].popupHtml, undefined, 'the input model is untouched')
})

test('stale segments and course bounds never create a misleading interactive feature', () => {
  const f = fixture()
  const model = withRouteFeatureMarkers(f.model, f.points, f.climbs, f.course, [{ ...f.segment, routeFingerprint: 'changed' }])
  assert.equal(model.markers.length, 1)
  assert.equal(withRouteFeatureMarkers(f.model, f.points, f.climbs, { ...f.course, status: 'stale' }, [f.segment]), f.model)
})
