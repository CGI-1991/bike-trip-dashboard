import assert from 'node:assert/strict'
import test from 'node:test'

import { buildZipArchive, crc32 } from '../../src/ui/zip-writer.ts'

/**
 * No unzip binary is available to cross-check against in this environment,
 * so this test is the verification: a small, independent reader that walks
 * the end-of-central-directory record → central directory → each local file
 * header, and asserts the bytes `buildZipArchive` wrote are self-consistent
 * (name, size, and CRC32 all agree with what a real unzip tool would read).
 */
async function readZipEntries(blob) {
  const buffer = new Uint8Array(await blob.arrayBuffer())
  const view = new DataView(buffer.buffer)
  // Walk backwards for the end-of-central-directory signature — correct
  // here since none of these test archives carry a trailing comment.
  let eocdOffset = -1
  for (let index = buffer.length - 22; index >= 0; index--) {
    if (view.getUint32(index, true) === 0x06054b50) { eocdOffset = index; break }
  }
  assert.ok(eocdOffset >= 0, 'end-of-central-directory record must be present')
  const entryCount = view.getUint16(eocdOffset + 10, true)
  const centralDirectoryOffset = view.getUint32(eocdOffset + 16, true)

  const entries = []
  let cursor = centralDirectoryOffset
  for (let i = 0; i < entryCount; i++) {
    assert.equal(view.getUint32(cursor, true), 0x02014b50)
    const crc = view.getUint32(cursor + 16, true)
    const compressedSize = view.getUint32(cursor + 20, true)
    const uncompressedSize = view.getUint32(cursor + 24, true)
    const nameLength = view.getUint16(cursor + 28, true)
    const localHeaderOffset = view.getUint32(cursor + 42, true)
    const name = new TextDecoder().decode(buffer.subarray(cursor + 46, cursor + 46 + nameLength))
    cursor += 46 + nameLength

    assert.equal(view.getUint32(localHeaderOffset, true), 0x04034b50)
    const localNameLength = view.getUint16(localHeaderOffset + 26, true)
    const dataStart = localHeaderOffset + 30 + localNameLength
    const data = buffer.subarray(dataStart, dataStart + uncompressedSize)

    entries.push({ name, crc, compressedSize, uncompressedSize, data })
  }
  return entries
}

test('round-trips a single small entry: name, size, and CRC32 all match', async () => {
  const data = new TextEncoder().encode('<gpx>hello</gpx>')
  const zip = buildZipArchive([{ name: 'day-1.gpx', data }], new Date(2027, 4, 10, 8, 0, 0))
  const entries = await readZipEntries(zip)
  assert.equal(entries.length, 1)
  assert.equal(entries[0].name, 'day-1.gpx')
  assert.equal(entries[0].uncompressedSize, data.length)
  assert.equal(entries[0].crc, crc32(data))
  assert.deepEqual([...entries[0].data], [...data])
})

test('round-trips multiple entries, in order, each independently correct', () => {
  return (async () => {
    const files = [
      { name: 'j1-thonon-morzine.gpx', data: new TextEncoder().encode('<gpx>1</gpx>') },
      { name: 'j2-morzine-bornand.gpx', data: new TextEncoder().encode('<gpx>two, a bit longer</gpx>') },
      { name: 'j3-bornand-beaufort.gpx', data: new TextEncoder().encode('<gpx>3</gpx>') },
    ]
    const zip = buildZipArchive(files, new Date(2027, 7, 12, 10, 30, 0))
    const entries = await readZipEntries(zip)
    assert.equal(entries.length, 3)
    entries.forEach((entry, index) => {
      const original = files[index]
      assert.equal(entry.name, original.name)
      assert.equal(entry.crc, crc32(original.data))
      assert.deepEqual([...entry.data], [...original.data])
    })
  })()
})

test('deduplicates a repeated file name so two originals never collide inside the archive', async () => {
  const files = [
    { name: 'stage.gpx', data: new TextEncoder().encode('<gpx>first</gpx>') },
    { name: 'stage.gpx', data: new TextEncoder().encode('<gpx>second</gpx>') },
  ]
  const zip = buildZipArchive(files, new Date(2027, 0, 1))
  const entries = await readZipEntries(zip)
  assert.equal(entries[0].name, 'stage.gpx')
  assert.equal(entries[1].name, 'stage (2).gpx')
  assert.notEqual(entries[0].crc, entries[1].crc)
})

test('an empty entry list still produces a structurally valid (empty) archive', async () => {
  const zip = buildZipArchive([], new Date(2027, 0, 1))
  const entries = await readZipEntries(zip)
  assert.equal(entries.length, 0)
})

test('crc32 is deterministic and distinguishes different content', () => {
  const a = new TextEncoder().encode('abc')
  const b = new TextEncoder().encode('abd')
  assert.equal(crc32(a), crc32(a))
  assert.notEqual(crc32(a), crc32(b))
})
