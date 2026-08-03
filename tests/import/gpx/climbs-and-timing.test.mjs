import { installMinimalDOMParser } from '../../support/minimal-dom-parser.mjs'

installMinimalDOMParser()

import assert from 'node:assert/strict'
import test from 'node:test'

import { createTripRepository } from '../../../src/storage/indexeddb/trip-repository.ts'
import { validateTripBundle } from '../../../src/trip-core/index.ts'
import { buildGpxXml, toGpxImportFile } from './support/fixtures.mjs'
import { runImport } from './support/run-import.mjs'

function climbTrack(name, startLat, gainM = 400, points = 300) {
  const segments = [[]]
  for (let i = 0; i <= points; i++) {
    segments[0].push({ lat: startLat + i * 0.0003, lon: 6 + i * 0.0003, ele: 1000 + (gainM * i) / points })
  }
  return { name, segments }
}

function flatTrack(name, startLat, points = 100) {
  const segments = [[]]
  for (let i = 0; i <= points; i++) {
    segments[0].push({ lat: startLat + i * 0.0003, lon: 6 + i * 0.0003 })
  }
  return { name, segments }
}

function climbFile(name, startLat, gainM = 400) {
  return toGpxImportFile(buildGpxXml({ tracks: [climbTrack(name, startLat, gainM)] }), name)
}

test('importGpxTrip produces climbs and populated timing fields, and the bundle still validates', async () => {
  const { result, database } = await runImport([climbFile('stage-1.gpx', 45)])
  try {
    assert.equal(result.ok, true)
    const { bundle } = result
    const stage = bundle.stages[0]

    assert.ok(stage.movingDurationSeconds > 0)
    assert.ok(stage.totalDurationSeconds >= stage.movingDurationSeconds)
    assert.equal(stage.totalDurationSeconds, stage.movingDurationSeconds + stage.pauseDurationSeconds)
    assert.ok(stage.estimatedAverageSpeedKph > 0)
    assert.equal(stage.climbIds.length, bundle.climbs.length)

    const validation = validateTripBundle(bundle)
    assert.equal(validation.ok, true, JSON.stringify(validation.ok ? null : validation.issues))
  } finally {
    database.close()
  }
})

test('a route steep and long enough produces at least one detected climb, correctly linked to its route/stage', async () => {
  const { result, database } = await runImport([climbFile('stage-1.gpx', 45, 500)])
  try {
    assert.equal(result.ok, true)
    const { bundle } = result
    assert.ok(bundle.climbs.length >= 1)
    const climb = bundle.climbs[0]
    assert.equal(climb.routeId, bundle.routes[0].id)
    assert.equal(climb.provenance.sourceType, 'generated')
    assert.deepEqual(bundle.stages[0].climbIds, bundle.climbs.map((c) => c.id))
  } finally {
    database.close()
  }
})

test('a flat route produces zero climbs, but still gets a valid (flat-model) timing', async () => {
  const file = toGpxImportFile(buildGpxXml({ tracks: [flatTrack('flat', 45)] }), 'flat.gpx')
  const { result, database } = await runImport([file])
  try {
    assert.equal(result.ok, true)
    const { bundle } = result
    assert.deepEqual(bundle.climbs, [])
    assert.ok(bundle.stages[0].movingDurationSeconds > 0)
  } finally {
    database.close()
  }
})

test('a GPX with no altitude at all still imports successfully: no climbs, flat-model timing, an explicit non-blocking issue', async () => {
  const xml = buildGpxXml({ tracks: [{ segments: [[{ lat: 45, lon: 6 }, { lat: 45.1, lon: 6.1 }, { lat: 45.2, lon: 6.2 }]] }] })
  const file = toGpxImportFile(xml, 'no-altitude.gpx')
  const { result, database } = await runImport([file])
  try {
    assert.equal(result.ok, true)
    const { bundle } = result
    assert.deepEqual(bundle.climbs, [])
    assert.equal(bundle.stages[0].minAltitudeM, null)
    assert.equal(bundle.stages[0].maxAltitudeM, null)
    assert.ok(bundle.stages[0].movingDurationSeconds > 0, 'still computes a flat-model duration')
    assert.ok(result.issues.some((issue) => issue.code === 'missing-altitude'))
  } finally {
    database.close()
  }
})

test('multi-day: each of 3 stages gets its own independent climbs and its own timing, never accumulated across stages', async () => {
  const files = [climbFile('stage-1.gpx', 45, 500), climbFile('stage-2.gpx', 46, 150), climbFile('stage-3.gpx', 47, 500)]
  const { result, database } = await runImport(files, { departureTime: '09:00', totalBreakMinutes: 45 })
  try {
    assert.equal(result.ok, true)
    const { bundle } = result
    assert.equal(bundle.stages.length, 3)

    // Every stage independently pays its own pause budget — durations never sum across stages.
    for (const stage of bundle.stages) {
      assert.equal(stage.pauseDurationSeconds, 45 * 60)
    }

    // Each route's climbs belong exclusively to that route — no cross-stage leakage.
    for (const stage of bundle.stages) {
      const routeClimbs = bundle.climbs.filter((climb) => climb.routeId === stage.sourceRouteId)
      assert.deepEqual(stage.climbIds, routeClimbs.map((climb) => climb.id))
    }
    const climbsByRoute = new Map()
    for (const climb of bundle.climbs) {
      climbsByRoute.set(climb.routeId, (climbsByRoute.get(climb.routeId) ?? 0) + 1)
    }
    // stage-2 (150 m gain) is far below the D+ threshold — no climbs there; the two steeper stages each have at least one.
    assert.ok((climbsByRoute.get(bundle.routes[0].id) ?? 0) >= 1)
    assert.equal(climbsByRoute.get(bundle.routes[1].id) ?? 0, 0)
    assert.ok((climbsByRoute.get(bundle.routes[2].id) ?? 0) >= 1)
  } finally {
    database.close()
  }
})

test('IndexedDB roundtrip preserves climbs, route profile, and every stage timing field exactly', async () => {
  const { result, database } = await runImport([climbFile('stage-1.gpx', 45, 400)])
  try {
    assert.equal(result.ok, true)
    const { bundle } = result
    assert.ok(bundle.climbs.length >= 1, 'sanity: this fixture must actually produce a climb to be a meaningful roundtrip test')

    const tripRepository = createTripRepository(database)
    const reloaded = await tripRepository.loadTripBundle(bundle.metadata.id)
    assert.deepEqual(reloaded, bundle)
    assert.deepEqual(reloaded.climbs, bundle.climbs)
    assert.deepEqual(reloaded.routes[0].profile, bundle.routes[0].profile)
    assert.deepEqual(reloaded.stages[0], bundle.stages[0])
  } finally {
    database.close()
  }
})
