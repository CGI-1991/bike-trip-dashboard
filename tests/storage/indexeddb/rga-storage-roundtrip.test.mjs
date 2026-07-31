import './support/setup-fake-indexeddb.mjs'

import assert from 'node:assert/strict'
import test from 'node:test'

import { validateTripBundle } from '../../../src/trip-core/index.ts'
import { createSourceFileRepository } from '../../../src/storage/indexeddb/source-file-repository.ts'
import { createTripRepository } from '../../../src/storage/indexeddb/trip-repository.ts'
import { loadRgaLegacyTrip } from '../../../src/trips/rga-2026/load-rga-legacy-trip.ts'
import { createFakePublicFetch, FAKE_PUBLIC_BASE_URL } from '../../support/fake-public-fetch.mjs'
import { openTestDatabase } from './support/open-test-database.mjs'

const projectRoot = new URL('../../../', import.meta.url)

test('the real RGA TripBundle survives a full IndexedDB save/reload round-trip unchanged, in order', async () => {
  const bundle = await loadRgaLegacyTrip(createFakePublicFetch(projectRoot), FAKE_PUBLIC_BASE_URL)
  const validated = validateTripBundle(bundle)
  assert.equal(validated.ok, true, 'the RGA bundle itself must already be valid before this test even touches storage')

  const db = await openTestDatabase()
  try {
    const repo = createTripRepository(db)
    await repo.saveTripBundle(bundle)
    const reloaded = await repo.loadTripBundle(bundle.metadata.id)

    // The whole point of this test: storage must reconstruct the exact same
    // bundle, not merely one `validateTripBundle` happens to still accept.
    assert.deepEqual(reloaded, bundle)

    const revalidated = validateTripBundle(reloaded)
    assert.equal(revalidated.ok, true)

    assert.equal(reloaded.days.length, 12)
    assert.equal(reloaded.days.filter((day) => day.type === 'ride').length, 10)
    assert.equal(reloaded.days.filter((day) => day.type === 'off').length, 2)
    assert.equal(reloaded.stages.length, 10)
    assert.equal(reloaded.routes.length, 10)
    assert.equal(reloaded.sourceFiles.length, 10)
    assert.equal(reloaded.routePoints.length, 46)
    assert.equal(reloaded.practicalPlaces.length, 1705)
    assert.equal(reloaded.accommodations.length, 10)
    assert.deepEqual(reloaded.settings, bundle.settings)

    // Order identical to the source, not merely "a superset with the right counts".
    assert.deepEqual(
      reloaded.days.map((day) => day.id),
      bundle.days.map((day) => day.id),
    )
    assert.deepEqual(
      reloaded.sourceFiles.map((file) => file.id),
      bundle.sourceFiles.map((file) => file.id),
    )
    assert.deepEqual(
      reloaded.practicalPlaces.map((place) => place.id),
      bundle.practicalPlaces.map((place) => place.id),
    )
  } finally {
    db.close()
  }
})

test('binary source payloads round-trip byte-identical (synthetic fixture — not the real 3.4 MB GPX set)', async () => {
  const bundle = await loadRgaLegacyTrip(createFakePublicFetch(projectRoot), FAKE_PUBLIC_BASE_URL)

  const db = await openTestDatabase()
  try {
    const repo = createTripRepository(db)
    const sourceFileRepo = createSourceFileRepository(db)

    // A small synthetic stand-in for a GPX payload — enough to prove the
    // Blob/ArrayBuffer round-trip is byte-identical, without pulling a real
    // multi-megabyte GPX file into this test (see the phase 5 report).
    const syntheticGpxBytes = new TextEncoder().encode(
      '<?xml version="1.0"?><gpx><trk><name>synthetic-fixture</name></trk></gpx>',
    )
    const arrayBufferPayload = syntheticGpxBytes.buffer.slice(
      syntheticGpxBytes.byteOffset,
      syntheticGpxBytes.byteOffset + syntheticGpxBytes.byteLength,
    )
    const blobPayload = new Blob([syntheticGpxBytes], { type: 'application/gpx+xml' })

    const [firstSourceFile, secondSourceFile] = bundle.sourceFiles
    await repo.saveTripBundle(bundle, {
      sourcePayloads: [
        { sourceFileId: firstSourceFile.id, content: arrayBufferPayload },
        { sourceFileId: secondSourceFile.id, content: blobPayload },
      ],
    })

    const storedAsArrayBuffer = await sourceFileRepo.getSourceFilePayload(bundle.metadata.id, firstSourceFile.id)
    assert.equal(storedAsArrayBuffer.contentType, 'arraybuffer')
    assert.deepEqual(new Uint8Array(storedAsArrayBuffer.content), syntheticGpxBytes)

    const storedAsBlob = await sourceFileRepo.getSourceFilePayload(bundle.metadata.id, secondSourceFile.id)
    assert.equal(storedAsBlob.contentType, 'blob')
    const roundTrippedBlobBytes = new Uint8Array(await storedAsBlob.content.arrayBuffer())
    assert.deepEqual(roundTrippedBlobBytes, syntheticGpxBytes)

    // A source file with no stored payload is a legitimate, explicit `null`.
    const thirdSourceFile = bundle.sourceFiles[2]
    assert.equal(await sourceFileRepo.getSourceFilePayload(bundle.metadata.id, thirdSourceFile.id), null)
  } finally {
    db.close()
  }
})
