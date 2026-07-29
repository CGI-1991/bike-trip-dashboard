import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  RIDE_DAY_IDS,
  buildPracticalData,
  serializePracticalData,
} from './practical-data-core.mjs'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const practicalDirectory = resolve(projectRoot, 'public', 'data', 'practical')
const sourcePath = resolve(practicalDirectory, 'rga-practical-points.kml')
const outputPath = resolve(practicalDirectory, 'practical-points.json')
const manifestPath = resolve(projectRoot, 'public', 'data', 'gpx', 'manifest.json')

export async function generatePracticalData() {
  const [kmlText, manifestText] = await Promise.all([
    readFile(sourcePath, 'utf8'),
    readFile(manifestPath, 'utf8'),
  ])
  const manifest = JSON.parse(manifestText)
  if (!Array.isArray(manifest.files) || manifest.files.length !== RIDE_DAY_IDS.length) {
    throw new Error('Le manifeste GPX doit référencer exactement dix traces.')
  }
  const gpxSources = await Promise.all(
    manifest.files.map(async ({ fileName }, index) => ({
      dayId: RIDE_DAY_IDS[index],
      fileName,
      gpxText: await readFile(resolve(projectRoot, 'public', 'data', 'gpx', fileName), 'utf8'),
    })),
  )
  const data = buildPracticalData({ kmlText, gpxSources })
  await writeFile(outputPath, serializePracticalData(data), 'utf8')
  return data
}

let generatedData
try {
  generatedData = await generatePracticalData()
} catch (error) {
  throw new Error(
    `Échec de la génération des données pratiques : ${error instanceof Error ? error.message : String(error)}`,
    { cause: error },
  )
}
console.log(
  `Données pratiques générées : ${generatedData.layers.length} calques, ${generatedData.points.length} points.`,
)
