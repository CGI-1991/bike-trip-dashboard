import assert from 'node:assert/strict'
import test from 'node:test'

import { getDistanceToRouteKm, getRoadbookPointRole, pointContributesToRisk } from '../../src/trip/point-role.ts'

const point = (id, resolution = 'matched') => ({ id, resolution, matchDistanceM: 3300 })

test('classifies confirmed off-route places as weather references', () => {
  for (const id of ['j03-passage-crest-voland', 'j04-passage-areches', 'j04-passage-les-chapieux', 'j09-passage-chateau-queyras', 'j01-passage-bellevaux', 'j06-passage-tignes']) {
    assert.equal(getRoadbookPointRole(point(id, 'excluded')), 'weather-reference')
  }
})

test('keeps route, information and excluded roles distinct', () => {
  assert.equal(getRoadbookPointRole(point('regular')), 'route-point')
  assert.equal(getRoadbookPointRole(point('note', 'informational')), 'information')
  assert.equal(getRoadbookPointRole(point('j10-option-cime-de-la-bonette', 'excluded')), 'excluded')
})

test('a weather reference affects risk only when planned', () => {
  const tignes = point('j06-passage-tignes', 'excluded')
  assert.equal(pointContributesToRisk(tignes), false)
  assert.equal(pointContributesToRisk(tignes, new Set([tignes.id])), true)
  assert.equal(getDistanceToRouteKm(tignes), 3.3)
})
