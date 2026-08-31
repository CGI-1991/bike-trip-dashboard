import assert from 'node:assert/strict'
import test from 'node:test'

import {
  isPracticalPlaceCorridorCategory,
  isPracticalPlaceUxCategory,
  PRACTICAL_PLACE_ANCHOR_CATEGORIES,
  PRACTICAL_PLACE_CORRIDOR_CATEGORIES,
  PRACTICAL_PLACE_UX_CATEGORIES,
  PRACTICAL_PLACE_UX_LABELS,
} from '../../src/practical-places/taxonomy.ts'

test('C2 section 3: exactly six UX categories, no more', () => {
  assert.deepEqual([...PRACTICAL_PLACE_UX_CATEGORIES].sort(), ['bakery', 'bike-service', 'shelter', 'supermarket', 'toilet', 'water'])
  assert.equal(PRACTICAL_PLACE_UX_CATEGORIES.length, 6)
})

test('labels match the CDC\'s own exact French wording', () => {
  assert.deepEqual(PRACTICAL_PLACE_UX_LABELS, {
    'bike-service': 'Vélo',
    supermarket: 'Supermarché',
    bakery: 'Boulangerie',
    water: 'Eau',
    shelter: 'Abris',
    toilet: 'Toilette',
  })
})

test('fast-food/cafe-or-ice-cream/sports are excluded from the UX gate — the model keeps them, C2 never shows them', () => {
  assert.equal(isPracticalPlaceUxCategory('fast-food'), false)
  assert.equal(isPracticalPlaceUxCategory('cafe-or-ice-cream'), false)
  assert.equal(isPracticalPlaceUxCategory('sports'), false)
})

test('every UX category passes the gate', () => {
  for (const category of PRACTICAL_PLACE_UX_CATEGORIES) assert.equal(isPracticalPlaceUxCategory(category), true)
})

test('corridor vs anchor split matches CDC section 10 exactly', () => {
  assert.deepEqual([...PRACTICAL_PLACE_CORRIDOR_CATEGORIES].sort(), ['shelter', 'toilet', 'water'])
  assert.deepEqual([...PRACTICAL_PLACE_ANCHOR_CATEGORIES].sort(), ['bakery', 'bike-service', 'supermarket'])
  for (const category of PRACTICAL_PLACE_CORRIDOR_CATEGORIES) assert.equal(isPracticalPlaceCorridorCategory(category), true)
  for (const category of PRACTICAL_PLACE_ANCHOR_CATEGORIES) assert.equal(isPracticalPlaceCorridorCategory(category), false)
})
