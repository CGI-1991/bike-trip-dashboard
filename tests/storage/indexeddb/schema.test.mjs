import './support/setup-fake-indexeddb.mjs'

import assert from 'node:assert/strict'
import test from 'node:test'

import { IDBFactory } from 'fake-indexeddb'

import { DATABASE_NAME, DATABASE_VERSION, OBJECT_STORE_NAMES } from '../../../src/storage/indexeddb/constants.ts'
import { MIGRATIONS, assertMigrationRegistryIsWellFormed, runMigrations } from '../../../src/storage/indexeddb/migrations.ts'
import { openBikeTripDatabase } from '../../../src/storage/indexeddb/open-database.ts'
import { SCHEMA_V1 } from '../../../src/storage/indexeddb/schema.ts'

test('opening a brand-new (empty) factory creates the database at the current version', async () => {
  const factory = new IDBFactory()
  const db = await openBikeTripDatabase(factory, { now: () => '2027-01-01T00:00:00.000Z' })
  assert.equal(db.name, DATABASE_NAME)
  assert.equal(db.version, DATABASE_VERSION)
  db.close()
})

test('every store declared in SCHEMA_V1 exists on a freshly opened database', async () => {
  const factory = new IDBFactory()
  const db = await openBikeTripDatabase(factory, { now: () => '2027-01-01T00:00:00.000Z' })
  const actualStoreNames = [...db.objectStoreNames].sort()
  const expectedStoreNames = SCHEMA_V1.map((descriptor) => descriptor.name).sort()
  assert.deepEqual(actualStoreNames, expectedStoreNames)
  assert.deepEqual(actualStoreNames, Object.values(OBJECT_STORE_NAMES).sort())
  db.close()
})

test('every index declared in SCHEMA_V1 exists on the matching store', async () => {
  const factory = new IDBFactory()
  const db = await openBikeTripDatabase(factory, { now: () => '2027-01-01T00:00:00.000Z' })
  const tx = db.transaction([...db.objectStoreNames], 'readonly')
  for (const descriptor of SCHEMA_V1) {
    const store = tx.objectStore(descriptor.name)
    assert.deepEqual([...store.indexNames].sort(), descriptor.indexes.map((index) => index.name).sort(), `store ${descriptor.name}`)
    for (const index of descriptor.indexes) {
      const actualIndex = store.index(index.name)
      assert.equal(actualIndex.unique, index.unique, `${descriptor.name}.${index.name}.unique`)
    }
  }
  db.close()
})

test('reopening the same factory is idempotent: same stores, same version, no duplication', async () => {
  const factory = new IDBFactory()
  const first = await openBikeTripDatabase(factory, { now: () => '2027-01-01T00:00:00.000Z' })
  const firstStores = [...first.objectStoreNames].sort()
  first.close()

  const second = await openBikeTripDatabase(factory, { now: () => '2027-06-01T00:00:00.000Z' })
  assert.equal(second.version, DATABASE_VERSION)
  assert.deepEqual([...second.objectStoreNames].sort(), firstStores)
  second.close()
})

