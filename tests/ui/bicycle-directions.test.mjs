import assert from 'node:assert/strict'
import test from 'node:test'

import { buildBicycleDirectionsUrl, buildDirectionsUrl, updatePoiDirectionsOrigin } from '../../src/ui/bicycle-directions.ts'

test('AK: with a known origin, the URL carries origin + destination + bicycling', () => {
  const url = buildBicycleDirectionsUrl({ latitude: 45.123456, longitude: 6.654321 }, { latitude: 45.5, longitude: 6.1 })
  const parsed = new URL(url)
  assert.equal(parsed.origin + parsed.pathname, 'https://www.google.com/maps/dir/')
  assert.equal(parsed.searchParams.get('api'), '1')
  assert.equal(parsed.searchParams.get('travelmode'), 'bicycling')
  assert.equal(parsed.searchParams.get('destination'), '45.123456,6.654321')
  assert.equal(parsed.searchParams.get('origin'), '45.500000,6.100000')
})

test('AL: with no known origin, the URL carries destination + bicycling and no fabricated origin', () => {
  const url = buildBicycleDirectionsUrl({ latitude: 45.1, longitude: 6.2 })
  const parsed = new URL(url)
  assert.equal(parsed.searchParams.get('destination'), '45.100000,6.200000')
  assert.equal(parsed.searchParams.get('travelmode'), 'bicycling')
  assert.equal(parsed.searchParams.has('origin'), false)
})

test('AM: coordinates are correctly encoded (commas within a query value, negative coordinates)', () => {
  const url = buildBicycleDirectionsUrl({ latitude: -33.865143, longitude: 151.2099 })
  assert.match(url, /destination=-33\.865143%2C151\.209900/)
  const parsed = new URL(url)
  assert.equal(parsed.searchParams.get('destination'), '-33.865143,151.209900')
})

test('explicit null origin behaves exactly like omitting it', () => {
  const withNull = buildBicycleDirectionsUrl({ latitude: 45, longitude: 6 }, null)
  const omitted = buildBicycleDirectionsUrl({ latitude: 45, longitude: 6 })
  assert.equal(withNull, omitted)
})

test('walking directions use the real destination with or without a known GPS origin', () => {
  const destination = { latitude: 45.123456, longitude: 6.654321 }
  for (const origin of [null, { latitude: 45.5, longitude: 6.1 }]) {
    const parsed = new URL(buildDirectionsUrl(destination, origin, 'walking'))
    assert.equal(parsed.searchParams.get('travelmode'), 'walking')
    assert.equal(parsed.searchParams.get('destination'), '45.123456,6.654321')
    assert.equal(parsed.searchParams.get('origin'), origin === null ? null : '45.500000,6.100000')
  }
  assert.equal(buildDirectionsUrl(destination), buildBicycleDirectionsUrl(destination))
})

test('a walking popup keeps walking directions when the GPS position moves or becomes unavailable', () => {
  const link = { dataset: { poiLat: '45.1', poiLon: '6.2', poiTravelMode: 'walking' }, href: '' }
  updatePoiDirectionsOrigin(link, { latitude: 45.2, longitude: 6.3 })
  assert.equal(new URL(link.href).searchParams.get('origin'), '45.200000,6.300000')
  updatePoiDirectionsOrigin(link, { latitude: 45.3, longitude: 6.4 })
  assert.equal(new URL(link.href).searchParams.get('origin'), '45.300000,6.400000')
  assert.equal(new URL(link.href).searchParams.get('travelmode'), 'walking')
  updatePoiDirectionsOrigin(link, null)
  assert.equal(new URL(link.href).searchParams.get('origin'), null)
  assert.equal(new URL(link.href).searchParams.get('travelmode'), 'walking')
})

test('an older popup without a movement mode retains cycling directions when GPS origin is refreshed', () => {
  const link = { dataset: { poiLat: '45.1', poiLon: '6.2' }, href: '' }
  updatePoiDirectionsOrigin(link, { latitude: 45.2, longitude: 6.3 })
  assert.equal(new URL(link.href).searchParams.get('travelmode'), 'bicycling')
  assert.equal(new URL(link.href).searchParams.get('destination'), '45.100000,6.200000')
})

test('a popup with missing destination coordinates is not redirected to an invented point', () => {
  const link = { dataset: { poiTravelMode: 'walking' }, href: 'https://example.test/original' }
  updatePoiDirectionsOrigin(link, { latitude: 45.2, longitude: 6.3 })
  assert.equal(link.href, 'https://example.test/original')
})
