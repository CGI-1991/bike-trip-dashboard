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
  assert.match(css, /\.route-map-dialog \{[^}]*width: 100dvw;[^}]*height: 100dvh;[^}]*border-radius: 0/s)
  assert.match(css, /\.route-map-dialog\[open\] \{[^}]*grid-template-rows: auto minmax\(0, 1fr\)/s)
  assert.match(css, /\.route-map-dialog > header \{[^}]*env\(safe-area-inset-top\)[^}]*env\(safe-area-inset-left\)[^}]*env\(safe-area-inset-right\)/s)
  assert.match(css, /\.route-map-dialog__map-wrap \{[^}]*min-height: 0;[^}]*env\(safe-area-inset-bottom\)/s)
  assert.match(css, /body\.map-scroll-locked \{[^}]*position: fixed;[^}]*--map-scroll-lock-y/s)
})
