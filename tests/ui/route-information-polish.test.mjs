import './support/dom-shim.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { installProfileWindControls } from '../../src/ui/relative-wind-view.ts'
import { renderClimbProfileBar } from '../../src/ui/trips/mini-profile-view.ts'
import { buildGenericDayWeatherViewModel } from '../../src/weather/generic/view-model.ts'
import { renderWeatherFreshness } from '../../src/ui/weather-view.ts'
import { buildDayDetail } from '../../src/ui/trips/day-detail-view.ts'
import { createGenericTripBundle } from '../trip-core/support/generic-trip-fixture.mjs'

test('a 5.5% slope has the same colour in the large profile and climb mini-profile', () => {
  const bands = { innerHTML: '' }, listeners = new Map()
  const nodes = { '[data-profile-interactive]': {}, '[data-profile-color-bands]': bands, '.profile-area': { style: {} }, '[data-profile-color-legend]': {} }
  const host = { querySelector: key => nodes[key] ?? null, querySelectorAll: () => [], addEventListener: (name, listener) => listeners.set(name, listener) }
  installProfileWindControls(host, [{ distanceKm: 0, smoothedGradePercent: 5.5 }, { distanceKm: 5, smoothedGradePercent: 5.5 }], { total: 5, x: km => km, y: a => a })
  const button = Object.assign(new globalThis.Element(), { dataset: { profileMode: 'grade' } })
  button.closest = () => button
  listeners.get('click')({ target: button })
  const colour = /fill="([^"]+)"/.exec(bands.innerHTML)[1]
  const mini = renderClimbProfileBar([{ startDistanceKm: 0, endDistanceKm: 5, startAltitudeM: 100, endAltitudeM: 375, averageGradientPercent: 5.5 }])
  assert.match(mini, new RegExp(`fill="${colour}"`))
})

test('forecast age follows the supplied clock and only becomes visible after the existing six-hour threshold', () => {
  const state = { dayType: 'ride', tripDate: '2026-10-27', availability: 'available', receivedDates: ['2026-10-27'], data: null, fetchedAt: '2026-10-26T05:00:00Z', departureScenarios: null }
  const model = buildGenericDayWeatherViewModel('day', state, new Date('2026-10-26T12:00:00Z'))
  assert.equal(model.forecastAgeMs, 7 * 3600000)
  assert.match(renderWeatherFreshness({ ...model, summary: {} }), /reçue il y a 7 h/)
  assert.equal(renderWeatherFreshness({ ...model, summary: {}, forecastAgeMs: 6 * 3600000 }), '')
  assert.equal(renderWeatherFreshness({ ...model, summary: {}, mode: 'past' }), '')
  assert.equal(renderWeatherFreshness(model), '', 'no age label accompanies absent data')
  const future = buildGenericDayWeatherViewModel('day', { ...state, fetchedAt: '2026-10-27T05:00:00Z' }, new Date('2026-10-26T12:00:00Z'))
  assert.equal(future.forecastAgeMs, null)
})

test('League and Tour omit the layer control and drawer; Voyage retains them', () => {
  const base = createGenericTripBundle()
  for (const mode of ['league', 'tour', 'voyage']) {
    const b = { ...base, settings: { ...base.settings, global: { ...base.settings.global, organizationMode: mode, raceMode: mode !== 'voyage' } } }
    const html = buildDayDetail(b, b.days[0].id).html
    if (mode === 'voyage') assert.match(html, /data-map-layers-toggle/)
    else assert.doesNotMatch(html, /data-map-layers-toggle|data-map-layers-panel|>Calques</)
  }
})
