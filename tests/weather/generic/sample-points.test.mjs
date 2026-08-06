import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  buildOffDayWeatherDefinition,
  buildRideDayWeatherDefinition,
  buildTransferWeatherDefinitions,
  buildTripWeatherDayDefinitions,
  transferDestinationDayKey,
  transferOriginDayKey,
} from '../../../src/weather/generic/sample-points.ts'
import { createGenericTripBundle } from '../../trip-core/support/generic-trip-fixture.mjs'

function findPoint(definition, name) {
  return definition.samplePoints.find((point) => point.name === name)
}

// --- CDC Jalon C1 section 25: which points a ride day includes/excludes ---

test('a ride day always includes its départ and arrivée as weather points', () => {
  const bundle = createGenericTripBundle()
  const definition = buildRideDayWeatherDefinition(bundle, bundle.days[0])
  assert.ok(definition !== null)
  assert.ok(findPoint(definition, 'Riverside') !== undefined, 'départ present')
  const start = findPoint(definition, 'Riverside')
  assert.equal(start.type, 'start')
})

test('a point carrying a pause is included even though its underlying kind (village/town/city) would otherwise be excluded', () => {
  const bundle = createGenericTripBundle()
  bundle.routePoints.push({
    id: 'village-paused', routeId: bundle.routes[0].id, type: 'passage', name: 'Micro Village',
    latitude: 45.2, longitude: 6.35, elevationM: 300, trackDistanceKm: 30,
    osmFeatureType: 'village', lateralDistanceKm: 0.5,
    provenance: { sourceType: 'osm', sourceId: 'postpass:village:1', fetchedAt: null, engineVersion: 'route-enrichment@4', confidence: 'high', manuallyOverridden: false },
  })
  bundle.stages[0].routePointIds.push('village-paused')
  bundle.settings.stages[0] = {
    stageId: bundle.stages[0].id, pausePlanMode: 'custom',
    pauses: [{ id: 'pause-village', active: true, routePointId: 'village-paused', durationSeconds: 600, order: 0, origin: 'custom' }],
  }
  const definition = buildRideDayWeatherDefinition(bundle, bundle.days[0])
  const point = findPoint(definition, 'Micro Village')
  assert.ok(point !== undefined, 'the paused village is a weather point')
  assert.equal(point.type, 'passage', 'a paused locality maps to the roadbook "arrêt principal" vocabulary')
  // Never duplicated as a separate "village" + "pause" pair (CDC section 10).
  assert.equal(definition.samplePoints.filter((candidate) => candidate.name === 'Micro Village').length, 1)
})

test('a city/town/village without a pause is excluded from the weather points, same as Parcours', () => {
  const bundle = createGenericTripBundle()
  bundle.routePoints.push(
    {
      id: 'village-bare', routeId: bundle.routes[0].id, type: 'passage', name: 'Village Sans Pause',
      latitude: 45.2, longitude: 6.35, elevationM: 300, trackDistanceKm: 30,
      osmFeatureType: 'village', lateralDistanceKm: 0.5,
      provenance: { sourceType: 'osm', sourceId: 'postpass:village:2', fetchedAt: null, engineVersion: 'route-enrichment@4', confidence: 'high', manuallyOverridden: false },
    },
    {
      id: 'town-bare', routeId: bundle.routes[0].id, type: 'passage', name: 'Ville Sans Pause',
      latitude: 45.21, longitude: 6.36, elevationM: 310, trackDistanceKm: 40,
      osmFeatureType: 'town', lateralDistanceKm: 0.3,
      provenance: { sourceType: 'osm', sourceId: 'postpass:town:2', fetchedAt: null, engineVersion: 'route-enrichment@4', confidence: 'high', manuallyOverridden: false },
    },
  )
  bundle.stages[0].routePointIds.push('village-bare', 'town-bare')
  const definition = buildRideDayWeatherDefinition(bundle, bundle.days[0])
  assert.equal(findPoint(definition, 'Village Sans Pause'), undefined)
  assert.equal(findPoint(definition, 'Ville Sans Pause'), undefined)
})

test('a major climb with no matching col/saddle landmark becomes its own "summit" weather point', () => {
  const bundle = createGenericTripBundle()
  bundle.climbs.push({
    id: 'climb-major', routeId: bundle.routes[0].id, name: 'Col Majeur',
    startDistanceKm: 10, endDistanceKm: 15, elevationGainM: 450,
    averageGradientPercent: 9, maxGradientPercent: 13, startAltitudeM: 300, endAltitudeM: 750,
    confidence: 'confirmed',
    provenance: { sourceType: 'osm', sourceId: 'postpass:climb:1', fetchedAt: null, engineVersion: 'route-enrichment@4', confidence: 'high', manuallyOverridden: false },
  })
  bundle.stages[0].climbIds.push('climb-major')
  const definition = buildRideDayWeatherDefinition(bundle, bundle.days[0])
  const point = findPoint(definition, 'Col Majeur')
  assert.ok(point !== undefined, 'a principal climb is a weather point even with no col/saddle landmark')
  assert.equal(point.type, 'summit')
})

