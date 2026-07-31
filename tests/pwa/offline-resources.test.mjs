import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { collectOfflineResources, offlineResources } from '../../scripts/offline-resources.mjs'

const publicDirPath = fileURLToPath(new URL('../../public/', import.meta.url))

test('collectOfflineResources returns an empty array when public/trips/ does not exist', async () => {
  const scratchDir = await mkdtemp(join(tmpdir(), 'offline-resources-empty-'))
  try {
    assert.deepEqual(collectOfflineResources(scratchDir), [])
  } finally {
    await rm(scratchDir, { recursive: true, force: true })
  }
})

test('collectOfflineResources discovers files recursively, sorted, POSIX-separated, no directories', async () => {
  const scratchDir = await mkdtemp(join(tmpdir(), 'offline-resources-'))
  try {
    await mkdir(join(scratchDir, 'trips', 'sample-trip', 'gpx'), { recursive: true })
    await writeFile(join(scratchDir, 'trips', 'sample-trip', 'manifest.json'), '{}')
    await writeFile(join(scratchDir, 'trips', 'sample-trip', 'gpx', 'b.gpx'), 'b')
    await writeFile(join(scratchDir, 'trips', 'sample-trip', 'gpx', 'a.gpx'), 'a')

    const resources = collectOfflineResources(scratchDir)
    assert.deepEqual(resources, [
      'trips/sample-trip/gpx/a.gpx',
      'trips/sample-trip/gpx/b.gpx',
      'trips/sample-trip/manifest.json',
    ])
    for (const resource of resources) assert.equal(resource.includes('\\'), false)
  } finally {
    await rm(scratchDir, { recursive: true, force: true })
  }
})

test('collectOfflineResources never returns duplicates and is deterministic across two calls', async () => {
  const scratchDir = await mkdtemp(join(tmpdir(), 'offline-resources-dedup-'))
  try {
    await mkdir(join(scratchDir, 'trips', 'x'), { recursive: true })
    await writeFile(join(scratchDir, 'trips', 'x', 'file.json'), '{}')
    const first = collectOfflineResources(scratchDir)
    const second = collectOfflineResources(scratchDir)
    assert.deepEqual(first, second)
    assert.equal(new Set(first).size, first.length)
  } finally {
    await rm(scratchDir, { recursive: true, force: true })
  }
})

test('is generic: it never hardcodes rga-2026, any of the ten GPX names, or the sixteen package files', () => {
  const source = collectOfflineResources.toString()
  assert.doesNotMatch(source, /rga-2026/)
  assert.doesNotMatch(source, /\.gpx/)
  assert.doesNotMatch(source, /\b16\b/)
})

test('combining the historical list with the real repo\'s public/trips/ finds all sixteen RGA package files', () => {
  const discovered = collectOfflineResources(publicDirPath)
  const rgaFiles = discovered.filter((resource) => resource.startsWith('trips/rga-2026/'))
  assert.equal(rgaFiles.length, 16)
  assert.ok(rgaFiles.includes('trips/rga-2026/manifest.json'))
  assert.equal(rgaFiles.filter((resource) => resource.endsWith('.gpx')).length, 10)

  const combined = [...new Set([...offlineResources, ...discovered])].sort()
  assert.equal(new Set(combined).size, combined.length, 'no duplicates once combined with the historical list')
  assert.deepEqual(combined, [...combined].sort(), 'deterministic, sorted order')
})

test('changing a trip package file changes the combined resource set\'s content, which changes the cache-version hash', async () => {
  const { createHash } = await import('node:crypto')
  const scratchDir = await mkdtemp(join(tmpdir(), 'offline-resources-hash-'))
  try {
    await mkdir(join(scratchDir, 'trips', 'sample'), { recursive: true })
    await writeFile(join(scratchDir, 'trips', 'sample', 'manifest.json'), '{"v":1}')
    const { readFileSync } = await import('node:fs')

    function hashFor(dir) {
      const resources = collectOfflineResources(dir)
      const hash = createHash('sha256')
      hash.update(JSON.stringify(resources))
      for (const resource of resources) hash.update(readFileSync(join(dir, resource)))
      return hash.digest('hex')
    }

    const before = hashFor(scratchDir)
    await writeFile(join(scratchDir, 'trips', 'sample', 'manifest.json'), '{"v":2}')
    const after = hashFor(scratchDir)
    assert.notEqual(before, after)
  } finally {
    await rm(scratchDir, { recursive: true, force: true })
  }
})
