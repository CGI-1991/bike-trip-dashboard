import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { parseAppHash } from '../../src/ui/app-state.ts'
import { renderDashboard } from '../../src/ui/render.ts'
import { setRouteDetail } from '../../src/ui/route-engine.ts'

const settings = { averageSpeedKph: 20, departureTime: '08:00', totalBreakMinutes: 30 }

test('Today, Trip and Settings never require the detail-only Parcours container', async () => {
  const html = renderDashboard(settings)
  const mainSource = await readFile(new URL('../../src/main.ts', import.meta.url), 'utf8')
  assert.equal(parseAppHash('#/today').currentView, 'today')
  assert.equal(parseAppHash('#/trip').currentView, 'trip')
  assert.equal(parseAppHash('#/settings').currentView, 'settings')
  assert.doesNotMatch(html, /data-day-points/)
  assert.doesNotMatch(mainSource, /data-day-points|dayPointsContainer|renderDayPoints/)
})

test('the day detail owns exactly one Parcours renderer', () => {
  const html = renderDashboard(settings)
  assert.equal(parseAppHash('#/day/J1').currentView, 'day-detail')
  assert.equal((html.match(/data-route-engine/g) ?? []).length, 1)
  assert.equal((html.match(/data-day-panel="route"/g) ?? []).length, 1)
})

test('repeated Detail toggles update the same DOM nodes without duplication', () => {
  const generated = [{ hidden: true }, { hidden: true }]
  const input = { setAttribute(name, value) { this[name] = value } }
  const container = { dataset: {}, querySelectorAll: () => generated, querySelector: () => input }
  setRouteDetail(container, true)
  setRouteDetail(container, false)
  setRouteDetail(container, true)
  assert.deepEqual(generated.map(({ hidden }) => hidden), [false, false])
  assert.equal(generated.length, 2)
  assert.equal(input['aria-checked'], 'true')
  assert.equal(container.dataset.routeDetail, 'true')
})

test('global navigation listeners are installed once', async () => {
  const mainSource = await readFile(new URL('../../src/main.ts', import.meta.url), 'utf8')
  assert.equal((mainSource.match(/addEventListener\('hashchange'/g) ?? []).length, 1)
  assert.equal((mainSource.match(/routeEngineContainer\.addEventListener\('change'/g) ?? []).length, 1)
})
