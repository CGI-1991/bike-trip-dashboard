import { installMinimalDOMParser } from '../../support/minimal-dom-parser.mjs'

installMinimalDOMParser()

import assert from 'node:assert/strict'
import test from 'node:test'

import { createImportJobRepository } from '../../../src/storage/indexeddb/import-job-repository.ts'
import { createSourceFileRepository } from '../../../src/storage/indexeddb/source-file-repository.ts'
import { createTripRepository } from '../../../src/storage/indexeddb/trip-repository.ts'
import { buildGpxXml, toGpxImportFile } from './support/fixtures.mjs'
import { runImport } from './support/run-import.mjs'

function climbFile(name, startLat) {
  const xml = buildGpxXml({
    tracks: [{ segments: [[{ lat: startLat, lon: 6, ele: 1000 }, { lat: startLat + 0.002, lon: 6.002, ele: 1050 }, { lat: startLat + 0.004, lon: 6.004, ele: 1100 }]] }],
  })
  return toGpxImportFile(xml, name)
}

test('end-to-end: create the database, import 2 synthetic GPX files, persist atomically, reload, verify payload byte-identity, verify ImportJob ready, then delete the trip completely', async () => {
  const fileA = climbFile('stage-1.gpx', 45)
  const fileB = climbFile('stage-2.gpx', 46)

  // 1-3. openImportTestDatabase (inside runImport) creates the base; importGpxTrip parses
  // both synthetic GPX files and persists the bundle/payloads/importJob atomically.
  const { result, database } = await runImport([fileA, fileB])
  try {
    assert.equal(result.ok, true)
    const { bundle, importJob } = result

    // 4-5. Reload the TripBundle and compare deepEqual.
    const tripRepository = createTripRepository(database)
    const reloadedBundle = await tripRepository.loadTripBundle(bundle.metadata.id)
    assert.deepEqual(reloadedBundle, bundle)

    // 6-7. Reload each payload and verify byte-identity against the original file.
    const sourceFileRepository = createSourceFileRepository(database)
    for (const [index, file] of [fileA, fileB].entries()) {
      const sourceFileRecord = bundle.sourceFiles[index]
      const payload = await sourceFileRepository.getSourceFilePayload(bundle.metadata.id, sourceFileRecord.id)
      assert.notEqual(payload, null)
      assert.equal(Buffer.from(payload.content).equals(Buffer.from(file.bytes)), true, `payload ${index} is byte-identical to the original file`)
    }

    // 8. Verify the ImportJob reads back exactly as returned, and is `ready`.
    const importJobRepository = createImportJobRepository(database)
    const storedImportJob = await importJobRepository.getImportJob(importJob.id)
    assert.deepEqual(storedImportJob, importJob)
    assert.equal(storedImportJob.status, 'ready')
    assert.equal(storedImportJob.tripId, bundle.metadata.id)

    // 9-10. Delete the trip and confirm complete removal (bundle and payloads).
    const deleted = await tripRepository.deleteTrip(bundle.metadata.id)
    assert.equal(deleted, true)
    assert.equal(await tripRepository.loadTripBundle(bundle.metadata.id), null)
    for (const sourceFileRecord of bundle.sourceFiles) {
      assert.equal(await sourceFileRepository.getSourceFilePayload(bundle.metadata.id, sourceFileRecord.id), null)
    }
  } finally {
    database.close()
  }
})
