import { installMinimalDOMParser } from '../support/minimal-dom-parser.mjs'
import './support/dom-shim.mjs'

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { buildGpxTrip } from '../../src/import/gpx/import-gpx-trip.ts'
import { buildDayDetail } from '../../src/ui/trips/day-detail-view.ts'
import { buildGenericRouteMapModel } from '../../src/ui/route-map-model.ts'
import { NO_MARKER_OFFSET, resolveMarkerIconOffsets } from '../../src/ui/marker-collision-offsets.ts'

installMinimalDOMParser()

// A climb that tops out ON the arrival line must stay two things on screen:
// its own montée card, and the arrivée right after it. The model has produced
// two distinct waypoints for a while; what these tests pin down is the
// RENDERED result — the Parcours HTML, and the map, where two markers pinned
// to the same coordinate used to cover one another.

const FIXTURES = new URL('../fixtures/gpx-segments/', import.meta.url)
/** The three files whose track ends while still climbing. */
const ARRIVAL_CLIMB_FILES = ['srada-delle-creste.gpx', 'il-hohneck.gpx', 'etape-reine.gpx']

function importFile(name) {
  const bytes = readFileSync(new URL(name, FIXTURES))
  return { name, mimeType: 'application/gpx+xml', sizeBytes: bytes.byteLength, lastModifiedAt: null, bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }
}

let counter = 0
/** One import per fixture per process: the pipeline is the expensive part, and every test below wants the same result. */
const detailCache = new Map()
async function detailFor(file) {
  const cached = detailCache.get(file)
  if (cached !== undefined) return cached
  const built = await buildDetail(file)
  detailCache.set(file, built)
  return built
}

async function buildDetail(file) {
  const result = await buildGpxTrip({
    files: [importFile(file)],
    options: {
      tripId: 'arrival-climb', slug: 'arrival-climb', name: 'Arrivée',
      startDate: '2028-06-01', timezone: 'Europe/Brussels', totalBreakMinutes: 'adaptive',
      importedAt: '2028-01-01T00:00:00.000Z', engineVersion: 'arrival-climb-test@1',
    },
    idFactory: () => `ac-${counter++}`,
    now: () => '2028-01-01T00:00:00.000Z',
  })
  assert.equal(result.ok, true, result.ok ? '' : result.error?.message)
  return { bundle: result.bundle, detail: buildDayDetail(result.bundle, result.bundle.days[0].id) }
}

/** Every `<li>` of the rendered Parcours list, in order. */
function timelineRows(detail) {
  return [...detail.timelineHtml.matchAll(/<li class="day-detail__timeline-row[^]*?<\/li>/g)].map((match) => match[0])
}

// --- the Parcours list ------------------------------------------------------

test('the rendered Parcours HTML really contains both blocks, montée then arrivée', async () => {
  for (const file of ARRIVAL_CLIMB_FILES) {
    const { detail } = await detailFor(file)
    const rows = timelineRows(detail)
    const climbRow = rows.at(-2)
    const arrivalRow = rows.at(-1)

    assert.match(climbRow, /data-waypoint-kind="climb"/, `${file}: the second-to-last block is the montée`)
    assert.match(arrivalRow, /data-waypoint-kind="end"/, `${file}: the last block is the arrivée`)
    // Two separate <li>, never one merged row.
    assert.notEqual(climbRow, arrivalRow)
    const climbId = /data-waypoint-id="([^"]+)"/.exec(climbRow)[1]
    const arrivalId = /data-waypoint-id="([^"]+)"/.exec(arrivalRow)[1]
    assert.notEqual(climbId, arrivalId, `${file}: two blocks, two ids`)
  }
})

