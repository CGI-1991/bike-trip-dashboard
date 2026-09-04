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
import { buildAutomaticPauseEnrichment, computeStageWaypoints } from '../../../src/analysis/waypoint-timeline.ts'
import { createGenericTripBundle } from '../../trip-core/support/generic-trip-fixture.mjs'

/** A real straight-line geometry spanning the fixture's own 62.4 km stage distance — the fixture's own 2-point `simplified` geometry alone is too coarse for pause-anchor window/edge-buffer fractions to line up with added route points' `trackDistanceKm`. */
function withRealGeometry(bundle) {
  const route = bundle.routes[0]
  const points = []
  for (let km = 0; km <= 63; km += 1) points.push({ latitude: 45.1 + km * 0.008993, longitude: 6.2, altitudeM: 210 + km * 5 })
  route.geometry = { full: points, simplified: points }
  return bundle
}

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

// Polish-final sections 12-16, 61-63: the weather module must select the
// SAME automatic-pause anchor the displayed Parcours timeline does
// (`day-detail-view.ts`), never a second, independently-computed one. A
// plain kind-priority search (`placeAutomaticPauses`, used pre-fix) always
// prefers a `city` over a `village`, however far from the ideal slot; the
// explainable C3 scoring (`recommendAutomaticPauses`, what Parcours has
// always used) can prefer a much closer village backed by real POI instead
// — exactly the divergence that used to leave the displayed pause anchor
// with no weather at all.
test('weather selects the same automatic-pause anchor Parcours displays, even when it diverges from the plain kind-priority search', () => {
  const bundle = withRealGeometry(createGenericTripBundle())
  const stage = bundle.stages[0]
  const route = bundle.routes[0]
  bundle.routePoints.push(
    {
      id: 'city-far', routeId: route.id, type: 'passage', name: 'Far City',
      latitude: 45.2, longitude: 6.4, elevationM: 400, trackDistanceKm: 41,
      osmFeatureType: 'city', lateralDistanceKm: 0.2,
      provenance: { sourceType: 'osm', sourceId: 'postpass:city:far', fetchedAt: null, engineVersion: 'route-enrichment@4', confidence: 'high', manuallyOverridden: false },
    },
    {
      id: 'village-near', routeId: route.id, type: 'passage', name: 'Near Village',
      latitude: 45.18, longitude: 6.35, elevationM: 380, trackDistanceKm: 46.9,
      osmFeatureType: 'village', lateralDistanceKm: 0.1,
      provenance: { sourceType: 'osm', sourceId: 'postpass:village:near', fetchedAt: null, engineVersion: 'route-enrichment@4', confidence: 'high', manuallyOverridden: false },
    },
  )
  stage.routePointIds.push('city-far', 'village-near')
  bundle.practicalPlaces.push(
    { id: 'poi-bakery', stageId: stage.id, category: 'bakery', name: 'Village Bakery', latitude: 45.18, longitude: 6.35, description: null, trackDistanceKm: 46.9, detourKm: 0.02, openingHours: null, hidden: false, pinned: false, dayIds: [bundle.days[0].id], provenance: { sourceType: 'osm', sourceId: 'mock:poi:bakery', fetchedAt: null, engineVersion: 'practical-places-postpass@1', confidence: 'high', manuallyOverridden: false } },
    { id: 'poi-water', stageId: stage.id, category: 'water', name: null, latitude: 45.18, longitude: 6.35, description: null, trackDistanceKm: 46.92, detourKm: 0.01, openingHours: null, hidden: false, pinned: false, dayIds: [bundle.days[0].id], provenance: { sourceType: 'osm', sourceId: 'mock:poi:water', fetchedAt: null, engineVersion: 'practical-places-postpass@1', confidence: 'high', manuallyOverridden: false } },
  )

  // What Parcours actually displays (`day-detail-view.ts`'s own call shape).
  const settings = { referenceSpeedKph: bundle.settings.global.referenceSpeedKph, departureTime: '08:00' }
  const displayed = computeStageWaypoints({
    stage, route, routePoints: bundle.routePoints, climbs: [], settings,
    automaticPauseEnrichment: buildAutomaticPauseEnrichment(bundle, stage, bundle.days[0]),
  })
  const displayedPause = displayed.find((waypoint) => waypoint.pauseDurationMinutes !== null)
  assert.equal(displayedPause?.name, 'Near Village', 'the POI-backed village, not the merely-closer-to-nothing city, is what Parcours anchors its pause to')

  const definition = buildRideDayWeatherDefinition(bundle, bundle.days[0])
  assert.ok(findPoint(definition, 'Near Village') !== undefined, 'the exact waypoint Parcours displays as the pause anchor has a weather sample point')
  assert.equal(findPoint(definition, 'Far City'), undefined, 'the city never carrying a pause stays a bare, insignificant locality on both sides')
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

// Integrity-hardening sections 39-46 (tests 76-79): weather geography must
// share the exact resolvers the UI itself reads — a manual override, and a
// transfer/OFF chain, must resolve identically on both sides.

function minimalStage(overrides = {}) {
  return { id: 'stage-x', dayId: 'day-x', sourceRouteId: 'route-x', name: null, startLocationName: null, endLocationName: null, distanceKm: null, elevationGainM: null, elevationLossM: null, minAltitudeM: null, maxAltitudeM: null, movingDurationSeconds: null, pauseDurationSeconds: null, totalDurationSeconds: null, estimatedAverageSpeedKph: null, validationStatus: 'pending', metricsProvenance: null, climbIds: [], routePointIds: [], weatherRecordIds: [], ...overrides }
}
function minimalRoute(overrides = {}) {
  return { id: 'route-x', sourceFileId: null, segments: [], geometry: { full: null, simplified: null }, profile: null, parsingStatus: 'success', parsingErrors: [], provenance: { sourceType: 'gpx', sourceId: null, fetchedAt: null, engineVersion: 'test@1', confidence: 'high', manuallyOverridden: false }, ...overrides }
}
function minimalDay(overrides = {}) {
  return { id: 'day-x', index: 0, displayNumber: 1, date: '2027-06-01', type: 'off', stageId: null, startLocationName: null, endLocationName: null, accommodationId: null, notes: null, enrichmentStatus: 'not-started', ...overrides }
}
function geometryFromEndpoints(start, end) {
  return { full: [{ latitude: start[0], longitude: start[1], altitudeM: null }, { latitude: end[0], longitude: end[1], altitudeM: null }], simplified: null }
}

test('a manual "Choisir sur la carte" override on an OFF day is honoured for weather — never silently replaced by the nearest ride endpoint', () => {
  const days = [
    minimalDay({ id: 'd0', index: 0, type: 'ride', stageId: 's0', date: '2027-06-01' }),
    minimalDay({ id: 'd1', index: 1, type: 'off', date: '2027-06-02', startLocationName: 'Refuge isolé', overrideStartLatitude: 48.0, overrideStartLongitude: 2.0 }),
  ]
  const stages = [minimalStage({ id: 's0', sourceRouteId: 'r0' })]
  const routes = [minimalRoute({ id: 'r0', geometry: geometryFromEndpoints([44.1, 6.1], [44.9, 6.9]) })]
  const bundle = { days, stages, routes }
  const definition = buildOffDayWeatherDefinition(bundle, days[1])
  assert.ok(definition !== null)
  assert.equal(definition.samplePoints[0].latitude, 48.0, 'the manual pin wins, never the nearest ride stage endpoint (44.9)')
  assert.equal(definition.samplePoints[0].longitude, 2.0)
})

test('Ride A → Transfer (manual destination) → OFF → Ride B: the OFF day\'s weather resolves at the transfer\'s destination, never skipping back to Ride A\'s own endpoint', () => {
  const days = [
    minimalDay({ id: 'd0', index: 0, type: 'ride', stageId: 's0', date: '2027-06-01' }),
    minimalDay({ id: 'd1', index: 1, type: 'transfer', date: '2027-06-02', overrideEndLatitude: 50.0, overrideEndLongitude: 3.0, endLocationName: 'Ville étape' }),
    minimalDay({ id: 'd2', index: 2, type: 'off', date: '2027-06-03' }),
    minimalDay({ id: 'd3', index: 3, type: 'ride', stageId: 's3', date: '2027-06-04' }),
  ]
  const stages = [minimalStage({ id: 's0', sourceRouteId: 'r0' }), minimalStage({ id: 's3', sourceRouteId: 'r3' })]
  const routes = [
    minimalRoute({ id: 'r0', geometry: geometryFromEndpoints([44.1, 6.1], [44.9, 6.9]) }),
    minimalRoute({ id: 'r3', geometry: geometryFromEndpoints([51.0, 3.5], [51.5, 3.8]) }),
  ]
  const bundle = { days, stages, routes }
  const definition = buildOffDayWeatherDefinition(bundle, days[2])
  assert.ok(definition !== null)
  assert.equal(definition.samplePoints[0].latitude, 50.0, 'resolves at the transfer\'s own destination, never Ride A\'s end (44.9) — the old "nearest ride" scan\'s exact bug')
  assert.equal(definition.samplePoints[0].longitude, 3.0)
})

test('a chained transfer (T1 → T2) resolves T2\'s origin weather from T1\'s own manual destination, never a ride two hops away', () => {
  const days = [
    minimalDay({ id: 'd0', index: 0, type: 'ride', stageId: 's0', date: '2027-06-01' }),
    minimalDay({ id: 'd1', index: 1, type: 'transfer', date: '2027-06-02', overrideEndLatitude: 49.0, overrideEndLongitude: 2.5, endLocationName: 'Gare intermédiaire' }),
    minimalDay({ id: 'd2', index: 2, type: 'transfer', date: '2027-06-03' }),
    minimalDay({ id: 'd3', index: 3, type: 'ride', stageId: 's3', date: '2027-06-04' }),
  ]
  const stages = [minimalStage({ id: 's0', sourceRouteId: 'r0' }), minimalStage({ id: 's3', sourceRouteId: 'r3' })]
  const routes = [
    minimalRoute({ id: 'r0', geometry: geometryFromEndpoints([44.1, 6.1], [44.9, 6.9]) }),
    minimalRoute({ id: 'r3', geometry: geometryFromEndpoints([51.0, 3.5], [51.5, 3.8]) }),
  ]
  const bundle = { days, stages, routes }
  const { origin } = buildTransferWeatherDefinitions(bundle, days[2])
  assert.ok(origin !== null)
  assert.equal(origin.samplePoints[0].latitude, 49.0, 'T2\'s origin is T1\'s own destination, never Ride A\'s end (44.9) two hops away')
  assert.equal(origin.samplePoints[0].longitude, 2.5)
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
