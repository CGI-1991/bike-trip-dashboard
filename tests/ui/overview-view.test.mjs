import assert from 'node:assert/strict'
import test from 'node:test'

import { renderOverviewView } from '../../src/ui/overview-view.ts'

function progress(overrides = {}) {
  return {
    period: 'during',
    currentDayId: 'J1',
    currentDayState: 'in-progress',
    totalDistanceKm: 800,
    completedDistanceKm: 120,
    remainingDistanceKm: 680,
    totalElevationGainM: 18_000,
    completedElevationGainM: 2_000,
    remainingElevationGainM: 16_000,
    totalElevationLossM: 17_500,
    completedElevationLossM: 1_800,
    remainingElevationLossM: 15_700,
    completedRideDays: 2,
    remainingRideDays: 8,
    offDays: 2,
    progressPercent: 15,
    position: null,
    ...overrides,
  }
}

function model(overrides = {}) {
  return {
    period: 'during',
    daysUntilStart: null,
    progress: progress(),
    stage: { type: 'ride', dayId: 'J1' },
    mapModel: { tracks: [], markers: [] },
    alerts: [],
    ...overrides,
  }
}

test('renders exactly twelve global stats, the merged map container/explore action, and the stage placeholder', () => {
  const container = { innerHTML: '', dataset: {} }
  renderOverviewView(container, model())
  assert.equal((container.innerHTML.match(/<dt>/g) ?? []).length, 12)
  assert.match(container.innerHTML, /Distance totale/)
  assert.match(container.innerHTML, /Distance parcourue/)
  assert.match(container.innerHTML, /Distance restante/)
  assert.match(container.innerHTML, />D\+ total</)
  assert.match(container.innerHTML, />D− total</)
  assert.match(container.innerHTML, /Étapes roulées terminées/)
  assert.match(container.innerHTML, /Étapes roulées restantes/)
  assert.match(container.innerHTML, /Journées OFF/)
  assert.match(container.innerHTML, /data-overview-map/)
  assert.match(container.innerHTML, /data-overview-explore-map/)
  assert.match(container.innerHTML, /data-overview-stage/)
  assert.equal(container.dataset.overviewState, 'during')
})

test('renders no alerts section when there are none, and one list item per alert when there are', () => {
  const container = { innerHTML: '', dataset: {} }
  renderOverviewView(container, model())
  assert.doesNotMatch(container.innerHTML, /overview-alerts/)

  const withAlerts = model({ alerts: [
    { id: 'offline', level: 'info', message: 'Mode hors ligne.' },
    { id: 'weather-risk', level: 'danger', message: 'Orage annoncé.' },
  ] })
  const container2 = { innerHTML: '', dataset: {} }
  renderOverviewView(container2, withAlerts)
  assert.equal((container2.innerHTML.match(/overview-alert overview-alert--/g) ?? []).length, 2)
  assert.match(container2.innerHTML, /overview-alert--info/)
  assert.match(container2.innerHTML, /overview-alert--danger/)
  assert.match(container2.innerHTML, /Mode hors ligne\./)
  assert.match(container2.innerHTML, /Orage annoncé\./)
})

test('never renders practical-layer or full-roadbook markup — the merged map card stays minimal', () => {
  const container = { innerHTML: '', dataset: {} }
  renderOverviewView(container, model())
  assert.doesNotMatch(container.innerHTML, /practical-layers|data-roadbook/)
})
