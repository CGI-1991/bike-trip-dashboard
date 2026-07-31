import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  PRACTICAL_DISTANCE_LIMIT_KM,
  RIDE_DAY_IDS,
  buildPracticalData,
  cleanDescription,
  minimumDistanceToTrackKm,
  normalizeLayerComparison,
  parseKmlPracticalPoints,
  serializePracticalData,
} from '../../scripts/practical-data-core.mjs'
import { validatePracticalData } from '../../src/practical/model.ts'
import {
  buildGoogleMapsBicyclingUrl,
  getPracticalLayersForDay,
} from '../../src/ui/practical-map-model.ts'

const projectRoot = new URL('../../', import.meta.url)
const readText = (relativePath) => readFile(new URL(relativePath, projectRoot), 'utf8')
const manifest = JSON.parse(await readText('public/data/gpx/manifest.json'))
const kmlText = await readText('public/data/practical/rga-practical-points.kml')
const gpxSources = await Promise.all(
  manifest.files.map(async ({ fileName }, index) => ({
    dayId: RIDE_DAY_IDS[index],
    fileName,
    gpxText: await readText(`public/data/gpx/${fileName}`),
  })),
)
const practicalData = buildPracticalData({ kmlText, gpxSources })

test('the real KML retains exactly eight practical layers and 1,705 point geometries', () => {
  assert.equal(practicalData.source.placemarkCount, 1_716)
  assert.equal(practicalData.layers.length, 8)
  assert.equal(practicalData.points.length, 1_705)
  assert.deepEqual(
    practicalData.layers.map(({ name, pointCount }) => [name, pointCount]),
    [
      ['Abris', 251],
      ['Boulangeries', 163],
      ['Cafés et glaces', 143],
      ['Eau / Boissons', 450],
      ['Restauration rapide', 156],
      ['Service vélo', 29],
      ['Supermarchés', 203],
      ['Toilettes', 310],
    ],
  )
  assert.equal(practicalData.source.styleCount, 22)
  assert.equal(practicalData.source.styleMapCount, 11)
  assert.ok(practicalData.layers.every(({ color }) => /^#[\dA-F]{6}$/.test(color)))
})

test('Itinéraire, Étapes, lines and non-point surfaces never enter the practical model', () => {
  assert.deepEqual(practicalData.source.excludedFolders, ['Itinéraire', 'Étapes'])
  assert.equal(practicalData.source.excludedPointCount, 10)
  assert.deepEqual(practicalData.source.ignoredNonPointGeometryCounts, { LineString: 1 })
  assert.doesNotMatch(
    practicalData.layers.map(({ name }) => name).join(' '),
    /Itinéraire|Étapes/,
  )
  assert.equal(practicalData.points.length, practicalData.source.sourceGeometryCounts.Point - 10)

  const synthetic = parseKmlPracticalPoints(`<?xml version="1.0"?>
    <kml><Document>
      <Folder><name>  ÉTAPES  </name><Placemark><name>Exclu</name><Point><coordinates>6,45</coordinates></Point></Placemark></Folder>
      <Folder><name>Parent</name><Folder><name> Cafés   utiles </name>
        <Placemark><name>Café sûr</name><description><![CDATA[
          <script>alert(1)</script><style>bad</style>Type: Café<br>
          Distance par rapport à l'itinéraire: 3 m<br>Ouvert 24 h<br>Ouvert 24 h
        ]]></description><MultiGeometry><Point><coordinates>6.1,45.1</coordinates></Point><LineString><coordinates>6,45 7,46</coordinates></LineString></MultiGeometry></Placemark>
        <Placemark><name>Surface</name><Polygon><outerBoundaryIs><LinearRing><coordinates>6,45 7,45 7,46</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
      </Folder></Folder>
    </Document></kml>`)
  assert.equal(synthetic.rawPoints.length, 1)
  assert.equal(synthetic.rawPoints[0].layerName, 'Cafés utiles')
  assert.equal(synthetic.rawPoints[0].description, 'Ouvert 24 h')
  assert.equal(synthetic.summary.excludedPointCount, 1)
  assert.equal(synthetic.summary.ignoredNonPointGeometryCounts.LineString, 1)
  assert.equal(synthetic.summary.ignoredNonPointGeometryCounts.Polygon, 1)
})

test('names, descriptions and coordinates are normalized, safe and finite', () => {
  assert.equal(normalizeLayerComparison('  ÉTAPES   '), 'etapes')
  assert.equal(
    cleanDescription(
      '<b>Fontaine</b><br>Type: Eau<br>Note utile<br>Note utile<script>bad()</script>',
      'Fontaine',
      'Eau',
    ),
    'Note utile',
  )
  assert.ok(
    practicalData.points.every(
      ({ latitude, longitude, description }) =>
        Number.isFinite(latitude) &&
        Number.isFinite(longitude) &&
        latitude >= -90 &&
        latitude <= 90 &&
        longitude >= -180 &&
        longitude <= 180 &&
        (description === undefined || !/[<>]|script|style=/i.test(description)),
    ),
  )
  assert.equal(practicalData.points.filter(({ description }) => description !== undefined).length, 0)
})

test('the six-kilometre filter measures the complete segment, not only GPX vertices', () => {
  const track = [[
    { latitude: 45, longitude: 6 },
    { latitude: 45, longitude: 6.2 },
  ]]
  const nearMiddle = minimumDistanceToTrackKm(
    { latitude: 45.02, longitude: 6.1 },
    track,
  )
  const outside = minimumDistanceToTrackKm(
    { latitude: 45.06, longitude: 6.1 },
    track,
  )
  assert.ok(nearMiddle < PRACTICAL_DISTANCE_LIMIT_KM)
  assert.ok(outside > PRACTICAL_DISTANCE_LIMIT_KM)
  assert.ok(nearMiddle < minimumDistanceToTrackKm({ latitude: 45.02, longitude: 6.1 }, [[track[0][0]]]))
})

test('the real derived model is deterministic and matches the checked-in runtime JSON', async () => {
  const checkedIn = await readText('public/data/practical/practical-points.json')
  assert.equal(serializePracticalData(practicalData), checkedIn)
  const secondBuild = buildPracticalData({ kmlText, gpxSources })
  assert.equal(serializePracticalData(secondBuild), checkedIn)
  assert.deepEqual(Object.keys(practicalData.dayPointCounts), RIDE_DAY_IDS)
  assert.ok(Object.values(practicalData.dayPointCounts).every((count) => count > 0))
})

test('runtime validation, independent layer filtering and bicycle guidance use real coordinates', () => {
  const validated = validatePracticalData(practicalData)
  const j1Layers = getPracticalLayersForDay(validated, 'J1')
  assert.ok(j1Layers.length > 0)
  assert.equal(
    j1Layers.reduce((total, { points }) => total + points.length, 0),
    validated.dayPointCounts.J1,
  )
  const point = j1Layers[0].points[0]
  assert.equal(
    buildGoogleMapsBicyclingUrl(point),
    `https://www.google.com/maps/dir/?api=1&destination=${point.latitude},${point.longitude}&travelmode=bicycling`,
  )
  assert.doesNotMatch(buildGoogleMapsBicyclingUrl(point), /origin=|key=/)
})

test('the build regenerates practical data and checks the RGA trip package and golden master before TypeScript and Vite', async () => {
  const packageJson = JSON.parse(await readText('package.json'))
  assert.equal(packageJson.scripts['generate:practical'], 'node scripts/generate-practical-data.mjs')
  assert.equal(packageJson.scripts['check:rga-trip-package'], 'node scripts/generate-rga-trip-package.mjs --check')
  assert.equal(packageJson.scripts['generate:rga-golden'], 'node scripts/generate-rga-golden.mjs')
  assert.equal(packageJson.scripts['check:rga-golden'], 'node scripts/generate-rga-golden.mjs --check')
  assert.equal(
    packageJson.scripts.prebuild,
    'npm run generate:practical && npm run check:rga-trip-package && npm run check:rga-golden',
  )
  assert.equal(packageJson.scripts.build, 'tsc && vite build')
})
