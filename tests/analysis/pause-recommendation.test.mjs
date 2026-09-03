import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildPauseCandidates,
  recommendAutomaticPauses,
  selectPauseRecommendations,
} from '../../src/analysis/pause-recommendation.ts'

// A synthetic 100 km stage. `routeEngineConfig.pauseRules` (src/route/config.ts)
// places ideal automatic-pause anchors at 25 %/50 %/75 % of the distance —
// 25 km / 50 km / 75 km here — with a 25/50/25 % share of the total budget.
const TOTAL_DISTANCE_KM = 100
const TOTAL_BREAK_MINUTES = 40 // -> morning 10 min @25km, main 20 min @50km, afternoon 10 min @75km

function waypoint(overrides = {}) {
  return {
    id: 'wp', kind: 'town', importance: 'major', visibleByDefault: false, name: 'Ville',
    trackDistanceKm: 50, latitude: 45, longitude: 6, elevationM: 400,
    climbId: null, pauseDurationMinutes: null, elapsedMinutes: null, clockTime: null,
    ...overrides,
  }
}

function place(overrides = {}) {
  return {
    id: 'place', category: 'bakery', name: 'Commerce', trackDistanceKm: 50, detourKm: 0.05, openingHours: null,
    ...overrides,
  }
}

function baseWaypoints() {
  return [
    waypoint({ id: 'start', kind: 'start', trackDistanceKm: 0, name: 'Départ' }),
    waypoint({ id: 'end', kind: 'end', trackDistanceKm: TOTAL_DISTANCE_KM, name: 'Arrivée' }),
  ]
}

/**
 * DER-DES-DER sections 21-23: a slot with no real place near it now produces
 * NO pause (rather than a synthetic one named after the slot). Tests that
 * only ever cared about "the engine still runs end to end" therefore need a
 * real anchor near each of the three slots (25/50/75 km) to keep asserting a
 * full three-pause plan.
 */
function threeAnchoredWaypoints() {
  return [
    ...baseWaypoints(),
    waypoint({ id: 'town-morning', trackDistanceKm: 25, name: 'Ville matin' }),
    waypoint({ id: 'town-main', trackDistanceKm: 50, name: 'Ville midi' }),
    waypoint({ id: 'town-afternoon', trackDistanceKm: 75, name: 'Ville après-midi' }),
  ]
}

function findRecommendation(recommendations, slotId) {
  return recommendations.find((recommendation) => recommendation.slotId === slotId)
}

// --- candidate construction (section 7) -------------------------------------

test('buildPauseCandidates: waypoint anchors become candidates, a nearby POI merges onto the closest one', () => {
  const candidates = buildPauseCandidates([...baseWaypoints(), waypoint({ id: 'town-a', trackDistanceKm: 50 })], [place({ id: 'bakery-1', trackDistanceKm: 50.1 })])
  const town = candidates.find((candidate) => candidate.id === 'town-a')
  assert.ok(town)
  assert.equal(town.places.length, 1)
  assert.equal(town.places[0].id, 'bakery-1')
})

test('buildPauseCandidates: a POI far from any waypoint becomes its own standalone candidate', () => {
  const candidates = buildPauseCandidates(baseWaypoints(), [place({ id: 'bakery-1', trackDistanceKm: 40 })])
  const standalone = candidates.find((candidate) => candidate.origin === 'poi')
  assert.ok(standalone)
  assert.equal(standalone.places[0].id, 'bakery-1')
})

test('buildPauseCandidates: two POI close to each other with no nearby waypoint merge into one standalone candidate, not two', () => {
  const candidates = buildPauseCandidates(baseWaypoints(), [place({ id: 'bakery-1', trackDistanceKm: 40 }), place({ id: 'water-1', category: 'water', trackDistanceKm: 40.1 })])
  const standalones = candidates.filter((candidate) => candidate.origin === 'poi')
  assert.equal(standalones.length, 1)
  assert.equal(standalones[0].places.length, 2)
})

