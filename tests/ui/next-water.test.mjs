import test from 'node:test'
import assert from 'node:assert/strict'
import { mappedDrinkingWater, prepareNextWater, nextWaterAt } from '../../src/practical-places/next-water.ts'
import { buildPracticalPlaceViewModels } from '../../src/practical-places/view-model.ts'
import { renderNextWater, mountNextWater } from '../../src/ui/trips/next-water-view.ts'

function water(km, changes = {}) {
  return { place: { id: `water-${km}`, category: 'water', name: 'Fontaine', latitude: 45, longitude: 6, trackDistanceKm: km, detourKm: .05,
    hidden: false, usefulTags: { amenity: 'drinking_water' }, ...changes }, displayName: changes.name ?? 'Fontaine', passageClockTimeLabel: '10:30', opening: { status: 'open' } }
}

test('water recommendations require mapped potability and exclude hidden, private, closed and contradictory sources', () => {
  for (const changes of [{ hidden: true }, { usefulTags: {} }, { usefulTags: { amenity: 'drinking_water', access: 'private' } },
    { usefulTags: { amenity: 'drinking_water', access: 'customers' } }, { usefulTags: { amenity: 'drinking_water', drinking_water: 'no' } },
    { usefulTags: { amenity: 'drinking_water', drinking_water: 'unknown' } }, { trackDistanceKm: null }]) {
    assert.equal(mappedDrinkingWater(water(2, changes)), false)
  }
  assert.equal(mappedDrinkingWater({ ...water(2), opening: { status: 'closed' } }), false)
  assert.equal(mappedDrinkingWater({ ...water(2), opening: { status: 'unknown' } }), true)
  assert.equal(mappedDrinkingWater(water(2, { usefulTags: { amenity: 'fountain', drinking_water: 'yes' } })), true)
})

test('next water follows chainage, preserves distinct loop passes and never mutates stored places', () => {
  const source = [water(20), water(2), water(8), water(50)], before = JSON.stringify(source)
  const prepared = prepareNextWater(source, 30)
  assert.equal(nextWaterAt(prepared, 0).place.trackDistanceKm, 2)
  assert.equal(nextWaterAt(prepared, 2).place.trackDistanceKm, 2)
  assert.equal(nextWaterAt(prepared, 2.1).place.trackDistanceKm, 8)
  assert.equal(nextWaterAt(prepared, 9).place.trackDistanceKm, 20, 'the same coordinates at a later chainage are another passage')
  assert.equal(nextWaterAt(prepared, 21), null)
  assert.equal(nextWaterAt(prepared, NaN), null)
  assert.equal(JSON.stringify(source), before)
})

test('water uses the shared passage clock and opening evaluator, including arrival after midnight', () => {
  const places = [{ ...water(2).place, openingHours: 'Tu 00:00-01:00' }, { ...water(8).place, openingHours: 'Tu 10:00-12:00' }]
  const models = buildPracticalPlaceViewModels(places, { date: '2026-10-26' }, { elapsedMinutesAt: () => 120 }, '23:00')
  assert.equal(models[0].passageClockTimeLabel, '01:00 (+1 j)')
  assert.equal(models[0].opening.status, 'closed', 'the closing instant is excluded')
  assert.equal(prepareNextWater(models, 20).length, 0)
})

test('the water strip escapes names, distinguishes route passage from access and retains unknown ETA honestly', () => {
  const html = renderNextWater([water(8, { name: '<img src=x>' })], 5, 'walking')
  assert.match(html, /Dans 3,0 km/); assert.match(html, /Passage 10:30/)
  assert.match(html, /~50 m du tracé/); assert.match(html, /travelmode=walking/)
  assert.match(html, /&lt;img src=x&gt;/); assert.doesNotMatch(html, /<img/)
  assert.match(renderNextWater([{ ...water(8), passageClockTimeLabel: null }], 5, 'cycling'), /Passage —/)
  assert.match(renderNextWater([], 5, 'cycling'), /Aucun point potable identifié plus loin/)
})

test('releasing a profile restores the origin once; a repeated blur never replaces the water link again', () => {
  let html = '', assignments = 0
  const host = { dataset: {}, get innerHTML() { return html }, set innerHTML(value) { html = value; assignments++ } }
  const profile = new EventTarget()
  mountNextWater(host, profile, [water(8)], 20, 'cycling')
  profile.dispatchEvent(new CustomEvent('profile-distance-active', { detail: { distanceKm: 5 } }))
  assert.match(html, /Dans 3,0 km/)
  profile.dispatchEvent(new Event('profile-sample-cleared'))
  assert.match(html, /Depuis le départ GPX/)
  const previous = assignments
  profile.dispatchEvent(new Event('profile-sample-cleared'))
  assert.equal(assignments, previous)
})

test('an empty water block only tracks the cursor; a progressive POI update uses that position without prior DOM work', () => {
  let html = '', assignments = 0
  const host = { dataset: {}, get innerHTML() { return html }, set innerHTML(value) { html = value; assignments++ } }
  const profile = new EventTarget()
  mountNextWater(host, profile, [], 20, 'cycling')
  profile.dispatchEvent(new CustomEvent('profile-distance-active', { detail: { distanceKm: 5 } }))
  assert.equal(host.hidden, true)
  assert.equal(assignments, 0)
  mountNextWater(host, profile, [water(8)], 20, 'cycling')
  assert.equal(host.hidden, false)
  assert.match(html, /Depuis le km 5,0/)
  assert.match(html, /Dans 3,0 km/)
})
