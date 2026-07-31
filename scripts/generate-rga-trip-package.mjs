// Generates the canonical, static RGA 2026 trip package under
// public/trips/rga-2026/ — byte-identical copies of the historical assets
// (GPX, roadbook, overrides, accommodations, practical places) plus a
// deterministic manifest (with computed counters) and a default-settings
// file.
//
// Usage:
//   node scripts/generate-rga-trip-package.mjs           # (re)writes the package
//   node scripts/generate-rga-trip-package.mjs --check    # verifies, writes nothing
//
// `--check` (also `npm run check:rga-trip-package`) rebuilds the exact same
// plan in memory and compares it byte-for-byte against what's on disk: exit
// code 0 when identical, non-zero with a precise missing/different/extra
// file list otherwise. It never writes anything. `npm run build`'s prebuild
// step runs this in `--check` mode only — the package itself is authored by
// hand-running the no-flag form after a historical asset changes (see
// README.md), never automatically rewritten by a build or test run.
//
// Deterministic by construction: no `Date.now()`/`new Date()` (the migration
// timestamp is a fixed constant), no `Math.random()`, sha256/sizeBytes are
// computed from the actual file bytes. Building the plan twice in a row
// produces byte-identical output every time.

import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const publicDir = resolve(projectRoot, 'public')
const tripDir = resolve(publicDir, 'trips', 'rga-2026')

// Fixed migration constant — never `new Date()`. Documents when this
// canonical package was authored from the legacy pipeline; it is not
// regenerated on every run of this script.
const MIGRATION_TIMESTAMP = '2026-07-31T00:00:00.000Z'
const ADAPTER_ENGINE_VERSION = 'rga-legacy-adapter@1'

