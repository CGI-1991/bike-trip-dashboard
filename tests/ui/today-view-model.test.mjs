import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { rga2026TripPlan } from '../../src/trip/plan.ts'
import { buildTodayViewModel } from '../../src/ui/today-view-model.ts'
import { renderTodayView } from '../../src/ui/today-view.ts'

const accommodations = JSON.parse(readFileSync(new URL('../../public/data/trip/accommodations.json', import.meta.url), 'utf8')).accommodations

function routeTimeline(dayId = 'J1') {
  const day = rga2026TripPlan.days.find(({ id }) => id === dayId)
  if (day.type === 'off') return { tripId: 'rga-2026', days: [{ type: 'off', day }], summary: {} }
  return {
    tripId: 'rga-2026',
    days: [{
      type: 'ride', status: 'ready', day, startTime: '08:00',
      arrivalTime: { totalMinutesFromDeparture: 215.5, clockMinutes: 695, dayOffset: 0 },
      route: {
        settings: { referenceSpeedKph: 18, departureTime: '08:00', totalBreakMinutes: 50 },
        pauses: [], waypoints: [], segments: [],
        summary: { distanceKm: 49.6, elevationGainM: 1_557, movingDurationMinutes: 165.5, estimatedAverageSpeedKph: 17.98, pauseDurationMinutes: 50, totalDurationMinutes: 215.5, departureTimeMinutes: 480, arrivalTimeMinutes: 695.5 },
      },
    }],
    summary: {},
  }
}

const gpx = {
  status: 'success',
  source: { fileName: rga2026TripPlan.days[0].gpxFile },
  segments: [{ points: [
    { latitude: 46.3, longitude: 6.4, elevationM: 400 },
    { latitude: 46.2, longitude: 6.5, elevationM: 1_100 },
    { latitude: 46.1, longitude: 6.6, elevationM: 900 },
  ] }],
}

function hourly(time, overrides = {}) {
  return { time, temperatureC: 12, apparentTemperatureC: 11, relativeHumidityPct: 70, precipitationProbabilityPct: 30, precipitationMm: 0.2, rainMm: 0.2, showersMm: 0, snowfallCm: 0, weatherCode: 3, cloudCoverPct: 50, visibilityM: 20_000, windSpeedKph: 20, windDirectionDeg: 180, windGustsKph: 30, freezingLevelM: 3_000, ...overrides }
}

function samplePoint(id, type, name, elevationM, etaMinutes) {
  return { id, dayId: 'J1', dayType: 'ride', tripDate: '2026-08-12', name, type, latitude: 46, longitude: 6, elevationM, trackDistanceKm: etaMinutes / 5, eta: { totalMinutesFromDeparture: etaMinutes, clockMinutes: 480 + etaMinutes, dayOffset: 0 }, sourcePointIds: [id], references: [], source: 'roadbook-matched', role: 'route-point', contributesToDayRisk: true }
}

function waypoint(sample, weather) {
  return { samplePoint: sample, etaLocal: `2026-08-12T${String(Math.floor(sample.eta.clockMinutes / 60)).padStart(2, '0')}:${String(sample.eta.clockMinutes % 60).padStart(2, '0')}`, forecastTimeLocal: weather.time, forecastOffsetMinutes: 0, weather, state: 'available' }
}

function rideWeatherState() {
  const start = waypoint(samplePoint('start', 'start', 'Gare de Thonon-les-Bains', 400, 0), hourly('2026-08-12T08:00'))
  const col = waypoint(samplePoint('col', 'col', 'Col du Feu', 1_120, 90), hourly('2026-08-12T09:30', { windGustsKph: 75 }))
  const end = waypoint(samplePoint('end', 'end', 'Morzine', 900, 215), hourly('2026-08-12T11:35'))
  return {
    dayId: 'J1', dayType: 'ride', tripDate: '2026-08-12', availability: 'available', cacheState: 'fresh', source: 'cache', fetchedAt: '2026-08-12T07:00:00Z', receivedDates: ['2026-08-12'], isRefreshing: false, departureScenarios: null,
    data: { type: 'ride', dayId: 'J1', tripDate: '2026-08-12', waypoints: [start, col, end], routeSummary: { temperatureMinC: 12, temperatureMaxC: 18, apparentTemperatureMinC: 11, apparentTemperatureMaxC: 17, precipitationProbabilityMaxPct: 30, hourlyPrecipitationMaxMm: 0.2, windSpeedMaxKph: 30, windGustsMaxKph: 75, visibilityMinM: 20_000, freezingLevelMinM: 3_000, worstWeatherCode: 3, coveredPointCount: 3, missingPointCount: 0 }, dailyByLocation: [], todayReference: null },
  }
}

function build(now, options = {}) {
  return buildTodayViewModel({
    now,
    plan: rga2026TripPlan,
    timeline: Object.hasOwn(options, 'timeline') ? options.timeline : routeTimeline('J1'),
    roadbookReport: options.roadbookReport ?? null,
    accommodations: options.accommodations ?? accommodations,
    weatherSnapshot: options.weatherSnapshot ?? { selectedDayId: 'J10', states: new Map() },
    gpx: options.gpx === undefined ? gpx : options.gpx,
    publicBaseUrl: '/',
  })
}

