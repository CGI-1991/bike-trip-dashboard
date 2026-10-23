import assert from 'node:assert/strict'
import test from 'node:test'
import { buildZipArchive } from '../../src/archive/zip-writer.ts'
import { readStoredZipArchive, InvalidArchiveError } from '../../src/archive/zip-reader.ts'

const data=new TextEncoder().encode('original file bytes')
const archive=()=>buildZipArchive([{name:'manifest.json',data},{name:'sources/1/1.bin',data}],new Date('2028-10-23T10:00:00Z'))

test('the strict reader preserves original bytes from the existing ZIP writer',async()=>{
  const entries=readStoredZipArchive(await archive().arrayBuffer(),10)
  assert.deepEqual(entries.get('manifest.json'),data)
  assert.deepEqual(entries.get('sources/1/1.bin'),data)
})

test('truncated, corrupt, overlapping and compressed entries are refused without extraction',async()=>{
  const original=await archive().arrayBuffer()
  for(const length of [0,1,21,30,original.byteLength-1])assert.throws(()=>readStoredZipArchive(original.slice(0,length),10),InvalidArchiveError)
  const corrupt=original.slice(0);new Uint8Array(corrupt)[45]^=1
  assert.throws(()=>readStoredZipArchive(corrupt,10),InvalidArchiveError)
  const compressed=original.slice(0);new DataView(compressed).setUint16(8,8,true)
  assert.throws(()=>readStoredZipArchive(compressed,10),InvalidArchiveError)
  assert.throws(()=>readStoredZipArchive(original,1),InvalidArchiveError)
})

test('unsafe paths are rejected even when the ZIP headers and checksum are otherwise valid',async()=>{
  for(const name of ['../escape.bin','/absolute.bin','source/../file','back\\slash.bin']) {
    const file=buildZipArchive([{name,data}],new Date('2028-10-23T10:00:00Z'))
    const buffer=await file.arrayBuffer()
    assert.throws(()=>readStoredZipArchive(buffer,10),InvalidArchiveError)
  }
})
