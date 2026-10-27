import '../storage/indexeddb/support/setup-fake-indexeddb.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { openTestDatabase } from '../storage/indexeddb/support/open-test-database.mjs'
import { createGenericTripBundle } from '../trip-core/support/generic-trip-fixture.mjs'
import { createTripRepository } from '../../src/storage/indexeddb/trip-repository.ts'
import { prepareOriginalStageGpx, prepareOriginalTripGpx } from '../../src/export/original-gpx.ts'
import { readStoredZipArchive } from '../../src/archive/zip-reader.ts'

test('single and archived GPX preserve original bytes and chronological order, including duplicate names', async () => {
  const db = await openTestDatabase()
  try {
    const bundle = createGenericTripBundle()
    const originals = bundle.sourceFiles.map((source, i) => ({ sourceFileId: source.id, content: new TextEncoder().encode(`<gpx><!-- original ${i} --></gpx>`).buffer }))
    bundle.sourceFiles = bundle.sourceFiles.map(source => ({ ...source, originalName: 'Étape.gpx' }))
    bundle.stages.reverse()
    await createTripRepository(db).saveTripBundle(bundle, { sourcePayloads: originals })
    const single = await prepareOriginalStageGpx(db, bundle.metadata.id, bundle.days[0].id)
    assert.equal(single.filename, 'Étape.gpx')
    assert.equal(await single.blob.text(), '<gpx><!-- original 0 --></gpx>')
    const archive = await prepareOriginalTripGpx(db, bundle.metadata.id, '2026-10-27T12:00:00Z')
    const entries = readStoredZipArchive(await archive.blob.arrayBuffer(), 10)
    assert.deepEqual([...entries.keys()], ['Étape.gpx', 'Étape (2).gpx'])
    assert.deepEqual([...entries.values()].map(data => new TextDecoder().decode(data)), originals.map((_, i) => `<gpx><!-- original ${i} --></gpx>`))
  } finally { db.close() }
})

test('a missing original explicitly rejects a single export or the entire archive without modifying storage', async () => {
  const db = await openTestDatabase()
  try {
    const bundle = createGenericTripBundle()
    const repository = createTripRepository(db)
    await repository.saveTripBundle(bundle, { sourcePayloads: [{ sourceFileId: bundle.sourceFiles[0].id, content: new ArrayBuffer(4) }] })
    const before = await repository.loadTripBundle(bundle.metadata.id)
    await assert.rejects(prepareOriginalStageGpx(db, bundle.metadata.id, bundle.days[3].id), /GPX d’origine indisponible/)
    await assert.rejects(prepareOriginalTripGpx(db, bundle.metadata.id, '2026-10-27T12:00:00Z'), /Aucun fichier n’a été exporté/)
    assert.deepEqual(await repository.loadTripBundle(bundle.metadata.id), before)
  } finally { db.close() }
})
