import './support/setup-fake-indexeddb.mjs'

import assert from 'node:assert/strict'
import test from 'node:test'

import { saveTripImportAtomically } from '../../../src/storage/indexeddb/atomic-import.ts'
import { createImportJobRepository } from '../../../src/storage/indexeddb/import-job-repository.ts'
import { createSourceFileRepository } from '../../../src/storage/indexeddb/source-file-repository.ts'
import { TripValidationError, createTripRepository } from '../../../src/storage/indexeddb/trip-repository.ts'
import { createGenericTripBundle } from '../../trip-core/support/generic-trip-fixture.mjs'
import { openTestDatabase } from './support/open-test-database.mjs'

function readyImportJob(bundle) {
  return {
    id: 'import-job-atomic-1',
    tripId: bundle.metadata.id,
    createdAt: '2027-01-01T00:00:00.000Z',
    updatedAt: '2027-01-01T00:10:00.000Z',
    status: 'ready',
    currentStep: null,
    progress: 1,
    sourceFileIds: bundle.sourceFiles.map((file) => file.id),
    issues: [],
    error: null,
    engineVersion: 'test-import@1',
  }
}

test('saveTripImportAtomically commits the bundle, its source payloads and the importJob together', async () => {
  const db = await openTestDatabase()
  try {
    const tripRepo = createTripRepository(db)
    const sourceFileRepo = createSourceFileRepository(db)
    const importJobRepo = createImportJobRepository(db)
    const bundle = createGenericTripBundle({ dated: true })
    const payload = new TextEncoder().encode('gpx-bytes-alpha').buffer
    const job = readyImportJob(bundle)

    await saveTripImportAtomically(db, {
      bundle,
      sourcePayloads: [{ sourceFileId: bundle.sourceFiles[0].id, content: payload }],
      importJob: job,
    })

    assert.deepEqual(await tripRepo.loadTripBundle(bundle.metadata.id), bundle)
    const storedPayload = await sourceFileRepo.getSourceFilePayload(bundle.metadata.id, bundle.sourceFiles[0].id)
    assert.equal(Buffer.from(storedPayload.content).toString(), 'gpx-bytes-alpha')
    assert.deepEqual(await importJobRepo.getImportJob(job.id), job)
  } finally {
    db.close()
  }
})

test('an invalid bundle is refused before any transaction: the importJob is never written either', async () => {
  const db = await openTestDatabase()
  try {
    const importJobRepo = createImportJobRepository(db)
    const bundle = createGenericTripBundle({ dated: true })
    const invalidBundle = { ...bundle, schemaVersion: 99 }
    const job = readyImportJob(bundle)

    await assert.rejects(() => saveTripImportAtomically(db, { bundle: invalidBundle, importJob: job }), TripValidationError)
    assert.equal(await importJobRepo.getImportJob(job.id), null)
  } finally {
    db.close()
  }
})

test('a write failure aborts the whole transaction: the importJob is never marked ready without its bundle actually landing', async () => {
  const db = await openTestDatabase()
  try {
    const tripRepo = createTripRepository(db)
    const importJobRepo = createImportJobRepository(db)
    const bundle = createGenericTripBundle({ dated: true })
    const brokenBundle = {
      ...bundle,
      overrides: [
        ...bundle.overrides,
        {
          id: 'override-not-clonable',
          targetType: 'route-point',
          targetId: bundle.routePoints[0].id,
          field: 'name',
          value: () => 'not clonable',
          reason: null,
          createdAt: '2027-01-01T00:00:00.000Z',
        },
      ],
    }
    const job = readyImportJob(bundle)

    await assert.rejects(() => saveTripImportAtomically(db, { bundle: brokenBundle, importJob: job }))

    assert.equal(await tripRepo.loadTripBundle(bundle.metadata.id), null, 'the bundle must not have landed')
    assert.equal(await importJobRepo.getImportJob(job.id), null, 'the importJob must not read ready without its bundle')
  } finally {
    db.close()
  }
})

test('saveTripImportAtomically without an importJob still writes the bundle and payloads atomically', async () => {
  const db = await openTestDatabase()
  try {
    const tripRepo = createTripRepository(db)
    const bundle = createGenericTripBundle({ dated: false })
    await saveTripImportAtomically(db, { bundle })
    assert.deepEqual(await tripRepo.loadTripBundle(bundle.metadata.id), bundle)
  } finally {
    db.close()
  }
})
