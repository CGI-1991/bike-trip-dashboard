import assert from 'node:assert/strict'
import test from 'node:test'

import { compactPlaceName } from '../../src/ui/compact-place-name.ts'

test('shortens a leading "Saint-"/"Sainte-" for display, never touching the rest of the name', () => {
  assert.equal(compactPlaceName('Saint-Jean-de-Sixt'), 'St-Jean-de-Sixt')
  assert.equal(compactPlaceName('Sainte-Foy-Tarentaise'), 'Ste-Foy-Tarentaise')
})

test('a mid-name "Saint-"/"Sainte-" segment is shortened too (e.g. a hyphenated double place name)', () => {
  assert.equal(compactPlaceName('Bourg-Saint-Maurice'), 'Bourg-St-Maurice')
})

test('a name with no "Saint-"/"Sainte-" segment is returned unchanged', () => {
  assert.equal(compactPlaceName('Morzine'), 'Morzine')
  assert.equal(compactPlaceName('Riverside → Hilltown'), 'Riverside → Hilltown')
})

test('never mutates its input, and is safe on an empty string', () => {
  const input = 'Saint-Gervais'
  const result = compactPlaceName(input)
  assert.equal(input, 'Saint-Gervais', 'the original string is immutable anyway (JS strings), but the call must not throw or need mutation')
  assert.equal(result, 'St-Gervais')
  assert.equal(compactPlaceName(''), '')
})
