import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

// route-map.ts imports Leaflet's CSS, which only works inside a bundler
// (see route-map-model.ts's own doc comment) — so, like practical-layers.test.mjs,
// this asserts the source shape directly rather than executing a real map.

const source = readFileSync(new URL('../../src/ui/route-map.ts', import.meta.url), 'utf8')

function extractFunction(name) {
  const start = source.indexOf(`function ${name}`)
  assert.ok(start >= 0, `${name} not found`)
  // Grab up to the next top-level export/function as a generous bound.
  const next = source.indexOf('\nexport function', start + 1)
  return source.slice(start, next === -1 ? undefined : next)
}

test('getRouteMapInteractionHandle is exported alongside RouteMapInteractionHandle', () => {
  assert.match(source, /export interface RouteMapInteractionHandle/)
  assert.match(source, /export function getRouteMapInteractionHandle/)
})

test('Y: setTemporaryMarker only ever calls setLatLng/addTo on the marker — never fitBounds/panTo/setView on the map', () => {
  const handleSource = source.slice(source.indexOf('export function getRouteMapInteractionHandle'), source.indexOf('function shapeStyle'))
  assert.match(handleSource, /existing\.setLatLng\(/)
  assert.match(handleSource, /\.addTo\(map\)/)
  assert.doesNotMatch(handleSource, /fitBounds/)
  assert.doesNotMatch(handleSource, /\.panTo\(/)
  assert.doesNotMatch(handleSource, /\.setView\(/)
})

test('a fresh createRouteMap (a real re-render) clears any stale temporary marker for that container — never resurrects a marker from a torn-down map', () => {
  const destroySource = extractFunction('destroy(')
  assert.match(source, /temporaryMarkers\.delete\(container\)/)
  // destroyRouteMap (called by every createRouteMap) is what clears it.
  const destroyRouteMapSource = source.slice(source.indexOf('export function destroyRouteMap'), source.indexOf('function destroy('))
  assert.match(destroyRouteMapSource, /temporaryMarkers\.delete\(container\)/)
})

test('getRouteMapInteractionHandle resolves the compact canvas the same way renderGenericRouteMap itself does, whether given the outer container or the canvas directly', () => {
  const handleSource = source.slice(source.indexOf('export function getRouteMapInteractionHandle'), source.indexOf('function shapeStyle'))
  assert.match(handleSource, /container\.querySelector<HTMLElement>\('\[data-route-map-canvas\]'\) \?\? container/)
})
