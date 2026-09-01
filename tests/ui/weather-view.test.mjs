import assert from 'node:assert/strict'
import test from 'node:test'

import {
  renderGenericDayCardWeatherLine,
  renderGenericOverviewWeatherBlock,
  renderGenericStageWeatherPanel,
  renderInlineWaypointWeather,
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

// R1 section 12 ("météo banale"), test I — one compact line, no imposing
// block, when there is genuinely nothing to flag: the engine/model itself
// (riskLevel, summary) is untouched, only how much of it renders changes.
test('R1 test I: a banal (green) day\'s synthesis collapses to one compact line — no "Risque météo" sentence, no weather-code line, no meta line', () => {
  const container = fakeElement()
  const model = baseModel({ riskLevel: 'green', alerts: [], recommendation: null })
  renderGenericStageWeatherPanel(container, model, false, { includePointsList: false })
  assert.match(container.innerHTML, /weather-synthesis--compact/)
  assert.match(container.innerHTML, /12–21 °C/)
  assert.match(container.innerHTML, /Pluie 35 %/)
  assert.match(container.innerHTML, /Rafales 30 km\/h/)
  assert.doesNotMatch(container.innerHTML, /Risque météo/)
  assert.doesNotMatch(container.innerHTML, /Averses/, 'the raw weather-code line is dropped for a banal day')
  assert.doesNotMatch(container.innerHTML, /Mis à jour/)
})

test('R1: an orange/red day keeps the full synthesis — code line, explicit risk sentence, freshness meta — the compacting never applies to an actual alert', () => {
  const container = fakeElement()
  renderGenericStageWeatherPanel(container, baseModel({ riskLevel: 'orange' }), false, { includePointsList: false })
  assert.doesNotMatch(container.innerHTML, /weather-synthesis--compact/)
  assert.match(container.innerHTML, /Risque météo : Modéré/)
  assert.match(container.innerHTML, /Averses/)
  assert.match(container.innerHTML, /Mis à jour/)
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

// --- CDC D1.2 sections 24 (test U/V) — the ride day's own weather panel
// drops its "Points significatifs" list once each point already has its own
// inline weather line in the Parcours timeline. ---------------------------

test('U/V: includePointsList: false drops the points list entirely — synthesis/risk/recommendation/comparison stay, no second list of the same points', () => {
  const container = fakeElement()
  renderGenericStageWeatherPanel(container, baseModel(), false, { includePointsList: false })
  assert.doesNotMatch(container.innerHTML, /weather-points-block/)
  assert.doesNotMatch(container.innerHTML, /Points significatifs/)
  assert.doesNotMatch(container.innerHTML, /Col du Test/, 'the point that only ever appeared in that list is gone from this mount entirely')
  assert.match(container.innerHTML, /weather-summary-block/, 'the synthesis itself is untouched')
})

test('omitting the option (or passing true) keeps the exact historical behaviour — OFF/transfer days never lose their list', () => {
  const container = fakeElement()
  renderGenericStageWeatherPanel(container, baseModel(), false)
  assert.match(container.innerHTML, /weather-points-block/)
  assert.match(container.innerHTML, /Col du Test/)
})

// --- CDC D1.2 sections 18-21 (tests W/X/Y/Z) — the inline per-waypoint line ---

test('W/Z: a normal (green) point renders one compact line, no chevron, no expand affordance', () => {
  const html = renderInlineWaypointWeather('p1', baseModel().points[0])
  assert.match(html, /<span class="day-detail__waypoint-weather day-detail__waypoint-weather--green">/)
  assert.match(html, /12 °C/)
  assert.doesNotMatch(html, /data-action="toggle-waypoint-weather"/)
  assert.doesNotMatch(html, /chevron/)
})

test('X/Y: an orange/red point becomes a real expand toggle, highlighted, revealing the already-computed risk reasons', () => {
  const html = renderInlineWaypointWeather('p2', baseModel().points[1])
  assert.match(html, /<button type="button" class="day-detail__waypoint-weather day-detail__waypoint-weather--red day-detail__waypoint-weather-toggle" data-action="toggle-waypoint-weather" aria-expanded="false" aria-controls="waypoint-weather-detail-p2">/)
  assert.match(html, /<div class="day-detail__waypoint-weather-detail" id="waypoint-weather-detail-p2" hidden>/)
  assert.match(html, /Rafales fortes en altitude/, 'the alert engine\'s own riskReasons, never a second computation')
})

test('no data for this waypoint yet (still loading, or not a significant point) renders nothing at all — never a placeholder block per row', () => {
  assert.equal(renderInlineWaypointWeather('unknown-id', undefined), '')
})

test('an unavailable sample point (no real data reached it) renders nothing rather than a fabricated line', () => {
  const point = { ...baseModel().points[0], available: false, temperatureC: null, precipitationProbabilityPct: null, windSpeedKph: null }
  assert.equal(renderInlineWaypointWeather('p1', point), '')
})
