import assert from 'node:assert/strict'
import test from 'node:test'

import { GenericWeatherCoordinator } from '../../../src/weather/generic/coordinator.ts'
import { WeatherCache } from '../../../src/weather/cache.ts'
import { createGenericTripBundle } from '../../trip-core/support/generic-trip-fixture.mjs'

class MemoryStorage {
  constructor() {
    this.values = new Map()
  }

  getItem(key) {
    return this.values.get(key) ?? null
  }

  setItem(key, value) {
    this.values.set(key, value)
  }

  removeItem(key) {
    this.values.delete(key)
  }
}

/**
 * Sections 18-27/29 closeout: the generic weather engine already shared the
 * scenario/recommendation logic layer with the historical RGA runtime
 * (`weather/alerts/*.ts`) — this file locks in the missing part: that
 * `buildGenericDayWeatherViewModel` (exercised end to end here through the
 * real, unmodified `GenericWeatherCoordinator`) actually surfaces it, with a
 * real `mode` (the `coverage: null` bug used to force every future day to
 * `'today-reference'`, making `operational`/`planning`/`trend` unreachable).
 */

function fakeForecastFor(request, fetchedAt = '2027-06-01T06:00:00.000Z') {
  const hours = ['08:00', '10:00', '12:00', '14:00', '16:00']
  return {
    provider: 'open-meteo',
    requestKey: request.key,
    fetchedAt,
    status: 'success',
    locations: request.locations.map((location) => ({
      status: 'success',
      requestLocationId: location.id,
      requestedLatitude: location.latitude,
      requestedLongitude: location.longitude,
      requestedElevationM: location.elevationM,
      providerLatitude: location.latitude,
      providerLongitude: location.longitude,
      providerElevationM: location.elevationM,
      timezone: request.timezone,
      utcOffsetSeconds: 3_600,
      hourly: request.requiredDates.flatMap((date) => hours.map((hour) => ({
        time: `${date}T${hour}`,
        temperatureC: 15, apparentTemperatureC: 14, relativeHumidityPct: 60,
        precipitationProbabilityPct: 10, precipitationMm: 0, rainMm: 0, showersMm: 0, snowfallCm: 0,
        weatherCode: 1, cloudCoverPct: 20, visibilityM: 20_000, windSpeedKph: 10, windDirectionDeg: 180,
        windGustsKph: 15, freezingLevelM: 3_000,
      }))),
      daily: request.requiredDates.map((date) => ({
        date, temperatureMinC: 10, temperatureMaxC: 20, apparentTemperatureMinC: 9, apparentTemperatureMaxC: 19,
        precipitationSumMm: 0, precipitationProbabilityMaxPct: 10, weatherCode: 1, windSpeedMaxKph: 15,
        windGustsMaxKph: 20, windDirectionDominantDeg: 180, sunrise: `${date}T06:30`, sunset: `${date}T20:30`,
      })),
      missingVariables: [],
      issues: [],
    })),
    datesCovered: request.requiredDates,
    issues: [],
  }
}

function countingProvider(now = new Date()) {
  const calls = []
  return {
    calls,
    provider: {
      id: 'open-meteo',
      async fetchForecast(request) {
        calls.push(request.key)
        return fakeForecastFor(request, now.toISOString())
      },
    },
  }
}

test('a day 1 day out with real fetched coverage resolves "operational", not "today-reference" — the coverage:null bug fixed', async () => {
  const bundle = createGenericTripBundle()
  const now = new Date('2027-05-09T06:00:00.000Z') // day-alpha is 2027-05-10 — 1 day out, inside WEATHER_DISPLAY_THRESHOLDS.operationalStartDaysBefore (2)
  const { provider } = countingProvider(now)
  const coordinator = new GenericWeatherCoordinator({ provider, cache: new WeatherCache(new MemoryStorage()), now: () => now })
  coordinator.setTripBundle(bundle, bundle.days[0].id)
  await coordinator.waitForIdle()
  const viewModel = coordinator.getDayWeatherViewModel(bundle.days[0])
  assert.equal(viewModel.mode, 'operational')
  coordinator.dispose()
})

