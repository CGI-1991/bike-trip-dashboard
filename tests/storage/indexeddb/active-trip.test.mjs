import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ACTIVE_TRIP_ID_STORAGE_KEY,
  clearActiveTripId,
  getActiveTripId,
  setActiveTripId,
} from '../../../src/storage/indexeddb/active-trip.ts'

function memoryStorage() {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    values,
  }
}

function throwingStorage() {
  return {
    getItem: () => {
      throw new Error('Storage is unavailable.')
    },
    setItem: () => {
      throw new Error('Storage is unavailable.')
    },
    removeItem: () => {
      throw new Error('Storage is unavailable.')
    },
  }
}

test('set/get/clear round-trip through the namespaced key', () => {
  const storage = memoryStorage()
  assert.equal(getActiveTripId(storage), null)

  assert.equal(setActiveTripId('trip-alpha', storage), true)
  assert.equal(getActiveTripId(storage), 'trip-alpha')
  assert.equal(storage.values.get(ACTIVE_TRIP_ID_STORAGE_KEY), 'trip-alpha')

  assert.equal(clearActiveTripId(storage), true)
  assert.equal(getActiveTripId(storage), null)
})

test('the storage key is namespaced under bike-trip-dashboard', () => {
  assert.match(ACTIVE_TRIP_ID_STORAGE_KEY, /^bike-trip-dashboard\./)
})

test('an empty string is treated as an invalid tripId — never stored, never returned as active', () => {
  const storage = memoryStorage()
  assert.equal(setActiveTripId('', storage), false)
  assert.equal(storage.values.size, 0)
})

test('a stored value that is empty or whitespace-only reads back as no active trip', () => {
  const storage = memoryStorage()
  storage.setItem(ACTIVE_TRIP_ID_STORAGE_KEY, '   ')
  assert.equal(getActiveTripId(storage), null)
})

test('getActiveTripId never throws when storage is unavailable', () => {
  assert.equal(getActiveTripId(throwingStorage()), null)
})

test('setActiveTripId never throws when storage is unavailable, and reports failure', () => {
  assert.equal(setActiveTripId('trip-alpha', throwingStorage()), false)
})

test('clearActiveTripId never throws when storage is unavailable, and reports failure', () => {
  assert.equal(clearActiveTripId(throwingStorage()), false)
})

test('setActiveTripId writes exactly one key — no other trip data reaches this storage', () => {
  const storage = memoryStorage()
  setActiveTripId('trip-alpha', storage)
  assert.equal(storage.values.size, 1)
  assert.deepEqual([...storage.values.keys()], [ACTIVE_TRIP_ID_STORAGE_KEY])
})
