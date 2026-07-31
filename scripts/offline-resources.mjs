import { readdirSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

function toPosixPath(path) {
  return path.split(sep).join('/')
}

/**
 * Recursively discovers every file under `publicRoot/trips/` (any
 * `<trip-id>`, not just `rga-2026`) and returns their paths relative to
 * `publicRoot`, POSIX-separated, deduplicated and sorted. A future canonical
 * trip package placed anywhere under `public/trips/` is picked up
 * automatically — nothing about it (trip id, file names, file count) is
 * ever hardcoded here. Returns an empty array if `public/trips/` doesn't
 * exist yet. Works identically on Windows and POSIX filesystems.
 */
export function collectOfflineResources(publicRoot) {
  const tripsRoot = resolve(publicRoot, 'trips')
  let entries
  try {
    entries = readdirSync(tripsRoot, { recursive: true, withFileTypes: true })
  } catch {
    return []
  }
  const relativePaths = entries
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const absolutePath = join(entry.parentPath ?? entry.path, entry.name)
      const relativeToPublicRoot = relative(publicRoot, absolutePath)
      if (relativeToPublicRoot.startsWith('..')) {
        throw new Error(`Ressource offline hors de public/ : ${absolutePath}`)
      }
      return toPosixPath(relativeToPublicRoot)
    })
  return [...new Set(relativePaths)].sort()
}

export const offlineResources = Object.freeze([
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'data/trip/accommodations.json',
  'data/trip/roadbook.json',
  'data/trip/roadbook-overrides.json',
  'data/practical/practical-points.json',
  'data/gpx/manifest.json',
  'data/gpx/01_route-des-grandes-alpes-a-velo-thonon-les-bains-morzine-avoriaz.gpx',
  'data/gpx/02_route-des-grandes-alpes-a-velo-morzine-avoriaz-le-grand-bornand.gpx',
  'data/gpx/03_route-des-grandes-alpes-a-velo-le-grand-bornand-beaufort-sur-doron.gpx',
  'data/gpx/04_route-des-grandes-alpes-a-velo-beaufort-sur-doron-bourg-saint-maurice.gpx',
  'data/gpx/05_route-des-grandes-alpes-a-velo-bourg-saint-maurice-val-cenis.gpx',
  'data/gpx/06_route-des-grandes-alpes-a-velo-val-cenis-briancon.gpx',
  'data/gpx/07_route-des-grandes-alpes-a-velo-briancon-barcelonnette.gpx',
  'data/gpx/08_route-des-grandes-alpes-a-velo-variante-barcelonnette-saint-etienne-de-tinee.gpx',
  'data/gpx/09_route-des-grandes-alpes-a-velo-variante-saint-etienne-de-tinee-saint-martin-vesubie.gpx',
  'data/gpx/10_route-des-grandes-alpes-a-velo-saint-martin-vesubie-nice.gpx',
])
