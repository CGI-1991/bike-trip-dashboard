import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

// route-map.ts imports Leaflet's CSS, which only works inside a bundler — so,
// like route-map-direct-layer-toggle.test.mjs, this asserts the source shape
// directly rather than executing a real map (see that file's own note).

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

// R1 section 18: "Essentiels" activates exactly Eau/Abris/Toilettes/Vélo
// together — the CDC's own four categories, matched to the real layer ids
// buildPracticalPlaceMapLayers produces (`practical-${category}`).

test('R1 test M: ESSENTIAL_LAYER_IDS is exactly Eau/Abris/Toilettes/Vélo — no other category, no new one invented', () => {
  const match = /const ESSENTIAL_LAYER_IDS: ReadonlySet<string> = new Set\(\[([^\]]+)\]\)/.exec(source)
  assert.ok(match, 'ESSENTIAL_LAYER_IDS not found')
  const ids = match[1].split(',').map((entry) => entry.trim().replace(/^'|'$/g, ''))
  assert.deepEqual(ids.sort(), ['practical-bike-service', 'practical-shelter', 'practical-toilet', 'practical-water'].sort())
})

test('the six individual practical-place categories are untouched — the preset never replaces them, only toggles several at once', () => {
  const fnSource = extractFunction('installMapLayerPanel')
  // Every usable layer (all six categories, whichever the trip actually has
  // POI for) still gets its own independent checkbox row — the preset button
  // is prepended, never a replacement for the per-layer loop.
  assert.match(fnSource, /for \(const layer of usableLayers\) \{/)
  assert.match(fnSource, /input\.type = 'checkbox'/)
  assert.match(fnSource, /input\.dataset\.mapLayer = layer\.id/)
})

test('R1 test M/N: the Essentiels button reads the checkboxes back out of the DOM and dispatches a real "change" event on each — never a second, parallel add/remove-from-map code path', () => {
  const fnSource = extractFunction('installMapLayerPanel')
  assert.match(fnSource, /data-map-layer-preset="essentials"/)
  assert.match(fnSource, /input\.dispatchEvent\(new Event\('change'\)\)/)
  // No direct `group.addTo`/`group.remove` call anywhere near the preset
  // button's own click handler — it only ever flips `input.checked` and
  // dispatches, letting the SAME per-checkbox listener (already exercised
  // by the plain layer toggle) do the actual map mutation.
  const presetHandlerStart = fnSource.indexOf('essentialButton.addEventListener')
  const presetHandlerEnd = fnSource.indexOf('}, { signal })', presetHandlerStart) + '}, { signal })'.length
  const presetHandler = fnSource.slice(presetHandlerStart, presetHandlerEnd)
  assert.doesNotMatch(presetHandler, /\.addTo\(map\)|\.remove\(\)(?!\s*$)/)
})

test('R1 test M/N: toggling flips ALL essential checkboxes to the same uniform next state — a real on/off toggle, not a partial/inconsistent flip', () => {
  const fnSource = extractFunction('installMapLayerPanel')
  assert.match(fnSource, /const nextChecked = !inputs\.every\(\(input\) => input\.checked\)/)
  assert.match(fnSource, /input\.checked = nextChecked/)
})

test('R1: the preset button only appears when at least one essential category actually has markers on this trip — never a dead shortcut', () => {
  const fnSource = extractFunction('installMapLayerPanel')
  assert.match(fnSource, /usableLayers\.some\(\(layer\) => ESSENTIAL_LAYER_IDS\.has\(layer\.id\)\)/)
})

test('R1 test P: the preset button never imports or calls anything from the practical-places enrichment/network layer — a pure client-side DOM toggle', () => {
  const fnSource = extractFunction('installMapLayerPanel')
  const presetSection = fnSource.slice(fnSource.indexOf('ESSENTIAL_LAYER_IDS.has(layer.id))'), fnSource.indexOf('for (const layer of usableLayers)'))
  assert.doesNotMatch(presetSection, /fetch|Overpass|postpass|enrichStoredTrip/i)
})
