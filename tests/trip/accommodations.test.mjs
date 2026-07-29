import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { getAccommodationForDay, getAccommodationMapsUrl, renderAccommodation } from '../../src/trip/accommodations.ts'

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

test('J2 uses only Hôtel et Spa Le Vermont with its confirmed structured website', () => {
  const j2Entries = document.accommodations.filter(({ dayIds }) => dayIds.includes('J2'))
  assert.equal(j2Entries.length, 1)
  assert.deepEqual(j2Entries[0], {
    id: 'grand-bornand-vermont',
    dayIds: ['J2'],
    name: 'Hôtel et Spa Le Vermont',
    type: 'hotel',
    address: '607 Route de la Vallée du Bouchet, 74450 Le Grand-Bornand',
    website: 'https://hotelspalevermont.com/',
    confirmed: true,
  })
  assert.doesNotMatch(JSON.stringify(document.accommodations), /Croix Saint-Maurice|croix-saint-maurice|hotel-lacroixstmaurice/)
})

test('J9 keeps L’Éterlou in Faucon-de-Barcelonnette and exposes its direct website as Voir le site', () => {
  const j9 = getAccommodationForDay(document.accommodations, 'J9')
  assert.equal(j9.id, 'faucon-eterlou')
  assert.equal(j9.name, 'Gîte Auberge L’Éterlou')
  assert.equal(j9.address, 'Villevieille, 25 Route de Jausiers, 04400 Faucon-de-Barcelonnette')
  assert.equal(j9.website, 'https://www.ubaye-gite-hote-barcelonnette.fr/fr/')
  const container = { innerHTML: '', hidden: true }
  renderAccommodation(container, j9)
  assert.match(container.innerHTML, />Voir le site<\/a>/)
  assert.match(container.innerHTML, /aria-label="Voir le site de Gîte Auberge L’Éterlou"/)
  assert.match(container.innerHTML, /target="_blank" rel="noopener noreferrer"/)
})
