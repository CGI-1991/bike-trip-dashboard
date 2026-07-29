import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { createDefaultRideDaySettingsDocument } from '../../src/storage/ride-day-settings.ts'
import { renderDashboard } from '../../src/ui/render.ts'

test('the practical layer panel exists only inside the expanded route-map dialog', () => {
  const html = renderDashboard(createDefaultRideDaySettingsDocument())
  assert.equal((html.match(/data-practical-layers-toggle/g) ?? []).length, 1)
  assert.match(
    html,
    /class="route-map-dialog"[\s\S]*data-practical-layers-toggle[\s\S]*data-route-map-expanded[\s\S]*data-practical-layers-backdrop[\s\S]*data-practical-layers-panel/,
  )
  assert.match(html, /data-practical-layers-panel role="dialog"[\s\S]*data-practical-layers-list[\s\S]*<footer>[\s\S]*data-practical-layers-hide-all/)
  const todayView = html.slice(
    html.indexOf('data-app-view="today"'),
    html.indexOf('data-app-view="trip"'),
  )
  assert.doesNotMatch(todayView, /practical|Calques/)
})

test('practical markers are installed only after the expanded GPX map is created', () => {
  const source = readFileSync(new URL('../../src/ui/route-map.ts', import.meta.url), 'utf8')
  const compactStart = source.indexOf('export function renderCompactRouteMapModel')
  const expandedStart = source.indexOf('export function renderRouteMap', compactStart)
  assert.doesNotMatch(source.slice(compactStart, expandedStart), /Practical|practical/)
  assert.match(
    source.slice(expandedStart),
    /map = createMap\([\s\S]*invalidateBeforeInitialFit: true[\s\S]*installPracticalLayerPanel\(dialog, map, practicalData, timeline\.day\.id/,
  )
  assert.equal((source.match(/fitBounds\(/g) ?? []).length, 1)
})

test('layers start hidden, remain independent and never trigger a new fitBounds', () => {
  const source = readFileSync(new URL('../../src/ui/practical-map.ts', import.meta.url), 'utf8')
  assert.match(source, /panel\.hidden = true/)
  assert.match(source, /input\.type = 'checkbox'/)
  assert.doesNotMatch(source, /input\.checked = true|localStorage|sessionStorage|fitBounds/)
  assert.match(source, /groups\.set\(viewModel\.layer\.id, group\)/)
  assert.match(source, /input\.checked[\s\S]*group\.addTo\(map\)[\s\S]*group\?\.remove\(\)/)
  assert.match(source, /for \(const group of groups\.values\(\)\) group\.remove\(\)/)
  assert.match(source, /count\.textContent = `\$\{viewModel\.points\.length\}`/)
})

test('popups use textContent and safe external bicycle links', () => {
  const source = readFileSync(new URL('../../src/ui/practical-map.ts', import.meta.url), 'utf8')
  const popupStart = source.indexOf('function createPopup')
  const popupEnd = source.indexOf('\nfunction createLayerGroup', popupStart)
  const popupSource = source.slice(popupStart, popupEnd)
  assert.match(popupSource, /title\.textContent = point\.name/)
  assert.match(popupSource, /layerLabel\.textContent = layer\.name/)
  assert.match(popupSource, /description\.textContent = point\.description/)
  assert.match(popupSource, /link\.target = '_blank'/)
  assert.match(popupSource, /link\.rel = 'noopener noreferrer'/)
  assert.match(popupSource, /connexion requise/)
  assert.doesNotMatch(popupSource, /innerHTML/)
})

test('the panel is keyboard and backdrop closeable with a bounded mobile sheet', () => {
  const source = readFileSync(new URL('../../src/ui/practical-map.ts', import.meta.url), 'utf8')
  const css = readFileSync(new URL('../../src/style.css', import.meta.url), 'utf8')
  assert.match(source, /event\.key !== 'Escape'/)
  assert.match(source, /event\.preventDefault\(\)/)
  assert.match(source, /toggle\.focus\(\)/)
  assert.match(source, /backdrop\.addEventListener\('click', \(\) => installedController\.close\(\)/)
  assert.match(source, /hooks\.onOpened\?\.\(\)/)
  assert.match(css, /\.practical-layers-panel \{[^}]*max-height: min\(70dvh,[^}]*grid-template-rows: auto minmax\(0, 1fr\) auto;[^}]*overflow: hidden/s)
  assert.match(css, /\.practical-layers-panel > header \{[^}]*position: sticky/s)
  assert.match(css, /\.practical-layers-list \{[^}]*overflow-y: auto;[^}]*overscroll-behavior: contain/s)
  assert.match(css, /\.practical-layers-panel > footer \{[^}]*position: sticky;[^}]*env\(safe-area-inset-bottom\)/s)
  assert.match(css, /\.practical-layer-option \{[^}]*min-height: 44px;[^}]*minmax\(0, 1fr\)/s)
  assert.match(css, /@media \(max-width: 430px\) \{[\s\S]*\.practical-layers-panel \{[^}]*bottom: 0;[^}]*width: calc\(100% - 12px\)/)
})

test('practical data stays outside roadbook, ETA, pauses, weather and compact map models', () => {
  const files = [
    '../../src/ui/today-view.ts',
    '../../src/ui/today-view-model.ts',
    '../../src/ui/route-map-model.ts',
    '../../src/ui/weather-detail.ts',
    '../../src/trip/timeline.ts',
    '../../src/trip/pause-plan.ts',
    '../../src/trip/roadbook-match.ts',
  ]
  for (const file of files) {
    assert.doesNotMatch(readFileSync(new URL(file, import.meta.url), 'utf8'), /practical|KML/i)
  }
  const mainSource = readFileSync(new URL('../../src/main.ts', import.meta.url), 'utf8')
  assert.match(mainSource, /loadPracticalData/)
  assert.match(mainSource, /renderRouteMap\([^\n]+currentPracticalData\)/)
})
