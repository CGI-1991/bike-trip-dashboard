import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

// route-map.ts imports Leaflet's CSS, which only works inside a bundler —
// so, like practical-layers.test.mjs and route-map-interaction-handle.test.mjs,
// this asserts the source shape directly rather than executing a real map.

const source = readFileSync(new URL('../../src/ui/route-map.ts', import.meta.url), 'utf8')

function extractFunction(name) {
  const start = source.indexOf(`function ${name}`)
  assert.ok(start >= 0, `${name} not found`)
  const next = source.indexOf('\nfunction ', start + 1)
  const nextExport = source.indexOf('\nexport function ', start + 1)
  const candidates = [next, nextExport].filter((index) => index !== -1)
  const end = candidates.length === 0 ? undefined : Math.min(...candidates)
  return source.slice(start, end)
}

test('CDC D1.2 sections 4-5: installDirectLayerToggle exists and toggles on click directly — no panel-open indirection', () => {
  const fnSource = extractFunction('installDirectLayerToggle')
  assert.match(fnSource, /toggle\.addEventListener\('click', handler\)/)
  // The handler flips visibility immediately (addTo/remove), never opening
  // a panel/list first.
  assert.match(fnSource, /group\.addTo\(map\)/)
  assert.match(fnSource, /group\.remove\(\)/)
  assert.doesNotMatch(fnSource, /panel\.hidden|openPanel|closePanel/)
})

test('state is expressed only via aria-pressed — the button label itself is never rewritten to "Détail ON/OFF"', () => {
  const fnSource = extractFunction('installDirectLayerToggle')
  assert.match(fnSource, /toggle\.setAttribute\('aria-pressed', 'false'\)/)
  assert.match(fnSource, /toggle\.setAttribute\('aria-pressed', 'true'\)/)
  assert.doesNotMatch(fnSource, /textContent\s*=/, 'the toggle never rewrites its own text label')
})

test('a second click flips the state back off (toggle, not a one-way reveal)', () => {
  const fnSource = extractFunction('installDirectLayerToggle')
  assert.match(fnSource, /const active = toggle\.getAttribute\('aria-pressed'\) === 'true'/)
  assert.match(fnSource, /if \(active\) \{ group\.remove\(\); toggle\.setAttribute\('aria-pressed', 'false'\) \}/)
})

test('renderGenericRouteMap wires installDirectLayerToggle only when options.directLayerToggle is true — the Étape map\'s own Calques panel path is untouched', () => {
  const genericMapSource = source.slice(source.indexOf('export function renderGenericRouteMap'))
  assert.match(genericMapSource, /if \(options\.directLayerToggle === true\) installDirectLayerToggle\(dialog, map, layers\)/)
  assert.match(genericMapSource, /else installMapLayerPanel\(dialog, map, layers\)/)
})

test('disposeDirectLayerToggle is called on every fresh render and on close — no leaked layer group across renders', () => {
  assert.match(source, /disposeDirectLayerToggle\(dialog\)/g)
  const occurrences = source.match(/disposeDirectLayerToggle\(dialog\)/g) ?? []
  assert.ok(occurrences.length >= 2, 'called from both renderGenericRouteMap\'s fresh-render guard and closeExpandedRouteMap')
})
