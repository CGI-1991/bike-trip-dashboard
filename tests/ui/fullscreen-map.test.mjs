import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('the expanded route map owns a reversible scroll lock on every exit path', () => {
  const source = readFileSync(new URL('../../src/ui/route-map.ts', import.meta.url), 'utf8')
  assert.match(source, /scrollUnlocks\.set\(dialog, lockDocumentScroll\(\)\)/)
  assert.match(source, /if \(dialog\.open \|\| scrollUnlocks\.has\(dialog\) \|\| expandedHistory\.has\(dialog\)\) \{[\s\S]*closeExpandedRouteMap\(dialog\)/)
  assert.match(source, /try \{[\s\S]*dialog\.showModal\(\)[\s\S]*\} catch \{[\s\S]*closeExpandedRouteMap\(dialog, 'history'\)/)
  assert.match(source, /try \{[\s\S]*disposePracticalLayerPanel\(dialog\)[\s\S]*\} finally \{[\s\S]*unlock\?\.\(\)/)
  assert.match(source, /cancelAnimationFrame\(frame\)/)
})

test('fullscreen CSS uses the dynamic viewport, safe areas and one remaining map row', () => {
  const css = readFileSync(new URL('../../src/style.css', import.meta.url), 'utf8')
  assert.match(css, /\.route-map-dialog \{[^}]*width: 100dvw;[^}]*height: 100dvh;[^}]*min-height: 0;[^}]*max-height: none;[^}]*border-radius: 0/s)
  assert.match(css, /\.route-map-dialog\[open\] \{[^}]*grid-template-rows: auto minmax\(0, 1fr\)/s)
  assert.match(css, /\.route-map-dialog > header \{[^}]*env\(safe-area-inset-top\)[^}]*env\(safe-area-inset-left\)[^}]*env\(safe-area-inset-right\)/s)
  assert.match(css, /\.route-map-dialog__map-wrap \{[^}]*width: 100%;[^}]*height: 100%;[^}]*min-height: 0;[^}]*env\(safe-area-inset-bottom\)/s)
  assert.match(css, /\.route-map-dialog__map-wrap > \.route-map--expanded \{[^}]*height: 100%;[^}]*min-height: 0;[^}]*max-height: none/s)
  assert.match(css, /\.route-map-dialog__map-wrap > \.route-map--expanded\.leaflet-container \{[^}]*height: 100%;[^}]*min-height: 0;[^}]*max-height: none/s)
  assert.match(css, /body\.map-scroll-locked \{[^}]*position: fixed;[^}]*--map-scroll-lock-y/s)
})

test('fullscreen height overrides remain scoped away from compact route maps', () => {
  const css = readFileSync(new URL('../../src/style.css', import.meta.url), 'utf8')
  assert.match(css, /\.route-map \{[^}]*min-height: 280px/s)
  assert.match(css, /\.route-map__canvas \{ height: 280px; \}/)
  assert.match(css, /@media \(max-width: 430px\) \{[\s\S]*\.route-map, \.route-map__canvas \{ min-height: 230px; height: 230px; \}/)
  assert.doesNotMatch(css, /\.route-map--expanded > \.leaflet-container/)
  assert.doesNotMatch(css, /\[data-route-map-expanded\] \{[^}]*height:/s)
})

test('expanded Leaflet invalidates its final layout before the single GPX fit', () => {
  const source = readFileSync(new URL('../../src/ui/route-map.ts', import.meta.url), 'utf8')
  assert.match(source, /if \(options\.invalidateBeforeInitialFit === true\) map\.invalidateSize\(\)\s+map\.fitBounds\(line\.getBounds\(\)/)
  assert.match(source, /requestAnimationFrame\([\s\S]*dialog\.open[\s\S]*invalidateBeforeInitialFit: true/)
  assert.equal((source.match(/fitBounds\(/g) ?? []).length, 1)
})
