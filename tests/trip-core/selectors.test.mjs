import assert from 'node:assert/strict'
import test from 'node:test'

import {
  selectAccommodationForDay,
  selectClimbsForStage,
  selectDayById,
  selectOffDays,
  selectOrderedDays,
  selectRideDays,
  selectRoutePointsForStage,
  selectRouteById,
  selectRouteForStage,
  selectStageById,
  selectStageForDay,
  selectTransferDays,
  selectTripCounts,
  selectTripTotals,
} from '../../src/trip-core/selectors/trip-selectors.ts'
import { createGenericTripBundle } from './support/generic-trip-fixture.mjs'

test('selectOrderedDays returns days in ascending index order regardless of storage order', () => {
  const bundle = createGenericTripBundle()
  const [first, second, ...rest] = bundle.days
  bundle.days = [second, first, ...rest]
  const ordered = selectOrderedDays(bundle)
  assert.deepEqual(ordered.map((day) => day.index), [0, 1, 2, 3])
})

test('selectRideDays/selectOffDays/selectTransferDays filter by type, in order', () => {
  const bundle = createGenericTripBundle()
  assert.deepEqual(selectRideDays(bundle).map((day) => day.id), [bundle.days[0].id, bundle.days[3].id])
  assert.deepEqual(selectOffDays(bundle).map((day) => day.id), [bundle.days[1].id])
  assert.deepEqual(selectTransferDays(bundle).map((day) => day.id), [bundle.days[2].id])
})

test('selectStageForDay resolves a ride day to its stage', () => {
  const bundle = createGenericTripBundle()
  const stage = selectStageForDay(bundle, bundle.days[0].id)
  assert.equal(stage?.id, bundle.stages[0].id)
})

test('selectStageForDay returns null for an off day', () => {
  const bundle = createGenericTripBundle()
  assert.equal(selectStageForDay(bundle, bundle.days[1].id), null)
})

test('selectRouteForStage resolves a stage to its route', () => {
  const bundle = createGenericTripBundle()
  const route = selectRouteForStage(bundle, bundle.stages[0].id)
  assert.equal(route?.id, bundle.routes[0].id)
})

test('selectAccommodationForDay resolves the off day lodging, and null when unset', () => {
  const bundle = createGenericTripBundle()
  const accommodation = selectAccommodationForDay(bundle, bundle.days[1].id)
  assert.equal(accommodation?.id, bundle.accommodations[0].id)
  assert.equal(selectAccommodationForDay(bundle, bundle.days[0].id), null)
})

test('selectClimbsForStage and selectRoutePointsForStage return only what the stage references', () => {
  const bundle = createGenericTripBundle()
  assert.deepEqual(selectClimbsForStage(bundle, bundle.stages[1].id).map((climb) => climb.id), [bundle.climbs[0].id])
  assert.deepEqual(selectClimbsForStage(bundle, bundle.stages[0].id), [])
  assert.deepEqual(
    selectRoutePointsForStage(bundle, bundle.stages[0].id).map((point) => point.id),
    [bundle.routePoints[0].id, bundle.routePoints[1].id],
  )
})

test('selectTripCounts counts each day type without recomputing anything', () => {
  const bundle = createGenericTripBundle()
  assert.deepEqual(selectTripCounts(bundle), { totalDays: 4, rideDays: 2, offDays: 1, transferDays: 1 })
})

test('selectTripTotals sums only the values already present on stages', () => {
  const bundle = createGenericTripBundle()
  const totals = selectTripTotals(bundle)
  assert.equal(totals.distanceKm, bundle.stages[0].distanceKm)
  assert.equal(totals.elevationGainM, bundle.stages[0].elevationGainM)
})

test('selectTripTotals returns null for a measure that is null on every stage', () => {
  const bundle = createGenericTripBundle()
  bundle.stages = bundle.stages.map((stage) => ({ ...stage, distanceKm: null }))
  const totals = selectTripTotals(bundle)
  assert.equal(totals.distanceKm, null)
})

test('a missing reference is handled cleanly — null or empty collection, never a throw', () => {
  const bundle = createGenericTripBundle()
  assert.equal(selectDayById(bundle, 'day-does-not-exist'), null)
  assert.equal(selectStageById(bundle, 'stage-does-not-exist'), null)
  assert.equal(selectRouteById(bundle, 'route-does-not-exist'), null)
  assert.equal(selectAccommodationForDay(bundle, 'day-does-not-exist'), null)
  assert.deepEqual(selectClimbsForStage(bundle, 'stage-does-not-exist'), [])
  assert.deepEqual(selectRoutePointsForStage(bundle, 'stage-does-not-exist'), [])
})

test('selectTripTotals treats a genuine 0 as a contributing value, not as absent', () => {
  const bundle = createGenericTripBundle()
  bundle.stages = bundle.stages.map((stage, index) => (index === 1 ? { ...stage, elevationLossM: 0 } : stage))
  const totals = selectTripTotals(bundle)
  assert.equal(totals.elevationLossM, bundle.stages[0].elevationLossM + 0)
})
