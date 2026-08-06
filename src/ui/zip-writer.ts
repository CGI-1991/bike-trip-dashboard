/**
 * Minimal, dependency-free ZIP writer (STORE method only — no compression)
 * — CDC Jalon B4.3 section 15: builds a downloadable `.zip` client-side from
 * already-in-memory original GPX bytes. No package could be installed in
 * this environment (no npm access), and a STORE-only ZIP needs nothing but
 * CRC32 and a fixed set of fixed-size binary headers (APPNOTE.TXT §4.3),
 * which fits in a small, fully self-contained module — not "a framework".
 * GPX files are small text, so skipping compression costs nothing
 * meaningful in size.
 */

export interface ZipEntryInput {
  readonly name: string
  readonly data: Uint8Array
}

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = (c & 1) !== 0 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1
    table[n] = c >>> 0
  }
  return table
}

const CRC_TABLE = buildCrcTable()

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (let index = 0; index < data.length; index++) {
    crc = (CRC_TABLE[(crc ^ (data[index] ?? 0)) & 0xff] ?? 0) ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function dosDateTime(date: Date): { readonly time: number; readonly date: number } {
  const time = ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | ((Math.floor(date.getSeconds() / 2)) & 0x1f)
  const dosDate = (((Math.max(0, date.getFullYear() - 1980)) & 0x7f) << 9) | (((date.getMonth() + 1) & 0xf) << 5) | (date.getDate() & 0x1f)
  return { time, date: dosDate }
}

/** Deduplicates a file name against names already used in this archive — "day.gpx" seen twice becomes "day (2).gpx", never a silent overwrite inside the zip. */
function withSuffix(name: string, index: number): string {
  const dot = name.lastIndexOf('.')
  return dot === -1 ? `${name} (${index})` : `${name.slice(0, dot)} (${index})${name.slice(dot)}`
}

function partByteLength(part: ArrayBuffer | Uint8Array): number {
  return part instanceof ArrayBuffer ? part.byteLength : part.length
}

/** Builds one ZIP archive (STORE method) from `entries`, in order. `now` is injected (never `new Date()` internally) so archive contents stay deterministic and testable. */
export function buildZipArchive(entries: readonly ZipEntryInput[], now: Date): Blob {
  const seenNames = new Map<string, number>()
  const localParts: (ArrayBuffer | Uint8Array)[] = []
  const centralParts: (ArrayBuffer | Uint8Array)[] = []
  const encoder = new TextEncoder()
  const { time, date } = dosDateTime(now)
  let localOffset = 0

  for (const entry of entries) {
    const seenCount = seenNames.get(entry.name) ?? 0
    seenNames.set(entry.name, seenCount + 1)
    const name = seenCount === 0 ? entry.name : withSuffix(entry.name, seenCount + 1)
    const nameBytes = encoder.encode(name)
    const crc = crc32(entry.data)
    const size = entry.data.length

    const localHeader = new DataView(new ArrayBuffer(30))
    localHeader.setUint32(0, 0x04034b50, true)
    localHeader.setUint16(4, 20, true)
    localHeader.setUint16(6, 0, true)
    localHeader.setUint16(8, 0, true) // compression method: STORE
    localHeader.setUint16(10, time, true)
    localHeader.setUint16(12, date, true)
    localHeader.setUint32(14, crc, true)
    localHeader.setUint32(18, size, true)
    localHeader.setUint32(22, size, true)
    localHeader.setUint16(26, nameBytes.length, true)
    localHeader.setUint16(28, 0, true)

    localParts.push(localHeader.buffer, nameBytes, entry.data)

    const centralHeader = new DataView(new ArrayBuffer(46))
    centralHeader.setUint32(0, 0x02014b50, true)
    centralHeader.setUint16(4, 20, true)
    centralHeader.setUint16(6, 20, true)
    centralHeader.setUint16(8, 0, true)
    centralHeader.setUint16(10, 0, true) // compression method: STORE
    centralHeader.setUint16(12, time, true)
    centralHeader.setUint16(14, date, true)
    centralHeader.setUint32(16, crc, true)
    centralHeader.setUint32(20, size, true)
    centralHeader.setUint32(24, size, true)
    centralHeader.setUint16(28, nameBytes.length, true)
    centralHeader.setUint16(30, 0, true)
    centralHeader.setUint16(32, 0, true)
    centralHeader.setUint16(34, 0, true)
    centralHeader.setUint16(36, 0, true)
    centralHeader.setUint32(38, 0, true)
    centralHeader.setUint32(42, localOffset, true)

    centralParts.push(centralHeader.buffer, nameBytes)
    localOffset += 30 + nameBytes.length + size
  }

  const centralDirectorySize = centralParts.reduce((total, part) => total + partByteLength(part), 0)
  const endRecord = new DataView(new ArrayBuffer(22))
  endRecord.setUint32(0, 0x06054b50, true)
  endRecord.setUint16(4, 0, true)
  endRecord.setUint16(6, 0, true)
  endRecord.setUint16(8, entries.length, true)
  endRecord.setUint16(10, entries.length, true)
  endRecord.setUint32(12, centralDirectorySize, true)
  endRecord.setUint32(16, localOffset, true)
  endRecord.setUint16(20, 0, true)

  return new Blob([...localParts, ...centralParts, endRecord.buffer], { type: 'application/zip' })
}
