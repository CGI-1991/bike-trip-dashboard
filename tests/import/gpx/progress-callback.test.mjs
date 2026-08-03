import { installMinimalDOMParser } from '../../support/minimal-dom-parser.mjs'

installMinimalDOMParser()

import assert from 'node:assert/strict'
import test from 'node:test'

import { buildGpxXml, toGpxImportFile } from './support/fixtures.mjs'
import { runImport } from './support/run-import.mjs'
import { importGpxTrip } from '../../../src/import/gpx/import-gpx-trip.ts'
import { createIdFactory, fixedNow, openImportTestDatabase } from './support/run-import.mjs'

function climbFile(name, startLat) {
  const xml = buildGpxXml({
    tracks: [{ segments: [[{ lat: startLat, lon: 6, ele: 1000 }, { lat: startLat + 0.002, lon: 6.002, ele: 1050 }]] }],
  })
  return toGpxImportFile(xml, name)
}

test('onProgress fires every real phase, in order, at least once, for a successful import', async () => {
  const database = await openImportTestDatabase()
  try {
    const seen = []
    const result = await importGpxTrip({
      files: [climbFile('stage-1.gpx', 45)],
      options: { tripId: 'trip-1', slug: 'trip-1', name: 'Test', importedAt: '2027-01-01T00:00:00.000Z', engineVersion: 'test@1' },
      database,
      idFactory: createIdFactory(),
      now: fixedNow(),
      onProgress: (label) => seen.push(label),
    })
    assert.equal(result.ok, true)
    assert.deepEqual(seen, ['reading', 'validating', 'analyzing', 'climbs', 'stages', 'saving'])
  } finally {
    database.close()
  }
})

test('onProgress fires analyzing/climbs/stages once per file, in file order', async () => {
  const database = await openImportTestDatabase()
  try {
    const seen = []
    const result = await importGpxTrip({
      files: [climbFile('stage-1.gpx', 45), climbFile('stage-2.gpx', 46)],
      options: { tripId: 'trip-1', slug: 'trip-1', name: 'Test', importedAt: '2027-01-01T00:00:00.000Z', engineVersion: 'test@1' },
      database,
      idFactory: createIdFactory(),
      now: fixedNow(),
      onProgress: (label) => seen.push(label),
    })
    assert.equal(result.ok, true)
    assert.deepEqual(seen, ['reading', 'validating', 'analyzing', 'climbs', 'stages', 'analyzing', 'climbs', 'stages', 'saving'])
  } finally {
    database.close()
  }
})

test('onProgress never fires "saving" when the import fails before the write (e.g. an invalid file)', async () => {
  const database = await openImportTestDatabase()
  try {
    const seen = []
    const result = await importGpxTrip({
      files: [toGpxImportFile('', 'empty.gpx')],
      options: { tripId: 'trip-1', slug: 'trip-1', name: 'Test', importedAt: '2027-01-01T00:00:00.000Z', engineVersion: 'test@1' },
      database,
      idFactory: createIdFactory(),
      now: fixedNow(),
      onProgress: (label) => seen.push(label),
    })
    assert.equal(result.ok, false)
    assert.ok(!seen.includes('saving'))
  } finally {
    database.close()
  }
})

test('omitting onProgress entirely still works — it is purely observational', async () => {
  const { result, database } = await runImport([climbFile('stage-1.gpx', 45)])
  try {
    assert.equal(result.ok, true)
  } finally {
    database.close()
  }
})
