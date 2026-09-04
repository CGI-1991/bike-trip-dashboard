import assert from 'node:assert/strict'
import test from 'node:test'

import { renderGenericStageWeatherPanel, renderWeatherAlertsSummary } from '../../src/ui/weather-view.ts'

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

// Integrity-hardening sections 47-51/80-81: an actionable global alert must
// stay traceable to a concrete point/secteur — never a bare risk sentence
// with no way to tell where/when it applies.
test('a single-point alert shows its own point name and ETA — traceable to exactly where/when it applies', () => {
  const container = fakeElement()
  renderGenericStageWeatherPanel(container, baseModel({
    riskLevel: 'red',
    alerts: [{ id: 'a1', dayId: 'day-alpha', pointId: 'p1', pointName: 'Montaigu', etaLocal: '2027-05-09T13:18', riskType: 'rain', level: 'red', title: 'Pluie probable', summary: '1,5 mm/h attendus.' }],
  }), false)
  assert.match(container.innerHTML, /weather-decision__banner-location">Montaigu · 13:18</)
})

test('a grouped, multi-point alert shows its time span — the point names already sit in its own title ("entre X et Y"), never repeated', () => {
  const container = fakeElement()
  renderGenericStageWeatherPanel(container, baseModel({
    riskLevel: 'orange',
    alerts: [{
      id: 'a1', dayId: 'day-alpha', riskType: 'rain', level: 'orange',
      title: 'Pluie probable entre Montaigu et Bouin', summary: '',
      etaLocal: '2027-05-09T13:18', etaLocalEnd: '2027-05-09T14:23',
      firstPointName: 'Montaigu', lastPointName: 'Bouin',
    }],
  }), false)
  assert.match(container.innerHTML, /Pluie probable entre Montaigu et Bouin/)
  assert.match(container.innerHTML, /weather-decision__banner-location">13:18–14:23</)
  // Never a second "Montaigu"/"Bouin" repeated outside the title itself.
  assert.equal((container.innerHTML.match(/Montaigu/g) ?? []).length, 1)
})

test('an alert with genuinely no point/eta at all shows no location line — never a fabricated one', () => {
  const container = fakeElement()
  renderGenericStageWeatherPanel(container, baseModel({
    riskLevel: 'red',
    alerts: [{ id: 'a1', dayId: 'day-alpha', riskType: 'stale-data', level: 'red', title: 'Données météo trop anciennes', summary: '' }],
  }), false)
  assert.doesNotMatch(container.innerHTML, /weather-decision__banner-location/)
})

test('a green risk shows no banner at all — sober treatment (section 23)', () => {
  const container = fakeElement()
  renderGenericStageWeatherPanel(container, baseModel({ riskLevel: 'green' }), false)
  assert.doesNotMatch(container.innerHTML, /weather-decision__banner/)
})

// Polish-final section 34/71: once the -2h/-1h/Actuel/+1h/+2h scenarios (or
// a banner/recommendation) are showing, the old aggregate bottom summary
// ("11,5–18,8 °C · Pluie 2 % · Rafales 34 km/h…") never repeats alongside
// them — ambiguous, redundant, and no help deciding a departure time.
test('the aggregate bottom synthesis never shows once the scenarios are visible — the detailed scenarios suffice', () => {
  const container = fakeElement()
  renderGenericStageWeatherPanel(container, baseModel({ departureScenarios: fiveScenarios() }), false)
  assert.match(container.innerHTML, /data-weather-compare/, 'the scenarios themselves are indeed showing')
  assert.doesNotMatch(container.innerHTML, /data-weather-synthesis/)
  assert.doesNotMatch(container.innerHTML, /weather-synthesis/)
})

test('a red risk banner alone (no scenarios yet, e.g. before the reference speed resolves) is also enough to drop the aggregate synthesis', () => {
  const container = fakeElement()
  renderGenericStageWeatherPanel(container, baseModel({ riskLevel: 'red', alerts: [{ id: 'a1', dayId: 'day-alpha', riskType: 'gust', level: 'red', title: 'Rafales fortes en altitude', summary: '' }], departureScenarios: [] }), false)
  assert.match(container.innerHTML, /weather-decision__banner/)
  assert.doesNotMatch(container.innerHTML, /data-weather-synthesis/)
})

// Integrity-hardening section 53-56: the aggregate synthesis fallback is
// gone outright — with nothing decision-worthy to say, the panel now shows
// nothing at all beyond its own eyebrow label ("healthy silence"), never a
// filler line reinstated just to avoid an empty block.
test('with no banner, no recommendation and no scenario at all, the panel shows nothing at all — never the aggregate synthesis reinstated as a filler', () => {
  const container = fakeElement()
  renderGenericStageWeatherPanel(container, baseModel(), false)
  assert.doesNotMatch(container.innerHTML, /weather-decision/)
  assert.doesNotMatch(container.innerHTML, /data-weather-synthesis/)
  assert.doesNotMatch(container.innerHTML, /weather-synthesis/)
})

test('R2.1 section 7: a recommended change shows the conclusion sentence, an "Appliquer HH:MM" that applies directly, and "Modifier manuellement"', () => {
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
  assert.match(container.innerHTML, /data-action="apply-weather-departure-time" data-departure-time="07:00">Appliquer 07:00</)
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

// Opening Météo shows the five scenarios immediately. They used to sit
// behind a collapsed "Comparer les horaires" accordion, so reaching them
// took a second tap — hiding the very thing the panel exists for.
test('the 5 scenarios are visible as soon as the panel renders, offsets labelled −2 h/−1 h/Actuel/+1 h/+2 h', () => {
  const container = fakeElement()
  renderGenericStageWeatherPanel(container, baseModel({ departureScenarios: fiveScenarios() }), false)
  assert.match(container.innerHTML, /<section class="weather-decision__compare" data-weather-compare>/)
  for (const label of ['−2 h', '−1 h', 'Actuel', '+1 h', '+2 h']) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    assert.match(container.innerHTML, new RegExp(`<strong>${escaped}</strong>`), `missing offset label ${label}`)
  }
  assert.match(container.innerHTML, /Départ 06:00 · Arrivée 10:00/)
  assert.match(container.innerHTML, /Départ 08:00 · Arrivée 12:00/)
})

test('there is no intermediate accordion left at all — no <details>, no "Comparer les horaires"', () => {
  const container = fakeElement()
  renderGenericStageWeatherPanel(container, baseModel({ departureScenarios: fiveScenarios() }), false)
  assert.doesNotMatch(container.innerHTML, /Comparer les horaires/)
  assert.doesNotMatch(container.innerHTML, /<details[^>]*data-weather-compare/)
  assert.doesNotMatch(container.innerHTML, /<summary>/)
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

test('R2.1 section 7: no confirmation panel/modal at all any more — "Choisir"/"Appliquer" apply directly, nothing left to confirm or cancel', () => {
  const container = fakeElement()
  renderGenericStageWeatherPanel(container, baseModel({ departureScenarios: fiveScenarios() }), false)
  assert.doesNotMatch(container.innerHTML, /data-weather-apply-confirm/)
  assert.doesNotMatch(container.innerHTML, /confirm-apply-weather-departure-time/)
  assert.doesNotMatch(container.innerHTML, /cancel-apply-weather-departure-time/)
  assert.doesNotMatch(container.innerHTML, /Modifier l.heure de départ ?/)
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

// --- CDC D1.1 section 15 — tests S/T: the scenario list is always presented
// chronologically, whichever one the ranking recommends -------------------

test('S: the 5 scenarios render −2h/−1h/Actuel/+1h/+2h in that exact chronological order — even when +1h is the recommended one', () => {
  const container = fakeElement()
  const scenarios = fiveScenarios()
  const recommendation = {
    status: 'recommended-change',
    currentScenario: scenarios[2],
    recommendedScenario: scenarios[3], // +60
    title: 'Un départ vers 09:00 semble plus favorable que 08:00.',
    explanation: [],
  }
  renderGenericStageWeatherPanel(container, baseModel({ recommendation, departureScenarios: scenarios }), false)
  const offsetOrder = [...container.innerHTML.matchAll(/<strong>(−2 h|−1 h|Actuel|\+1 h|\+2 h)<\/strong>/g)].map((match) => match[1])
  assert.deepEqual(offsetOrder, ['−2 h', '−1 h', 'Actuel', '+1 h', '+2 h'], 'chronological order — never re-sorted best-first')
})

test('T: the "Suggéré" badge lands on the recommended scenario\'s own row, independent of position — "Actuel" keeps its own badge on a different row', () => {
  const container = fakeElement()
  const scenarios = fiveScenarios()
  const recommendation = {
    status: 'recommended-change',
    currentScenario: scenarios[2],
    recommendedScenario: scenarios[3], // +60 — not the first, not the current
    title: 'Un départ vers 09:00 semble plus favorable que 08:00.',
    explanation: [],
  }
  renderGenericStageWeatherPanel(container, baseModel({ recommendation, departureScenarios: scenarios }), false)
  const rows = container.innerHTML.split('<li class="weather-decision__scenario')
  const plus1hRow = rows.find((row) => row.includes('<strong>+1 h</strong>'))
  const currentRow = rows.find((row) => row.includes('<strong>Actuel</strong>'))
  const minus2hRow = rows.find((row) => row.includes('<strong>−2 h</strong>'))
  assert.match(plus1hRow, /tag--suggested">Suggéré</)
  assert.doesNotMatch(plus1hRow, /tag--data">Actuel/, 'the +1h row is not itself the current scenario')
  assert.match(currentRow, /tag--data">Actuel/)
  assert.doesNotMatch(currentRow, /tag--suggested/, 'the current scenario never also claims the Suggéré badge here')
  assert.doesNotMatch(minus2hRow, /tag--suggested/)
})

test('no "Suggéré" badge at all when the recommendation keeps the current departure time', () => {
  const container = fakeElement()
  const scenarios = fiveScenarios()
  const recommendation = { status: 'keep-current', currentScenario: scenarios[2], recommendedScenario: null, title: 'Le départ actuel reste le meilleur compromis.', explanation: [] }
  renderGenericStageWeatherPanel(container, baseModel({ recommendation, departureScenarios: scenarios }), false)
  assert.doesNotMatch(container.innerHTML, /tag--suggested/)
})

// --- R3 sections 24-28 (tests M-Q): the always-visible "Alertes météo"
// summary — a lighter, compact counterpart to the full weather-decision
// card above, reusing the exact same model. ---------------------------

test('M: a red/orange risk shows a compact risk line — never the full uppercase banner treatment', () => {
  const html = renderWeatherAlertsSummary(baseModel({
    riskLevel: 'red',
    alerts: [{ id: 'a1', dayId: 'day-alpha', riskType: 'gust', level: 'red', title: 'Risque notable au Col X', summary: 'Rafales 65 km/h' }],
  }))
  assert.match(html, /data-weather-alerts-summary/)
  assert.match(html, /Alertes météo/)
  assert.match(html, /Risque notable au Col X · Rafales 65 km\/h/)
  assert.doesNotMatch(html, /ALERTE MÉTÉO · RISQUE/, 'lighter than the full banner\'s own uppercase treatment')
})

// Integrity-hardening section 50: both alert surfaces (the full Météo
// panel's banner AND this always-visible summary card) must stay
// traceable to a concrete point/secteur — never just the compact one.
test('the always-visible "Alertes météo" summary also carries its own point/eta context, not just the full banner', () => {
  const html = renderWeatherAlertsSummary(baseModel({
    riskLevel: 'red',
    alerts: [{ id: 'a1', dayId: 'day-alpha', pointId: 'p1', pointName: 'Montaigu', etaLocal: '2027-05-09T13:18', riskType: 'rain', level: 'red', title: 'Pluie probable', summary: '1,5 mm/h attendus.' }],
  }))
  assert.match(html, /weather-alerts-summary__location">Montaigu · 13:18</)
})

test('N: a recommended-change suggestion shows a compact "Départ suggéré" reminder', () => {
  const recommendation = {
    status: 'recommended-change',
    currentScenario: scenario({ departureTimeLocal: '2027-05-10T08:00' }),
    recommendedScenario: scenario({ offsetMinutes: 120, isCurrent: false, departureTimeLocal: '2027-05-10T10:00' }),
    title: 'Un départ vers 10:00 semble plus favorable.',
    explanation: [],
  }
  const html = renderWeatherAlertsSummary(baseModel({ recommendation }))
  assert.match(html, /Départ suggéré · \+2 h/)
})

test('O: no recommendation beyond the current time never shows an empty "Départ suggéré" line', () => {
  const recommendation = { status: 'keep-current', currentScenario: scenario(), recommendedScenario: null, title: 'Le départ actuel reste le meilleur compromis.', explanation: [] }
  const html = renderWeatherAlertsSummary(baseModel({ recommendation }))
  assert.doesNotMatch(html, /Départ suggéré/)
  assert.equal(html, '', 'nothing at all — green risk and no real suggestion means genuinely nothing to say')
})

test('P: healthy (green, no recommendation) renders nothing at all — silence when healthy', () => {
  assert.equal(renderWeatherAlertsSummary(baseModel()), '')
})

test('Q: a transfer\'s own composite view-model (origin/destination) never renders this summary — no single "suggested departure" concept for it', () => {
  assert.equal(renderWeatherAlertsSummary({ origin: baseModel({ riskLevel: 'red', alerts: [{ id: 'a1', dayId: 'x', riskType: 'gust', level: 'red', title: 't', summary: 's' }] }), destination: null }), '')
})

test('null model renders nothing (still loading)', () => {
  assert.equal(renderWeatherAlertsSummary(null), '')
})
