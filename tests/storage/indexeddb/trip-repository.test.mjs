import './support/setup-fake-indexeddb.mjs'

import assert from 'node:assert/strict'
import test from 'node:test'

import { tripId as makeTripId } from '../../../src/trip-core/index.ts'
import { createSourceFileRepository } from '../../../src/storage/indexeddb/source-file-repository.ts'
import { TripValidationError, createTripRepository } from '../../../src/storage/indexeddb/trip-repository.ts'
import { createGenericTripBundle } from '../../trip-core/support/generic-trip-fixture.mjs'
import { openTestDatabase } from './support/open-test-database.mjs'

function withTripId(bundle, newTripId, newSlug) {
  return { ...bundle, metadata: { ...bundle.metadata, id: newTripId, slug: newSlug } }
}

test('saveTripBundle then loadTripBundle round-trips a dated bundle: deepEqual, validated, deterministic order', async () => {
  const db = await openTestDatabase()
  try {
    const repo = createTripRepository(db)
    const bundle = createGenericTripBundle({ dated: true })

    await repo.saveTripBundle(bundle)
    const loadedOnce = await repo.loadTripBundle(bundle.metadata.id)
    const loadedTwice = await repo.loadTripBundle(bundle.metadata.id)

    assert.deepEqual(loadedOnce, bundle)
    assert.deepEqual(loadedTwice, bundle)
    // Order is exactly the source order, not merely "some order the validator accepts".
    assert.deepEqual(loadedOnce.days.map((day) => day.id), bundle.days.map((day) => day.id))
    assert.deepEqual(loadedOnce.stages.map((stage) => stage.id), bundle.stages.map((stage) => stage.id))
  } finally {
    db.close()
  }
})

test('saveTripBundle then loadTripBundle round-trips the undated variant', async () => {
  const db = await openTestDatabase()
  try {
    const repo = createTripRepository(db)
    const bundle = createGenericTripBundle({ dated: false })
    await repo.saveTripBundle(bundle)
    const loaded = await repo.loadTripBundle(bundle.metadata.id)
    assert.deepEqual(loaded, bundle)
  } finally {
    db.close()
  }
})

test('loadTripBundle returns null for a trip that was never saved', async () => {
  const db = await openTestDatabase()
  try {
    const repo = createTripRepository(db)
    const loaded = await repo.loadTripBundle(makeTripId('never-saved'))
    assert.equal(loaded, null)
  } finally {
    db.close()
  }
})

test('saveTripBundle never mutates the bundle it is given', async () => {
  const db = await openTestDatabase()
  try {
    const repo = createTripRepository(db)
    const bundle = createGenericTripBundle({ dated: true })
    const snapshot = JSON.parse(JSON.stringify(bundle))
    await repo.saveTripBundle(bundle)
    assert.deepEqual(bundle, snapshot)
  } finally {
    db.close()
  }
})

test('a bundle rejected by validateTripBundle is refused before any transaction — nothing is written', async () => {
  const db = await openTestDatabase()
  try {
    const repo = createTripRepository(db)
    const invalidBundle = { ...createGenericTripBundle({ dated: true }), schemaVersion: 2 }

    await assert.rejects(() => repo.saveTripBundle(invalidBundle), TripValidationError)
    assert.equal(await repo.hasTrip(invalidBundle.metadata.id), false)
    assert.deepEqual(await repo.listTrips(), [])
  } finally {
    db.close()
  }
})

