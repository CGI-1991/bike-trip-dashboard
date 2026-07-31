import assert from 'node:assert/strict'
import test from 'node:test'

import { fromTripRecordSet, toTripRecordSet } from '../../../src/storage/indexeddb/records.ts'
import { createGenericTripBundle } from '../../trip-core/support/generic-trip-fixture.mjs'

test('toTripRecordSet -> fromTripRecordSet round-trips a dated bundle exactly, unchanged', () => {
  const bundle = createGenericTripBundle({ dated: true })
  const records = toTripRecordSet(bundle)
  const rebuilt = fromTripRecordSet(records)
  assert.deepEqual(rebuilt, bundle)
})

test('toTripRecordSet -> fromTripRecordSet round-trips the undated variant (no calendar, no weather)', () => {
  const bundle = createGenericTripBundle({ dated: false })
  const rebuilt = fromTripRecordSet(toTripRecordSet(bundle))
  assert.deepEqual(rebuilt, bundle)
})

test('toTripRecordSet never mutates the bundle it is given', () => {
  const bundle = createGenericTripBundle({ dated: true })
  const snapshot = JSON.parse(JSON.stringify(bundle))
  toTripRecordSet(bundle)
  assert.deepEqual(bundle, snapshot)
})

test('fromTripRecordSet never mutates the record set it is given', () => {
  const bundle = createGenericTripBundle({ dated: true })
  const records = toTripRecordSet(bundle)
  const snapshot = JSON.parse(JSON.stringify(records))
  fromTripRecordSet(records)
  assert.deepEqual(records, snapshot)
})

test('every trip-scoped record carries the bundle tripId', () => {
  const bundle = createGenericTripBundle({ dated: true })
  const records = toTripRecordSet(bundle)
  const tripId = bundle.metadata.id
  assert.equal(records.trip.id, tripId)
  assert.equal(records.tripSettings.tripId, tripId)
  for (const collection of [
    records.sourceFiles,
    records.tripDays,
    records.stages,
    records.routes,
    records.routeGeometries,
    records.climbs,
    records.routePoints,
    records.practicalPlaces,
    records.accommodations,
    records.weather,
    records.overrides,
  ]) {
    for (const record of collection) {
      assert.equal(record.tripId, tripId)
    }
  }
})

test('a route with no geometry produces no routeGeometries record; a route with geometry produces exactly one', () => {
  const bundle = createGenericTripBundle({ dated: true })
  const records = toTripRecordSet(bundle)
  // Fixture: route1 has geometry.simplified set, route2 has geometry: null.
  const routeWithGeometry = bundle.routes.find((route) => route.geometry !== null)
  const routeWithoutGeometry = bundle.routes.find((route) => route.geometry === null)
  assert.ok(routeWithGeometry && routeWithoutGeometry, 'fixture must contain one route of each kind')
  assert.equal(records.routeGeometries.filter((record) => record.id === routeWithGeometry.id).length, 1)
  assert.equal(records.routeGeometries.some((record) => record.id === routeWithoutGeometry.id), false)
})

test('sequence fields capture the exact original array order, independent of any re-sort by id', () => {
  const bundle = createGenericTripBundle({ dated: true })
  const records = toTripRecordSet(bundle)
  // Shuffle the stored stage records (simulating IndexedDB returning rows in
  // an unspecified order) before rebuilding — the result must still match
  // the original bundle's stage order exactly, because reconstruction sorts
  // by `sequence`, not by read order.
  const shuffledStages = [...records.stages].reverse()
  const rebuilt = fromTripRecordSet({ ...records, stages: shuffledStages })
  assert.deepEqual(rebuilt.stages, bundle.stages)
})