test('the upgrade only ever runs once: reopening does not re-record the migration with a new timestamp', async () => {
  const factory = new IDBFactory()
  const first = await openBikeTripDatabase(factory, { now: () => '2027-01-01T00:00:00.000Z' })
  first.close()

  const second = await openBikeTripDatabase(factory, { now: () => '2099-12-31T00:00:00.000Z' })
  const tx = second.transaction([OBJECT_STORE_NAMES.schemaMigrations], 'readonly')
  const records = await new Promise((resolve, reject) => {
    const request = tx.objectStore(OBJECT_STORE_NAMES.schemaMigrations).getAll()
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  assert.equal(records.length, 1)
  assert.equal(records[0].version, 1)
  assert.equal(records[0].appliedAt, '2027-01-01T00:00:00.000Z')
  second.close()
})

test('data written in one session survives closing and reopening the same factory', async () => {
  const factory = new IDBFactory()
  const first = await openBikeTripDatabase(factory, { now: () => '2027-01-01T00:00:00.000Z' })
  await new Promise((resolve, reject) => {
    const tx = first.transaction([OBJECT_STORE_NAMES.providerCache], 'readwrite')
    tx.objectStore(OBJECT_STORE_NAMES.providerCache).put({ cacheKey: 'k', tripId: null, payload: { hello: 'world' }, storedAt: '2027-01-01T00:00:00.000Z', expiresAt: null })
    tx.oncomplete = resolve
    tx.onerror = () => reject(tx.error)
  })
  first.close()

  const second = await openBikeTripDatabase(factory, { now: () => '2027-01-02T00:00:00.000Z' })
  const record = await new Promise((resolve, reject) => {
    const request = second.transaction([OBJECT_STORE_NAMES.providerCache], 'readonly').objectStore(OBJECT_STORE_NAMES.providerCache).get('k')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  assert.deepEqual(record.payload, { hello: 'world' })
  second.close()
})

test('a versionchange from another connection closes the old handle via its own onversionchange handler', async () => {
  const factory = new IDBFactory()
  const first = await openBikeTripDatabase(factory, { now: () => '2027-01-01T00:00:00.000Z' })

  let versionchangeFiredOnFirst = false
  first.addEventListener('versionchange', () => {
    versionchangeFiredOnFirst = true
  })

  // A raw connection requesting a higher version fires `first`'s
  // versionchange event; `first`'s handler (installed by
  // openBikeTripDatabase) reacts by calling `close()` — this is the exact
  // mechanism that lets a second tab/session upgrade the schema without a
  // stale first connection blocking it forever. If it didn't, `bump` would
  // sit in `onblocked` until this test's own timeout fails it; reaching
  // `onupgradeneeded`/`onsuccess` below is itself proof `first` got closed.
  // (`close()` is a deliberate, application-initiated closure — per the IDB
  // spec, the `close` event only fires for an *unexpected* shutdown, so it
  // is not the right signal to assert on here.)
  const bump = factory.open(DATABASE_NAME, DATABASE_VERSION + 1)
  let blockedFired = false
  await new Promise((resolve, reject) => {
    bump.onupgradeneeded = (event) => {
      // Don't actually create a real v2 migration here — just prove the
      // upgrade transaction was reachable, i.e. `first` got out of the way.
      assert.equal(event.oldVersion, DATABASE_VERSION)
      resolve()
    }
    bump.onerror = () => reject(bump.error)
    bump.onblocked = () => {
      blockedFired = true
    }
  })

  assert.equal(versionchangeFiredOnFirst, true)
  assert.equal(blockedFired, false, 'first should have closed itself before bump ever needed to report blocked')
  assert.throws(() => first.transaction([OBJECT_STORE_NAMES.trips], 'readonly'), /InvalidStateError/)

  bump.result.close()
})

test('a future, unhandled database version is refused rather than silently accepted', async () => {
  const factory = new IDBFactory()
  await new Promise((resolve, reject) => {
    const request = factory.open(DATABASE_NAME, MIGRATIONS.length + 1)
    request.onupgradeneeded = (event) => {
      assert.throws(
        () => runMigrations(request.result, request.transaction, event.oldVersion, event.newVersion, '2027-01-01T00:00:00.000Z'),
        /non gérée/,
      )
      resolve()
    }
    request.onerror = () => resolve()
    // `runMigrations` throwing was caught (above) purely to assert its
    // message — fake-indexeddb still considers this upgrade transaction
    // "complete" (nothing rethrown into it) and fires `onsuccess`. Close
    // that handle immediately rather than leaving it open: an
    // unreachable-but-open IDBDatabase connection is exactly the kind of
    // leaked resource that keeps the process alive past every test's own
    // completion.
    request.onsuccess = () => {
      request.result.close()
      resolve()
    }
  })
})

test('the migration registry is ordered and contiguous from 1', () => {
  assert.doesNotThrow(() => assertMigrationRegistryIsWellFormed(MIGRATIONS))
  assert.deepEqual(
    MIGRATIONS.map((migration) => migration.version),
    MIGRATIONS.map((_, index) => index + 1),
  )
})

test('a malformed registry (gap or out-of-order version) is rejected', () => {
  assert.throws(() => assertMigrationRegistryIsWellFormed([{ version: 2, description: '', apply: () => {} }]), /incohérent/)
  assert.throws(
    () =>
      assertMigrationRegistryIsWellFormed([
        { version: 1, description: '', apply: () => {} },
        { version: 3, description: '', apply: () => {} },
      ]),
    /incohérent/,
  )
})
