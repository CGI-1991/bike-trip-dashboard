/**
 * Transactional primitives shared by every repository. Nothing here is
 * specific to trips, source files or import jobs — `trip-repository.ts`,
 * `source-file-repository.ts` and `import-job-repository.ts` all build on
 * these.
 */

import { BY_TRIP_ID_INDEX_NAME } from './constants.ts'

/**
 * Runs `executor` against a fresh `readwrite`/`readonly` transaction over
 * `storeNames`, resolving only once IndexedDB actually commits
 * (`transaction.oncomplete`) — never merely once `executor`'s own promise
 * settles. If `executor` throws or rejects, the transaction is explicitly
 * aborted and the returned promise rejects with `executor`'s error (never a
 * partial commit).
 *
 * `executor` may issue any number of store requests, awaited one after
 * another (`await promisifyRequest(store.put(...))`, etc.) — as long as
 * every awaited step resolves from an IndexedDB request's own callback (a
 * microtask), the transaction stays active for its whole duration. Awaiting
 * anything else (a timer, a fetch, an unrelated promise) between two
 * IndexedDB requests would let the transaction auto-commit early; this
 * module never does that.
 */
export function runInTransaction<T>(
  db: IDBDatabase,
  storeNames: readonly string[],
  mode: IDBTransactionMode,
  executor: (tx: IDBTransaction) => Promise<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeNames as string[], mode)
    let settled = false
    let result: T | undefined
    let executorError: unknown

    tx.oncomplete = () => {
      if (settled) return
      settled = true
      if (executorError !== undefined) reject(executorError)
      else resolve(result as T)
    }
    tx.onerror = () => {
      if (settled) return
      settled = true
      reject(executorError ?? tx.error ?? new Error('La transaction IndexedDB a échoué.'))
    }
    tx.onabort = () => {
      if (settled) return
      settled = true
      reject(executorError ?? tx.error ?? new Error('La transaction IndexedDB a été annulée.'))
    }

    executor(tx).then(
      (value) => {
        result = value
      },
      (error: unknown) => {
        executorError = error
        try {
          tx.abort()
        } catch {
          // Already complete/aborted by IndexedDB itself (e.g. a failed
          // request already aborted the transaction) — the on* handlers
          // above still fire and will reject with `executorError`.
        }
      },
    )
  })
}

/** All values currently stored under `tripId` in a trip-scoped store, via its `byTripId` index — never a full-store scan. */
export function getAllByTripId<T>(store: IDBObjectStore, tripId: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const request = store.index(BY_TRIP_ID_INDEX_NAME).getAll(IDBKeyRange.only(tripId))
    request.onsuccess = () => resolve(request.result as T[])
    request.onerror = () => reject(request.error ?? new Error('La lecture indexée a échoué.'))
  })
}

/** Deletes every record currently stored under `tripId` in a trip-scoped store, via its `byTripId` index — never a full-store scan. */
export function deleteAllByTripId(store: IDBObjectStore, tripId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = store.index(BY_TRIP_ID_INDEX_NAME).openCursor(IDBKeyRange.only(tripId))
    request.onsuccess = () => {
      const cursor = request.result
      if (cursor) {
        cursor.delete()
        cursor.continue()
      } else {
        resolve()
      }
    }
    request.onerror = () => reject(request.error ?? new Error('La suppression indexée a échoué.'))
  })
}