test('Today selection is timezone-driven and never follows the last selected Voyage day', () => {
  assert.deepEqual([
    build(new Date('2026-08-01T12:00:00Z')).dayId,
    build(new Date('2026-08-12T12:00:00Z')).dayId,
    build(new Date('2026-08-16T12:00:00Z'), { timeline: routeTimeline('J5'), gpx: null }).dayId,
    build(new Date('2026-08-17T12:00:00Z'), { timeline: routeTimeline('J6') }).dayId,
    build(new Date('2026-08-24T12:00:00Z'), { timeline: routeTimeline('J12') }).dayId,
  ], ['J1', 'J1', 'J5', 'J6', 'J12'])
  assert.equal(build(new Date('2026-08-01T12:00:00Z')).statusLabel, 'Départ dans 11 jours')
  assert.equal(build(new Date('2026-08-12T12:00:00Z')).statusLabel, 'Départ aujourd’hui')
  assert.equal(build(new Date('2026-08-11T22:30:00Z')).dayId, 'J1', '00:30 in Europe/Paris is already the first trip day')
  assert.equal(build(new Date('2026-08-24T12:00:00Z'), { timeline: routeTimeline('J12') }).statusLabel, 'Voyage terminé')
})

test('the model still computes the full weather/accommodation data even though the Aperçu card only shows a compact summary', () => {
  const model = build(new Date('2026-08-12T08:00:00Z'), { weatherSnapshot: { selectedDayId: 'J10', states: new Map([['J1', rideWeatherState()]]) } })
  assert.equal(model.type, 'ride')
  assert.equal(model.stats.resultingAverageSpeedKph, 17.98)
  assert.equal(model.stats.totalBreakMinutes, 50)
  assert.ok(model.mapModel.coordinates.length >= 2)
  assert.deepEqual(model.weather.points.map(({ role }) => role), ['start', 'main-col', 'end'])
  assert.equal(model.weather.primaryAlert.level, 'red')
  assert.equal(model.accommodation.name, 'Hôtel Le Soly')
  assert.equal(model.accommodation.address, '234 Route de la Manche, 74110 Morzine')
  assert.match(model.gpxHref, /01_route-des-grandes-alpes/)
})