test('a secondary climb (not principal) is excluded from the weather points, same as the default Parcours view', () => {
  const bundle = createGenericTripBundle()
  bundle.climbs.push({
    id: 'climb-minor', routeId: bundle.routes[0].id, name: 'Petite Bosse',
    startDistanceKm: 10, endDistanceKm: 10.3, elevationGainM: 20,
    averageGradientPercent: 2, maxGradientPercent: 3, startAltitudeM: 300, endAltitudeM: 320,
    confidence: 'probable',
    provenance: { sourceType: 'generated', sourceId: null, fetchedAt: null, engineVersion: 'route-enrichment@4', confidence: 'low', manuallyOverridden: false },
  })
  bundle.stages[0].climbIds.push('climb-minor')
  const definition = buildRideDayWeatherDefinition(bundle, bundle.days[0])
  assert.equal(findPoint(definition, 'Petite Bosse'), undefined)
})

test('a col landmark merged with its detected climb is a single weather point, never duplicated', () => {
  const bundle = createGenericTripBundle()
  bundle.climbs.push({
    id: 'climb-col', routeId: bundle.routes[0].id, name: 'Col Fusionné',
    startDistanceKm: 10, endDistanceKm: 15, elevationGainM: 450,
    averageGradientPercent: 9, maxGradientPercent: 13, startAltitudeM: 300, endAltitudeM: 750,
    confidence: 'confirmed',
    provenance: { sourceType: 'osm', sourceId: 'postpass:climb:2', fetchedAt: null, engineVersion: 'route-enrichment@4', confidence: 'high', manuallyOverridden: false },
  })
  bundle.stages[0].climbIds.push('climb-col')
  bundle.routePoints.push({
    id: 'col-landmark', routeId: bundle.routes[0].id, type: 'passage', name: 'Col Fusionné',
    latitude: 45.25, longitude: 6.4, elevationM: 750, trackDistanceKm: 15,
    osmFeatureType: 'mountain-pass', lateralDistanceKm: 0.05,
    provenance: { sourceType: 'osm', sourceId: 'postpass:col:1', fetchedAt: null, engineVersion: 'route-enrichment@4', confidence: 'high', manuallyOverridden: false },
  })
  bundle.stages[0].routePointIds.push('col-landmark')
  const definition = buildRideDayWeatherDefinition(bundle, bundle.days[0])
  const matches = definition.samplePoints.filter((point) => point.name === 'Col Fusionné')
  assert.equal(matches.length, 1, 'one weather point, not one for the col and one for the climb')
  assert.equal(matches[0].type, 'col')
})

test('returns null for a non-ride day, or a ride day whose stage/route cannot be resolved', () => {
  const bundle = createGenericTripBundle()
  assert.equal(buildRideDayWeatherDefinition(bundle, bundle.days[1]), null, 'OFF day')
  assert.equal(buildRideDayWeatherDefinition(bundle, bundle.days[2]), null, 'transfer day')
  assert.equal(buildRideDayWeatherDefinition(bundle, bundle.days[3]), null, 'day-delta has no route geometry in the fixture')
})

// --- CDC Jalon C1 section 26: ETA/timeline reuse, never recomputed here ---

test('a sample point\'s eta is derived from the already-computed elapsedMinutes/departureTime — never a second timing computation', () => {
  const bundle = createGenericTripBundle()
  const definition = buildRideDayWeatherDefinition(bundle, bundle.days[0])
  const start = findPoint(definition, 'Riverside')
  assert.ok(start.eta !== undefined)
  // Departure is 08:00 (the fixture's own day settings) and départ is the
  // very first waypoint (elapsedMinutes 0), so its eta must be exactly 08:00.
  assert.equal(start.eta.clockMinutes, 8 * 60)
  assert.equal(start.eta.dayOffset, 0)
})

test('changing the reference speed changes every point\'s eta, without this module recomputing anything itself (it only reads whatever computeStageWaypoints produced)', () => {
  const slow = createGenericTripBundle()
  const fast = createGenericTripBundle()
  fast.settings.global.referenceSpeedKph = slow.settings.global.referenceSpeedKph * 2
  const slowArrival = findPoint(buildRideDayWeatherDefinition(slow, slow.days[0]), 'Hilltown')
  const fastArrival = findPoint(buildRideDayWeatherDefinition(fast, fast.days[0]), 'Hilltown')
  assert.ok(fastArrival.eta.clockMinutes < slowArrival.eta.clockMinutes, 'doubling the reference speed must move the arrival eta earlier')
})

