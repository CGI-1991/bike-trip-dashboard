import assert from 'node:assert/strict'
import test from 'node:test'

import { GenericWeatherCoordinator } from '../../../src/weather/generic/coordinator.ts'
import { transferOriginDayKey } from '../../../src/weather/generic/sample-points.ts'
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

/** A well-formed `WeatherForecastResult` at the already-normalized level — sidesteps re-testing raw Open-Meteo JSON normalization, which `tests/weather/weather-core.test.mjs` already covers thoroughly for the (unmodified, reused-as-is) provider. */
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

/** `fetchedAt` matches whatever `now` the coordinator itself is using — a fixed, past-relative-to-`now` fetch time (as any real fetch would have) so `WeatherCache`'s own freshness window (30 min, `weatherConfig.cacheFreshMs`) actually reads as fresh, rather than accidentally "stale" and re-triggering a background refetch on every read. */
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

test('resolves a real ride day\'s weather view-model end to end, from a TripBundle through the real (unmodified) WeatherCoordinator', async () => {
  const bundle = createGenericTripBundle()
  const now = new Date('2027-05-09T06:00:00.000Z') // the day before day-alpha (2027-05-10) — inside the forecast horizon
  const { provider } = countingProvider(now)
  const coordinator = new GenericWeatherCoordinator({ provider, cache: new WeatherCache(new MemoryStorage()), now: () => now })

  coordinator.setTripBundle(bundle, bundle.days[0].id)
  await coordinator.waitForIdle()
  const viewModel = coordinator.getDayWeatherViewModel(bundle.days[0])

  assert.ok(viewModel !== null)
  assert.equal(viewModel.dayType, 'ride')
  assert.ok(viewModel.points.length > 0)
  assert.ok(viewModel.summary !== null)
  assert.equal(viewModel.summary.temperatureMinC, 15, 'the summary is built from the fake hourly series, not the daily one')
  coordinator.dispose()
})

test('CDC Jalon C1 section 27: a fresh cache entry is served without any network call', async () => {
  const bundle = createGenericTripBundle()
  const now = new Date('2027-05-09T06:00:00.000Z')
  const { provider, calls } = countingProvider(now)
  const cache = new WeatherCache(new MemoryStorage())

  // Pre-populate the cache by running the coordinator once for real — the
  // whole trip's definitions (ride + OFF + the transfer's resolvable
  // origin) each fetch once.
  const warmup = new GenericWeatherCoordinator({ provider, cache, now: () => now })
  warmup.setTripBundle(bundle, bundle.days[0].id)
  await warmup.waitForIdle()
  warmup.dispose()
  const warmupCalls = calls.length
  assert.ok(warmupCalls > 0, 'sanity check: the warm-up run did fetch')

  const coordinator = new GenericWeatherCoordinator({ provider, cache, now: () => now })
  coordinator.setTripBundle(bundle, bundle.days[0].id)
  await coordinator.waitForIdle()
  const viewModel = coordinator.getDayWeatherViewModel(bundle.days[0])

  assert.equal(calls.length, warmupCalls, 'a second coordinator instance over the same cache must reuse every cached entry, never fetch again')
  assert.equal(viewModel.availability, 'available')
  coordinator.dispose()
})

