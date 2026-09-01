import assert from 'node:assert/strict'
import test from 'node:test'

import { buildBicycleDirectionsUrl } from '../../src/ui/bicycle-directions.ts'

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