// --- A-E: scoring (section 62) ----------------------------------------------

test('A: a locality with an open bakery beats an equidistant locality with no service', () => {
  const waypoints = [...baseWaypoints(), waypoint({ id: 'town-plain', trackDistanceKm: 49.5, name: 'Plaine' }), waypoint({ id: 'town-bakery', trackDistanceKm: 50.5, name: 'Boulange' })]
  const recommendations = recommendAutomaticPauses({
    totalBreakMinutes: TOTAL_BREAK_MINUTES, totalDistanceKm: TOTAL_DISTANCE_KM, waypoints, climbs: [],
    places: [place({ id: 'bakery-1', trackDistanceKm: 50.5, openingHours: null })],
  })
  const main = findRecommendation(recommendations, 'main')
  assert.equal(main.waypointId, 'town-bakery')
  assert.ok(main.reasons.includes('locality'))
})

// --- R2.1 sections 15-16: a standalone POI (no nearby structural anchor)
// must never itself become an automatic pause's name — the "Service"
// generic-lieu bug. ----------------------------------------------------------

test('N/R2.1: a standalone POI with no nearby waypoint anchor never wins the slot — and now produces no pause at all, never "Service"/a slot name', () => {
  const waypoints = baseWaypoints() // start/end only — no locality/col anywhere near the "main" ideal slot (50 km)
  const recommendations = recommendAutomaticPauses({
    totalBreakMinutes: TOTAL_BREAK_MINUTES, totalDistanceKm: TOTAL_DISTANCE_KM, waypoints, climbs: [],
    places: [place({ id: 'bakery-1', name: null, trackDistanceKm: 50, openingHours: null })],
  })
  // Section 24: a lone bakery/supermarket is a SERVICE, never a place to
  // anchor a pause on. With no real locality near the slot there is simply
  // no pause — neither a "Service"-named one nor a slot-named one.
  assert.deepEqual(recommendations, [])
})

test('R2.1: a standalone POI still enriches/scores a REAL nearby anchor (CDC "POI = service utile associé") — this merge behaviour is unaffected', () => {
  const waypoints = [...baseWaypoints(), waypoint({ id: 'town-bakery', trackDistanceKm: 50 })]
  const recommendations = recommendAutomaticPauses({
    totalBreakMinutes: TOTAL_BREAK_MINUTES, totalDistanceKm: TOTAL_DISTANCE_KM, waypoints, climbs: [],
    places: [place({ id: 'bakery-1', trackDistanceKm: 50.1, openingHours: null })],
  })
  const main = findRecommendation(recommendations, 'main')
  assert.equal(main.waypointId, 'town-bakery')
  assert.equal(main.name, 'Ville', 'S/T: the POI enriches the real place; the place keeps its own name')
})

test('B: a closed bakery never scores like an open one', () => {
  const waypoints = [...baseWaypoints(), waypoint({ id: 'town-bakery', trackDistanceKm: 50 })]
  const timingCommon = { movingElapsedMinutesAt: (distanceKm) => (distanceKm / 20) * 60, departureMinutes: 8 * 60, weekdayAtDeparture: 1 }

  const open = recommendAutomaticPauses({
    totalBreakMinutes: TOTAL_BREAK_MINUTES, totalDistanceKm: TOTAL_DISTANCE_KM, waypoints, climbs: [],
    places: [place({ id: 'bakery-1', openingHours: 'Mo 06:00-20:00' })],
    ...timingCommon,
  })
  const closed = recommendAutomaticPauses({
    totalBreakMinutes: TOTAL_BREAK_MINUTES, totalDistanceKm: TOTAL_DISTANCE_KM, waypoints, climbs: [],
    places: [place({ id: 'bakery-1', openingHours: 'Mo 22:00-23:00' })],
    ...timingCommon,
  })
  const openMain = findRecommendation(open, 'main')
  const closedMain = findRecommendation(closed, 'main')
  assert.ok(openMain.reasons.includes('bakery-open'))
  assert.ok(closedMain.reasons.includes('shop-closed'))
  assert.notDeepEqual(openMain.reasons, closedMain.reasons)
})