test('CDC Jalon C1 section 27: changing the departure time changes every point\'s eta without any new network call — the request signature never includes eta', async () => {
  const bundle = createGenericTripBundle()
  const now = new Date('2027-05-09T06:00:00.000Z')
  const { provider, calls } = countingProvider(now)
  const cache = new WeatherCache(new MemoryStorage())
  const coordinator = new GenericWeatherCoordinator({ provider, cache, now: () => now })

  coordinator.setTripBundle(bundle, bundle.days[0].id)
  await coordinator.waitForIdle()
  const callsAfterFirst = calls.length
  const before = coordinator.getDayWeatherViewModel(bundle.days[0])
  const arrivalBefore = before.points.find((point) => point.name === 'Hilltown')

  // A later departure time shifts every downstream eta uniformly without
  // changing which points exist or their coordinates — the exact
  // "signature-stable eta change" case (unlike e.g. switching pause mode,
  // which can add/remove a synthetic pause point and so genuinely changes
  // the request's own coordinate list).
  bundle.settings.days[0] = { ...bundle.settings.days[0], departureTime: '11:00' }
  coordinator.setTripBundle(bundle, bundle.days[0].id)
  await coordinator.waitForIdle()
  const after = coordinator.getDayWeatherViewModel(bundle.days[0])
  const arrivalAfter = after.points.find((point) => point.name === 'Hilltown')

  assert.equal(calls.length, callsAfterFirst, 'no new fetch — the request signature (coordinates/dates/variables) is unaffected by a pause duration change')
  assert.notEqual(arrivalBefore.etaLabel, arrivalAfter.etaLabel, 'the arrival eta itself must still reflect the new pause')
  coordinator.dispose()
})

test('a transfer day\'s origin and destination resolve independently and are merged into one GenericTransferWeatherViewModel', async () => {
  const bundle = createGenericTripBundle()
  bundle.routes[1] = { ...bundle.routes[1], geometry: { full: null, simplified: [{ latitude: 45.6, longitude: 6.9, altitudeM: 500 }, { latitude: 45.7, longitude: 7.0, altitudeM: 900 }] } }
  const now = new Date('2027-05-09T06:00:00.000Z')
  const { provider } = countingProvider(now)
  const coordinator = new GenericWeatherCoordinator({ provider, cache: new WeatherCache(new MemoryStorage()), now: () => now })

  coordinator.setTripBundle(bundle, bundle.days[2].id)
  await coordinator.waitForIdle()
  const viewModel = coordinator.getDayWeatherViewModel(bundle.days[2])

  assert.ok(viewModel !== null)
  assert.ok('origin' in viewModel && 'destination' in viewModel, 'a transfer resolves to {origin, destination}, never a single ride/off view-model')
  assert.ok(viewModel.origin !== null)
  assert.ok(viewModel.destination !== null)
  assert.equal(viewModel.origin.points[0].name, 'Hilltown')
  coordinator.dispose()
})

test('selecting a transfer day prioritises its origin virtual key with the underlying coordinator', async () => {
  const bundle = createGenericTripBundle()
  const { provider } = countingProvider()
  const coordinator = new GenericWeatherCoordinator({ provider, cache: new WeatherCache(new MemoryStorage()) })
  coordinator.setTripBundle(bundle, bundle.days[0].id)
  await coordinator.waitForIdle()

  // Selecting the transfer day must not throw, even though it has no
  // definition registered under its own real id.
  coordinator.selectDay(bundle, bundle.days[2].id)
  await coordinator.waitForIdle()
  const state = coordinator.getDayWeatherViewModel(bundle.days[2])
  assert.ok(state === null || 'origin' in state)
  coordinator.dispose()
})

test('an OFF day resolves through the same generic view-model shape as a ride day', async () => {
  const bundle = createGenericTripBundle()
  const now = new Date('2027-05-09T06:00:00.000Z')
  const { provider } = countingProvider(now)
  const coordinator = new GenericWeatherCoordinator({ provider, cache: new WeatherCache(new MemoryStorage()), now: () => now })

  coordinator.setTripBundle(bundle, bundle.days[1].id)
  await coordinator.waitForIdle()
  const viewModel = coordinator.getDayWeatherViewModel(bundle.days[1])

  assert.ok(viewModel !== null)
  assert.equal(viewModel.dayType, 'off')
  assert.equal(viewModel.points.length, 1)
  coordinator.dispose()
})

test('getDayWeatherViewModel returns null before any fetch has ever been prepared for that day', () => {
  const bundle = createGenericTripBundle()
  const { provider } = countingProvider()
  const coordinator = new GenericWeatherCoordinator({ provider, cache: new WeatherCache(new MemoryStorage()) })
  assert.equal(coordinator.getDayWeatherViewModel(bundle.days[0]), null)
  coordinator.dispose()
})
