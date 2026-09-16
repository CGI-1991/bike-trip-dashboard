import './support/dom-shim.mjs'

import assert from 'node:assert/strict'
import test from 'node:test'

import { buildDayDetail } from '../../src/ui/trips/day-detail-view.ts'
import { renderTripDetail } from '../../src/ui/trips/trip-detail-view.ts'
import { buildTripOverview } from '../../src/ui/trips/trip-overview-view.ts'
import { buildGenericAppHeader } from '../../src/ui/trips/app-header.ts'
import { selectTripDayNumbers } from '../../src/trip-core/index.ts'
import { shiftTripStartDate } from '../../src/trips-manager/trip-preferences.ts'
import { createLinkedTripBundle } from '../trips-manager/support/linked-trip-fixture.mjs'

// The J badge is the day OF THE TRIP, not a stage counter: two stages ridden
// the same date are both J1, the next day's stage is J2, a rest day after it
// is J3, and the stage after that is J4. No sub-numbering (1/2, 2/2) anywhere.

/** ride, ride (linked to the first), ride, OFF, ride — the brief's own example. */
function exampleTrip() {
  const base = createLinkedTripBundle({ rideCount: 4, links: [1] })
  const days = base.days.map((day) => ({ ...day }))
  // Turn the third ride day into an OFF day, shifting nothing else.
  const offDay = { ...days[2], type: 'off', stageId: null }
  delete offDay.sameCalendarDayAsPrevious
  days[2] = offDay
  return {
    ...base,
    days,
    stages: base.stages.filter((stage) => stage.dayId !== days[2].id),
  }
}

test('two stages ridden the same day share one J; the days after them keep counting calendar days', () => {
  const bundle = exampleTrip()
  const numbers = selectTripDayNumbers(bundle)
  assert.deepEqual(bundle.days.map((day) => numbers.get(day.id)), [1, 1, 2, 3])
  assert.deepEqual(bundle.days.map((day) => day.date), ['2028-06-01', '2028-06-01', '2028-06-02', '2028-06-03'])
})

test('a trip with nothing linked numbers exactly as it always did', () => {
  const numbers = selectTripDayNumbers(createLinkedTripBundle({ rideCount: 4 }))
  assert.deepEqual([...numbers.values()], [1, 2, 3, 4])
})

test('the number follows the planned date, so shifting the start date never changes it', () => {
  const bundle = exampleTrip()
  const before = [...selectTripDayNumbers(bundle).values()]
  const after = [...selectTripDayNumbers(shiftTripStartDate(bundle, '2028-10-25')).values()]
  // 2028-10-25 spans a European DST change — the arithmetic is UTC-anchored,
  // so the numbering is unaffected.
  assert.deepEqual(after, before)
})

test('linking and unlinking move the numbers of the days that follow, and only those', () => {
  const unlinked = createLinkedTripBundle({ rideCount: 3 })
  const linked = createLinkedTripBundle({ rideCount: 3, links: [1] })
  assert.deepEqual([...selectTripDayNumbers(unlinked).values()], [1, 2, 3])
  assert.deepEqual([...selectTripDayNumbers(linked).values()], [1, 1, 2])
})

test('Voyage: the day cards show the trip day, never a stage counter, and never a sub-number', () => {
  const html = renderTripDetail(exampleTrip(), { now: '2028-06-01' })
  const badges = [...html.matchAll(/<strong>J(\d+)<\/strong>/g)].map((match) => match[1])
  assert.deepEqual(badges, ['1', '1', '2', '3'])
  assert.doesNotMatch(html, /J\d+\s*[·/]\s*\d/, 'no 1/2, 2/2 sub-numbering')
})

test('Détail: the identity bandeau and the stage label use the same trip day', () => {
  const bundle = exampleTrip()
  const second = buildDayDetail(bundle, bundle.days[1].id)
  assert.match(second.identityHtml, /<strong>J1<\/strong>/)
  assert.match(second.stageLabel, /^J1 — /)
  const fourth = buildDayDetail(bundle, bundle.days[3].id)
  assert.match(fourth.identityHtml, /<strong>J3<\/strong>/)
})

test('Aperçu: the highlighted day carries the trip day too', () => {
  const bundle = exampleTrip()
  const overview = buildTripOverview(bundle, '2028-06-02')
  assert.match(overview.html, /<h3>J2 —/)
})

test('"Jx sur n" counts calendar days on both sides — the day count is never the stage count', () => {
  const bundle = exampleTrip()
  const header = buildGenericAppHeader(bundle, { view: 'day', day: bundle.days[1] })
  assert.equal(header.subtitle, 'J1 sur 3 · Étape')
  const overviewHeader = buildGenericAppHeader(bundle, { view: 'overview' })
  assert.match(overviewHeader.subtitle, /3 jours/)
})
