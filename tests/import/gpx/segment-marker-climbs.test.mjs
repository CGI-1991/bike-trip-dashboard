import { installMinimalDOMParser } from '../../support/minimal-dom-parser.mjs'
import '../../ui/support/dom-shim.mjs'

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { buildGpxTrip } from '../../../src/import/gpx/import-gpx-trip.ts'
import { buildCanonicalWaypoints } from '../../../src/analysis/canonical-waypoints.ts'
import { isRouteAnnotationMarker, isSegmentMarkerClimbName } from '../../../src/analysis/gpx-marker-names.ts'
import { repairSegmentMarkerClimbNames } from '../../../src/trips-manager/climb-name-repair.ts'

installMinimalDOMParser()

// Five real route files (Strava exports, "avec segments") reproduce the two
// defects this suite pins down:
//
//  - the montée that tops out AT the stage arrival used to be emitted a few
//    centimetres PAST it, because `Climb.endDistanceKm` is measured on the
//    haversine-accumulated terrain profile while the arrival's own distance
//    comes from `cumulativeGeometryDistances`' equirectangular one. The two
//    disagree by 5-13 cm over a long stage, which was enough for the arrival
//    to sort first and the montée to read as part of it;
//  - every one of these files marks its sport segments with "Segment Start"/
//    "Segment End"/"Alert" waypoints. Those named the climbs ("Fin grimpeur",
//    "Début Sprint", and — 5 m from the finish — "Arrivée Bleu"), which is
//    also what stopped `enrichClimbs` from ever renaming them from a real OSM
//    col (it only renames a GENERIC climb) and therefore what stopped the
//    col↔climb merge, and with it the named cols on the Aperçu map.

const FIXTURES = new URL('../../fixtures/gpx-segments/', import.meta.url)

/** The three files whose track ends while still climbing — the arrival-fusion cases. */
const ARRIVAL_CLIMB_FILES = ['srada-delle-creste.gpx', 'il-hohneck.gpx', 'etape-reine.gpx']
const ALL_FILES = [...ARRIVAL_CLIMB_FILES, 'i-mille-stagni.gpx', 'cronometro-a-squadre.gpx']

function importFile(name) {
  const bytes = readFileSync(new URL(name, FIXTURES))
  return {
    name,
    mimeType: 'application/gpx+xml',
    sizeBytes: bytes.byteLength,
    lastModifiedAt: null,
    bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  }
}

let counter = 0
async function importStages(names) {
  const result = await buildGpxTrip({
    files: names.map(importFile),
    options: {
      tripId: 'trip-segments', slug: 'trip-segments', name: 'Segments',
      startDate: '2028-06-01', timezone: 'Europe/Brussels', totalBreakMinutes: 'adaptive',
      importedAt: '2028-01-01T00:00:00.000Z', engineVersion: 'segment-marker-test@1',
    },
    idFactory: () => `seg-${counter++}`,
    now: () => '2028-01-01T00:00:00.000Z',
  })
  assert.equal(result.ok, true, result.ok ? '' : result.error?.message)
  return result.bundle
}

function waypointsFor(bundle, stageIndex) {
  const stage = bundle.stages[stageIndex]
  const route = bundle.routes.find((candidate) => candidate.id === stage.sourceRouteId)
  return buildCanonicalWaypoints({ stage, route, routePoints: bundle.routePoints, climbs: bundle.climbs })
}

// --- the naming rule ---------------------------------------------------------

test('a declared segment boundary or route alert never names a climb, whatever its label says', () => {
  assert.equal(isRouteAnnotationMarker('Fin grimpeur', 'Segment End'), true)
  assert.equal(isRouteAnnotationMarker('Début grimpeur', 'Segment Start'), true)
  assert.equal(isRouteAnnotationMarker('Ultimo Kilometro', 'Alert'), true)
  // A waypoint the author placed as a real point still names its climb.
  assert.equal(isRouteAnnotationMarker('Col du Platzerwasel', 'Summit'), false)
  assert.equal(isRouteAnnotationMarker('Col du Platzerwasel', null), false)
})

test('with no declared type, a boundary-shaped label is still refused — and a place name still accepted', () => {
  assert.equal(isRouteAnnotationMarker('Arrivée Bleu', null), true)
  assert.equal(isRouteAnnotationMarker('Fin Sprint', null), true)
  assert.equal(isRouteAnnotationMarker('Départ étape', null), true)
  assert.equal(isRouteAnnotationMarker('Ballon d’Alsace', null), false)
  assert.equal(isRouteAnnotationMarker('Grand Ballon', null), false)
})

test('the GPX marker type survives the import, so a recomputation reads the same signal', async () => {
  const bundle = await importStages(['srada-delle-creste.gpx'])
  const byName = new Map(bundle.routePoints.map((point) => [point.name, point.gpxMarkerType]))
  assert.equal(byName.get('Arrivée Bleu'), 'Segment End')
  assert.equal(byName.get('Début grimpeur'), 'Segment Start')
  assert.equal(byName.get('Ultimo Kilometro'), 'Alert')
})

test('no climb of any of the five files is named after a segment marker', async () => {
  for (const file of ALL_FILES) {
    const bundle = await importStages([file])
    assert.ok(bundle.climbs.length > 0, `${file}: the file still yields climbs`)
    for (const climb of bundle.climbs) {
      assert.equal(isSegmentMarkerClimbName(climb.name), false, `${file}: "${climb.name}" is a segment marker, not a climb name`)
    }
  }
})