test('C: unknown opening hours are neither treated as open nor as closed', () => {
  const waypoints = [...baseWaypoints(), waypoint({ id: 'town-bakery', trackDistanceKm: 50 })]
  const recommendations = recommendAutomaticPauses({
    totalBreakMinutes: TOTAL_BREAK_MINUTES, totalDistanceKm: TOTAL_DISTANCE_KM, waypoints, climbs: [],
    places: [place({ id: 'bakery-1', openingHours: null })],
    // No timing supplied at all — the engine cannot resolve any clock time.
  })
  const main = findRecommendation(recommendations, 'main')
  assert.ok(main.reasons.includes('hours-uncertain'))
  assert.ok(!main.reasons.includes('bakery-open'))
  assert.ok(!main.reasons.includes('shop-closed'))
})

test('D: of two POI merged onto the same real locality, the 50 m off-route one beats the 600 m off-route one', () => {
  // R2.1 sections 15-16: a bare POI can no longer win a slot on its own (see
  // the standalone-POI tests above) — this test now anchors both POI onto a
  // REAL waypoint (never a fabricated "Service" pause) to keep exercising
  // the actual detour-distance scoring it was written for.
  const waypoints = [...baseWaypoints(), waypoint({ id: 'town-main', trackDistanceKm: 50 })]
  const recommendations = recommendAutomaticPauses({
    totalBreakMinutes: TOTAL_BREAK_MINUTES, totalDistanceKm: TOTAL_DISTANCE_KM, waypoints, climbs: [],
    places: [
      place({ id: 'near', trackDistanceKm: 50, detourKm: 0.05 }),
      place({ id: 'far', trackDistanceKm: 50, detourKm: 0.6 }),
    ],
  })
  const main = findRecommendation(recommendations, 'main')
  assert.equal(main.waypointId, 'town-main')
  assert.equal(main.primaryPoiIds[0], 'near')
  assert.ok(main.reasons.includes('low-detour'))
})

test('E: diversity (bakery + water + toilet) beats three redundant bakeries', () => {
  const waypoints = [...baseWaypoints(), waypoint({ id: 'town-redundant', trackDistanceKm: 49, name: 'Redondant' }), waypoint({ id: 'town-diverse', trackDistanceKm: 51, name: 'Divers' })]
  const recommendations = recommendAutomaticPauses({
    totalBreakMinutes: TOTAL_BREAK_MINUTES, totalDistanceKm: TOTAL_DISTANCE_KM, waypoints, climbs: [],
    places: [
      place({ id: 'bakery-1', trackDistanceKm: 49 }),
      place({ id: 'bakery-2', trackDistanceKm: 49 }),
      place({ id: 'bakery-3', trackDistanceKm: 49 }),
      place({ id: 'bakery-4', category: 'bakery', trackDistanceKm: 51 }),
      place({ id: 'water-1', category: 'water', trackDistanceKm: 51 }),
      place({ id: 'toilet-1', category: 'toilet', trackDistanceKm: 51 }),
    ],
  })
  const main = findRecommendation(recommendations, 'main')
  assert.equal(main.waypointId, 'town-diverse')
})

// --- F-I: terrain (section 63) -----------------------------------------------

function climb(overrides = {}) {
  return { id: 'climb-1', routeId: 'route-1', name: 'Col Test', startDistanceKm: 44, endDistanceKm: 50, elevationGainM: 600, averageGradientPercent: 6, maxGradientPercent: 10, startAltitudeM: 400, endAltitudeM: 1_000, confidence: 'confirmed', provenance: { sourceType: 'osm', sourceId: null, fetchedAt: null, engineVersion: 'test', confidence: 'high', manuallyOverridden: false }, ...overrides }
}

