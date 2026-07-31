/**
 * Browser storage-persistence request (CDC section 9.5/15) — `navigator
 * .storage.persist()`, wrapped so it is never called implicitly. This
 * module never touches `navigator` itself: the caller (a later phase's UI
 * or bootstrap) always passes the `StorageManager` explicitly, and nothing
 * here calls this function at module load or from `src/main.ts`.
 */

/** The subset of `StorageManager` this helper needs — real or a test double, `persist` optional to represent "unsupported". */
export interface PersistableStorageManager {
  readonly persist?: () => Promise<boolean>
}

export type PersistentStorageResult =
  | { readonly status: 'unsupported' }
  | { readonly status: 'granted' }
  | { readonly status: 'denied' }
  | { readonly status: 'error'; readonly error: unknown }

export async function requestPersistentStorage(storageManager: PersistableStorageManager | undefined): Promise<PersistentStorageResult> {
  if (storageManager === undefined || typeof storageManager.persist !== 'function') {
    return { status: 'unsupported' }
  }
  try {
    const granted = await storageManager.persist()
    return { status: granted ? 'granted' : 'denied' }
  } catch (error) {
    return { status: 'error', error }
  }
}
