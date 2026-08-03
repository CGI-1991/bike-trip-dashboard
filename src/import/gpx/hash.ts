/**
 * SHA-256 over raw file bytes, via the Web Crypto API — available as
 * `globalThis.crypto.subtle` in every target browser and in Node (>=20)
 * alike, so this one implementation needs no environment branch. Never
 * converts the file to text first: hashing the exact bytes is what makes
 * this comparable to a byte-for-byte duplicate check (CDC section 6).
 */
export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}