test('F: a candidate in the middle of a major climb is strongly penalised', () => {
  const waypoints = [...baseWaypoints(), waypoint({ id: 'mid-climb', trackDistanceKm: 47, name: 'Mi-pente' }), waypoint({ id: 'far-town', trackDistanceKm: 40, name: 'Loin' })]
  const recommendations = recommendAutomaticPauses({
    totalBreakMinutes: TOTAL_BREAK_MINUTES, totalDistanceKm: TOTAL_DISTANCE_KM, waypoints, climbs: [climb()],
  })
  const main = findRecommendation(recommendations, 'main')
  assert.notEqual(main.waypointId, 'mid-climb')
})

test('G: a candidate just after a major climb gets a bonus', () => {
  // Continuous at the summit (50 km, 1000 m): a steady climb up to it, then a
  // steep descent right after — never a fabricated jump at the seam.
  const geometryAltitudeAt = (distanceKm) => (distanceKm <= 50 ? 1_000 - (50 - distanceKm) * 12 : 1_000 - (distanceKm - 50) * 60)
  const waypoints = [...baseWaypoints(), waypoint({ id: 'after-climb', trackDistanceKm: 51, name: 'Après col' })]
  const recommendations = recommendAutomaticPauses(
    { totalBreakMinutes: TOTAL_BREAK_MINUTES, totalDistanceKm: TOTAL_DISTANCE_KM, waypoints, climbs: [climb()] },
    geometryAltitudeAt,
  )
  const main = findRecommendation(recommendations, 'main')
  assert.equal(main.waypointId, 'after-climb')
  assert.ok(main.reasons.includes('after-major-climb'))
})

test('H: a locality reached after a descent can beat a village slightly closer to the ideal position', () => {
  // Altitude drops sharply right after 'after-descent' (52 km) — a genuine
  // descent bonus — while 'closer-village' sits marginally nearer the ideal
  // 50 km slot but on flat ground with no service at all.
  const geometryAltitudeAt = (distanceKm) => (distanceKm < 51 ? 1_000 : 1_000 - (distanceKm - 51) * 60)
  const waypoints = [...baseWaypoints(), waypoint({ id: 'closer-village', kind: 'village', trackDistanceKm: 50.3, name: 'Proche' }), waypoint({ id: 'after-descent', trackDistanceKm: 52, name: 'Vallée' })]
  const recommendations = recommendAutomaticPauses(
    { totalBreakMinutes: TOTAL_BREAK_MINUTES, totalDistanceKm: TOTAL_DISTANCE_KM, waypoints, climbs: [] },
    geometryAltitudeAt,
  )
  const main = findRecommendation(recommendations, 'main')
  assert.equal(main.waypointId, 'after-descent')
  assert.ok(main.reasons.includes('after-descent'))
})

test('I: a col with no service at all is not automatically recommended over a serviced locality', () => {
  const waypoints = [...baseWaypoints(), waypoint({ id: 'col', kind: 'mountain-pass', trackDistanceKm: 50, name: 'Col', climbId: 'climb-1' }), waypoint({ id: 'town', trackDistanceKm: 50.4, name: 'Village' })]
  const recommendations = recommendAutomaticPauses({
    totalBreakMinutes: TOTAL_BREAK_MINUTES, totalDistanceKm: TOTAL_DISTANCE_KM, waypoints, climbs: [climb({ endDistanceKm: 50 })],
    places: [place({ id: 'bakery-1', trackDistanceKm: 50.4 })],
  })
  const main = findRecommendation(recommendations, 'main')
  assert.notEqual(main.waypointId, 'col', 'the serviced town wins the slot outright')
  const colScore = main.alternates.find((alternate) => alternate.candidate.id === 'col')
  assert.ok(colScore, 'the bare col is still a considered candidate')
  assert.ok(!colScore.reasons.includes('after-major-climb') && !colScore.reasons.includes('locality'), 'a bare col at its own climb summit earns neither an automatic locality nor a post-climb bonus')
})

// --- J-M: timing / hard constraints (section 64) ----------------------------

