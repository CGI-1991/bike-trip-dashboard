import { crc32 } from './zip-writer.ts'

export class InvalidArchiveError extends Error {
  constructor(message = 'Archive de sauvegarde invalide, incomplète ou non prise en charge.') {
    super(message)
    this.name = 'InvalidArchiveError'
  }
}

/** ZIP32 STORE only, matching our writer. Validate central/local headers,
 * bounds, names and CRC before exposing views of the original bytes. Never
 * extract to paths or allocate based on an untrusted uncompressed size. */
export function readStoredZipArchive(buffer: ArrayBuffer, maximumEntries: number): ReadonlyMap<string, Uint8Array<ArrayBuffer>> {
  const bytes = new Uint8Array(buffer)
  const view = new DataView(buffer)
  const fail = (): never => { throw new InvalidArchiveError() }
  const fits = (offset: number, length: number) => offset >= 0 && length >= 0 && offset + length <= bytes.length
  let end = -1
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset--) {
    if (view.getUint32(offset, true) === 0x06054b50 && offset + 22 + view.getUint16(offset + 20, true) === bytes.length) { end = offset; break }
  }
  if (end < 0) return fail()
  const count = view.getUint16(end + 10, true)
  const centralSize = view.getUint32(end + 12, true)
  const centralStart = view.getUint32(end + 16, true)
  if (view.getUint16(end + 4, true) !== 0 || view.getUint16(end + 6, true) !== 0
    || view.getUint16(end + 8, true) !== count || count > maximumEntries
    || centralStart + centralSize !== end) return fail()
  const entries = new Map<string, Uint8Array<ArrayBuffer>>()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let offset = centralStart
  let localEnd = 0
  for (let index = 0; index < count; index++) {
    if (!fits(offset, 46) || offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) return fail()
    const flags = view.getUint16(offset + 8, true)
    const method = view.getUint16(offset + 10, true)
    const crc = view.getUint32(offset + 16, true)
    const size = view.getUint32(offset + 24, true)
    const nameSize = view.getUint16(offset + 28, true)
    const extraSize = view.getUint16(offset + 30, true)
    const commentSize = view.getUint16(offset + 32, true)
    const local = view.getUint32(offset + 42, true)
    if ((flags & ~0x0800) !== 0 || method !== 0 || size !== view.getUint32(offset + 20, true)
      || view.getUint16(offset + 34, true) !== 0 || !fits(offset + 46, nameSize + extraSize + commentSize)
      || offset + 46 + nameSize + extraSize + commentSize > end || !fits(local, 30) || local !== localEnd
      || view.getUint32(local, true) !== 0x04034b50) return fail()
    let name: string
    try { name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameSize)) }
    catch { return fail() }
    if (name.length === 0 || name.startsWith('/') || name.includes('\\') || name.includes('\0')
      || name.split('/').some(part => part === '.' || part === '..' || part === '') || entries.has(name)) return fail()
    const localNameSize = view.getUint16(local + 26, true)
    const localExtraSize = view.getUint16(local + 28, true)
    const start = local + 30 + localNameSize + localExtraSize
    if (view.getUint16(local + 6, true) !== flags || view.getUint16(local + 8, true) !== method
      || view.getUint32(local + 14, true) !== crc || view.getUint32(local + 18, true) !== size || view.getUint32(local + 22, true) !== size
      || !fits(local + 30, localNameSize + localExtraSize) || !fits(start, size) || start + size > centralStart
      || localNameSize !== nameSize || !bytes.subarray(local + 30, local + 30 + localNameSize).every((byte, i) => byte === bytes[offset + 46 + i])) return fail()
    const data = bytes.subarray(start, start + size)
    if (crc32(data) !== crc) throw new InvalidArchiveError('La sauvegarde est endommagée : le contenu d’un fichier a changé.')
    entries.set(name, data)
    localEnd = start + size
    offset += 46 + nameSize + extraSize + commentSize
  }
  if (offset !== end || localEnd !== centralStart) return fail()
  return entries
}
