import './support/setup-fake-indexeddb.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { openTestDatabase } from './support/open-test-database.mjs'
import { createGenericTripBundle } from '../../trip-core/support/generic-trip-fixture.mjs'
import { createTripRepository } from '../../../src/storage/indexeddb/trip-repository.ts'
import { createSourceFileRepository } from '../../../src/storage/indexeddb/source-file-repository.ts'
import { createTripBackup, prepareTripBackupRestore, restorePreparedTripBackup, MAX_BACKUP_BYTES } from '../../../src/backup/trip-backup.ts'
import { buildZipArchive } from '../../../src/archive/zip-writer.ts'
import { readStoredZipArchive } from '../../../src/archive/zip-reader.ts'
import { OBJECT_STORE_NAMES } from '../../../src/storage/indexeddb/constants.ts'
import { sharePreparedBackupFile, renderBackupSummary } from '../../../src/ui/trips/trip-backup-panel.ts'

const now = '2028-10-23T10:00:00.000Z'
const raw = new Uint8Array([0, 255, 1, 65, 13, 10, 195, 169])
const original = () => {
  const bundle = createGenericTripBundle()
  bundle.days[0].notes = 'Ne pas oublier le pique-nique'
  bundle.settings.stages = [{stageId: bundle.stages[0].id, pausePlanMode: 'custom', pauses: [{id: 'manual', active: true, routePointId: bundle.routePoints[0].id, durationSeconds: 600, order: 0, origin: 'custom'}]}]
  bundle.enrichmentMetadata.practicalPlacesGeneration = 3
  bundle.enrichmentMetadata.enrichmentJobs = [{stageId: bundle.stages[0].id, routeFingerprint: 'saved-fingerprint', planVersion: 2, jobs: [{kind: 'practical', startKm: 0, endKm: 10, status: 'waiting-for-network', attempts: 1}]}]
  return bundle
}
async function seed(database, bundle = original()) {
  await createTripRepository(database).saveTripBundle(bundle, { sourcePayloads: [
    {sourceFileId: bundle.sourceFiles[0].id, content: new Blob([raw], {type: 'application/gpx+xml'})},
    {sourceFileId: bundle.sourceFiles[1].id, content: raw.slice().buffer},
  ] })
  return bundle
}
const serial = () => {let i = 0; return () => `copy-${++i}`}
async function rewrite(file, mutate, extra = []) {
  const entries = readStoredZipArchive(await file.arrayBuffer(), 5000)
  const manifest = JSON.parse(new TextDecoder().decode(entries.get('manifest.json')))
  mutate(manifest, entries)
  return buildZipArchive([{name:'manifest.json',data:new TextEncoder().encode(JSON.stringify(manifest))}, ...[...entries].filter(([name])=>name!=='manifest.json').map(([name,data])=>({name,data})), ...extra], new Date(now))
}

test('full backup restores two trips with identical internal ids, all manual data, search progress and exact Blob/ArrayBuffer bytes', async () => {
  const source = await openTestDatabase(), target = await openTestDatabase()
  try {
    const first = await seed(source)
    const second = structuredClone(first); second.metadata.id = 'another-trip'; second.metadata.name = 'Autre voyage'
    await seed(source, second)
    const backup = await createTripBackup(source, now)
    assert.equal(backup.summary.sourceFileCount, 4)
    const prepared = await prepareTripBackupRestore(backup.file)
    assert.equal((await createTripRepository(target).listTrips()).length, 0, 'preview never writes')
    const ids = await restorePreparedTripBackup(target, prepared, serial(), now)
    assert.equal(ids.length, 2)
    for (let i=0;i<ids.length;i++) {
      const restored = await createTripRepository(target).loadTripBundle(ids[i])
      const expected = prepared.trips[i].bundle
      assert.deepEqual({...restored,metadata:expected.metadata},expected)
      assert.match(restored.metadata.name,/\(restauré\)$/)
      for (const [index, file] of expected.sourceFiles.entries()) {
        const payload = await createSourceFileRepository(target).getSourceFilePayload(ids[i],file.id)
        assert.equal(payload.contentType,index===0?'blob':'arraybuffer')
        assert.deepEqual(new Uint8Array(payload.content instanceof Blob?await payload.content.arrayBuffer():payload.content),raw)
        if(index===0)assert.equal(payload.content.type,'application/gpx+xml')
      }
    }
  } finally {source.close();target.close()}
})