test('J: a candidate far outside the search window is never selected just because of great services', () => {
  const waypoints = [...baseWaypoints(), waypoint({ id: 'far-but-serviced', trackDistanceKm: 90, name: 'Loin mais équipé' })]
  const recommendations = recommendAutomaticPauses({
    totalBreakMinutes: TOTAL_BREAK_MINUTES, totalDistanceKm: TOTAL_DISTANCE_KM, waypoints, climbs: [],
    places: [place({ id: 'bakery-1', trackDistanceKm: 90 }), place({ id: 'water-1', category: 'water', trackDistanceKm: 90 }), place({ id: 'toilet-1', category: 'toilet', trackDistanceKm: 90 })],
  })
  // Sections 21-23: the "main" slot (50 km) has no real place within its
  // window, so it yields no pause at all — and certainly never steals the
  // well-serviced but far-away 90 km anchor.
  assert.equal(findRecommendation(recommendations, 'main'), undefined)
  assert.ok(recommendations.every((recommendation) => recommendation.waypointId !== 'far-but-serviced'))
})

test('K: the edge buffer near départ/arrivée is respected — a candidate inside it is excluded, and the slot then yields no pause at all', () => {
  const candidates = buildPauseCandidates([...baseWaypoints(), waypoint({ id: 'near-start', trackDistanceKm: 3, name: 'Trop tôt' })], [])
  const recommendations = selectPauseRecommendations(
    candidates,
    [{ id: 'edge-test', name: 'Test', distanceKm: 3, durationMinutes: 15 }],
    TOTAL_DISTANCE_KM,
    () => ({ climbs: [] }),
  )
  // Sections 21-23: the excluded candidate no longer degrades into a
  // synthetic pause clamped to the buffer boundary — it produces nothing.
  assert.deepEqual(recommendations, [])
})

test('L: minimum spacing between two selected pauses is respected', () => {
  // 'a' and 'b' sit only 1 km apart — well under the 8 km min spacing
  // (100 km × PAUSE_MIN_SPACING_FRACTION 0.08) — so once slot 1 claims 'a',
  // slot 2 can never also land on 'b', even though 'b' is otherwise its own
  // best candidate.
  const waypoints = [...baseWaypoints(), waypoint({ id: 'a', trackDistanceKm: 50, name: 'A' }), waypoint({ id: 'b', trackDistanceKm: 51, name: 'B' })]
  const candidates = buildPauseCandidates(waypoints, [])
  const recommendations = selectPauseRecommendations(
    candidates,
    [{ id: 'slot-1', name: 'Slot 1', distanceKm: 50, durationMinutes: 10 }, { id: 'slot-2', name: 'Slot 2', distanceKm: 51, durationMinutes: 10 }],
    TOTAL_DISTANCE_KM,
    () => ({ climbs: [] }),
  )
  assert.equal(recommendations[0].waypointId, 'a')
  // Slot 2 has no other real place within spacing → no second pause at all.
  assert.equal(recommendations.length, 1)
})

test('M: no duplicate candidate is ever produced for the same waypoint', () => {
  const waypoints = [...baseWaypoints(), waypoint({ id: 'dup', trackDistanceKm: 50 })]
  const candidates = buildPauseCandidates(waypoints, [place({ id: 'bakery-1', trackDistanceKm: 50.01 }), place({ id: 'bakery-2', trackDistanceKm: 49.99 })])
  const ids = candidates.map((candidate) => candidate.id)
  assert.equal(new Set(ids).size, ids.length)
})

// --- N-Q: fallback (section 65) ----------------------------------------------

test('N: with no POI at all, pauses are still produced — the real localities alone are enough', () => {
  const recommendations = recommendAutomaticPauses({ totalBreakMinutes: TOTAL_BREAK_MINUTES, totalDistanceKm: TOTAL_DISTANCE_KM, waypoints: threeAnchoredWaypoints(), climbs: [] })
  assert.equal(recommendations.length, 3)
  for (const recommendation of recommendations) assert.notEqual(recommendation.waypointId, null)
})

