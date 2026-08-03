import { installMinimalDOMParser } from '../../support/minimal-dom-parser.mjs'

installMinimalDOMParser()

import assert from 'node:assert/strict'
import test from 'node:test'

import { validateTripBundle } from '../../../src/trip-core/index.ts'
import { buildGpxXml, simpleClimbTrack, toGpxImportFile } from './support/fixtures.mjs'
import { runImport } from './support/run-import.mjs'

function climbFile(name, startLat = 45) {
  const xml = buildGpxXml({
    tracks: [{ name: `Track ${name}`, segments: [[{ lat: startLat, lon: 6, ele: 1000 }, { lat: startLat + 0.002, lon: 6.002, ele: 1050 }, { lat: startLat + 0.004, lon: 6.004, ele: 1100 }]] }],
  })
  return toGpxImportFile(xml, name)
}

test('a single GPX file produces exactly one day, one stage and one route', async () => {
  const { result, database } = await runImport([climbFile('stage-1.gpx')])
  try {
    assert.equal(result.ok, true)
    assert.equal(result.bundle.days.length, 1)
    assert.equal(result.bundle.stages.length, 1)
    assert.equal(result.bundle.routes.length, 1)
    assert.equal(result.bundle.sourceFiles.length, 1)
    assert.equal(result.bundle.stages[0].sourceRouteId, result.bundle.routes[0].id)
    assert.equal(result.bundle.days[0].stageId, result.bundle.stages[0].id)
    assert.equal(result.bundle.routes[0].sourceFileId, result.bundle.sourceFiles[0].id)
  } finally {
    database.close()
  }
})

test('three GPX files produce exactly three days/stages/routes, in the given order, with unique ids', async () => {
  const files = [climbFile('stage-1.gpx', 45), climbFile('stage-2.gpx', 46), climbFile('stage-3.gpx', 47)]
  const { result, database } = await runImport(files)
  try {
    assert.equal(result.ok, true)
    const { bundle } = result
    assert.equal(bundle.days.length, 3)
    assert.equal(bundle.stages.length, 3)
    assert.equal(bundle.routes.length, 3)
    assert.equal(bundle.sourceFiles.length, 3)

    // Order preserved: source file N corresponds to input file N, and so does its stage/day/route.
    assert.deepEqual(bundle.sourceFiles.map((file) => file.originalName), ['stage-1.gpx', 'stage-2.gpx', 'stage-3.gpx'])
    assert.deepEqual(
      bundle.days.map((day) => day.index),
      [0, 1, 2],
    )
    assert.deepEqual(
      bundle.days.map((day) => day.displayNumber),
      [1, 2, 3],
    )
    for (let index = 0; index < 3; index++) {
      const day = bundle.days[index]
      const stage = bundle.stages.find((candidate) => candidate.id === day.stageId)
      const route = bundle.routes.find((candidate) => candidate.id === stage.sourceRouteId)
      assert.equal(route.sourceFileId, bundle.sourceFiles[index].id)
      // The route's first point matches this file's own starting latitude (45 + index).
      assert.equal(route.geometry.full[0].latitude, 45 + index)
    }

    const allIds = [
      ...bundle.days.map((d) => d.id),
      ...bundle.stages.map((s) => s.id),
      ...bundle.routes.map((r) => r.id),
      ...bundle.sourceFiles.map((f) => f.id),
    ]
    assert.equal(new Set(allIds).size, allIds.length, 'every id across every collection is unique')
  } finally {
    database.close()
  }
})

test('distances are positive and D+/D- match the known synthetic climb fixture', async () => {
  const { result, database } = await runImport([climbFile('stage-1.gpx')])
  try {
    const stage = result.bundle.stages[0]
    assert.ok(stage.distanceKm > 0)
    assert.equal(stage.elevationGainM, 100)
    assert.equal(stage.elevationLossM, 0)
    assert.equal(stage.minAltitudeM, 1000)
    assert.equal(stage.maxAltitudeM, 1100)
  } finally {
    database.close()
  }
})

test('the resulting bundle passes validateTripBundle', async () => {
  const { result, database } = await runImport([climbFile('stage-1.gpx'), climbFile('stage-2.gpx', 46)])
  try {
    const validation = validateTripBundle(result.bundle)
    assert.equal(validation.ok, true, JSON.stringify(validation.ok ? null : validation.issues))
  } finally {
    database.close()
  }
})

test('collections other than generated climbs that remain out of scope for this phase stay empty', async () => {
  const { result, database } = await runImport([climbFile('stage-1.gpx')])
  try {
    const { bundle } = result
    assert.equal(bundle.climbs.length, 1)
    assert.deepEqual(bundle.practicalPlaces, [])
    assert.deepEqual(bundle.accommodations, [])
    assert.deepEqual(bundle.weather, [])
    assert.deepEqual(bundle.overrides, [])
    assert.deepEqual(bundle.settings.stages, [])
  } finally {
    database.close()
  }
})

test('input files are never mutated by the pipeline', async () => {
  const file = climbFile('stage-1.gpx')
  const bytesSnapshot = Buffer.from(file.bytes).toString('base64')
  const fileSnapshot = { ...file }
  const { database } = await runImport([file])
  try {
    assert.deepEqual({ ...file }, fileSnapshot)
    assert.equal(Buffer.from(file.bytes).toString('base64'), bytesSnapshot)
  } finally {
    database.close()
  }
})

test('a byte-identical duplicate file is rejected with an explicit issue, never silently merged', async () => {
  const xml = buildGpxXml({ tracks: [simpleClimbTrack()] })
  const fileA = toGpxImportFile(xml, 'stage-1.gpx')
  const fileB = toGpxImportFile(xml, 'stage-1-copy.gpx')
  const { result, database } = await runImport([fileA, fileB])
  try {
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'duplicate-file')
    assert.ok(result.issues.some((issue) => issue.code === 'duplicate-file'))
  } finally {
    database.close()
  }
})

test('invalid options (a malformed slug) fail with a validation-error before any file is even parsed', async () => {
  const { result, database } = await runImport([climbFile('stage-1.gpx')], { slug: 'Not A Slug!' })
  try {
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'validation-error')
  } finally {
    database.close()
  }
})