test('restoring repeatedly adds copies and never changes existing journeys', async () => {
  const database = await openTestDatabase()
  try {
    const bundle = await seed(database)
    const prepared = await prepareTripBackupRestore((await createTripBackup(database,now)).file)
    const factory = serial()
    await restorePreparedTripBackup(database,prepared,factory,now)
    await restorePreparedTripBackup(database,prepared,factory,now)
    assert.equal((await createTripRepository(database).listTrips()).length,3)
    assert.deepEqual(await createTripRepository(database).loadTripBundle(bundle.metadata.id),bundle)
  } finally {database.close()}
})

test('a snapshot sees matching trip metadata and original files while another edit is queued', async () => {
  const database=await openTestDatabase()
  try {
    const bundle=await seed(database)
    const exporting=createTripBackup(database,now)
    const modified={...bundle,metadata:{...bundle.metadata,name:'Edited after snapshot'}}
    await createTripRepository(database).saveTripBundle(modified,{sourcePayloads:[{sourceFileId:bundle.sourceFiles[0].id,content:new Blob(['new GPX'])}]})
    const prepared=await prepareTripBackupRestore((await exporting).file)
    assert.equal(prepared.trips[0].bundle.metadata.name,bundle.metadata.name)
    assert.deepEqual(new Uint8Array(await prepared.trips[0].sourcePayloads[0].content.arrayBuffer()),raw)
    assert.equal((await createTripRepository(database).loadTripBundle(bundle.metadata.id)).metadata.name,'Edited after snapshot')
  }finally{database.close()}
})

test('missing original files are declared honestly and a single-trip export excludes other journeys', async () => {
  const database=await openTestDatabase()
  try {
    const bundle=original()
    await createTripRepository(database).saveTripBundle(bundle)
    const other=structuredClone(bundle);other.metadata.id='unrelated';await seed(database,other)
    const backup=await createTripBackup(database,now,bundle.metadata.id)
    assert.equal(backup.summary.tripNames.length,1)
    assert.equal(backup.summary.sourceFileCount,0)
    assert.equal(backup.summary.missingSourceFileCount,2)
    assert.equal((await prepareTripBackupRestore(backup.file)).summary.missingSourceFileCount,2)
    assert.match(renderBackupSummary(backup.summary),/indisponible/)
  }finally{database.close()}
})

test('an empty library and oversized input are refused without reading or writing extra data', async () => {
  const database=await openTestDatabase()
  try {
    await assert.rejects(createTripBackup(database,now),/Aucun voyage/)
    await assert.rejects(prepareTripBackupRestore({size:MAX_BACKUP_BYTES+1,arrayBuffer(){throw Error('must not read')}}),/64 Mio/)
  }finally{database.close()}
})

