// Builds the RGA 2026 golden master (three snapshots + parity matrix) and
// either writes it to tests/golden/rga-2026/rga-2026-golden.json or, in
// `--check` mode, compares the freshly rebuilt master against that committed
// file without writing anything.
//
// Usage:
//   node scripts/generate-rga-golden.mjs           # (re)writes the golden file — run only voluntarily
//   node scripts/generate-rga-golden.mjs --check    # verifies, writes nothing (npm run check:rga-golden)
//
// Never invoked automatically by `npm test` or `npm run build` — see
// package.json and docs/rga-trip-bundle-parity.md. A golden master update is
// always an explicit, reviewable decision.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildLegacyRgaSnapshot } from '../tests/golden/rga-2026/build-legacy-rga-snapshot.mjs'
import { buildCanonicalPackageSnapshot } from '../tests/golden/rga-2026/build-canonical-package-snapshot.mjs'
import { buildTripBundleRgaSnapshot } from '../tests/golden/rga-2026/build-trip-bundle-rga-snapshot.mjs'
import { buildParityMatrix } from '../tests/golden/rga-2026/compare-rga-snapshots.mjs'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const goldenPath = resolve(projectRoot, 'tests', 'golden', 'rga-2026', 'rga-2026-golden.json')

export async function buildRgaGolden() {
  const [legacy, tripBundle] = await Promise.all([buildLegacyRgaSnapshot(), buildTripBundleRgaSnapshot()])
  const canonical = buildCanonicalPackageSnapshot()
  const parityMatrix = buildParityMatrix(legacy, canonical, tripBundle)
  return {
    goldenVersion: 1,
    legacy,
    canonical,
    tripBundle,
    parityMatrix,
  }
}

function serialize(golden) {
  return `${JSON.stringify(golden, null, 2)}\n`
}

function diffPaths(expected, actual, path = '$') {
  const differences = []
  if (typeof expected !== typeof actual) {
    differences.push(path)
    return differences
  }
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual) || expected.length !== actual.length) {
      differences.push(path)
      return differences
    }
    for (let i = 0; i < expected.length; i++) differences.push(...diffPaths(expected[i], actual[i], `${path}[${i}]`))
    return differences
  }
  if (expected !== null && typeof expected === 'object') {
    if (actual === null || typeof actual !== 'object') {
      differences.push(path)
      return differences
    }
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)])
    for (const key of keys) differences.push(...diffPaths(expected[key], actual[key], `${path}.${key}`))
    return differences
  }
  if (expected !== actual) differences.push(path)
  return differences
}

const isRunDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))

if (isRunDirectly) {
  const checkOnly = process.argv.slice(2).includes('--check')
  const golden = await buildRgaGolden()

  if (checkOnly) {
    let committedRaw
    try {
      committedRaw = readFileSync(goldenPath, 'utf8')
    } catch {
      console.error(`Golden RGA 2026 introuvable : ${goldenPath}. Lancez d'abord npm run generate:rga-golden.`)
      process.exitCode = 1
    }
    if (committedRaw !== undefined) {
      const committed = JSON.parse(committedRaw)
      const freshSerialized = serialize(golden)
      if (freshSerialized === committedRaw) {
        console.log('Golden RGA 2026 conforme : aucune dérive détectée.')
      } else {
        const paths = diffPaths(committed, golden)
        console.error('Dérive détectée dans tests/golden/rga-2026/rga-2026-golden.json :')
        for (const path of paths.slice(0, 50)) console.error(`  ${path}`)
        if (paths.length > 50) console.error(`  ... (+${paths.length - 50} autres chemins)`)
        process.exitCode = 1
      }
    }
  } else {
    mkdirSync(dirname(goldenPath), { recursive: true })
    writeFileSync(goldenPath, serialize(golden))
    console.log(`Golden RGA 2026 régénéré : ${goldenPath}`)
  }
}
