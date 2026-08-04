import assert from 'node:assert/strict'
import test from 'node:test'

import {
  allRouteMarkerCategories,
  getRouteMarkerCategory,
  getRouteMarkerLegendEntries,
  getRouteMarkerLegendSymbol,
  getRouteMarkerStyle,
} from '../../src/ui/route-marker-style.ts'

const point = (type, resolution = 'matched') => ({ type, resolution })

test('classifies start and end regardless of resolution', () => {
  assert.equal(getRouteMarkerCategory(point('start', 'matched')), 'start')
  assert.equal(getRouteMarkerCategory(point('end', 'matched')), 'finish')
})

test('a documented col or summit is col-summit only when actually matched on the ridden track', () => {
  assert.equal(getRouteMarkerCategory(point('col', 'matched')), 'col-summit')
  assert.equal(getRouteMarkerCategory(point('summit', 'matched')), 'col-summit')
  assert.equal(getRouteMarkerCategory(point('col', 'informational')), 'passage')
  assert.equal(getRouteMarkerCategory(point('summit', 'user-decision-required')), 'passage')
})

test('villages, passages, resupplies and pois fall back to the generic passage category', () => {
  for (const type of ['village', 'passage', 'resupply', 'poi', 'pause']) {
    assert.equal(getRouteMarkerCategory(point(type, 'matched')), 'passage')
  }
})

test('each category has a distinct shape, color and accessible label — not color alone', () => {
  const categories = ['start', 'finish', 'col-summit', 'passage']
  const styles = categories.map((category) => getRouteMarkerStyle(category))

  assert.equal(new Set(styles.map((style) => style.shape)).size, 3, 'start and passage may share a circle shape, but not all four should collapse to one shape')
  assert.equal(new Set(styles.map((style) => style.colorHex)).size, 4, 'every category needs its own color')
  for (const style of styles) {
    assert.ok(style.label.trim().length > 0, `${style.category} needs an accessible label`)
    assert.ok(style.sizePx > 0, `${style.category} needs a positive size`)
  }

  // Start and finish must remain distinguishable in black and white (no color): different shapes.
  const start = getRouteMarkerStyle('start')
  const finish = getRouteMarkerStyle('finish')
  assert.notEqual(start.shape, finish.shape)
})

test('start and finish markers are sized larger than a plain passage', () => {
  assert.ok(getRouteMarkerStyle('start').sizePx > getRouteMarkerStyle('passage').sizePx)
  assert.ok(getRouteMarkerStyle('finish').sizePx > getRouteMarkerStyle('passage').sizePx)
  assert.ok(getRouteMarkerStyle('col-summit').sizePx > getRouteMarkerStyle('passage').sizePx)
})

test('allRouteMarkerCategories covers every category with no duplicate and every one has a distinct-enough style — hamlet/peak are gone (V1 final scope)', () => {
  const categories = ['start', 'finish', 'col-summit', 'passage', 'locality-major', 'locality-minor']
  assert.equal(allRouteMarkerCategories.length, categories.length)
  assert.deepEqual([...allRouteMarkerCategories].sort(), [...categories].sort())
  assert.equal(new Set(allRouteMarkerCategories).size, allRouteMarkerCategories.length)
  for (const category of allRouteMarkerCategories) {
    const style = getRouteMarkerStyle(category)
    assert.ok(style.label.trim().length > 0, `${category} needs an accessible label`)
    assert.ok(style.sizePx > 0, `${category} needs a positive size`)
    assert.ok(getRouteMarkerLegendSymbol(category).length > 0, `${category} needs a legend symbol`)
  }
})

test('a village is smaller than a city/town — visual hierarchy matches importance', () => {
  assert.ok(getRouteMarkerStyle('locality-minor').sizePx < getRouteMarkerStyle('locality-major').sizePx)
})

test('the compact legend covers exactly the four historical RGA categories, unaffected by the generic map extension', () => {
  const entries = getRouteMarkerLegendEntries()
  assert.equal(entries.length, 4)
  assert.deepEqual(entries.map(({ symbol }) => symbol), ['D', 'A', '◆', '●'])
  assert.equal(getRouteMarkerLegendSymbol('start'), 'D')
  assert.equal(getRouteMarkerLegendSymbol('finish'), 'A')
  assert.equal(getRouteMarkerLegendSymbol('col-summit'), '◆')
  assert.equal(getRouteMarkerLegendSymbol('passage'), '●')
})
