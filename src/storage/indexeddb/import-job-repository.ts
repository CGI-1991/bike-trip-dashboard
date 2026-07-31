/**
 * Generic tracking for one import run — see CDC section 9.4/12. This
 * repository only stores/retrieves state; it never runs a GPX import or any
 * other business logic, and never reads the current time (every timestamp
 * is supplied by the caller).
 */

import type { SourceFileId, TripId } from '../../trip-core/index.ts'
import { OBJECT_STORE_NAMES } from './constants.ts'
import { promisifyRequest } from './request.ts'
import { getAllByTripId, runInTransaction } from './transaction.ts'

export type ImportJobStatus = 'pending' | 'parsing' | 'validating' | 'writing' | 'ready' | 'failed' | 'cancelled'

export interface ImportJobIssue {
  readonly code: string
  readonly message: string
}

/** The `importJobs` store's record. */
export interface ImportJob {
  readonly id: string
  /** `null` while no trip has been created/identified yet (early `pending`/`parsing` steps). */
  readonly tripId: TripId | null
  readonly createdAt: string
  readonly updatedAt: string
  readonly status: ImportJobStatus
  readonly currentStep: string | null
  /** A fraction in `[0, 1]`, or `null` when indeterminate. */
  readonly progress: number | null
  readonly sourceFileIds: readonly SourceFileId[]
  readonly issues: readonly ImportJobIssue[]
  readonly error: string | null
  readonly engineVersion: string
}

export class ImportJobNotFoundError extends Error {
  constructor(id: string) {
    super(`ImportJob introuvable : ${id}.`)
    this.name = 'ImportJobNotFoundError'
  }
}

export class ImportJobAlreadyExistsError extends Error {
  constructor(id: string) {
    super(`ImportJob déjà existant : ${id}.`)
    this.name = 'ImportJobAlreadyExistsError'
  }
}

export interface ImportJobRepository {
  /** Inserts a brand-new import job. Rejects if `job.id` already exists. */
  createImportJob(job: ImportJob): Promise<void>
  /** Overwrites an existing import job (a status/progress/issues transition). Rejects if `job.id` does not exist yet. */
  updateImportJob(job: ImportJob): Promise<void>
  getImportJob(id: string): Promise<ImportJob | null>
  /** All import jobs, or only those for one trip when `tripId` is given (via the `byTripId` index — never a full scan when filtering). */
  listImportJobs(tripId?: TripId): Promise<readonly ImportJob[]>
  deleteImportJob(id: string): Promise<boolean>
}

export function createImportJobRepository(db: IDBDatabase): ImportJobRepository {
  const storeName = OBJECT_STORE_NAMES.importJobs

  return {
    async createImportJob(job) {
      await runInTransaction(db, [storeName], 'readwrite', async (tx) => {
        const store = tx.objectStore(storeName)
        const existing = await promisifyRequest(store.count(job.id))
        if (existing > 0) throw new ImportJobAlreadyExistsError(job.id)
        store.put(job)
      })
    },

    async updateImportJob(job) {
      await runInTransaction(db, [storeName], 'readwrite', async (tx) => {
        const store = tx.objectStore(storeName)
        const existing = await promisifyRequest(store.count(job.id))
        if (existing === 0) throw new ImportJobNotFoundError(job.id)
        store.put(job)
      })
    },

    async getImportJob(id) {
      const record = await runInTransaction(db, [storeName], 'readonly', (tx) => promisifyRequest(tx.objectStore(storeName).get(id)))
      return (record as ImportJob | undefined) ?? null
    },

    async listImportJobs(tripId) {
      const records = await runInTransaction(db, [storeName], 'readonly', (tx) => {
        const store = tx.objectStore(storeName)
        return tripId === undefined ? promisifyRequest(store.getAll()) : getAllByTripId<ImportJob>(store, tripId)
      })
      return (records as readonly ImportJob[]).slice().sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
    },

    async deleteImportJob(id) {
      return runInTransaction(db, [storeName], 'readwrite', async (tx) => {
        const store = tx.objectStore(storeName)
        const existing = await promisifyRequest(store.count(id))
        if (existing === 0) return false
        store.delete(id)
        return true
      })
    },
  }
}
