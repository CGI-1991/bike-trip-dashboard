import assert from 'node:assert/strict'
import test from 'node:test'

import { locateAndDeduplicatePostpassPracticalPlaces } from '../../src/practical-places/route-proximity.ts'
import { PRACTICAL_PLACES_ANCHOR_RADIUS_METERS, PRACTICAL_PLACES_CORRIDOR_RADIUS_METERS } from '../../src/practical-places/postpass-provider.ts'

// A north-south line at 45°N — one degree of latitude is exactly 111_320 m
// everywhere, and one degree of longitude at 45°N is ~78_700 m, so placing a
// candidate a given number of meters *laterally* off this line is a simple
// longitude offset. Kept intentionally simple/deterministic for the tests.
const METERS_PER_LONGITUDE_DEGREE_AT_45N = 111_320 * Math.cos(45 * Math.PI / 180)
const geometry = [
  { latitude: 45, longitude: 6, altitudeM: 200 },
  { latitude: 45.2, longitude: 6, altitudeM: 200 },
]
const departureAnchor = { latitude: 45, longitude: 6 }
const midStageAnchor = { latitude: 45.1, longitude: 6 }

function lateralPoint(meters, alongLatitude = 45.1) {
  return { latitude: alongLatitude, longitude: 6 + meters / METERS_PER_LONGITUDE_DEGREE_AT_45N }
}

function anchorOffsetPoint(anchor, meters) {
  return { latitude: anchor.latitude, longitude: anchor.longitude + meters / METERS_PER_LONGITUDE_DEGREE_AT_45N }
}

function candidate(overrides = {}) {
  return { osmType: 'node', osmId: '1', category: 'water', name: 'Test', latitude: 45.1, longitude: 6, usefulTags: {}, ...overrides }
}

const options = { corridorMaximumLateralDistanceMeters: PRACTICAL_PLACES_CORRIDOR_RADIUS_METERS, anchorMaximumDistanceMeters: PRACTICAL_PLACES_ANCHOR_RADIUS_METERS }

test('N: a corridor-category (Eau) candidate 450 m off the route is retained', () => {
  const point = lateralPoint(450)
  const located = locateAndDeduplicatePostpassPracticalPlaces([candidate({ category: 'water', ...point })], geometry, [], options)
  assert.equal(located.length, 1)
})

test('O: a corridor-category candidate 550 m off the route is excluded', () => {
  const point = lateralPoint(550)
  const located = locateAndDeduplicatePostpassPracticalPlaces([candidate({ category: 'water', ...point })], geometry, [], options)
  assert.equal(located.length, 0)
})

test('P: a Toilette candidate 490 m off the route is retained', () => {
  const point = lateralPoint(490)
  const located = locateAndDeduplicatePostpassPracticalPlaces([candidate({ category: 'toilet', ...point })], geometry, [], options)
  assert.equal(located.length, 1)
})

test('Q: a bakery 400 m off the route but far from every anchor is excluded — corridor proximity alone never qualifies an anchor category', () => {
  const point = lateralPoint(400)
  const located = locateAndDeduplicatePostpassPracticalPlaces([candidate({ category: 'bakery', name: 'Boulangerie', ...point })], geometry, [departureAnchor], options)
  assert.equal(located.length, 0)
})

test('R: a bakery 700 m from a significant locality anchor is retained', () => {
  const point = anchorOffsetPoint(midStageAnchor, 700)
  const located = locateAndDeduplicatePostpassPracticalPlaces([candidate({ category: 'bakery', name: 'Boulangerie', ...point })], geometry, [departureAnchor, midStageAnchor], options)
  assert.equal(located.length, 1)
})

test('S: a bakery 900 m from every anchor is excluded', () => {
  const point = anchorOffsetPoint(midStageAnchor, 900)
  const located = locateAndDeduplicatePostpassPracticalPlaces([candidate({ category: 'bakery', name: 'Boulangerie', ...point })], geometry, [departureAnchor, midStageAnchor], options)
  assert.equal(located.length, 0)
})

test('T: a supermarket close to the départ anchor is retained', () => {
  const point = anchorOffsetPoint(departureAnchor, 300)
  const located = locateAndDeduplicatePostpassPracticalPlaces([candidate({ category: 'supermarket', name: 'Supermarché', ...point })], geometry, [departureAnchor], options)
  assert.equal(located.length, 1)
})

test('U: a bike-repair station close to a pause anchor is retained, even anonymous', () => {
  const point = anchorOffsetPoint(midStageAnchor, 200)
  const located = locateAndDeduplicatePostpassPracticalPlaces(
    [candidate({ category: 'bike-service', name: null, usefulTags: { amenity: 'bicycle_repair_station' }, ...point })],
    geometry, [midStageAnchor], options,
  )
  assert.equal(located.length, 1)
})

test('an anonymous bakery/supermarket never survives — only water/shelter/toilet/bike-repair-station allow no name', () => {
  const point = anchorOffsetPoint(departureAnchor, 100)
  const located = locateAndDeduplicatePostpassPracticalPlaces([candidate({ category: 'bakery', name: null, ...point })], geometry, [departureAnchor], options)
  assert.equal(located.length, 0)
})

// --- W/X/Y: deduplication ----------------------------------------------------

test('W/X: the same osm id appearing twice (e.g. matched via two different anchors/branches) collapses to one POI', () => {
  const point = anchorOffsetPoint(departureAnchor, 100)
  const located = locateAndDeduplicatePostpassPracticalPlaces(
    [candidate({ category: 'supermarket', name: 'Supermarché Un', osmId: 'dup-1', ...point }), candidate({ category: 'supermarket', name: 'Supermarché Un', osmId: 'dup-1', ...point })],
    geometry, [departureAnchor], options,
  )
  assert.equal(located.length, 1)
})

test('Y: two distinct commerces sharing a name but far apart both survive', () => {
  const near = anchorOffsetPoint(departureAnchor, 50)
  const far = anchorOffsetPoint(midStageAnchor, 50)
  const located = locateAndDeduplicatePostpassPracticalPlaces(
    [
      candidate({ category: 'supermarket', name: 'Supérette du Coin', osmId: 'a', ...near }),
      candidate({ category: 'supermarket', name: 'Supérette du Coin', osmId: 'b', ...far }),
    ],
    geometry, [departureAnchor, midStageAnchor], options,
  )
  assert.equal(located.length, 2)
})

test('anchor-category detour is the distance to the nearest anchor, not the lateral distance to the route line', () => {
  const point = anchorOffsetPoint(midStageAnchor, 250)
  const [located] = locateAndDeduplicatePostpassPracticalPlaces([candidate({ category: 'bakery', name: 'Boulangerie', ...point })], geometry, [departureAnchor, midStageAnchor], options)
  assert.ok(located.anchorDistanceMeters !== null && located.anchorDistanceMeters !== undefined)
  assert.ok(Math.abs(located.anchorDistanceMeters - 250) < 5)
})

test('corridor-category candidates carry no anchor distance at all', () => {
  const point = lateralPoint(100)
  const [located] = locateAndDeduplicatePostpassPracticalPlaces([candidate({ category: 'water', ...point })], geometry, [departureAnchor], options)
  assert.equal(located.anchorDistanceMeters, null)
})
