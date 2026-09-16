import './support/dom-shim.mjs'

import assert from 'node:assert/strict'
import test from 'node:test'

import { buildDayDetail } from '../../src/ui/trips/day-detail-view.ts'
import { createGenericTripBundle } from '../trip-core/support/generic-trip-fixture.mjs'

/**
 * A climb whose summit IS the stage arrival — the case where the two facts
 * (the last ascent, and the end of the stage) share one position, and the
 * Parcours list must still show both.
 */
function bundleWithArrivalClimb() {
  const bundle = createGenericTripBundle()
  // `stage-alpha`'s own route: the arrival distance is whatever its geometry
  // measures, so the climb is pinned to the stage's real total.
  const arrivalDistanceKm = buildDayDetail(bundle, 'day-alpha').waypoints.at(-1).trackDistanceKm
  bundle.climbs.push({
    id: 'climb-final',
    routeId: bundle.routes[0].id,
    name: 'Montée finale',
    startDistanceKm: arrivalDistanceKm - 6,
    endDistanceKm: arrivalDistanceKm,
    elevationGainM: 430,
    averageGradientPercent: 7.2,
    maxGradientPercent: 11,
    startAltitudeM: 210,
    endAltitudeM: 640,
    confidence: 'probable',
    provenance: { sourceType: 'generated', sourceId: null, fetchedAt: null, engineVersion: 'test', confidence: 'medium', manuallyOverridden: false },
  })
  bundle.stages[0].climbIds.push('climb-final')
  return { bundle, arrivalDistanceKm }
}

test('Parcours: a climb finishing at the arrival renders as its own block, before the arrival block', () => {
  const { bundle } = bundleWithArrivalClimb()
  const detail = buildDayDetail(bundle, 'day-alpha')

  const kinds = detail.waypoints.map((waypoint) => waypoint.kind)
  assert.equal(kinds[kinds.length - 1], 'end', 'the arrival is always last')
  assert.equal(kinds[kinds.length - 2], 'climb', 'the montée reads just before it, never after')

  // Two distinct rows in the rendered list, each with its own identity.
  assert.match(detail.timelineHtml, /data-waypoint-id="climb-final"/)
  assert.match(detail.timelineHtml, /data-waypoint-id="stage-alpha:end"/)
  assert.ok(detail.timelineHtml.indexOf('climb-final') < detail.timelineHtml.indexOf('stage-alpha:end'))
})

test('Parcours: neither block absorbs the other — the climb keeps its own stats, the arrival its own name', () => {
  const { bundle } = bundleWithArrivalClimb()
  const detail = buildDayDetail(bundle, 'day-alpha')

  // The climb gets the mini-card with its own length/D+/gradient.
  assert.match(detail.timelineHtml, /data-climb-id="climb-final"/)
  assert.match(detail.timelineHtml, /\+430 m/)
  // The arrival keeps being the arrival.
  const arrival = detail.waypoints.at(-1)
  assert.equal(arrival.name, 'Hilltown')
  assert.equal(arrival.climbId, null)
})

test('Parcours: one climb at the arrival never produces two climb blocks', () => {
  const { bundle } = bundleWithArrivalClimb()
  const detail = buildDayDetail(bundle, 'day-alpha')
  assert.equal(detail.waypoints.filter((waypoint) => waypoint.climbId === 'climb-final').length, 1)
  assert.equal((detail.timelineHtml.match(/data-climb-id="climb-final"/g) ?? []).length, 1)
})
