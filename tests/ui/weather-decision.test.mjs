import assert from 'node:assert/strict'
import test from 'node:test'

import { renderGenericStageWeatherPanel } from '../../src/ui/weather-view.ts'

// Sections 18-27/29 closeout: the weather decision card — risk banner,
// recommendation + apply/modify actions, confirmation panel, and the
// "Comparer les horaires" scenario comparison. `tests/ui/weather-view.test.mjs`
// covers the plain synthesis/points/Aperçu/Voyage rendering this file
// doesn't touch again.

function fakeElement() {
  let html = ''
  return {
    get innerHTML() { return html },
    set innerHTML(value) { html = value },
  }
}

function scenario(overrides = {}) {
  return {
    offsetMinutes: 0, isCurrent: true, isCoherent: true, incoherenceReason: null,
    departureTimeLocal: '2027-05-10T08:00', arrivalTimeLocal: '2027-05-10T12:00',
    coveredPointCount: 2, missingPointCount: 0,
    maximumRainMm: 0, maximumGustKph: 10, minimumApparentTemperatureC: 10,
    minimumExposedApparentTemperatureC: 8, minimumVisibilityM: 20_000,
    risk: { level: 'green', redCount: 0, orangeCount: 0, upcomingRedCount: 0, upcomingOrangeCount: 0, coveredPointCount: 2, missingPointCount: 0, essentialCoverageRatio: 1, alerts: [] },
    ...overrides,
  }
}

function fiveScenarios() {
  return [
    scenario({ offsetMinutes: -120, isCurrent: false, departureTimeLocal: '2027-05-10T06:00', arrivalTimeLocal: '2027-05-10T10:00' }),
    scenario({ offsetMinutes: -60, isCurrent: false, departureTimeLocal: '2027-05-10T07:00', arrivalTimeLocal: '2027-05-10T11:00' }),
    scenario({ offsetMinutes: 0 }),
    scenario({ offsetMinutes: 60, isCurrent: false, departureTimeLocal: '2027-05-10T09:00', arrivalTimeLocal: '2027-05-10T13:00' }),
    scenario({ offsetMinutes: 120, isCurrent: false, departureTimeLocal: '2027-05-10T10:00', arrivalTimeLocal: '2027-05-10T14:00' }),
  ]
}

function baseModel(overrides = {}) {
  return {
    dayId: 'day-alpha', dayType: 'ride', availability: 'available', mode: 'operational',
    fetchedAt: '2027-05-09T10:00:00.000Z', isRefreshing: false, message: null,
    summary: { temperatureMinC: 5, temperatureMaxC: 15, precipitationProbabilityMaxPct: 20, precipitationMaxMm: 0.5, windSpeedMaxKph: 20, windGustsMaxKph: 40, worstWeatherLabel: null },
    points: [], riskLevel: 'green', alerts: [],
    departureScenarios: [], recommendation: null, departureAlreadyPassed: false,
    ...overrides,
  }
}

test('a red risk gets a real, visible banner — never a small badge lost among values (section 23)', () => {
  const container = fakeElement()
  renderGenericStageWeatherPanel(container, baseModel({ riskLevel: 'red', alerts: [{ id: 'a1', dayId: 'day-alpha', riskType: 'gust', level: 'red', title: 'Rafales fortes en altitude', summary: '72 km/h prévues sur les hauts cols.' }] }), false)
  assert.match(container.innerHTML, /weather-decision__banner weather-decision__banner--red/)
  assert.match(container.innerHTML, /ALERTE MÉTÉO · RISQUE ÉLEVÉ/)
  assert.match(container.innerHTML, /Rafales fortes en altitude/)
  assert.match(container.innerHTML, /72 km\/h prévues sur les hauts cols\./)
})

test('a green risk shows no banner at all — sober treatment (section 23)', () => {
  const container = fakeElement()
  renderGenericStageWeatherPanel(container, baseModel({ riskLevel: 'green' }), false)
  assert.doesNotMatch(container.innerHTML, /weather-decision__banner/)
})

test('a recommended change shows the conclusion sentence, an "Appliquer HH:MM", and "Modifier manuellement" (sections 20-21/25/28)', () => {
  const container = fakeElement()
  const recommendation = {
    status: 'recommended-change',
    currentScenario: scenario({ departureTimeLocal: '2027-05-10T08:00' }),
    recommendedScenario: scenario({ offsetMinutes: -60, isCurrent: false, departureTimeLocal: '2027-05-10T07:00' }),
    title: 'Un départ vers 07:00 semble plus favorable que 08:00.',
    explanation: [],
  }
  renderGenericStageWeatherPanel(container, baseModel({ recommendation, departureScenarios: fiveScenarios() }), false)
  assert.match(container.innerHTML, /Un départ vers 07:00 semble plus favorable que 08:00\./)
  assert.match(container.innerHTML, /data-action="apply-weather-departure-time" data-departure-time="07:00" data-current-departure-time="08:00">Appliquer 07:00</)
  assert.match(container.innerHTML, /data-action="edit-day-departure-time">Modifier manuellement/, 'reuses the exact same editor action as the Étape stats header — never a second implementation')
})

