import './support/setup-fake-indexeddb.mjs'

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ImportJobAlreadyExistsError,
  ImportJobNotFoundError,
  createImportJobRepository,
} from '../../../src/storage/indexeddb/import-job-repository.ts'
import { openTestDatabase } from './support/open-test-database.mjs'

function baseJob(overrides = {}) {
  return {
    id: 'import-job-1',
    tripId: null,
    createdAt: '2027-01-01T00:00:00.000Z',
    updatedAt: '2027-01-01T00:00:00.000Z',
    status: 'pending',
    currentStep: null,
    progress: null,
    sourceFileIds: [],
    issues: [],
    error: null,
    engineVersion: 'test-import@1',
    ...overrides,
  }
}

test('createImportJob then getImportJob round-trips exactly', async () => {
  const db = await openTestDatabase()
  try {
    const repo = createImportJobRepository(db)
    const job = baseJob()
    await repo.createImportJob(job)
    assert.deepEqual(await repo.getImportJob(job.id), job)
  } finally {
    db.close()
  }
})

test('creating an import job with an id that already exists is rejected, not overwritten', async () => {
  const db = await openTestDatabase()
  try {
    const repo = createImportJobRepository(db)
    const job = baseJob()
    await repo.createImportJob(job)
    await assert.rejects(() => repo.createImportJob(baseJob({ status: 'parsing' })), ImportJobAlreadyExistsError)
    assert.equal((await repo.getImportJob(job.id)).status, 'pending')
  } finally {
    db.close()
  }
})

test('updateImportJob transitions status/progress/issues using only caller-supplied timestamps', async () => {
  const db = await openTestDatabase()
  try {
    const repo = createImportJobRepository(db)
    const job = baseJob()
    await repo.createImportJob(job)

    const parsing = { ...job, status: 'parsing', currentStep: 'parsing-gpx', progress: 0.2, updatedAt: '2027-01-01T00:05:00.000Z' }
    await repo.updateImportJob(parsing)
    assert.deepEqual(await repo.getImportJob(job.id), parsing)

    const validating = { ...parsing, status: 'validating', progress: 0.6, updatedAt: '2027-01-01T00:10:00.000Z' }
    await repo.updateImportJob(validating)
    assert.deepEqual(await repo.getImportJob(job.id), validating)

    const ready = { ...validating, status: 'ready', progress: 1, tripId: 'trip-from-import', updatedAt: '2027-01-01T00:15:00.000Z' }
    await repo.updateImportJob(ready)
    assert.deepEqual(await repo.getImportJob(job.id), ready)
  } finally {
    db.close()
  }
})

test('updateImportJob on an unknown id is rejected, never silently created', async () => {
  const db = await openTestDatabase()
  try {
    const repo = createImportJobRepository(db)
    await assert.rejects(() => repo.updateImportJob(baseJob({ id: 'never-created' })), ImportJobNotFoundError)
  } finally {
    db.close()
  }
})

test('a failed import job records its error without ever reaching ready', async () => {
  const db = await openTestDatabase()
  try {
    const repo = createImportJobRepository(db)
    const job = baseJob({ status: 'parsing' })
    await repo.createImportJob(job)

    const failed = {
      ...job,
      status: 'failed',
      error: 'GPX de départ illisible.',
      issues: [{ code: 'unreadable-gpx', message: 'Le fichier alpha.gpx est illisible.' }],
      updatedAt: '2027-01-01T00:02:00.000Z',
    }
    await repo.updateImportJob(failed)

    const loaded = await repo.getImportJob(job.id)
    assert.equal(loaded.status, 'failed')
    assert.equal(loaded.error, 'GPX de départ illisible.')
    assert.equal(loaded.issues.length, 1)
  } finally {
    db.close()
  }
})

test('getImportJob returns null for an unknown id', async () => {
  const db = await openTestDatabase()
  try {
    const repo = createImportJobRepository(db)
    assert.equal(await repo.getImportJob('does-not-exist'), null)
  } finally {
    db.close()
  }
})

test('listImportJobs(tripId) uses the byTripId index to isolate jobs belonging to one trip', async () => {
  const db = await openTestDatabase()
  try {
    const repo = createImportJobRepository(db)
    await repo.createImportJob(baseJob({ id: 'job-a', tripId: 'trip-x' }))
    await repo.createImportJob(baseJob({ id: 'job-b', tripId: 'trip-y' }))
    await repo.createImportJob(baseJob({ id: 'job-c', tripId: null }))

    const forTripX = await repo.listImportJobs('trip-x')
    assert.deepEqual(
      forTripX.map((job) => job.id),
      ['job-a'],
    )

    const all = await repo.listImportJobs()
    assert.deepEqual(
      all.map((job) => job.id).sort(),
      ['job-a', 'job-b', 'job-c'],
    )
  } finally {
    db.close()
  }
})

test('deleteImportJob removes the job and reports whether it existed', async () => {
  const db = await openTestDatabase()
  try {
    const repo = createImportJobRepository(db)
    await repo.createImportJob(baseJob())
    assert.equal(await repo.deleteImportJob('import-job-1'), true)
    assert.equal(await repo.getImportJob('import-job-1'), null)
    assert.equal(await repo.deleteImportJob('import-job-1'), false)
  } finally {
    db.close()
  }
})
