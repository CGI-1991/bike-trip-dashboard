import { installMinimalDOMParser } from '../support/minimal-dom-parser.mjs'
import './support/dom-shim.mjs'

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { buildGpxTrip } from '../../src/import/gpx/import-gpx-trip.ts'
import { buildTripOverview } from '../../src/ui/trips/trip-overview-view.ts'
import { buildGenericOverviewDetailMarkers } from '../../src/ui/route-map-model.ts'

installMinimalDOMParser()

// The Aperçu map's "Détail" layer showed the points of some stages and not
// others. This suite measures the aggregation per stage rather than judging
// it by eye: what each stage is expected to contribute, what reaches
// `mapDetailStages`, and what reaches the layer's markers.
//
// The layer surfaces exactly two kinds (`isOverviewDetailWaypoint`): a pause,
// and a NAMED col. A col only ever becomes a waypoint by merging into the
// climb it tops (`canonical-waypoints.ts`) — and that merge is by name. So a
// stage whose climb carried a GPX segment-marker name ("Fin grimpeur") could
// never merge its col, and contributed nothing at all. The aggregation
// itself, tested below, was never the faulty part.

const FIXTURES = new URL('../fixtures/gpx-segments/', import.meta.url)
const FILES = ['srada-delle-creste.gpx', 'il-hohneck.gpx', 'etape-reine.gpx']

function importFile(name) {
  const bytes = readFileSync(new URL(name, FIXTURES))
  return { name, mimeType: 'application/gpx+xml', sizeBytes: bytes.byteLength, lastModifiedAt: null, bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }
}

let counter = 0

/**
 * A three-stage trip whose first two stages are ridden the same day, with
 * one named col per stage — the state route enrichment leaves behind, i.e.
 * an OSM `mountain-pass` point on the route AND the climb renamed after it
 * (`enrichClimbs` only ever does that for a climb whose name is generic,
 * which is exactly what the segment-marker rule now guarantees).
 */
async function linkedTripWithCols() {
  const result = await buildGpxTrip({
    files: FILES.map(importFile),
    options: {
      tripId: 'trip-overview-detail', slug: 'trip-overview-detail', name: 'Détail',
      startDate: '2028-06-01', timezone: 'Europe/Brussels', totalBreakMinutes: 'adaptive',
      importedAt: '2028-01-01T00:00:00.000Z', engineVersion: 'overview-detail-test@1',
    },
    idFactory: () => `ov-${counter++}`,
    now: () => '2028-01-01T00:00:00.000Z',
  })
  assert.equal(result.ok, true, result.ok ? '' : result.error?.message)
  const bundle = result.bundle

  const routePoints = [...bundle.routePoints]
  const climbs = bundle.climbs.map((climb) => climb)
  const stages = bundle.stages.map((stage) => ({ ...stage }))

  bundle.routes.forEach((route, index) => {
    const stage = stages.find((candidate) => candidate.sourceRouteId === route.id)
    // The LAST climb of each stage gets its col — a different name per stage,
    // so a name-based dedup could not legitimately collapse them.
    const climb = climbs.filter((candidate) => candidate.routeId === route.id).at(-1)
    const geometry = route.geometry.full
    const summit = geometry[Math.min(geometry.length - 1, Math.round(geometry.length * 0.8))]
    const colName = `Col ${index + 1}`
    const pointId = `osm-col-${index}`
    routePoints.push({
      id: pointId, routeId: route.id, type: 'summit', name: colName,
      latitude: summit.latitude, longitude: summit.longitude, elevationM: summit.altitudeM,
      trackDistanceKm: climb.endDistanceKm, osmFeatureType: 'mountain-pass', lateralDistanceKm: 0,
      provenance: { sourceType: 'osm', sourceId: `osm-${index}`, fetchedAt: null, engineVersion: 'route-enrichment@4', confidence: 'high', manuallyOverridden: false },
    })
    const climbIndex = climbs.findIndex((candidate) => candidate.id === climb.id)
    climbs[climbIndex] = { ...climb, name: colName, confidence: 'confirmed', provenance: { ...climb.provenance, sourceType: 'osm', engineVersion: 'climb-name-enrichment@1' } }
    stage.routePointIds = [...stage.routePointIds, pointId]
  })

  // Stage 2 shares stage 1's calendar day.
  const days = bundle.days.map((day, index) => (index === 1 ? { ...day, date: bundle.days[0].date, sameCalendarDayAsPrevious: true } : index === 2 ? { ...day, date: bundle.days[1].date } : day))
  return {
    ...bundle,
    days,
    calendar: { ...bundle.calendar, endDate: days[days.length - 1].date },
    metadata: { ...bundle.metadata, endDate: days[days.length - 1].date },
    routePoints,
    climbs,
    stages,
  }
}

