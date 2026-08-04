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
  assert.match(source, /if \(options\.invalidateBeforeInitialFit === true\) map\.invalidateSize\(\)\s+map\.fitBounds\(bounds/)
  assert.match(source, /requestAnimationFrame\([\s\S]*dialog\.open[\s\S]*invalidateBeforeInitialFit: true/)
  assert.equal((source.match(/fitBounds\(/g) ?? []).length, 1)
})

test('every compact map wrapper (.route-map) gets its own local stacking context so Leaflet panes can never escape above the fixed bottom nav', () => {
  const css = readFileSync(new URL('../../src/style.css', import.meta.url), 'utf8')
  // .route-map is the one shared wrapper class for the day-detail compact
  // card, the Aperçu global map and the Aperçu stage's small map
  // (.route-map--today) — fixing it once covers all of them.
  assert.match(css, /\.route-map \{[^}]*position: relative;[^}]*isolation: isolate;[^}]*z-index: 0;[^}]*overflow: hidden/s)
  // The fix must not touch Leaflet's own internal panes/controls globally.
  assert.doesNotMatch(css, /^\.leaflet-pane\s*\{/m)
  assert.doesNotMatch(css, /^\.leaflet-marker-pane\s*\{/m)
  assert.doesNotMatch(css, /^\.leaflet-popup-pane\s*\{/m)
  assert.doesNotMatch(css, /^\.leaflet-control\s*\{/m)
})

test('the bottom navigation and the fullscreen map dialog both stay above the isolated compact map stacking context', () => {
  const css = readFileSync(new URL('../../src/style.css', import.meta.url), 'utf8')
  assert.match(css, /\.app-nav \{[^}]*position: fixed;[^}]*z-index: 20/s)
  // The fullscreen map is a native <dialog> shown with showModal(): the
  // browser's top-layer already renders it above every regular positioned
  // element (including .app-nav) regardless of z-index, and its own header
  // additionally carries a z-index well above the nav for defense in depth.
  assert.match(css, /\.route-map-dialog > header \{[^}]*z-index: 1200/s)
})

test('the practical layers panel still stacks above the expanded map inside the fullscreen dialog', () => {
  const css = readFileSync(new URL('../../src/style.css', import.meta.url), 'utf8')
  assert.match(css, /\.practical-layers-backdrop \{[^}]*z-index: 1090/s)
})