test('O: with no weather at all, recommendations are still produced', () => {
  const recommendations = recommendAutomaticPauses({ totalBreakMinutes: TOTAL_BREAK_MINUTES, totalDistanceKm: TOTAL_DISTANCE_KM, waypoints: threeAnchoredWaypoints(), climbs: [], weather: null })
  assert.equal(recommendations.length, 3)
})

test('P: with no usable terrain data (no climbs, no altitude sampler), recommendations are still produced', () => {
  const recommendations = recommendAutomaticPauses({ totalBreakMinutes: TOTAL_BREAK_MINUTES, totalDistanceKm: TOTAL_DISTANCE_KM, waypoints: threeAnchoredWaypoints(), climbs: [] })
  assert.equal(recommendations.length, 3)
})

// --- DER-DES-DER sections 12/21-23: no real place → no pause ---------------

test('Q/B/K/L/M: with no structural anchor and no POI at all, NO pause is recommended — never a synthetic slot-named one', () => {
  const recommendations = recommendAutomaticPauses({ totalBreakMinutes: TOTAL_BREAK_MINUTES, totalDistanceKm: TOTAL_DISTANCE_KM, waypoints: baseWaypoints(), climbs: [] })
  assert.deepEqual(recommendations, [], 'a stage with only départ/arrivée known yet gets no automatic pause at all')
})

test('O: every recommendation anchors to a real waypoint — `waypointId` is never null', () => {
  const recommendations = recommendAutomaticPauses({ totalBreakMinutes: TOTAL_BREAK_MINUTES, totalDistanceKm: TOTAL_DISTANCE_KM, waypoints: threeAnchoredWaypoints(), climbs: [] })
  assert.ok(recommendations.length > 0)
  for (const recommendation of recommendations) assert.notEqual(recommendation.waypointId, null)
})