test('the final montée keeps its real card — name, longueur, D+, pente and mini-profil', async () => {
  for (const file of ARRIVAL_CLIMB_FILES) {
    const { detail } = await detailFor(file)
    const climbRow = timelineRows(detail).at(-2)

    assert.match(climbRow, /day-detail__climb-card/, `${file}: it is the rich climb card, not a plain row`)
    assert.match(climbRow, /data-action="toggle-climb-profile"/, `${file}: expandable like any other climb`)
    // "Longueur · D+ · Pente" — the climb's own figures, never the arrival's.
    assert.match(climbRow, /day-detail__timeline-meta">[\d,]+ km · \+\d+ m · [\d,]+ %</, `${file}: its statistics are there`)
    assert.match(climbRow, /day-detail__climb-profile-shape/, `${file}: the mini-profile is drawn`)
    assert.doesNotMatch(climbRow, /Profil indisponible/, `${file}: and it is not the empty fallback`)
    // Never a GPX segment label ("Fin grimpeur", "Arrivée Bleu"…).
    const name = /<strong><span class="day-detail__timeline-marker"[^>]*>[^<]*<\/span>([^<]*)<\/strong>/.exec(climbRow)[1]
    assert.doesNotMatch(name, /^(fin|d[ée]but|arriv[ée]e|d[ée]part)\b/iu, `${file}: "${name}" is a segment marker, not a climb name`)
  }
})

test('the arrivée block keeps the real arrival place, never the climb’s name', async () => {
  for (const file of ARRIVAL_CLIMB_FILES) {
    const { bundle, detail } = await detailFor(file)
    const arrivalRow = timelineRows(detail).at(-1)
    const stage = bundle.stages[0]
    const name = /<strong><span class="day-detail__timeline-marker"[^>]*>[^<]*<\/span>([^<]*)<\/strong>/.exec(arrivalRow)[1]
    assert.equal(name, stage.endLocationName, `${file}: the arrival carries its own place name`)
    assert.match(arrivalRow, /<span class="day-detail__timeline-meta">Arrivée · /, `${file}: and is labelled as the arrival`)
    assert.doesNotMatch(arrivalRow, /day-detail__climb-card/, `${file}: the arrival never becomes a climb card`)
  }
})

// --- the map ----------------------------------------------------------------

test('both markers stay in the map model, at their own untouched coordinates', async () => {
  for (const file of ARRIVAL_CLIMB_FILES) {
    const { detail } = await detailFor(file)
    const markers = buildGenericRouteMapModel(detail.waypoints, []).markers
    const climb = markers.at(-2)
    const finish = markers.at(-1)
    assert.equal(finish.category, 'finish')
    assert.equal(climb.category, 'col-summit')
    assert.deepEqual(climb.coordinate, finish.coordinate, `${file}: they genuinely share one position`)
    assert.notEqual(climb.id, finish.id)
  }
})

test('two markers on one spot are pulled apart graphically, and nothing else moves', async () => {
  for (const file of ARRIVAL_CLIMB_FILES) {
    const { detail } = await detailFor(file)
    const markers = buildGenericRouteMapModel(detail.waypoints, []).markers
    const offsets = resolveMarkerIconOffsets(markers)

    const climbOffset = offsets.at(-2)
    const finishOffset = offsets.at(-1)
    assert.notDeepEqual(climbOffset, finishOffset, `${file}: the colliding pair is separated`)
    assert.ok(climbOffset.x !== 0 || climbOffset.y !== 0)
    assert.ok(finishOffset.x !== 0 || finishOffset.y !== 0)
    // Every marker that collides with nothing keeps the historical anchor.
    for (const offset of offsets.slice(0, -2)) {
      assert.deepEqual(offset, NO_MARKER_OFFSET, `${file}: a lone marker is never displaced`)
    }
  }
})

test('the offsets are a pure, deterministic function of the positions alone', () => {
  const markers = [
    { coordinate: [45, 6] },
    { coordinate: [45.5, 6.5] },
    { coordinate: [45, 6] },
  ]
  const first = resolveMarkerIconOffsets(markers)
  assert.deepEqual(resolveMarkerIconOffsets(markers), first, 'same input, same output')
  assert.deepEqual(first[1], NO_MARKER_OFFSET)
  assert.deepEqual(first[0], { x: -7, y: -7 })
  assert.deepEqual(first[2], { x: 7, y: 7 })
})

test('three or more markers on one spot are spread too, never left stacked', () => {
  const offsets = resolveMarkerIconOffsets([{ coordinate: [45, 6] }, { coordinate: [45, 6] }, { coordinate: [45, 6] }])
  const keys = new Set(offsets.map((offset) => `${offset.x}|${offset.y}`))
  assert.equal(keys.size, 3)
})

test('a map with no collision at all is byte-for-byte unaffected', () => {
  const markers = [{ coordinate: [45, 6] }, { coordinate: [45.001, 6.001] }, { coordinate: [46, 7] }]
  assert.deepEqual(resolveMarkerIconOffsets(markers), [NO_MARKER_OFFSET, NO_MARKER_OFFSET, NO_MARKER_OFFSET])
})