test('"keep-current"/"insufficient-data" show only the plain sentence — no primary "Appliquer" CTA to a time that isn\'t actually better (per-row "Choisir" on other coherent scenarios, section 25, is still allowed)', () => {
  const container = fakeElement()
  const recommendation = { status: 'keep-current', currentScenario: scenario(), recommendedScenario: null, title: 'Le départ actuel reste le meilleur compromis.', explanation: [] }
  renderGenericStageWeatherPanel(container, baseModel({ recommendation, departureScenarios: [] }), false)
  assert.match(container.innerHTML, /Le départ actuel reste le meilleur compromis\./)
  assert.doesNotMatch(container.innerHTML, /Appliquer/, 'no primary recommendation CTA when the recommendation itself says to keep the current time')
})

test('"not-applicable" shows nothing at all — never an empty/confusing recommendation block', () => {
  const container = fakeElement()
  const recommendation = { status: 'not-applicable', currentScenario: null, recommendedScenario: null, title: 'x', explanation: [] }
  const html1 = (() => { const c = fakeElement(); renderGenericStageWeatherPanel(c, baseModel({ recommendation }), false); return c.innerHTML })()
  assert.doesNotMatch(html1, /weather-decision__recommendation/)
})

test('the 5 scenarios render inside a repliable "Comparer les horaires" section, offsets labelled −2 h/−1 h/Actuel/+1 h/+2 h (section 24)', () => {
  const container = fakeElement()
  renderGenericStageWeatherPanel(container, baseModel({ departureScenarios: fiveScenarios() }), false)
  assert.match(container.innerHTML, /<details class="weather-decision__compare" data-weather-compare>/)
  assert.match(container.innerHTML, /<summary>Comparer les horaires<\/summary>/)
  for (const label of ['−2 h', '−1 h', 'Actuel', '+1 h', '+2 h']) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    assert.match(container.innerHTML, new RegExp(`<strong>${escaped}</strong>`), `missing offset label ${label}`)
  }
  assert.match(container.innerHTML, /Départ 06:00 · Arrivée 10:00/)
  assert.match(container.innerHTML, /Départ 08:00 · Arrivée 12:00/)
})

test('each non-current coherent scenario offers its own "Choisir HH:MM" — the current one and incoherent ones never do (section 25)', () => {
  const container = fakeElement()
  const scenarios = [
    scenario({ offsetMinutes: -120, isCurrent: false, isCoherent: false, departureTimeLocal: '2027-05-09T23:00' }),
    scenario({ offsetMinutes: -60, isCurrent: false, departureTimeLocal: '2027-05-10T07:00' }),
    scenario({ offsetMinutes: 0 }),
  ]
  renderGenericStageWeatherPanel(container, baseModel({ departureScenarios: scenarios }), false)
  assert.match(container.innerHTML, /data-action="apply-weather-departure-time" data-departure-time="07:00"[^>]*>Choisir 07:00/)
  assert.equal((container.innerHTML.match(/Choisir /g) ?? []).length, 1, 'only the one coherent, non-current scenario gets a "Choisir" action')
})

test('the confirmation panel is always rendered alongside a comparison, hidden by default (section 26)', () => {
  const container = fakeElement()
  renderGenericStageWeatherPanel(container, baseModel({ departureScenarios: fiveScenarios() }), false)
  assert.match(container.innerHTML, /data-weather-apply-confirm hidden/)
  assert.match(container.innerHTML, /Modifier l.heure de départ ?/)
  assert.match(container.innerHTML, /data-action="confirm-apply-weather-departure-time">Confirmer/)
  assert.match(container.innerHTML, /data-action="cancel-apply-weather-departure-time">Annuler/)
})

test('mode policy (section 29): today-reference/past/trend show no decision card at all', () => {
  for (const mode of ['today-reference', 'past', 'trend']) {
    const container = fakeElement()
    const recommendation = { status: 'recommended-change', currentScenario: scenario(), recommendedScenario: scenario({ offsetMinutes: -60, isCurrent: false }), title: 'x', explanation: [] }
    renderGenericStageWeatherPanel(container, baseModel({ mode, recommendation, departureScenarios: fiveScenarios(), riskLevel: 'red', alerts: [{ id: 'a1', dayId: 'day-alpha', riskType: 'gust', level: 'red', title: 'x', summary: '' }] }), false)
    assert.doesNotMatch(container.innerHTML, /weather-decision/, `mode ${mode} must show no decision card at all`)
  }
})

test('mode policy: planning shows the comparison (preliminary) even though buildDepartureRecommendation itself never fires in planning', () => {
  const container = fakeElement()
  renderGenericStageWeatherPanel(container, baseModel({ mode: 'planning', departureScenarios: fiveScenarios() }), false)
  assert.match(container.innerHTML, /data-weather-compare/)
})

test('mode policy: live after the theoretical departure drops the comparison — never a retroactive proposal (section 29)', () => {
  const container = fakeElement()
  renderGenericStageWeatherPanel(container, baseModel({ mode: 'live', departureAlreadyPassed: true, departureScenarios: fiveScenarios() }), false)
  assert.doesNotMatch(container.innerHTML, /data-weather-compare/)
})

test('mode policy: live before the theoretical departure still shows the comparison', () => {
  const container = fakeElement()
  renderGenericStageWeatherPanel(container, baseModel({ mode: 'live', departureAlreadyPassed: false, departureScenarios: fiveScenarios() }), false)
  assert.match(container.innerHTML, /data-weather-compare/)
})

test('an OFF day (no scenarios) never renders a decision card at all', () => {
  const container = fakeElement()
  renderGenericStageWeatherPanel(container, baseModel({ dayType: 'off', mode: 'operational', departureScenarios: [], recommendation: null }), false)
  assert.doesNotMatch(container.innerHTML, /weather-decision/)
})