test('the compact Aperçu stage card renders only identity, four stats, the map, one weather line, a short alert and two actions', () => {
  const model = build(new Date('2026-08-12T08:00:00Z'), { weatherSnapshot: { selectedDayId: 'J10', states: new Map([['J1', rideWeatherState()]]) } })
  const container = { innerHTML: '', dataset: {} }
  renderTodayView(container, model)
  assert.match(container.innerHTML, /J1 · Thonon-les-Bains → Morzine/)
  assert.equal((container.innerHTML.match(/<dt>/g) ?? []).length, 4, 'only distance, D+, départ and ETA — no average speed or break time row')
  assert.match(container.innerHTML, /data-today-route-map/)
  assert.match(container.innerHTML, />Voir l’étape<\/a>/)
  assert.match(container.innerHTML, /data-overview-gpx-trigger[^>]*data-gpx-url="[^"]*01_route-des-grandes-alpes[^"]*"[^>]*>GPX</)
  assert.equal((container.innerHTML.match(/class="today-weather-compact"/g) ?? []).length, 1, 'exactly one synthetic weather line')
  assert.equal((container.innerHTML.match(/class="today-alert today-alert--/g) ?? []).length, 1, 'exactly one short alert')
  assert.match(container.innerHTML, /today-alert--red/)

  // The three detailed weather cards, per-point breakdowns, accommodation
  // block/address and its Maps/website buttons are all gone from the Aperçu —
  // they remain available in the day's own detail screen instead.
  assert.doesNotMatch(container.innerHTML, /today-weather-point|today-weather__status|today-weather__summary|today-weather-points/)
  assert.doesNotMatch(container.innerHTML, /Hôtel Le Soly|234 Route de la Manche/)
  assert.doesNotMatch(container.innerHTML, />Ouvrir dans Maps<|>Voir le site<|today-accommodation/)
  assert.doesNotMatch(container.innerHTML, /NaN|undefined/)
})

test('outside-horizon weather is explicitly current and non-forecast, with no fabricated alert', () => {
  const state = rideWeatherState()
  state.availability = 'outside-horizon'
  state.data.todayReference = { date: '2026-08-01', temperatureMinC: 8, temperatureMaxC: 18, precipitationSumMm: null, precipitationProbabilityMaxPct: 20, windSpeedMaxKph: 25, windGustsMaxKph: 40, weatherCode: 2 }
  const model = build(new Date('2026-08-01T12:00:00Z'), { weatherSnapshot: { selectedDayId: 'J10', states: new Map([['J1', state]]) } })
  assert.equal(model.weather.context, 'Aujourd’hui · information actuelle, non prévisionnelle')
  assert.match(model.weather.summary, /8–18 °C/)
  assert.equal(model.weather.primaryAlert, null)
})

test('the Aperçu card never renders accommodation content, whether it is missing or confirmed', () => {
  const withoutAccommodation = build(new Date('2026-08-01T12:00:00Z'), { accommodations: [] })
  assert.equal(withoutAccommodation.accommodation, null)
  const container = { innerHTML: '', dataset: {} }
  renderTodayView(container, withoutAccommodation)
  assert.doesNotMatch(container.innerHTML, /Hébergement/)

  const withAccommodation = build(new Date('2026-08-12T08:00:00Z'))
  assert.equal(withAccommodation.accommodation.name, 'Hôtel Le Soly')
  const container2 = { innerHTML: '', dataset: {} }
  renderTodayView(container2, withAccommodation)
  assert.doesNotMatch(container2.innerHTML, /Hébergement|Hôtel Le Soly/)
})

test('an OFF day has recovery, lodging and one action, but no cycling map, stats or GPX', () => {
  const roadbookReport = { days: [{ dayId: 'J5', type: 'off', roadbook: { type: 'off', ambiance: 'Récupération documentée.', recovery: [{ description: 'Repos.' }], activities: [], logistics: [], notes: [] }, points: [] }] }
  const model = build(new Date('2026-08-16T12:00:00Z'), { timeline: routeTimeline('J5'), roadbookReport, gpx: null })
  assert.equal(model.type, 'off')
  assert.equal(model.locationName, 'Bourg-Saint-Maurice')
  assert.ok(model.recoveryText.includes('Repos.'), 'the model keeps the full recovery text even though the compact card no longer shows it')
  const container = { innerHTML: '', dataset: {} }
  renderTodayView(container, model)
  assert.match(container.innerHTML, />OFF</)
  assert.match(container.innerHTML, /Bourg-Saint-Maurice/)
  assert.doesNotMatch(container.innerHTML, /today-metrics|data-today-route-map|data-overview-gpx-trigger|Moyenne estimée résultante|Repos\./, 'no cycling stats/map/GPX, and the detailed recovery text is left to the day’s own Infos tab')
  assert.equal((container.innerHTML.match(/>Voir l’étape<\/a>/g) ?? []).length, 1)
})

test('local failures (no timeline, no weather, no GPX) preserve title and the day action without false zeros or exceptions, and still never render accommodation', () => {
  const model = build(new Date('2026-08-01T12:00:00Z'), { timeline: null, weatherSnapshot: { selectedDayId: 'J1', states: new Map() }, gpx: null })
  assert.equal(model.type, 'ride')
  assert.equal(model.stats, null)
  assert.equal(model.mapModel, null)
  assert.equal(model.accommodation.name, 'Hôtel Le Soly', 'the model still resolves accommodation even when the timeline/weather/GPX are unavailable')
  const container = { innerHTML: '', dataset: {} }
  assert.doesNotThrow(() => renderTodayView(container, model))
  assert.match(container.innerHTML, /Calcul de l’étape temporairement indisponible/)
  assert.match(container.innerHTML, /Météo temporairement indisponible/)
  assert.match(container.innerHTML, /Carte temporairement indisponible/)
  assert.doesNotMatch(container.innerHTML, /Hôtel Le Soly/, 'accommodation is never rendered in the compact Aperçu card, even when it is the only thing available')
  assert.match(container.innerHTML, />Voir l’étape<\/a>/)
  assert.doesNotMatch(container.innerHTML, /NaN|0 km|0 °C/)
})

test('Aperçu (renderToday) is independent from Voyage and Météo DOM, and still renders the embedded stage card via buildTodayViewModel', () => {
  const source = readFileSync(new URL('../../src/main.ts', import.meta.url), 'utf8')
  const start = source.indexOf('function renderToday(): void')
  const end = source.indexOf('\nfunction refreshRoadbookIntegration', start)
  const renderTodaySource = source.slice(start, end)
  assert.doesNotMatch(renderTodaySource, /tripPlanContainer|weatherPanel|trip-day__weather-line|weather-waypoint--next/)
  assert.match(renderTodaySource, /buildOverviewViewModel/)
  assert.match(renderTodaySource, /renderOverviewView/)
  assert.match(renderTodaySource, /renderTodayView/)
  const modelSource = readFileSync(new URL('../../src/ui/today-view-model.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(modelSource, /fetch\(|OpenMeteo|WeatherCoordinator|querySelector|textContent|innerHTML/)
  const overviewModelSource = readFileSync(new URL('../../src/ui/overview-view-model.ts', import.meta.url), 'utf8')
  assert.match(overviewModelSource, /buildTodayViewModel/)
  assert.doesNotMatch(overviewModelSource, /fetch\(|OpenMeteo|WeatherCoordinator|querySelector|textContent|innerHTML/)
})