for(const [name,mutate,expected] of [
  ['future backup version',manifest=>{manifest.version=2},/Version de sauvegarde/],
  ['future trip version',manifest=>{manifest.trips[0].bundle.schemaVersion=999},/future/],
  ['invalid references',manifest=>{manifest.trips[0].bundle.stages[0].sourceRouteId='unknown'},/incompatible|incomplet/],
  ['duplicate trip',manifest=>{manifest.trips.push(manifest.trips[0])},/plusieurs fois/],
  ['missing binary', (manifest,entries)=>{entries.delete(manifest.trips[0].payloads[0].entry)},/manque|incomplet/],
  ['changed binary despite valid ZIP CRC', (manifest,entries)=>{const entry=manifest.trips[0].payloads[0];entries.set(entry.entry,new Uint8Array(entry.sizeBytes))},/endommagé/],
  ['undeclared source omission',manifest=>{manifest.trips[0].payloads.pop()},/incomplète/],
  ['duplicate source descriptor',manifest=>{manifest.trips[0].payloads.push(manifest.trips[0].payloads[0])},/invalide/],
  ['unexpected file',(_manifest,entries)=>{entries.set('unexpected.bin',raw)},/inattendus/],
]) {
  test(`restore refuses ${name} before any trip can be added`,async()=>{
    const database=await openTestDatabase()
    try {
      const bundle=await seed(database)
      const file=(await createTripBackup(database,now)).file
      await assert.rejects(prepareTripBackupRestore(await rewrite(file,mutate)),expected)
      assert.deepEqual(await createTripRepository(database).loadTripBundle(bundle.metadata.id),bundle)
      assert.equal((await createTripRepository(database).listTrips()).length,1)
    }finally{database.close()}
  })
}

test('a late quota failure rolls back every copied trip and its original binaries',async()=>{
  const database=await openTestDatabase()
  const prototype=Object.getPrototypeOf(database.transaction(OBJECT_STORE_NAMES.trips).objectStore(OBJECT_STORE_NAMES.trips))
  const put=prototype.put
  try {
    const bundle=await seed(database)
    const second=structuredClone(bundle);second.metadata.id='second';await seed(database,second)
    const prepared=await prepareTripBackupRestore((await createTripBackup(database,now)).file)
    prototype.put=function(value,...args){if(this.name===OBJECT_STORE_NAMES.practicalPlaces&&value.tripId==='restored-copy-2')throw new DOMException('Quota exceeded','QuotaExceededError');return put.call(this,value,...args)}
    await assert.rejects(restorePreparedTripBackup(database,prepared,serial(),now),{name:'QuotaExceededError'})
    assert.equal((await createTripRepository(database).listTrips()).length,2)
    assert.equal(await createSourceFileRepository(database).getSourceFilePayload('restored-copy-1',bundle.sourceFiles[0].id),null)
    assert.deepEqual(await createTripRepository(database).loadTripBundle(bundle.metadata.id),bundle)
  }finally{prototype.put=put;database.close()}
})

test('an id collision cannot overwrite an existing trip or partially restore the preceding copy',async()=>{
  const database=await openTestDatabase()
  try {
    const bundle=await seed(database)
    const second=structuredClone(bundle);second.metadata.id='second';await seed(database,second)
    const prepared=await prepareTripBackupRestore((await createTripBackup(database,now)).file)
    const conflict=structuredClone(bundle);conflict.metadata.id='restored-collision';await seed(database,conflict)
    let calls=0
    await assert.rejects(restorePreparedTripBackup(database,prepared,()=>++calls===1?'first':'collision',now),/existe déjà/)
    assert.equal(await createTripRepository(database).hasTrip('restored-first'),false)
    assert.deepEqual(await createTripRepository(database).loadTripBundle(conflict.metadata.id),conflict)
  }finally{database.close()}
})

test('download-ready sharing starts synchronously on the tap and cancellation does not become an error or a download',async()=>{
  const file=new File(['backup'],'backup.zip',{type:'application/zip'})
  let shared=false
  const sharing=sharePreparedBackupFile(file,{share:async data=>{assert.equal(data.files[0],file);shared=true}})
  assert.equal(shared,true)
  assert.equal(await sharing,'shared')
  assert.equal(await sharePreparedBackupFile(file,{share:async()=>{throw new DOMException('cancel','AbortError')}}),'cancelled')
  assert.doesNotMatch(renderBackupSummary({tripNames:['<img src=x onerror=alert(1)>'],sourceFileCount:0,missingSourceFileCount:0}),/<img/)
})
