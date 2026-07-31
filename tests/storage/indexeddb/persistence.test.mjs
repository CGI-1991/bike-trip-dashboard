import assert from 'node:assert/strict'
import test from 'node:test'

import { requestPersistentStorage } from '../../../src/storage/indexeddb/persistence.ts'

test('an undefined storage manager reports unsupported', async () => {
  assert.deepEqual(await requestPersistentStorage(undefined), { status: 'unsupported' })
})

test('a storage manager with no persist method reports unsupported', async () => {
  assert.deepEqual(await requestPersistentStorage({}), { status: 'unsupported' })
})

test('a granted persist() call reports granted', async () => {
  const result = await requestPersistentStorage({ persist: async () => true })
  assert.deepEqual(result, { status: 'granted' })
})

test('a denied persist() call reports denied', async () => {
  const result = await requestPersistentStorage({ persist: async () => false })
  assert.deepEqual(result, { status: 'denied' })
})

test('a persist() call that throws is captured as an error result, never an unhandled rejection', async () => {
  const failure = new Error('storage manager unavailable')
  const result = await requestPersistentStorage({
    persist: async () => {
      throw failure
    },
  })
  assert.equal(result.status, 'error')
  assert.equal(result.error, failure)
})
