import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { parseAppHash } from '../../src/ui/app-state.ts'
import { renderDashboard } from '../../src/ui/render.ts'

const rideDaySettings = {
  version: 1,
  days: ['J1', 'J2', 'J3', 'J4', 'J6', 'J7', 'J9', 'J10', 'J11', 'J12'].map((dayId) => ({
    dayId,
    averageSpeedKph: 20,
    departureTime: '08:00',
    totalBreakMinutes: 30,
  })),
}

test('Today, Trip and Settings never require the detail-only Parcours container', async () => {
  const html = renderDashboard(rideDaySettings)
  const mainSource = await readFile(new URL('../../src/main.ts', import.meta.url), 'utf8')
  assert.equal(parseAppHash('#/today').currentView, 'today')
  assert.equal(parseAppHash('#/trip').currentView, 'trip')
  assert.equal(parseAppHash('#/settings').currentView, 'settings')
  assert.doesNotMatch(html, /data-day-points/)
  assert.doesNotMatch(mainSource, /data-day-points|dayPointsContainer|renderDayPoints/)
})

test('the day detail owns exactly one Parcours renderer', () => {
  const html = renderDashboard(rideDaySettings)
  assert.equal(parseAppHash('#/day/J1').currentView, 'day-detail')
  assert.equal((html.match(/data-route-engine/g) ?? []).length, 1)
  assert.equal((html.match(/data-day-panel="route"/g) ?? []).length, 1)
})

test('the Détail toggle and its automatic-waypoint machinery are gone for good', async () => {
  const html = renderDashboard(rideDaySettings)
  const mainSource = await readFile(new URL('../../src/main.ts', import.meta.url), 'utf8')
  const routeEngineSource = await readFile(new URL('../../src/ui/route-engine.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(html, /data-route-detail-toggle/)
  assert.doesNotMatch(mainSource, /setRouteDetail|data-route-detail-toggle/)
  assert.doesNotMatch(routeEngineSource, /setRouteDetail|route-point--generated|data-route-detail-toggle/)
})

test('global navigation listeners are installed once', async () => {
  const mainSource = await readFile(new URL('../../src/main.ts', import.meta.url), 'utf8')
  assert.equal((mainSource.match(/addEventListener\('hashchange'/g) ?? []).length, 1)
})