function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function serializeJson(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function toPosixPath(path) {
  return path.split(sep).join('/')
}

/**
 * Computes the manifest's `counts` — every value derived from the actual
 * source documents, never a hand-copied literal (CDC phase 3B section 5).
 */
function computeCounts(roadbook, overrides, accommodations, practicalData, gpxFileCount) {
  const rideDays = roadbook.days.filter((day) => day.type === 'ride')
  const offDays = roadbook.days.filter((day) => day.type === 'off')

  let documentedPointCandidates = 0
  for (const day of rideDays) {
    documentedPointCandidates += day.cols.length + day.resupplyPassages.length + day.options.length
  }

  const overridesByStatus = { matched: 0, 'needs-review': 0, unmatched: 0 }
  for (const override of overrides.overrides) {
    if (override.approvedStatus in overridesByStatus) overridesByStatus[override.approvedStatus] += 1
  }

  return {
    days: roadbook.days.length,
    rideDays: rideDays.length,
    offDays: offDays.length,
    gpxFiles: gpxFileCount,
    documentedPointCandidates,
    roadbookOverrides: overrides.overrides.length,
    matchedOverrides: overridesByStatus.matched,
    needsReviewOverrides: overridesByStatus['needs-review'],
    unmatchedOverrides: overridesByStatus.unmatched,
    // Only `matched` overrides become a TripBundle RoutePoint — see
    // `mapRoutePoints` in src/trips/rga-2026/rga-legacy-mapping.ts.
    tripBundleRoutePoints: overridesByStatus.matched,
    practicalPlaces: practicalData.points.length,
    accommodations: accommodations.accommodations.length,
  }
}

/**
 * Builds the entire canonical package plan in memory: every file's relative
 * path and exact bytes, computed purely from the current
 * `public/data/**` sources. Used identically by both write mode and
 * `--check` mode, so the two can never drift apart from each other.
 */
export function buildRgaTripPackagePlan() {
  const gpxManifest = JSON.parse(readFileSync(resolve(publicDir, 'data', 'gpx', 'manifest.json'), 'utf8'))
  const roadbookBytes = readFileSync(resolve(publicDir, 'data', 'trip', 'roadbook.json'))
  const overridesBytes = readFileSync(resolve(publicDir, 'data', 'trip', 'roadbook-overrides.json'))
  const accommodationsBytes = readFileSync(resolve(publicDir, 'data', 'trip', 'accommodations.json'))
  const practicalBytes = readFileSync(resolve(publicDir, 'data', 'practical', 'practical-points.json'))

  const roadbook = JSON.parse(roadbookBytes.toString('utf8'))
  const overrides = JSON.parse(overridesBytes.toString('utf8'))
  const accommodations = JSON.parse(accommodationsBytes.toString('utf8'))
  const practicalData = JSON.parse(practicalBytes.toString('utf8'))

  const gpxFiles = gpxManifest.files.map(({ fileName, startName, endName }) => {
    const bytes = readFileSync(resolve(publicDir, 'data', 'gpx', fileName))
    return {
      relativePath: `gpx/${fileName}`,
      bytes,
      manifestEntry: { fileName, startName, endName, sizeBytes: bytes.length, sha256: sha256Hex(bytes) },
    }
  })

  const counts = computeCounts(roadbook, overrides, accommodations, practicalData, gpxFiles.length)

  const defaultSettings = { version: 1, referenceSpeedKph: 18, departureTime: '08:00', totalBreakMinutes: 60 }

  const manifest = {
    manifestVersion: 1,
    tripId: 'rga-2026',
    slug: 'rga-2026',
    name: 'Route des Grandes Alpes 2026',
    language: 'fr',
    timezone: 'Europe/Paris',
    tripBundleSchemaVersion: 1,
    adapter: ADAPTER_ENGINE_VERSION,
    migration: {
      provenance: 'migrated-from-legacy-rga-pipeline',
      migratedAt: MIGRATION_TIMESTAMP,
    },
    counts,
    gpx: gpxFiles.map((file) => file.manifestEntry),
    roadbookPath: 'roadbook/roadbook.json',
    accommodationsPath: 'accommodations/accommodations.json',
    practicalPlacesPath: 'practical/practical-points.json',
    overridesPath: 'overrides/roadbook-overrides.json',
    settingsPath: 'settings/default-settings.json',
  }

  const files = [
    ...gpxFiles.map((file) => ({ relativePath: file.relativePath, bytes: file.bytes })),
    { relativePath: 'roadbook/roadbook.json', bytes: roadbookBytes },
    { relativePath: 'overrides/roadbook-overrides.json', bytes: overridesBytes },
    { relativePath: 'accommodations/accommodations.json', bytes: accommodationsBytes },
    { relativePath: 'practical/practical-points.json', bytes: practicalBytes },
    { relativePath: 'settings/default-settings.json', bytes: serializeJson(defaultSettings) },
    { relativePath: 'manifest.json', bytes: serializeJson(manifest) },
  ]

  return { files }
}

export function writeRgaTripPackage(plan, targetDir = tripDir) {
  for (const file of plan.files) {
    const destinationPath = resolve(targetDir, file.relativePath)
    mkdirSync(dirname(destinationPath), { recursive: true })
    writeFileSync(destinationPath, file.bytes)
  }
}

function listExistingFiles(targetDir) {
  let entries
  try {
    entries = readdirSync(targetDir, { recursive: true, withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => toPosixPath(relative(targetDir, join(entry.parentPath ?? entry.path, entry.name))))
}

/**
 * Compares `plan` against what's actually on disk under `targetDir`
 * (`public/trips/rga-2026/` by default). Never writes anything.
 */
export function checkRgaTripPackage(plan, targetDir = tripDir) {
  const missing = []
  const different = []
  const expectedPaths = new Set(plan.files.map((file) => file.relativePath))

  for (const file of plan.files) {
    let existing
    try {
      existing = readFileSync(resolve(targetDir, file.relativePath))
    } catch {
      missing.push(file.relativePath)
      continue
    }
    if (!existing.equals(file.bytes)) different.push(file.relativePath)
  }

  const extra = listExistingFiles(targetDir)
    .filter((relativePath) => !expectedPaths.has(relativePath))
    .sort()

  return {
    ok: missing.length === 0 && different.length === 0 && extra.length === 0,
    missing: missing.sort(),
    different: different.sort(),
    extra,
  }
}

// Only run the CLI (and, in particular, only ever write anything) when this file is
// executed directly (`node scripts/generate-rga-trip-package.mjs[...]`) — never as a
// side effect of another module importing its exported functions, e.g. from a test.
const isRunDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))

if (isRunDirectly) {
  const args = process.argv.slice(2)
  const checkOnly = args.includes('--check')
  const plan = buildRgaTripPackagePlan()

  if (checkOnly) {
    const result = checkRgaTripPackage(plan)
    if (result.ok) {
      console.log(`Paquet RGA 2026 conforme : ${plan.files.length} fichiers, aucune dérive détectée.`)
    } else {
      console.error('Dérive détectée dans public/trips/rga-2026/ :')
      for (const path of result.missing) console.error(`  manquant   : ${path}`)
      for (const path of result.different) console.error(`  différent  : ${path}`)
      for (const path of result.extra) console.error(`  surnuméraire : ${path}`)
      process.exitCode = 1
    }
  } else {
    writeRgaTripPackage(plan)
    console.log(`Paquet de voyage RGA 2026 généré : ${plan.files.length} fichiers sous public/trips/rga-2026/.`)
  }
}
