import { installMinimalDOMParser } from '../../support/minimal-dom-parser.mjs'

installMinimalDOMParser()

import assert from 'node:assert/strict'
import test from 'node:test'

import { computeStageWaypoints } from '../../../src/analysis/waypoint-timeline.ts'
import { buildGpxXml, toGpxImportFile } from './support/fixtures.mjs'
import { runImport } from './support/run-import.mjs'

/**
 * DER-DES-DER sections 5-7/12 / tests A-C — "budget de pauses ≠ plan de
 * pauses".
 *
 * Import may compute HOW MANY minutes of pause are reasonable; it must not
 * decide WHERE they happen. At import time nothing structural is known yet
 * (no city, no village, no col — those arrive with the Postpass structural
 * phase), so there is nowhere legitimate to put a pause, and the app must
 * therefore put none rather than inventing "Pause du matin" at 25 % of the
 * route.
 */

function longTrack(name, startLat, points = 400) {
  const segments = [[]]
  for (let i = 0; i <= points; i++) {
    segments[0].push({ lat: startLat + i * 0.0009, lon: 6 + i * 0.0003, ele: 400 + Math.sin(i / 25) * 120 })
  }
  return { name, segments }
}

function trackFile(name, startLat) {
  return toGpxImportFile(buildGpxXml({ tracks: [longTrack(name, startLat)] }), name)
}

test('A: import computes a real pause BUDGET for the stage', async () => {
  const { result, database } = await runImport([trackFile('stage-1.gpx', 45)])
  try {
    assert.equal(result.ok, true)
    const stage = result.bundle.stages[0]
    assert.ok(stage.pauseDurationSeconds > 0, 'a long stage gets a non-zero break budget')
    assert.equal(stage.totalDurationSeconds, stage.movingDurationSeconds + stage.pauseDurationSeconds)
  } finally {
    database.close()
  }
})

test('B/C: a freshly imported trip carries NO automatic pause and no synthetic pause point at all', async () => {
  const { result, database } = await runImport([trackFile('stage-1.gpx', 45)])
  try {
    assert.equal(result.ok, true)
    const { bundle } = result

    // C: no stored point of type `pause` — nothing was materialised.
    assert.deepEqual(bundle.routePoints.filter((point) => point.type === 'pause'), [])
    // B: and no pause plan either — `settings.stages` carries no pause entry.
    for (const entry of bundle.settings.stages ?? []) {
      assert.deepEqual(entry.pauses ?? [], [], 'no automatic pause plan is persisted at import')
    }
  } finally {
    database.close()
  }
})

test('B/C/section 12: the derived waypoints of a freshly imported stage carry no pause either — a budget is not a plan', async () => {
  const { result, database } = await runImport([trackFile('stage-1.gpx', 45)])
  try {
    assert.equal(result.ok, true)
    const { bundle } = result
    const stage = bundle.stages[0]
    const route = bundle.routes.find((candidate) => candidate.id === stage.sourceRouteId)

    const waypoints = computeStageWaypoints({
      stage,
      route,
      routePoints: bundle.routePoints,
      climbs: bundle.climbs,
      settings: { referenceSpeedKph: bundle.settings.global.referenceSpeedKph, departureTime: '08:00' },
    })

    assert.ok(waypoints.length > 0, 'the stage still has its départ/arrivée/montées')
    assert.ok(waypoints.every((waypoint) => waypoint.kind !== 'pause'), 'K/L/M: never a synthetic "Pause du matin"/"principale"/"de l\'après-midi" waypoint')
    assert.ok(waypoints.every((waypoint) => waypoint.pauseDurationMinutes === null), 'section 12: no pause is placed before the structural phase has run')
  } finally {
    database.close()
  }
})

test('N: no imported waypoint is ever named "Service" — a POI category never becomes a place', async () => {
  const { result, database } = await runImport([trackFile('stage-1.gpx', 45)])
  try {
    assert.equal(result.ok, true)
    for (const point of result.bundle.routePoints) {
      assert.notEqual(point.name, 'Service')
    }
  } finally {
    database.close()
  }
})
