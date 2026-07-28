import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { getAccommodationForDay, getAccommodationMapsUrl } from '../../src/trip/accommodations.ts'

const document = JSON.parse(readFileSync(new URL('../../public/data/trip/accommodations.json', import.meta.url), 'utf8'))

test('all twelve days resolve to ten confirmed accommodations', () => {
  assert.equal(document.accommodations.length, 10)
  for (let day = 1; day <= 12; day++) assert.ok(getAccommodationForDay(document.accommodations, `J${day}`))
  assert.equal(getAccommodationForDay(document.accommodations, 'J4'), getAccommodationForDay(document.accommodations, 'J5'))
  assert.equal(getAccommodationForDay(document.accommodations, 'J7'), getAccommodationForDay(document.accommodations, 'J8'))
})

test('Maps links prefer confirmed Airbnb coordinates', () => {
  assert.match(getAccommodationMapsUrl(getAccommodationForDay(document.accommodations, 'J4')), /query=45\.61376%2C6\.76874/)
  assert.match(getAccommodationMapsUrl(getAccommodationForDay(document.accommodations, 'J1')), /234%20Route%20de%20la%20Manche/)
})