test('every stage of the trip contributes its own named col to the Détail layer — linked stages included', async () => {
  const bundle = await linkedTripWithCols()
  const overview = buildTripOverview(bundle, '2028-06-01')

  assert.equal(overview.mapDetailStages.length, 3, 'one detail entry per stage, never just the selected one')
  overview.mapDetailStages.forEach((stage, index) => {
    const names = stage.waypoints.map((waypoint) => waypoint.name)
    assert.ok(names.includes(`Col ${index + 1}`), `stage ${index + 1} contributes its own col (got ${JSON.stringify(names)})`)
  })

  const markers = buildGenericOverviewDetailMarkers(overview.mapDetailStages)
  for (let index = 0; index < 3; index++) {
    assert.equal(markers.filter((marker) => marker.name === `Col ${index + 1}`).length, 1, `stage ${index + 1}'s col reaches the layer exactly once`)
  }
})

test('the Détail markers carry unique ids across stages — no marker of one stage can replace another’s', async () => {
  const bundle = await linkedTripWithCols()
  const overview = buildTripOverview(bundle, '2028-06-01')
  const ids = buildGenericOverviewDetailMarkers(overview.mapDetailStages).map((marker) => marker.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('the Détail layer keeps its narrow category rule — never the full point list, never a plain climb', async () => {
  const bundle = await linkedTripWithCols()
  const overview = buildTripOverview(bundle, '2028-06-01')
  for (const stage of overview.mapDetailStages) {
    for (const waypoint of stage.waypoints) {
      const eligible = waypoint.pauseDurationMinutes !== null || waypoint.kind === 'mountain-pass' || waypoint.kind === 'saddle'
      assert.equal(eligible, true, `unexpected ${waypoint.kind} "${waypoint.name}" in the Détail layer`)
    }
  }
})

test('the base map keeps every stage’s trace and its two principal points, whatever the Détail layer shows', async () => {
  const bundle = await linkedTripWithCols()
  const overview = buildTripOverview(bundle, '2028-06-01')
  assert.equal(overview.mapStages.length, 3)
  for (const stage of overview.mapStages) {
    assert.ok(stage.geometry.length > 1, 'the full ridden trace is drawn for every stage')
    assert.deepEqual(stage.waypoints.map((waypoint) => waypoint.kind).sort(), ['end', 'start'])
  }
})

test('a climb still named after a segment marker is exactly what used to make a stage contribute nothing', async () => {
  const bundle = await linkedTripWithCols()
  // Put stage 2 back in the broken state: the climb keeps a marker name, so
  // it no longer matches its col and the merge cannot happen.
  const brokenRouteId = bundle.routes[1].id
  const broken = {
    ...bundle,
    climbs: bundle.climbs.map((climb) => (climb.routeId === brokenRouteId && climb.name === 'Col 2'
      ? { ...climb, name: 'Fin grimpeur', provenance: { ...climb.provenance, sourceType: 'generated' } }
      : climb)),
  }
  const overview = buildTripOverview(broken, '2028-06-01')
  assert.equal(overview.mapDetailStages[1].waypoints.length, 0, 'the affected stage contributes nothing at all')
  // …while its neighbours are unaffected, which is precisely the reported
  // "only some stages show points".
  assert.ok(overview.mapDetailStages[0].waypoints.some((waypoint) => waypoint.name === 'Col 1'))
  assert.ok(overview.mapDetailStages[2].waypoints.some((waypoint) => waypoint.name === 'Col 3'))
})