test('an error thrown mid-write aborts the transaction: no partial write, the previous version survives', async () => {
  const db = await openTestDatabase()
  try {
    const repo = createTripRepository(db)
    const original = createGenericTripBundle({ dated: true })
    await repo.saveTripBundle(original)

    // `TripOverride.value` is `unknown` — validateTripBundle never inspects
    // its shape, so a non-clonable value (a function) sails through
    // validation but fails IndexedDB's own structured-clone step mid-write,
    // a realistic failure this repository does not itself guard against.
    const broken = {
      ...original,
      overrides: [
        ...original.overrides,
        {
          id: 'override-not-clonable',
          targetType: 'route-point',
          targetId: original.routePoints[0].id,
          field: 'name',
          value: () => 'not clonable',
          reason: null,
          createdAt: '2027-01-05T00:00:00.000Z',
        },
      ],
    }

    await assert.rejects(() => repo.saveTripBundle(broken));

    const stillLoaded = await repo.loadTripBundle(original.metadata.id)
    assert.deepEqual(stillLoaded, original, 'the aborted write must leave the previously-saved bundle completely intact')
  } finally {
    db.close()
  }
})

test('two trips reusing identical entity ids never collide: isolated storage, isolated load, isolated delete', async () => {
  const db = await openTestDatabase()
  try {
    const repo = createTripRepository(db)
    const tripA = createGenericTripBundle({ dated: true })
    const tripB = withTripId(createGenericTripBundle({ dated: true }), makeTripId('trip-b'), 'trip-b')

    // Same literal day/stage/route/etc ids in both fixtures by construction.
    assert.deepEqual(
      tripA.days.map((day) => day.id),
      tripB.days.map((day) => day.id),
    )

    await repo.saveTripBundle(tripA)
    await repo.saveTripBundle(tripB)

    const loadedA = await repo.loadTripBundle(tripA.metadata.id)
    const loadedB = await repo.loadTripBundle(tripB.metadata.id)
    assert.deepEqual(loadedA, tripA)
    assert.deepEqual(loadedB, tripB)

    const trips = await repo.listTrips()
    assert.equal(trips.length, 2)

    const deleted = await repo.deleteTrip(tripA.metadata.id)
    assert.equal(deleted, true)
    assert.equal(await repo.loadTripBundle(tripA.metadata.id), null)
    // tripB, sharing every entity id with the now-deleted tripA, must be untouched.
    assert.deepEqual(await repo.loadTripBundle(tripB.metadata.id), tripB)
  } finally {
    db.close()
  }
})

test('saving a replacement bundle fully replaces the previous one: stale entities gone, new entities present', async () => {
  const db = await openTestDatabase()
  try {
    const repo = createTripRepository(db)
    const original = createGenericTripBundle({ dated: true })
    await repo.saveTripBundle(original)

    const replacement = {
      ...original,
      metadata: { ...original.metadata, name: 'Renamed trip', updatedAt: '2027-02-01T00:00:00.000Z' },
      // Drop the second practical place... generic fixture only has one, so
      // instead prove removal via overrides (drop the only one) and prove
      // addition via a brand-new one.
      overrides: [
        {
          id: 'override-brand-new',
          targetType: 'accommodation',
          targetId: original.accommodations[0].id,
          field: 'notes',
          value: 'Replaced.',
          reason: null,
          createdAt: '2027-02-01T00:00:00.000Z',
        },
      ],
    }
    await repo.saveTripBundle(replacement)

    const loaded = await repo.loadTripBundle(original.metadata.id)
    assert.deepEqual(loaded, replacement)
    assert.equal(loaded.overrides.length, 1)
    assert.equal(loaded.overrides[0].id, 'override-brand-new')
    assert.equal(loaded.metadata.name, 'Renamed trip')
  } finally {
    db.close()
  }
})

