import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import process from 'node:process'
import test from 'node:test'

import {
  buildRgaTripPackagePlan,
  checkRgaTripPackage,
  writeRgaTripPackage,
} from '../../../scripts/generate-rga-trip-package.mjs'

const projectRoot = new URL('../../../', import.meta.url)
const projectRootPath = fileURLToPath(projectRoot)
const generatorScriptPath = fileURLToPath(new URL('../../../scripts/generate-rga-trip-package.mjs', import.meta.url))

test('the plan is deterministic: building it twice produces byte-identical files and manifest', () => {
  const first = buildRgaTripPackagePlan()
  const second = buildRgaTripPackagePlan()
  assert.equal(first.files.length, second.files.length)
  for (let i = 0; i < first.files.length; i++) {
    assert.equal(first.files[i].relativePath, second.files[i].relativePath)
    assert.ok(first.files[i].bytes.equals(second.files[i].bytes), `${first.files[i].relativePath} differs between two builds`)
  }
})

test('the currently committed public/trips/rga-2026/ package matches the plan exactly (no drift)', () => {
  const plan = buildRgaTripPackagePlan()
  const result = checkRgaTripPackage(plan)
  assert.deepEqual(result, { ok: true, missing: [], different: [], extra: [] })
})

test('the manifest counts are computed, not hand-copied, and match the current source data exactly', () => {
  const plan = buildRgaTripPackagePlan()
  const manifestFile = plan.files.find((file) => file.relativePath === 'manifest.json')
  const manifest = JSON.parse(manifestFile.bytes.toString('utf8'))
  assert.deepEqual(manifest.counts, {
    days: 12,
    rideDays: 10,
    offDays: 2,
    gpxFiles: 10,
    documentedPointCandidates: 53,
    roadbookOverrides: 53,
    matchedOverrides: 46,
    needsReviewOverrides: 4,
    unmatchedOverrides: 3,
    tripBundleRoutePoints: 46,
    practicalPlaces: 1705,
    accommodations: 10,
  })
})

async function withScratchPackage(run) {
  const scratchDir = await mkdtemp(join(tmpdir(), 'rga-trip-package-'))
  try {
    const plan = buildRgaTripPackagePlan()
    writeRgaTripPackage(plan, scratchDir)
    await run(scratchDir, plan)
  } finally {
    await rm(scratchDir, { recursive: true, force: true })
  }
}

test('--check mode detects a modified file', async () => {
  await withScratchPackage(async (scratchDir, plan) => {
    await writeFile(join(scratchDir, 'manifest.json'), '{"tampered":true}')
    const result = checkRgaTripPackage(plan, scratchDir)
    assert.equal(result.ok, false)
    assert.deepEqual(result.different, ['manifest.json'])
    assert.deepEqual(result.missing, [])
  })
})

test('--check mode detects a missing file', async () => {
  await withScratchPackage(async (scratchDir, plan) => {
    await rm(join(scratchDir, 'settings', 'default-settings.json'))
    const result = checkRgaTripPackage(plan, scratchDir)
    assert.equal(result.ok, false)
    assert.deepEqual(result.missing, ['settings/default-settings.json'])
  })
})

test('--check mode detects a surplus (unexpected) file', async () => {
  await withScratchPackage(async (scratchDir, plan) => {
    await writeFile(join(scratchDir, 'unexpected-file.txt'), 'not part of the plan')
    const result = checkRgaTripPackage(plan, scratchDir)
    assert.equal(result.ok, false)
    assert.deepEqual(result.extra, ['unexpected-file.txt'])
  })
})

test('--check mode reports ok with no differences on a freshly written scratch package', async () => {
  await withScratchPackage(async (scratchDir, plan) => {
    const result = checkRgaTripPackage(plan, scratchDir)
    assert.deepEqual(result, { ok: true, missing: [], different: [], extra: [] })
  })
})

test('running the CLI in --check mode writes nothing to public/trips/rga-2026/', async () => {
  const manifestPath = new URL('public/trips/rga-2026/manifest.json', projectRoot)
  const before = await readFile(manifestPath)
  const output = execFileSync(process.execPath, [generatorScriptPath, '--check'], {
    cwd: projectRootPath,
    encoding: 'utf8',
  })
  assert.match(output, /conforme/)
  const after = await readFile(manifestPath)
  assert.ok(before.equals(after))
})
