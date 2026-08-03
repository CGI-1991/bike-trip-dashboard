import { installMinimalDOMParser } from '../support/minimal-dom-parser.mjs'

installMinimalDOMParser()

import '../storage/indexeddb/support/setup-fake-indexeddb.mjs'

import assert from 'node:assert/strict'
import test, { after, before } from 'node:test'

import { importGpxTrip } from '../../src/import/gpx/import-gpx-trip.ts'
import { getActiveTripId } from '../../src/storage/indexeddb/active-trip.ts'
import { createSourceFileRepository } from '../../src/storage/indexeddb/source-file-repository.ts'
import { createTripRepository } from '../../src/storage/indexeddb/trip-repository.ts'
import { deleteTripCompletely, listTripSummaries, setActiveTrip } from '../../src/trips-manager/trip-manager-actions.ts'
import { buildGpxXml, toGpxImportFile } from '../import/gpx/support/fixtures.mjs'
import { createIdFactory, fixedNow, openImportTestDatabase } from '../import/gpx/support/run-import.mjs'

function climbFile(name, startLat) {
  const xml = buildGpxXml({
    tracks: [{ segments: [[{ lat: startLat, lon: 6, ele: 1000 }, { lat: startLat + 0.002, lon: 6.002, ele: 1050 }, { lat: startLat + 0.004, lon: 6.004, ele: 1100 }]] }],
  })
  return toGpxImportFile(xml, name)
}

// `active-trip.ts` reads `globalThis.localStorage` defensively and treats it
// as simply unavailable when absent — true by default in this Node test
// runner (no global `localStorage`). Install a small in-memory stand-in for
// the duration of this file only, so `setActiveTrip`/`getActiveTripId`
// actually persist across calls the way a real browser would.
let previousLocalStorageDescriptor

before(() => {
  previousLocalStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const values = new Map()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: (key) => values.delete(key),
    },
  })
})

after(() => {
  if (previousLocalStorageDescriptor) {
    Object.defineProperty(globalThis, 'localStorage', previousLocalStorageDescriptor)
  } else {
    delete globalThis.localStorage
  }
})

async function importTrip(database, tripId, overrides = {}) {
  return importGpxTrip({
    files: [climbFile(`${tripId}-stage-1.gpx`, 45)],
    options: {
      tripId,
      slug: tripId,
      name: overrides.name ?? tripId,
      importedAt: '2027-01-01T00:00:00.000Z',
      engineVersion: 'test@1',
      startDate: overrides.startDate,
      timezone: overrides.startDate ? 'Europe/Paris' : undefined,
      ...overrides,
    },
    database,
    idFactory: createIdFactory(tripId),
    now: fixedNow(),
  })
}

test('two trips coexist independently in the same IndexedDB database', async () => {
  const database = await openImportTestDatabase()
  try {
    const first = await importTrip(database, 'trip-alpha', { startDate: '2027-06-01' })
    const second = await importTrip(database, 'trip-bravo', { startDate: '2027-07-01' })
    assert.equal(first.ok, true)
    assert.equal(second.ok, true)

    const summaries = await listTripSummaries(database)
    assert.equal(summaries.length, 2)
    const ids = summaries.map((summary) => summary.id).sort()
    assert.deepEqual(ids, ['trip-alpha', 'trip-bravo'])
  } finally {
    database.close()
  }
})

test('trip summaries report name, dates, day/stage counts, distance and status', async () => {
  const database = await openImportTestDatabase()
  try {
    await importTrip(database, 'trip-alpha', { name: 'Alpha Trip', startDate: '2027-06-01' })
    const [summary] = await listTripSummaries(database)
    assert.equal(summary.name, 'Alpha Trip')
    assert.equal(summary.startDate, '2027-06-01')
    assert.equal(summary.dayCount, 1)
    assert.equal(summary.stageCount, 1)
    assert.ok(summary.totalDistanceKm > 0)
    assert.equal(summary.status, 'ready')
  } finally {
    database.close()
  }
})

