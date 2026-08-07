import assert from 'node:assert/strict'
import test from 'node:test'

import {
  renderGenericDayCardWeatherLine,
  renderGenericOverviewWeatherBlock,
  renderGenericStageWeatherPanel,
} from '../../src/ui/weather-view.ts'

function fakeElement() {
  let html = ''
  return {
    get innerHTML() { return html },
    set innerHTML(value) { html = value },
  }
}

function baseModel(overrides = {}) {
  return {
    dayId: 'day-alpha',
    dayType: 'ride',
    availability: 'available',
    mode: 'planning',
    fetchedAt: '2027-05-09T10:00:00.000Z',
    isRefreshing: false,
    message: null,
    summary: {
      temperatureMinC: 12, temperatureMaxC: 21,
      precipitationProbabilityMaxPct: 35, precipitationMaxMm: 1.2,
      windSpeedMaxKph: 18, windGustsMaxKph: 30,
      worstWeatherLabel: 'Averses',
    },
    points: [
      { id: 'p1', name: 'Riverside', role: 'Départ', etaLabel: '08:00', temperatureC: 12, apparentTemperatureC: 11, precipitationProbabilityPct: 10, precipitationMm: 0, windSpeedKph: 10, windGustsKph: 15, weatherCodeLabel: 'Ciel clair', available: true, riskLevel: 'green', riskReasons: [] },
      { id: 'p2', name: 'Col du Test', role: 'Col', etaLabel: '11:30', temperatureC: 6, apparentTemperatureC: 3, precipitationProbabilityPct: 60, precipitationMm: 2, windSpeedKph: 30, windGustsKph: 45, weatherCodeLabel: 'Orage', available: true, riskLevel: 'red', riskReasons: ['Rafales fortes en altitude'] },
    ],
    riskLevel: 'red',
    alerts: [{ id: 'a1', dayId: 'day-alpha', riskType: 'gust', level: 'red', title: 'Rafales fortes en altitude', summary: 'x' }],
    // Sections 18-27 closeout: dedicated scenario/recommendation coverage
    // lives in `tests/ui/weather-decision.test.mjs` — this file's own tests
    // predate that feature and stay focused on the plain synthesis/points/
    // Aperçu/Voyage rendering, so the baseline here carries no scenarios.
    departureScenarios: [], recommendation: null, departureAlreadyPassed: false,
    ...overrides,
  }
}

// --- Étape Météo panel (CDC Jalon C1 section 19) ----------------------------

test('the stage weather panel shows a loading state before any data has ever arrived', () => {
  const container = fakeElement()
  renderGenericStageWeatherPanel(container, null, true)
  assert.match(container.innerHTML, /Chargement des prévisions/)
})

test('the stage weather panel shows the synthesis (temperature range, precipitation, wind, risk) and the chronological significant points', () => {
  const container = fakeElement()
  renderGenericStageWeatherPanel(container, baseModel(), false)
  assert.match(container.innerHTML, /12–21 °C/)
  assert.match(container.innerHTML, /Pluie 35 %/)
  assert.match(container.innerHTML, /Rafales 30 km\/h/)
  assert.match(container.innerHTML, /Risque météo : Élevé/)
  assert.match(container.innerHTML, /Riverside/)
  assert.match(container.innerHTML, /Départ/)
  assert.match(container.innerHTML, /08:00/)
  assert.match(container.innerHTML, /Col du Test/)
  assert.match(container.innerHTML, /11:30/)
})

test('an unavailable stage weather shows an honest message, never a fabricated value', () => {
  const container = fakeElement()
  renderGenericStageWeatherPanel(container, baseModel({ availability: 'unavailable', summary: null, points: [], message: 'Prévision de localisation indisponible.', riskLevel: 'unknown', alerts: [] }), false)
  assert.match(container.innerHTML, /Prévision de localisation indisponible\./)
  assert.doesNotMatch(container.innerHTML, /°C/)
})

test('a transfer day renders its origin and destination as two independent sections, never a fabricated waypoint along the way', () => {
  const container = fakeElement()
  renderGenericStageWeatherPanel(container, { origin: baseModel(), destination: null }, false)
  assert.match(container.innerHTML, />Origine</)
  assert.match(container.innerHTML, />Destination</)
  assert.match(container.innerHTML, /12–21 °C/, 'the resolvable origin shows real data')
  assert.match(container.innerHTML, /Météo non disponible pour le moment\./, 'the unresolved destination shows an honest placeholder, never an invented one')
})

// --- Aperçu (CDC Jalon C1 section 20) ---------------------------------------

test('Aperçu shows the real temperature/pluie/vent line plus the top alert when the risk is elevated', () => {
  const html = renderGenericOverviewWeatherBlock(baseModel())
  assert.match(html, /data-trip-overview-weather/)
  assert.match(html, /12–21 °C/)
  assert.match(html, /Rafales fortes en altitude/)
})

test('Aperçu never shows a fake weather value when data is unavailable', () => {
  const html = renderGenericOverviewWeatherBlock(baseModel({ availability: 'unavailable', summary: null, message: 'Météo non disponible pour le moment.' }))
  assert.doesNotMatch(html, /°C/)
  assert.match(html, /Météo non disponible pour le moment\./)
})

test('Aperçu shows the honest placeholder when there is no view-model at all yet', () => {
  const html = renderGenericOverviewWeatherBlock(null)
  assert.match(html, /Météo non disponible pour le moment\./)
  assert.doesNotMatch(html, /°C/)
})

test('a green-risk day never shows an alert line — only orange/red risk surfaces one', () => {
  const html = renderGenericOverviewWeatherBlock(baseModel({ riskLevel: 'green', alerts: [] }))
  assert.doesNotMatch(html, /trip-overview__weather-risk/)
})

// --- Voyage compact line (CDC Jalon C1 section 21) --------------------------

test('the Voyage day-card compact line shows temperature/pluie/vent in one short line', () => {
  const html = renderGenericDayCardWeatherLine(baseModel())
  assert.match(html, /<span class="trip-day-card__weather trip-day-card__weather--red">/)
  assert.match(html, /12–21 °C/)
  assert.match(html, /Pluie 35 %/)
})

test('the Voyage compact line renders nothing at all when there is no summary yet — never a repeated paragraph', () => {
  assert.equal(renderGenericDayCardWeatherLine(null), '')
  assert.equal(renderGenericDayCardWeatherLine(baseModel({ summary: null })), '')
})

test('the Voyage compact line never renders for a transfer\'s composite view-model directly (the card itself stays minimal per CDC section 21)', () => {
  assert.equal(renderGenericDayCardWeatherLine({ origin: baseModel(), destination: null }), '')
})
