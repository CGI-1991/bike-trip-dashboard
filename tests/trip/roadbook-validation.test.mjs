import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  RoadbookValidationError,
  validateRoadbookDocument,
  validateRoadbookOverridesDocument,
} from '../../src/trip/roadbook-validation.ts'

const root = new URL('../../', import.meta.url)
const readJson = async (path) => JSON.parse(await readFile(new URL(path, root), 'utf8'))

async function loadRealDocuments() {
  const [roadbookRaw, overridesRaw] = await Promise.all([
    readJson('public/data/trip/roadbook.json'),
    readJson('public/data/trip/roadbook-overrides.json'),
  ])
  const roadbook = validateRoadbookDocument(roadbookRaw)
  return { roadbook, overridesRaw }
}

test('all 53 rebuilt overrides pass validation with the reprojected-anchor method', async () => {
  const { roadbook, overridesRaw } = await loadRealDocuments()
  const overrides = validateRoadbookOverridesDocument(overridesRaw, roadbook)

  assert.equal(overrides.overrides.length, 53)
  assert.equal(overrides.skippedOverrides.length, 0)
  assert.ok(
    overrides.overrides.every(
      (override) => override.matchMethod === 'manual-anchor-reprojected-current-gpx',
    ),
  )
})

test('an invalid matchMethod is rejected, whatever the reconstructor happened to write', async () => {
  const { roadbook, overridesRaw } = await loadRealDocuments()
  const broken = {
    ...overridesRaw,
    overrides: overridesRaw.overrides.map((override, index) =>
      index === 0 ? { ...override, matchMethod: 'source-anchor-projected-to-current-gpx-segment' } : override,
    ),
  }

  const overrides = validateRoadbookOverridesDocument(broken, roadbook)

  assert.equal(overrides.overrides.length, 52)
  assert.equal(overrides.skippedOverrides.length, 1)
  assert.equal(overrides.skippedOverrides[0].pointId, overridesRaw.overrides[0].pointId)
  assert.match(overrides.skippedOverrides[0].issues[0].path, /overrides\[0\]\.matchMethod/)
})

test('one invalid override entry is skipped locally, the other 52 keep loading', async () => {
  const { roadbook, overridesRaw } = await loadRealDocuments()
  const broken = {
    ...overridesRaw,
    overrides: overridesRaw.overrides.map((override, index) =>
      index === 12 ? { ...override, sourceAnchor: { latitude: 999, longitude: 999 } } : override,
    ),
  }

  assert.doesNotThrow(() => validateRoadbookOverridesDocument(broken, roadbook))

  const overrides = validateRoadbookOverridesDocument(broken, roadbook)
  assert.equal(overrides.overrides.length, 52)
  assert.equal(overrides.skippedOverrides.length, 1)
  assert.equal(
    overrides.overrides.some((override) => override.pointId === overridesRaw.overrides[12].pointId),
    false,
  )
})

test('a genuinely unreadable overrides document (bad root structure) still throws', async () => {
  const { roadbook } = await loadRealDocuments()

  assert.throws(() => validateRoadbookOverridesDocument(null, roadbook), RoadbookValidationError)
  assert.throws(
    () => validateRoadbookOverridesDocument({ version: 1, tripId: roadbook.tripId, overrides: 'not-an-array' }, roadbook),
    RoadbookValidationError,
  )
  assert.throws(
    () => validateRoadbookOverridesDocument({ version: 2, tripId: roadbook.tripId, overrides: [] }, roadbook),
    RoadbookValidationError,
  )
})

test('the new manual-anchor-reprojected-current-gpx method is accepted on a minimal well-formed override', async () => {
  const { roadbook, overridesRaw } = await loadRealDocuments()
  const template = overridesRaw.overrides[0]
  const minimal = {
    version: 1,
    tripId: roadbook.tripId,
    overrides: [template],
  }

  const overrides = validateRoadbookOverridesDocument(minimal, roadbook)
  assert.equal(overrides.overrides.length, 1)
  assert.equal(overrides.overrides[0].matchMethod, 'manual-anchor-reprojected-current-gpx')
})
