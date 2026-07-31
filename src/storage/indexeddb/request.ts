/** Wraps a single `IDBRequest` in a Promise settling on `success`/`error`. */
export function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('La requête IndexedDB a échoué.'))
  })
}