test('the 5 departure scenarios are exposed, ranked, and include the exact historical offsets', async () => {
  const bundle = createGenericTripBundle()
  const now = new Date('2027-05-09T06:00:00.000Z')
  const { provider } = countingProvider(now)
  const coordinator = new GenericWeatherCoordinator({ provider, cache: new WeatherCache(new MemoryStorage()), now: () => now })
  coordinator.setTripBundle(bundle, bundle.days[0].id)
  await coordinator.waitForIdle()
  const viewModel = coordinator.getDayWeatherViewModel(bundle.days[0])
  assert.equal(viewModel.departureScenarios.length, 5)
  assert.deepEqual(new Set(viewModel.departureScenarios.map((s) => s.offsetMinutes)), new Set([-120, -60, 0, 60, 120]))
  assert.ok(viewModel.departureScenarios.some((s) => s.isCurrent))
  coordinator.dispose()
})

test('a recommendation is built in operational mode — reusing buildDepartureRecommendation, never a second scoring', async () => {
  const bundle = createGenericTripBundle()
  const now = new Date('2027-05-09T06:00:00.000Z')
  const { provider } = countingProvider(now)
  const coordinator = new GenericWeatherCoordinator({ provider, cache: new WeatherCache(new MemoryStorage()), now: () => now })
  coordinator.setTripBundle(bundle, bundle.days[0].id)
  await coordinator.waitForIdle()
  const viewModel = coordinator.getDayWeatherViewModel(bundle.days[0])
  assert.ok(viewModel.recommendation !== null)
  // All fake hours are identical/benign, so no scenario is significantly
  // better than another — "keep-current" is the correct, honest outcome.
  assert.equal(viewModel.recommendation.status, 'keep-current')
  coordinator.dispose()
})

test('an OFF day never gets a scenario comparison or a recommendation (section 19)', async () => {
  const bundle = createGenericTripBundle()
  const now = new Date('2027-05-09T06:00:00.000Z')
  const { provider } = countingProvider(now)
  const coordinator = new GenericWeatherCoordinator({ provider, cache: new WeatherCache(new MemoryStorage()), now: () => now })
  coordinator.setTripBundle(bundle, bundle.days[1].id) // day-bravo, OFF
  await coordinator.waitForIdle()
  const viewModel = coordinator.getDayWeatherViewModel(bundle.days[1])
  assert.equal(viewModel.dayType, 'off')
  assert.deepEqual(viewModel.departureScenarios, [])
  assert.equal(viewModel.recommendation, null)
  coordinator.dispose()
})

test('computing scenarios/recommendation triggers no new network call — reassociates against the forecast already fetched', async () => {
  const bundle = createGenericTripBundle()
  const now = new Date('2027-05-09T06:00:00.000Z')
  const { provider, calls } = countingProvider(now)
  const coordinator = new GenericWeatherCoordinator({ provider, cache: new WeatherCache(new MemoryStorage()), now: () => now })
  coordinator.setTripBundle(bundle, bundle.days[0].id)
  await coordinator.waitForIdle()
  const callsAfterFetch = calls.length
  assert.ok(callsAfterFetch > 0, 'sanity check: the real fetch did happen once')
  // Reading the view-model (which computes 5 scenarios + a recommendation)
  // several more times must never trigger a 6th network call.
  coordinator.getDayWeatherViewModel(bundle.days[0])
  coordinator.getDayWeatherViewModel(bundle.days[0])
  coordinator.getDayWeatherViewModel(bundle.days[0])
  assert.equal(calls.length, callsAfterFetch)
  coordinator.dispose()
})

test('mode integration: trend (far out) never proposes a recommendation, but still resolves a real mode via real coverage', async () => {
  const bundle = createGenericTripBundle()
  // day-alpha is 2027-05-10 — push "now" far enough back that it's >7 days
  // out (trend), while staying within the fake provider's returned horizon
  // so `receivedDates` still covers it.
  const now = new Date('2027-05-01T06:00:00.000Z')
  const { provider } = countingProvider(now)
  const coordinator = new GenericWeatherCoordinator({ provider, cache: new WeatherCache(new MemoryStorage()), now: () => now })
  coordinator.setTripBundle(bundle, bundle.days[0].id)
  await coordinator.waitForIdle()
  const viewModel = coordinator.getDayWeatherViewModel(bundle.days[0])
  assert.equal(viewModel.mode, 'trend')
  assert.equal(viewModel.recommendation?.status ?? 'not-applicable', 'not-applicable', 'trend never proposes a firm recommendation (section 29)')
  coordinator.dispose()
})