test('setActiveTrip persists the chosen trip id, retrievable via getActiveTripId', async () => {
  const database = await openImportTestDatabase()
  try {
    await importTrip(database, 'trip-alpha', { startDate: '2027-06-01' })
    assert.equal(setActiveTrip('trip-alpha'), true)
    assert.equal(getActiveTripId(), 'trip-alpha')
  } finally {
    database.close()
    // active-trip-id lives in a fake global localStorage across tests in this
    // file — clear it so later tests are not polluted by this one.
    globalThis.localStorage?.removeItem?.('bike-trip-dashboard.active-trip-id.v1')
  }
})

test('deleting a non-active trip leaves activeTripId untouched', async () => {
  const database = await openImportTestDatabase()
  try {
    await importTrip(database, 'trip-alpha', { startDate: '2027-06-01' })
    await importTrip(database, 'trip-bravo', { startDate: '2027-07-01' })
    setActiveTrip('trip-alpha')

    const result = await deleteTripCompletely(database, 'trip-bravo', '2027-06-15')
    assert.equal(result.deleted, true)
    assert.equal(result.wasActive, false)
    assert.equal(getActiveTripId(), 'trip-alpha')

    const tripRepository = createTripRepository(database)
    assert.equal(await tripRepository.hasTrip('trip-bravo'), false)
    assert.equal(await tripRepository.hasTrip('trip-alpha'), true)
  } finally {
    database.close()
    globalThis.localStorage?.removeItem?.('bike-trip-dashboard.active-trip-id.v1')
  }
})

test('deleting the active trip clears activeTripId and selects the next most relevant remaining trip', async () => {
  const database = await openImportTestDatabase()
  try {
    await importTrip(database, 'trip-alpha', { startDate: '2027-06-01' })
    await importTrip(database, 'trip-bravo', { startDate: '2027-07-01' })
    setActiveTrip('trip-alpha')

    // "today" is after trip-alpha's single day and before trip-bravo's — trip-bravo becomes the nearest upcoming trip.
    const result = await deleteTripCompletely(database, 'trip-alpha', '2027-06-15')
    assert.equal(result.deleted, true)
    assert.equal(result.wasActive, true)
    assert.equal(result.nextActiveTripId, 'trip-bravo')
    assert.equal(getActiveTripId(), 'trip-bravo')
  } finally {
    database.close()
    globalThis.localStorage?.removeItem?.('bike-trip-dashboard.active-trip-id.v1')
  }
})

test('deleting the active trip with no remaining trip clears activeTripId to nothing', async () => {
  const database = await openImportTestDatabase()
  try {
    await importTrip(database, 'trip-alpha', { startDate: '2027-06-01' })
    setActiveTrip('trip-alpha')

    const result = await deleteTripCompletely(database, 'trip-alpha', '2027-06-15')
    assert.equal(result.wasActive, true)
    assert.equal(result.nextActiveTripId, null)
    assert.equal(getActiveTripId(), null)
  } finally {
    database.close()
    globalThis.localStorage?.removeItem?.('bike-trip-dashboard.active-trip-id.v1')
  }
})

test('deletion removes all linked data — bundle, and source payloads (isolated per trip)', async () => {
  const database = await openImportTestDatabase()
  try {
    const first = await importTrip(database, 'trip-alpha', { startDate: '2027-06-01' })
    await importTrip(database, 'trip-bravo', { startDate: '2027-07-01' })
    const sourceFileId = first.bundle.sourceFiles[0].id

    await deleteTripCompletely(database, 'trip-alpha', '2027-06-15')

    const sourceFileRepository = createSourceFileRepository(database)
    assert.equal(await sourceFileRepository.getSourceFilePayload('trip-alpha', sourceFileId), null)

    // trip-bravo is completely unaffected by trip-alpha's deletion.
    const tripRepository = createTripRepository(database)
    assert.equal(await tripRepository.hasTrip('trip-bravo'), true)
  } finally {
    database.close()
  }
})

test('deleting an unknown trip id reports deleted: false without throwing', async () => {
  const database = await openImportTestDatabase()
  try {
    const result = await deleteTripCompletely(database, 'does-not-exist', '2027-06-15')
    assert.equal(result.deleted, false)
  } finally {
    database.close()
  }
})