test('source payload contract on replacement: preserved when untouched, replaced when provided, removed when orphaned', async () => {
  const db = await openTestDatabase()
  try {
    const repo = createTripRepository(db)
    const sourceFileRepo = createSourceFileRepository(db)
    const original = createGenericTripBundle({ dated: true })
    const [sourceFile1, sourceFile2] = original.sourceFiles

    const originalPayload1 = new TextEncoder().encode('original-alpha-content').buffer
    const originalPayload2 = new TextEncoder().encode('original-delta-content').buffer
    await repo.saveTripBundle(original, {
      sourcePayloads: [
        { sourceFileId: sourceFile1.id, content: originalPayload1 },
        { sourceFileId: sourceFile2.id, content: originalPayload2 },
      ],
    })

    // Replace: keep sourceFile1 (payload not re-provided -> must be
    // preserved), drop sourceFile2 entirely (its route now has no source
    // file -> its payload must be removed as orphaned), and provide a new
    // payload for sourceFile1 is NOT done here on purpose to test pure
    // preservation; a second save right after tests replacement.
    const droppedSourceFile2 = {
      ...original,
      sourceFiles: [sourceFile1],
      routes: original.routes.map((route) => (route.sourceFileId === sourceFile2.id ? { ...route, sourceFileId: null } : route)),
    }
    await repo.saveTripBundle(droppedSourceFile2)

    const preserved1 = await sourceFileRepo.getSourceFilePayload(original.metadata.id, sourceFile1.id)
    assert.ok(preserved1)
    assert.equal(Buffer.from(preserved1.content).toString(), 'original-alpha-content')

    const removed2 = await sourceFileRepo.getSourceFilePayload(original.metadata.id, sourceFile2.id)
    assert.equal(removed2, null)

    // Now replace sourceFile1's payload explicitly.
    const newPayload1 = new TextEncoder().encode('replaced-alpha-content').buffer
    await repo.saveTripBundle(droppedSourceFile2, { sourcePayloads: [{ sourceFileId: sourceFile1.id, content: newPayload1 }] })
    const replaced1 = await sourceFileRepo.getSourceFilePayload(original.metadata.id, sourceFile1.id)
    assert.equal(Buffer.from(replaced1.content).toString(), 'replaced-alpha-content')
  } finally {
    db.close()
  }
})

test('deleteTrip cascades across every store and returns whether the trip existed', async () => {
  const db = await openTestDatabase()
  try {
    const repo = createTripRepository(db)
    const sourceFileRepo = createSourceFileRepository(db)
    const bundle = createGenericTripBundle({ dated: true })
    const payload = new TextEncoder().encode('gpx-bytes').buffer
    await repo.saveTripBundle(bundle, { sourcePayloads: [{ sourceFileId: bundle.sourceFiles[0].id, content: payload }] })

    const firstDelete = await repo.deleteTrip(bundle.metadata.id)
    assert.equal(firstDelete, true)
    assert.equal(await repo.loadTripBundle(bundle.metadata.id), null)
    assert.equal(await repo.hasTrip(bundle.metadata.id), false)
    assert.equal(await sourceFileRepo.getSourceFilePayload(bundle.metadata.id, bundle.sourceFiles[0].id), null)

    const secondDelete = await repo.deleteTrip(bundle.metadata.id)
    assert.equal(secondDelete, false)
  } finally {
    db.close()
  }
})

test('deleteTrip never touches another trip sharing every entity id', async () => {
  const db = await openTestDatabase()
  try {
    const repo = createTripRepository(db)
    const tripA = createGenericTripBundle({ dated: true })
    const tripB = withTripId(createGenericTripBundle({ dated: true }), makeTripId('trip-b-delete'), 'trip-b-delete')
    await repo.saveTripBundle(tripA)
    await repo.saveTripBundle(tripB)

    await repo.deleteTrip(tripA.metadata.id)

    assert.deepEqual(await repo.loadTripBundle(tripB.metadata.id), tripB)
    const trips = await repo.listTrips()
    assert.deepEqual(
      trips.map((metadata) => metadata.id),
      [tripB.metadata.id],
    )
  } finally {
    db.close()
  }
})

test('hasTrip reflects existence without requiring a full load', async () => {
  const db = await openTestDatabase()
  try {
    const repo = createTripRepository(db)
    const bundle = createGenericTripBundle({ dated: true })
    assert.equal(await repo.hasTrip(bundle.metadata.id), false)
    await repo.saveTripBundle(bundle)
    assert.equal(await repo.hasTrip(bundle.metadata.id), true)
  } finally {
    db.close()
  }
})
