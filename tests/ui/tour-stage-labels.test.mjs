import './support/dom-shim.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { selectTripDayLabel, selectTripDayNumbers } from '../../src/trip-core/index.ts'
import { createLinkedTripBundle } from '../trips-manager/support/linked-trip-fixture.mjs'
import { buildTripOverview } from '../../src/ui/trips/trip-overview-view.ts'
import { buildGenericOverviewRouteMapModel } from '../../src/ui/route-map-model.ts'
import { buildDayDetail } from '../../src/ui/trips/day-detail-view.ts'

function tour(options) {
  const b = createLinkedTripBundle(options)
  return { ...b, settings: { ...b.settings, global: { ...b.settings.global, raceMode: true, organizationMode: 'tour' } } }
}

test('Tour labels disambiguate two stages per date without changing calendar numbers or stored IDs', () => {
  const b = tour({ rideCount: 4, links: [1, 3] }), before = JSON.stringify(b)
  assert.deepEqual(b.days.map(day => selectTripDayLabel(b, day.id)), ['J1a', 'J1b', 'J2a', 'J2b'])
  assert.deepEqual([...selectTripDayNumbers(b).values()], [1, 1, 2, 2])
  assert.equal(JSON.stringify(b), before)
})

test('a standalone stage keeps J2; League keeps independent course numbers', () => {
  const b = tour({ rideCount: 3, links: [1] })
  assert.deepEqual(b.days.map(day => selectTripDayLabel(b, day.id)), ['J1a', 'J1b', 'J2'])
  const league = { ...b, settings: { ...b.settings, global: { ...b.settings.global, organizationMode: 'league' } } }
  assert.deepEqual(league.days.map(day => selectTripDayLabel(league, day.id)), ['C1', 'C2', 'C3'])
})

test('map badges, stage header and lower selector use the same Tour stage identity', () => {
  const b = tour({ rideCount: 3, links: [1] })
  const model = buildGenericOverviewRouteMapModel(buildTripOverview(b, '2028-05-01').mapStages)
  assert.deepEqual(model.overviewStages.map(stage => stage.number), ['J1a', 'J1b', 'J2'])
  const view = buildDayDetail(b, b.days[1].id)
  assert.match(view.identityHtml, /<strong>J1b<\/strong>/)
  assert.match(view.html, /J1b — Départ 2/)
})

test('large same-day groups have unique suffixes after z', () => {
  const b = tour({ rideCount: 28, links: Array.from({ length: 27 }, (_, i) => i + 1) })
  assert.deepEqual(b.days.slice(-3).map(day => selectTripDayLabel(b, day.id)), ['J1z', 'J1aa', 'J1ab'])
})
