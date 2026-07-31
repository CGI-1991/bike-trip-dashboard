import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, readdir, stat } from 'node:fs/promises'
import test from 'node:test'

const projectRoot = new URL('../../../', import.meta.url)
const readJson = async (relativePath) => JSON.parse(await readFile(new URL(relativePath, projectRoot), 'utf8'))
const readBytes = (relativePath) => readFile(new URL(relativePath, projectRoot))

test('manifest.json is present and declares manifestVersion 1', async () => {
  const manifest = await readJson('public/trips/rga-2026/manifest.json')
  assert.equal(manifest.manifestVersion, 1)
  assert.equal(manifest.tripId, 'rga-2026')
})

test('the manifest validates with parseRgaTripManifest', async () => {
  const { parseRgaTripManifest } = await import('../../../src/trips/rga-2026/load-rga-legacy-trip.ts')
  const raw = await readJson('public/trips/rga-2026/manifest.json')
  assert.doesNotThrow(() => parseRgaTripManifest(raw))
})

test('every manifest path is relative and base-safe — never absolute, never a Windows path', async () => {
  const manifest = await readJson('public/trips/rga-2026/manifest.json')
  const paths = [
    manifest.roadbookPath,
    manifest.accommodationsPath,
    manifest.practicalPlacesPath,
    manifest.overridesPath,
    manifest.settingsPath,
    ...manifest.gpx.map((entry) => entry.fileName),
  ]
  for (const path of paths) {
    assert.equal(path.startsWith('/'), false, `${path} must not start with /`)
    assert.equal(/^[a-zA-Z]:[\\/]/.test(path), false, `${path} must not be a Windows drive path`)
    assert.equal(path.includes('\\'), false, `${path} must not contain a backslash`)
    assert.equal(path.includes('U:'), false)
  }
})

test('the manifest never hardcodes an absolute GitHub Pages URL', async () => {
  const raw = await readFile(new URL('public/trips/rga-2026/manifest.json', projectRoot), 'utf8')
  assert.equal(raw.includes('github.io'), false)
  assert.equal(raw.includes('http://'), false)
  assert.equal(raw.includes('https://'), false)
})

test('the manifest declares exactly ten GPX entries, matching the historical manifest order', async () => {
  const manifest = await readJson('public/trips/rga-2026/manifest.json')
  const legacyManifest = await readJson('public/data/gpx/manifest.json')
  assert.equal(manifest.gpx.length, 10)
  assert.deepEqual(
    manifest.gpx.map((entry) => entry.fileName),
    legacyManifest.files.map((entry) => entry.fileName),
  )
  assert.equal(new Set(manifest.gpx.map((entry) => entry.fileName)).size, 10)
})

test('every file declared in the manifest actually exists under public/trips/rga-2026/', async () => {
  const manifest = await readJson('public/trips/rga-2026/manifest.json')
  const declaredPaths = [
    'manifest.json',
    manifest.roadbookPath,
    manifest.accommodationsPath,
    manifest.practicalPlacesPath,
    manifest.overridesPath,
    manifest.settingsPath,
    ...manifest.gpx.map((entry) => `gpx/${entry.fileName}`),
  ]
  for (const relativePath of declaredPaths) {
    const info = await stat(new URL(`public/trips/rga-2026/${relativePath}`, projectRoot))
    assert.ok(info.isFile(), `${relativePath} should exist and be a file`)
  }
})

test('each copied GPX file is byte-identical to its historical source', async () => {
  const manifest = await readJson('public/trips/rga-2026/manifest.json')
  for (const entry of manifest.gpx) {
    const original = await readBytes(`public/data/gpx/${entry.fileName}`)
    const copy = await readBytes(`public/trips/rga-2026/gpx/${entry.fileName}`)
    assert.equal(copy.length, original.length, `${entry.fileName} size mismatch`)
    assert.ok(copy.equals(original), `${entry.fileName} is not byte-identical to the historical source`)
    assert.equal(copy.length, entry.sizeBytes)
    assert.equal(createHash('sha256').update(copy).digest('hex'), entry.sha256)
  }
})

test('roadbook.json, overrides, accommodations and practical places are semantically identical to their historical sources', async () => {
  const [roadbookCopy, roadbookSource] = await Promise.all([
    readJson('public/trips/rga-2026/roadbook/roadbook.json'),
    readJson('public/data/trip/roadbook.json'),
  ])
  assert.deepEqual(roadbookCopy, roadbookSource)

  const [overridesCopy, overridesSource] = await Promise.all([
    readJson('public/trips/rga-2026/overrides/roadbook-overrides.json'),
    readJson('public/data/trip/roadbook-overrides.json'),
  ])
  assert.deepEqual(overridesCopy, overridesSource)

  const [accommodationsCopy, accommodationsSource] = await Promise.all([
    readJson('public/trips/rga-2026/accommodations/accommodations.json'),
    readJson('public/data/trip/accommodations.json'),
  ])
  assert.deepEqual(accommodationsCopy, accommodationsSource)

  const [practicalCopy, practicalSource] = await Promise.all([
    readJson('public/trips/rga-2026/practical/practical-points.json'),
    readJson('public/data/practical/practical-points.json'),
  ])
  assert.deepEqual(practicalCopy, practicalSource)
})

test('no historical asset was removed from its original location', async () => {
  const originalGpxFiles = (await readdir(new URL('public/data/gpx/', projectRoot))).filter((name) => name.endsWith('.gpx'))
  assert.equal(originalGpxFiles.length, 10)
  for (const name of originalGpxFiles) {
    const info = await stat(new URL(`public/data/gpx/${name}`, projectRoot))
    assert.ok(info.isFile())
  }
  for (const relativePath of [
    'public/data/trip/roadbook.json',
    'public/data/trip/roadbook-overrides.json',
    'public/data/trip/accommodations.json',
    'public/data/practical/practical-points.json',
    'public/data/gpx/manifest.json',
  ]) {
    const info = await stat(new URL(relativePath, projectRoot))
    assert.ok(info.isFile(), `${relativePath} should still exist`)
  }
})