test('K/L/M: no recommendation is ever named after a pause slot ("Pause du matin"/"principale"/"de l\'après-midi")', () => {
  const recommendations = recommendAutomaticPauses({
    totalBreakMinutes: TOTAL_BREAK_MINUTES, totalDistanceKm: TOTAL_DISTANCE_KM,
    waypoints: [...baseWaypoints(), waypoint({ id: 'town-main', trackDistanceKm: 50, name: 'Ville midi' })], climbs: [],
  })
  for (const recommendation of recommendations) {
    assert.ok(!/^Pause (du matin|principale|de l’après-midi|de l'après-midi)$/u.test(recommendation.name), `fabricated slot name: ${recommendation.name}`)
  }
  assert.deepEqual(recommendations.map((recommendation) => recommendation.name), ['Ville midi'])
})

test('section 23: the two unplaceable slots\' minutes are redistributed onto the single real pause', () => {
  const recommendations = recommendAutomaticPauses({
    totalBreakMinutes: TOTAL_BREAK_MINUTES, totalDistanceKm: TOTAL_DISTANCE_KM,
    waypoints: [...baseWaypoints(), waypoint({ id: 'town-main', trackDistanceKm: 50, name: 'Ville midi' })], climbs: [],
  })
  assert.equal(recommendations.length, 1)
  assert.equal(recommendations[0].durationMinutes, TOTAL_BREAK_MINUTES, 'the whole 40-minute budget lands on the one real place')
  assert.equal(recommendations[0].durationMinutes % 5, 0)
})

// --- T: weather absence never breaks validity (section 67) ------------------

test('T: omitting weather never changes the shape/validity of the result', () => {
  const waypoints = [...baseWaypoints(), waypoint({ id: 'town', trackDistanceKm: 50 })]
  const withWeather = recommendAutomaticPauses({ totalBreakMinutes: TOTAL_BREAK_MINUTES, totalDistanceKm: TOTAL_DISTANCE_KM, waypoints, climbs: [], weather: { precipitationMm: 0, windSpeedKph: 5, temperatureMaxC: 18 } })
  const withoutWeather = recommendAutomaticPauses({ totalBreakMinutes: TOTAL_BREAK_MINUTES, totalDistanceKm: TOTAL_DISTANCE_KM, waypoints, climbs: [] })
  assert.equal(withWeather.length, withoutWeather.length)
  assert.deepEqual(withWeather.map((r) => r.waypointId), withoutWeather.map((r) => r.waypointId))
})

// --- U/V: weather modulation (section 67) -----------------------------------

test('U: significant rain near a shelter can add a bonus', () => {
  const waypoints = [...baseWaypoints(), waypoint({ id: 'town', trackDistanceKm: 50 })]
  const dry = recommendAutomaticPauses({
    totalBreakMinutes: TOTAL_BREAK_MINUTES, totalDistanceKm: TOTAL_DISTANCE_KM, waypoints, climbs: [],
    places: [place({ id: 'shelter-1', category: 'shelter' })],
    weather: { precipitationMm: 0, windSpeedKph: null, temperatureMaxC: null },
  })
  const rainy = recommendAutomaticPauses({
    totalBreakMinutes: TOTAL_BREAK_MINUTES, totalDistanceKm: TOTAL_DISTANCE_KM, waypoints, climbs: [],
    places: [place({ id: 'shelter-1', category: 'shelter' })],
    weather: { precipitationMm: 8, windSpeedKph: null, temperatureMaxC: null },
  })
  const dryMain = findRecommendation(dry, 'main')
  const rainyMain = findRecommendation(rainy, 'main')
  assert.ok(!dryMain.reasons.includes('rain-shelter'))
  assert.ok(rainyMain.reasons.includes('rain-shelter'))
})

test('V: strong wind on an exposed col can add a malus', () => {
  const waypoints = [...baseWaypoints(), waypoint({ id: 'col', kind: 'mountain-pass', trackDistanceKm: 50, name: 'Col exposé' })]
  const calm = recommendAutomaticPauses({
    totalBreakMinutes: TOTAL_BREAK_MINUTES, totalDistanceKm: TOTAL_DISTANCE_KM, waypoints, climbs: [],
    weather: { precipitationMm: null, windSpeedKph: 10, temperatureMaxC: null },
  })
  const windy = recommendAutomaticPauses({
    totalBreakMinutes: TOTAL_BREAK_MINUTES, totalDistanceKm: TOTAL_DISTANCE_KM, waypoints, climbs: [],
    weather: { precipitationMm: null, windSpeedKph: 55, temperatureMaxC: null },
  })
  const calmMain = findRecommendation(calm, 'main')
  const windyMain = findRecommendation(windy, 'main')
  assert.ok(!calmMain.reasons.includes('wind-exposure'))
  assert.ok(windyMain.reasons.includes('wind-exposure'))
})

// --- W/X: explanations (section 68) -----------------------------------------

test('W: every non-fallback recommendation carries structured reason codes, never free text', () => {
  const waypoints = [...baseWaypoints(), waypoint({ id: 'town', trackDistanceKm: 50 })]
  const recommendations = recommendAutomaticPauses({
    totalBreakMinutes: TOTAL_BREAK_MINUTES, totalDistanceKm: TOTAL_DISTANCE_KM, waypoints, climbs: [],
    places: [place({ id: 'bakery-1' })],
  })
  const main = findRecommendation(recommendations, 'main')
  assert.ok(Array.isArray(main.reasons))
  for (const reason of main.reasons) {
    assert.equal(typeof reason, 'string')
    assert.ok(!/\s/.test(reason), 'a reason is a code, e.g. "bakery-open", never a sentence')
  }
})

test('X: the recommendation itself never contains a numeric score', () => {
  const waypoints = [...baseWaypoints(), waypoint({ id: 'town', trackDistanceKm: 50 })]
  const recommendations = recommendAutomaticPauses({ totalBreakMinutes: TOTAL_BREAK_MINUTES, totalDistanceKm: TOTAL_DISTANCE_KM, waypoints, climbs: [] })
  for (const recommendation of recommendations) {
    assert.equal('score' in recommendation, false)
  }
})
