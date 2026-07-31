// Summarizes the canonical `public/trips/rga-2026/` package by reusing the
// exact plan-building and drift-checking logic from
// scripts/generate-rga-trip-package.mjs — never a second, competing
// implementation of "what the package should contain".

import { buildRgaTripPackagePlan, checkRgaTripPackage } from '../../../scripts/generate-rga-trip-package.mjs'

function sortBy(array, keyFn) {
  return [...array].sort((left, right) => {
    const a = keyFn(left)
    const b = keyFn(right)
    return a < b ? -1 : a > b ? 1 : 0
  })
}

export function buildCanonicalPackageSnapshot() {
  const plan = buildRgaTripPackagePlan()
  const drift = checkRgaTripPackage(plan)
  const manifestFile = plan.files.find((file) => file.relativePath === 'manifest.json')
  const manifest = JSON.parse(manifestFile.bytes.toString('utf8'))
  const settingsFile = plan.files.find((file) => file.relativePath === 'settings/default-settings.json')
  const settings = JSON.parse(settingsFile.bytes.toString('utf8'))

  return {
    fileCount: plan.files.length,
    filePaths: sortBy(plan.files.map((file) => file.relativePath), (path) => path),
    drift,
    manifestVersion: manifest.manifestVersion,
    tripId: manifest.tripId,
    slug: manifest.slug,
    name: manifest.name,
    language: manifest.language,
    timezone: manifest.timezone,
    tripBundleSchemaVersion: manifest.tripBundleSchemaVersion,
    counts: manifest.counts,
    gpx: sortBy(manifest.gpx, (entry) => entry.fileName),
    settings,
  }
}