test('a "Sprint" or "Bleu" segment never turns into a climb, and never lends its name to one', async () => {
  const bundle = await importStages(['i-mille-stagni.gpx', 'cronometro-a-squadre.gpx'])
  for (const climb of bundle.climbs) {
    assert.doesNotMatch(climb.name, /sprint|bleu/iu, `"${climb.name}" borrowed a sprint/blue segment label`)
  }
})

test('the climbs left generic are exactly what lets a later OSM pass name them — none carries a confirmed segment name', async () => {
  const bundle = await importStages(['il-hohneck.gpx'])
  // Two climbs used to end up both called "Fin grimpeur"; generic numbering
  // now keeps them distinguishable and collision-free.
  const names = bundle.climbs.map((climb) => climb.name)
  assert.equal(new Set(names).size, names.length, 'no two climbs share a name')
  assert.equal(new Set(bundle.climbs.map((climb) => climb.id)).size, bundle.climbs.length, 'ids stay unique whatever the names')
})

// --- the arrival stays its own block ----------------------------------------

test('a stage whose track ends climbing keeps the montée and the arrivée as two distinct, correctly ordered blocks', async () => {
  for (const file of ARRIVAL_CLIMB_FILES) {
    const bundle = await importStages([file])
    const waypoints = waypointsFor(bundle, 0)
    const last = waypoints[waypoints.length - 1]
    const beforeLast = waypoints[waypoints.length - 2]

    assert.equal(last.kind, 'end', `${file}: the arrival is last`)
    assert.equal(beforeLast.kind, 'climb', `${file}: the final climb reads just before it`)
    assert.equal(beforeLast.trackDistanceKm, last.trackDistanceKm, `${file}: they legitimately share one position`)
    assert.notEqual(beforeLast.id, last.id, `${file}: two objects, two ids`)
    assert.equal(last.climbId, null, `${file}: the arrival never absorbs the climb`)
    assert.ok(beforeLast.climbId !== null, `${file}: the climb keeps its own statistics`)
  }
})

test('a climb never sits past the arrival, whichever distance accumulator measured it', async () => {
  for (const file of ALL_FILES) {
    const bundle = await importStages([file])
    const waypoints = waypointsFor(bundle, 0)
    const arrivalKm = waypoints[waypoints.length - 1].trackDistanceKm
    for (const waypoint of waypoints) {
      assert.ok(waypoint.trackDistanceKm <= arrivalKm + 1e-9, `${file}: "${waypoint.name}" at ${waypoint.trackDistanceKm} is past the arrival at ${arrivalKm}`)
    }
  }
})

test('one climb at the arrival produces exactly one climb block', async () => {
  const bundle = await importStages(['srada-delle-creste.gpx'])
  const waypoints = waypointsFor(bundle, 0)
  const finalClimb = waypoints[waypoints.length - 2]
  assert.equal(waypoints.filter((waypoint) => waypoint.climbId === finalClimb.climbId).length, 1)
})

// --- the repair for trips imported before the rule existed ------------------

test('an already-imported trip has its segment-marker climb names repaired, and adopts a known col where there is one', async () => {
  const bundle = await importStages(['il-hohneck.gpx'])
  const route = bundle.routes[0]
  const target = bundle.climbs[bundle.climbs.length - 1]
  // Reproduces what the old import stored: the marker name, treated as
  // confirmed. One of the two climbs also has a real OSM col next to it,
  // exactly as route enrichment would have recorded.
  const stale = {
    ...bundle,
    climbs: bundle.climbs.map((climb) => ({ ...climb, name: 'Fin grimpeur', confidence: 'confirmed' })),
    routePoints: [
      ...bundle.routePoints,
      {
        id: 'osm-col-1', routeId: route.id, type: 'summit', name: 'Col du Test',
        latitude: 48.03, longitude: 7.01, elevationM: 1200, trackDistanceKm: target.endDistanceKm,
        osmFeatureType: 'mountain-pass', lateralDistanceKm: 0,
        provenance: { sourceType: 'osm', sourceId: 'osm-1', fetchedAt: null, engineVersion: 'route-enrichment@4', confidence: 'high', manuallyOverridden: false },
      },
    ],
  }

  const repaired = repairSegmentMarkerClimbNames(stale)
  assert.notEqual(repaired, stale, 'a trip that needs repairing is genuinely rewritten')
  for (const climb of repaired.climbs) {
    assert.equal(isSegmentMarkerClimbName(climb.name), false)
  }
  assert.equal(repaired.climbs.find((climb) => climb.id === target.id).name, 'Col du Test', 'the col the trip already knows becomes the climb’s name')
  // Idempotent: a second pass changes nothing.
  assert.equal(repairSegmentMarkerClimbNames(repaired), repaired)
})

test('the repair never touches a manual climb or one already named from OSM', async () => {
  const bundle = await importStages(['cronometro-a-squadre.gpx'])
  const stale = {
    ...bundle,
    climbs: [
      { ...bundle.climbs[0], name: 'Fin grimpeur', provenance: { ...bundle.climbs[0].provenance, sourceType: 'user', manuallyOverridden: true } },
      { ...bundle.climbs[1], name: 'Arrivée Bleu', provenance: { ...bundle.climbs[1].provenance, sourceType: 'osm' } },
    ],
  }
  assert.equal(repairSegmentMarkerClimbNames(stale), stale, 'nothing the traveller or OSM owns is rewritten')
})

test('a trip with nothing to repair is returned untouched — no pointless write', async () => {
  const bundle = await importStages(['i-mille-stagni.gpx'])
  assert.equal(repairSegmentMarkerClimbNames(bundle), bundle)
})
