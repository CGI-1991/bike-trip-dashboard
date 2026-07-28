import assert from 'node:assert/strict'
import test from 'node:test'

import { getDistanceToRouteKm, getRoadbookPointRole, pointContributesToRisk } from '../../src/trip/point-role.ts'

const point = (id, resolution = 'matched') => ({ id, resolution, matchDistanceM: 3300 })

// Bellevaux, Crest-Voland, Arêches, Les Chapieux, Tignes, Château-Queyras and
// Cime de la Bonette are permanently suppressed (see `roadbook-suppressions.ts`)
// and are filtered out of the operational model before they ever reach
// `getRoadbookPointRole` — they no longer get a special weather-reference or
// not-ridden-option role, even if a stray id slipped through.
const suppressedIds = [
  'j01-passage-bellevaux',
  'j03-passage-crest-voland',
  'j04-passage-areches',
  'j04-passage-les-chapieux',
  'j06-passage-tignes',
  'j09-passage-chateau-queyras',
  'j10-option-cime-de-la-bonette',
]

test('permanently suppressed point ids no longer get a special role', () => {
  for (const id of suppressedIds) {
    assert.equal(getRoadbookPointRole(point(id, 'excluded')), 'information')
  }
})

test('keeps route and information roles distinct', () => {
  assert.equal(getRoadbookPointRole(point('regular')), 'route-point')
  assert.equal(getRoadbookPointRole(point('note', 'informational')), 'information')
  assert.equal(getRoadbookPointRole(point('other', 'excluded')), 'information')
})

test('risk contribution only applies to matched route points, never to an excluded/suppressed id even when planned', () => {
  const matched = point('col-1')
  const excluded = point('j06-passage-tignes', 'excluded')
  assert.equal(pointContributesToRisk(matched), true)
  assert.equal(pointContributesToRisk(excluded), false)
  assert.equal(pointContributesToRisk(excluded, new Set([excluded.id])), false)
  assert.equal(getDistanceToRouteKm(excluded), 3.3)
})
