import { installMinimalDOMParser } from '../../support/minimal-dom-parser.mjs'

installMinimalDOMParser()

import assert from 'node:assert/strict'
import test from 'node:test'

import { createTripRepository } from '../../../src/storage/indexeddb/trip-repository.ts'
import { buildGpxXml, toGpxImportFile } from './support/fixtures.mjs'
import { runImport } from './support/run-import.mjs'

function climbFile(name, startLat) {
  const xml = buildGpxXml({
    tracks: [{ segments: [[{ lat: startLat, lon: 6, ele: 1000 }, { lat: startLat + 0.002, lon: 6.002, ele: 1050 }]] }],
  })
  return toGpxImportFile(xml, name)
}

test('importing several GPX files with no startDate produces an undated, still-valid, saved bundle', async () => {
  const files = [climbFile('stage-1.gpx', 45), climbFile('stage-2.gpx', 46), climbFile('stage-3.gpx', 47)]
  const { result, database } = await runImport(files)
  try {
    assert.equal(result.ok, true)
    const { bundle } = result

    assert.equal(bundle.calendar.startDate, null)
    assert.equal(bundle.calendar.endDate, null)
    assert.equal(bundle.calendar.timezone, null)
    assert.equal(bundle.metadata.startDate, null)
    assert.equal(bundle.metadata.status, 'draft')
    assert.ok(bundle.days.every((day) => day.date === null), 'no day carries an invented date')
    assert.deepEqual(bundle.weather, [], 'no weather without a calendar')

    const tripRepository = createTripRepository(database)
    const reloaded = await tripRepository.loadTripBundle(bundle.metadata.id)
    assert.deepEqual(reloaded, bundle)
  } finally {
    database.close()
  }
})
