import assert from 'node:assert/strict'
import test from 'node:test'

import { buildPracticalPlaceViewModels } from '../../src/practical-places/view-model.ts'

function place(overrides = {}) {
  return {
    id: 'place-1', category: 'bakery', name: 'Boulangerie du Col', latitude: 45.1, longitude: 6.2,
    description: null, trackDistanceKm: 48.2, detourKm: 0.32, openingHours: 'Mo-Fr 08:00-18:00',
    usefulTags: {}, hidden: false, pinned: false, dayIds: ['day-1'],
    provenance: { sourceType: 'osm', sourceId: 'postpass-practical-places:node:1', fetchedAt: '2028-01-01T00:00:00.000Z', engineVersion: 'practical-places-postpass@1', confidence: 'high', manuallyOverridden: false },
    ...overrides,
  }
}

function day(overrides = {}) {
  return { id: 'day-1', date: '2027-05-10', ...overrides }
}

/** Constant-pace fake curve: `ratePerKm` minutes elapsed per km — enough to exercise the ETA/opening pipeline without a real terrain-timing engine. */
function fakeCurve(ratePerKm = 1) {
  return { elapsedMinutesAt: (km) => km * ratePerKm, clockTimeAt: () => '—' }
}

test('the six UX categories map through with their own label; non-UX categories (fast-food, sports, cafe) are filtered out entirely', () => {
  const places = [place({ id: 'p1', category: 'water' }), place({ id: 'p2', category: 'fast-food' }), place({ id: 'p3', category: 'sports' })]
  const models = buildPracticalPlaceViewModels(places, day(), fakeCurve(), '08:00')
  assert.equal(models.length, 1)
  assert.equal(models[0].category, 'water')
  assert.equal(models[0].categoryLabel, 'Eau')
})

test('a null/missing name falls back to an honest per-category placeholder, never blank', () => {
  const models = buildPracticalPlaceViewModels([place({ name: null, category: 'water' })], day(), fakeCurve(), '08:00')
  assert.equal(models[0].displayName, 'Point d’eau')
})

test('section 20: the ETA reuses the exact StageTimingCurve, departure time included — 08:00 + (48.2 km × 1 min/km)', () => {
  const models = buildPracticalPlaceViewModels([place({ trackDistanceKm: 48.2 })], day(), fakeCurve(1), '08:00')
  // 08:00 + 48 minutes (rounded) ≈ 08:48
  assert.match(models[0].passageClockTimeLabel, /^08:4[7-9]$/)
})

test('AG: changing the departure time recomputes the passage ETA and therefore the opening status', () => {
  const stagePlace = place({ trackDistanceKm: 60, openingHours: 'Mo-Fr 08:00-13:00' })
  const earlyDeparture = buildPracticalPlaceViewModels([stagePlace], day(), fakeCurve(1), '07:00')
  const lateDeparture = buildPracticalPlaceViewModels([stagePlace], day(), fakeCurve(1), '12:00')
  // 07:00 + 60 min = 08:00 (open, window starts at 08:00) vs 12:00 + 60 min = 13:00 (just closed)
  assert.equal(earlyDeparture[0].opening.status, 'open')
  assert.equal(lateDeparture[0].opening.status, 'closed')
  assert.notEqual(earlyDeparture[0].passageClockTimeLabel, lateDeparture[0].passageClockTimeLabel)
})

test('AD: the weekday used for the opening evaluation is derived from the trip day\'s own local date, not a naive UTC read of an arbitrary instant', () => {
  // 2027-05-10 is a known Monday; Mo-Fr 08:00-18:00 must read as open at a
  // same-day passage regardless of what the host machine's local timezone is.
  const models = buildPracticalPlaceViewModels([place({ trackDistanceKm: 1, openingHours: 'Mo-Fr 08:00-18:00' })], day({ date: '2027-05-10' }), fakeCurve(1), '10:00')
  assert.equal(models[0].opening.status, 'open')
})

test('a passage that rolls past local midnight resolves against the NEXT day\'s weekday, via civil-day arithmetic', () => {
  // Departure 23:30, +90 min elapsed = 01:00 the next calendar day. 2027-05-10
  // is a Monday, so the passage actually falls on Tuesday.
  const models = buildPracticalPlaceViewModels(
    [place({ trackDistanceKm: 90, openingHours: 'Tu 00:00-06:00' })],
    day({ date: '2027-05-10' }), fakeCurve(1), '23:30',
  )
  assert.equal(models[0].opening.status, 'open')
})

test('no timing curve at all (untimed stage) never fabricates an ETA or an opening verdict', () => {
  const models = buildPracticalPlaceViewModels([place()], day(), null, '08:00')
  assert.equal(models[0].passageClockTimeLabel, null)
  assert.equal(models[0].opening, null)
})

test('an undated day (no calendar yet) never fabricates an opening verdict either, even with a real timing curve', () => {
  const models = buildPracticalPlaceViewModels([place()], day({ date: null }), fakeCurve(1), '08:00')
  assert.equal(models[0].opening, null)
})
