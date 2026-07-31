import assert from 'node:assert/strict'
import test from 'node:test'

import { createRgaLegacyTripBundle } from '../../../src/trips/rga-2026/load-rga-legacy-trip.ts'
import { selectPracticalPlacesForDay } from '../../../src/trip-core/index.ts'
import { loadRgaLegacySnapshotFromDisk } from './support/load-snapshot.mjs'

const { snapshot } = await loadRgaLegacySnapshotFromDisk()
const bundle = createRgaLegacyTripBundle(snapshot)

test('all ten historical accommodations are migrated', () => {
  assert.equal(bundle.accommodations.length, snapshot.accommodations.accommodations.length)
})

test('every day accommodation association resolves to a real accommodation', () => {
  const accommodationIds = new Set(bundle.accommodations.map((accommodation) => accommodation.id))
  const associatedDays = bundle.days.filter((day) => day.accommodationId !== null)
  assert.ok(associatedDays.length > 0)
  for (const day of associatedDays) assert.ok(accommodationIds.has(day.accommodationId))
})

test('shared accommodations (e.g. the OFF-day pair) resolve both days to the same accommodation', () => {
  const sorted = [...bundle.days].sort((left, right) => left.index - right.index)
  const bourgSaintMauriceOffDay = sorted[4]
  const dayBefore = sorted[3]
  assert.notEqual(bourgSaintMauriceOffDay.accommodationId, null)
  assert.equal(dayBefore.accommodationId, bourgSaintMauriceOffDay.accommodationId)
})

test('no accommodation carries an invalid coordinate', () => {
  for (const accommodation of bundle.accommodations) {
    if (accommodation.latitude !== null) assert.ok(accommodation.latitude >= -90 && accommodation.latitude <= 90)
    if (accommodation.longitude !== null) assert.ok(accommodation.longitude >= -180 && accommodation.longitude <= 180)
  }
})

test('accommodation types are all recognized categories', () => {
  const allowed = new Set(['hotel', 'airbnb', 'gite', 'chambre-hotes', 'hostel', 'guest-house', 'refuge', 'camping'])
  for (const accommodation of bundle.accommodations) assert.ok(allowed.has(accommodation.type))
})

test('practical places are migrated in full, one per historical point', () => {
  assert.equal(bundle.practicalPlaces.length, snapshot.practicalData.points.length)
})

test('no practical place carries an invalid coordinate', () => {
  for (const place of bundle.practicalPlaces) {
    assert.ok(place.latitude >= -90 && place.latitude <= 90)
    assert.ok(place.longitude >= -180 && place.longitude <= 180)
  }
})

test('practical place categories are all recognized by TripBundle', () => {
  const allowed = new Set(['shelter', 'bakery', 'cafe-or-ice-cream', 'water', 'fast-food', 'bike-service', 'supermarket', 'toilet'])
  for (const place of bundle.practicalPlaces) assert.ok(allowed.has(place.category))
})

test('practical place identifiers stay stable and unique', () => {
  const ids = bundle.practicalPlaces.map((place) => place.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('every route point (documented col/passage/detour) belongs to a real route', () => {
  const routeIds = new Set(bundle.routes.map((route) => route.id))
  for (const point of bundle.routePoints) assert.ok(routeIds.has(point.routeId))
})

test('practical place dayIds are preserved exactly, one generic id per historical legacy id', () => {
  const dayNumberByLegacyId = new Map(snapshot.roadbook.days.map((day) => [day.id, day.dayNumber]))
  const genericDayIdByDisplayNumber = new Map(bundle.days.map((day) => [day.displayNumber, day.id]))
  for (const legacyPoint of snapshot.practicalData.points) {
    const migratedPlace = bundle.practicalPlaces.find((place) => place.id === legacyPoint.id)
    assert.ok(migratedPlace, `place ${legacyPoint.id} should have been migrated`)
    const expectedGenericIds = legacyPoint.dayIds.map(
      (legacyDayId) => genericDayIdByDisplayNumber.get(dayNumberByLegacyId.get(legacyDayId)),
    )
    assert.deepEqual(migratedPlace.dayIds, expectedGenericIds)
  }
})

test('no practical place references an unknown day, and none reference an OFF day (the source never does)', () => {
  const dayIds = new Set(bundle.days.map((day) => day.id))
  const offDayIds = new Set(bundle.days.filter((day) => day.type === 'off').map((day) => day.id))
  for (const place of bundle.practicalPlaces) {
    for (const dayId of place.dayIds) {
      assert.ok(dayIds.has(dayId))
      assert.equal(offDayIds.has(dayId), false)
    }
  }
})

test('selecting practical places for a given day matches the historical association exactly', () => {
  const firstRideDay = bundle.days.find((day) => day.displayNumber === 1)
  const legacyDayIdsForJ1 = new Set(
    snapshot.practicalData.points.filter((point) => point.dayIds.includes('J1')).map((point) => point.id),
  )
  const selected = selectPracticalPlacesForDay(bundle, firstRideDay.id)
  assert.equal(selected.length, legacyDayIdsForJ1.size)
  for (const place of selected) assert.ok(legacyDayIdsForJ1.has(place.id))
})

test('a multi-day practical place is returned for each of its days', () => {
  const multiDayLegacyPoint = snapshot.practicalData.points.find((point) => point.dayIds.length > 1)
  assert.ok(multiDayLegacyPoint)
  const migratedPlace = bundle.practicalPlaces.find((place) => place.id === multiDayLegacyPoint.id)
  assert.ok(migratedPlace.dayIds.length > 1)
  for (const dayId of migratedPlace.dayIds) {
    const forDay = selectPracticalPlacesForDay(bundle, dayId)
    assert.ok(forDay.some((place) => place.id === migratedPlace.id))
  }
})

test('practical place dayIds arrays are never mutated by construction', () => {
  const snapshotCopy = structuredClone(snapshot)
  createRgaLegacyTripBundle(snapshot)
  assert.deepEqual(snapshot.practicalData.points.map((p) => p.dayIds), snapshotCopy.practicalData.points.map((p) => p.dayIds))
})
