import { readFile } from 'node:fs/promises'

// No DOMParser polyfill needed here: this snapshot never parses GPX text
// (Route.geometry/profile stay null in phase 3 — see the adapter's report).

const projectRoot = new URL('../../../../', import.meta.url)
const readJson = async (relativePath) => JSON.parse(await readFile(new URL(relativePath, projectRoot), 'utf8'))

/** Reads the canonical `public/trips/rga-2026/` package straight from disk, exactly as `loadRgaLegacyTrip` would fetch it. */
export async function loadRgaLegacySnapshotFromDisk() {
  const { validateRoadbookDocument, validateRoadbookOverridesDocument } = await import(
    '../../../../src/trip/roadbook-validation.ts'
  )
  const { validatePracticalData } = await import('../../../../src/practical/model.ts')
  const { parseRgaTripManifest } = await import('../../../../src/trips/rga-2026/load-rga-legacy-trip.ts')

  const manifest = parseRgaTripManifest(await readJson('public/trips/rga-2026/manifest.json'))
  const roadbook = validateRoadbookDocument(await readJson(`public/trips/rga-2026/${manifest.roadbookPath}`))
  const overrides = validateRoadbookOverridesDocument(
    await readJson(`public/trips/rga-2026/${manifest.overridesPath}`),
    roadbook,
  )
  const accommodations = await readJson(`public/trips/rga-2026/${manifest.accommodationsPath}`)
  const practicalData = validatePracticalData(await readJson(`public/trips/rga-2026/${manifest.practicalPlacesPath}`))
  const defaultSettings = await readJson(`public/trips/rga-2026/${manifest.settingsPath}`)

  return {
    manifest,
    snapshot: {
      roadbook,
      overrides,
      accommodations,
      practicalData,
      gpxManifest: manifest.gpx,
      defaultSettings,
    },
  }
}