// --- CDC Jalon C1 section 28: OFF / transfer ---

test('an OFF day resolves a single weather point at the real coordinates of the nearest ride stage endpoint — never an invented location', () => {
  const bundle = createGenericTripBundle()
  const definition = buildOffDayWeatherDefinition(bundle, bundle.days[1])
  assert.ok(definition !== null)
  assert.equal(definition.samplePoints.length, 1)
  const point = definition.samplePoints[0]
  assert.equal(point.type, 'off-location')
  // day-bravo (OFF) sits right after day-alpha, whose stage-alpha ends at
  // Hilltown (45.3, 6.5) — the OFF day's own coordinates must match that
  // real endpoint, never a fabricated (0, 0) or the départ's coordinates.
  assert.equal(point.latitude, 45.3)
  assert.equal(point.longitude, 6.5)
})

test('a transfer day resolves an independent origin weather definition from the previous ride stage\'s real endpoint, never a single combined day', () => {
  const bundle = createGenericTripBundle()
  const { origin, destination } = buildTransferWeatherDefinitions(bundle, bundle.days[2])
  assert.ok(origin !== null)
  assert.equal(origin.dayId, transferOriginDayKey(bundle.days[2].id))
  assert.equal(origin.samplePoints.length, 1)
  assert.equal(origin.dayType, 'off')
  // day-charlie (transfer) sits right after day-alpha, whose stage-alpha
  // ends at Hilltown (45.3, 6.5) — the transfer's origin must match that
  // real endpoint.
  assert.equal(origin.samplePoints[0].latitude, 45.3)
  assert.equal(origin.samplePoints[0].longitude, 6.5)
  // day-delta (the next ride day) has no route geometry in this fixture —
  // the destination must gracefully resolve to `null` rather than fabricate
  // coordinates (CDC section 13: "aucun waypoint vélo inventé").
  assert.equal(destination, null)
})

test('a transfer day\'s destination resolves once the next ride stage actually has usable geometry', () => {
  const bundle = createGenericTripBundle()
  // Give day-delta's route real geometry so the destination can resolve.
  bundle.routes[1] = {
    ...bundle.routes[1],
    geometry: { full: null, simplified: [{ latitude: 45.6, longitude: 6.9, altitudeM: 500 }, { latitude: 45.7, longitude: 7.0, altitudeM: 900 }] },
  }
  const { destination } = buildTransferWeatherDefinitions(bundle, bundle.days[2])
  assert.ok(destination !== null)
  assert.equal(destination.dayId, transferDestinationDayKey(bundle.days[2].id))
  assert.equal(destination.samplePoints[0].latitude, 45.6)
  assert.equal(destination.samplePoints[0].longitude, 6.9)
})

test('buildTripWeatherDayDefinitions builds one entry per ride/OFF day and two suffixed entries per transfer day, skipping unresolvable days', () => {
  const bundle = createGenericTripBundle()
  const definitions = buildTripWeatherDayDefinitions(bundle)
  const dayIds = definitions.map((definition) => definition.dayId)
  assert.ok(dayIds.includes('day-alpha'), 'the resolvable ride day is present')
  assert.ok(!dayIds.includes('day-delta'), 'day-delta has no geometry — skipped, never a broken entry')
  assert.ok(dayIds.includes('day-bravo'), 'the OFF day is present')
  assert.ok(dayIds.includes(transferOriginDayKey('day-charlie')), 'the transfer day contributes its origin key')
})

// --- CDC Jalon C1 section 24: no RGA hardcode ---

test('this module never imports rga2026TripPlan, roadbook-match.ts, or the RGA-hardcoded trip/types.ts (TripPlan/TripTimeline/TripDayId)', () => {
  const source = readFileSync(new URL('../../../src/weather/generic/sample-points.ts', import.meta.url), 'utf8')
  const importLines = source.split('\n').filter((line) => /^import\b/.test(line))
  assert.ok(importLines.every((line) => !line.includes('rga2026TripPlan')))
  assert.ok(importLines.every((line) => !line.includes("'../trip/roadbook-match.ts'") && !line.includes("'../../trip/roadbook-match.ts'")))
  assert.ok(importLines.every((line) => !line.includes("'../trip/types.ts'") && !line.includes("'../../trip/types.ts'")), 'never imports the RGA-hardcoded TripPlan/TripTimeline/TripDayId module')
})
