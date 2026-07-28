import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveArrivalDisplay, resolveDepartureDisplay } from '../../src/trip/endpoint-display.ts'

const j1Day = { id: 'J1', startName: 'Thonon-les-Bains', endName: 'Morzine' }

test('J1 departure uses the precise station name, sub-labeled with the plain locality', () => {
  const display = resolveDepartureDisplay(j1Day)
  assert.equal(display.primaryName, 'Gare de Thonon-les-Bains')
  assert.equal(display.subLabel, 'Départ · Thonon-les-Bains')
  assert.equal(display.merged, true)
})

test('a day without a precise station name falls back to the plain locality', () => {
  const day = { id: 'J3', startName: 'Le Grand-Bornand', endName: 'Beaufort' }
  const display = resolveDepartureDisplay(day)
  assert.equal(display.primaryName, 'Le Grand-Bornand')
  assert.equal(display.subLabel, 'Départ · Le Grand-Bornand')
  assert.equal(display.merged, false)
})

test('an arrival merges with the accommodation when its address names the same locality', () => {
  const accommodation = { name: 'Hôtel Le Soly', address: '234 Route de la Manche, 74110 Morzine' }
  const display = resolveArrivalDisplay(j1Day, accommodation)
  assert.equal(display.primaryName, 'Hôtel Le Soly')
  assert.equal(display.subLabel, 'Arrivée · Morzine')
  assert.equal(display.merged, true)
})

test('an arrival keeps the plain locality when there is no accommodation', () => {
  const display = resolveArrivalDisplay(j1Day, null)
  assert.equal(display.primaryName, 'Morzine')
  assert.equal(display.subLabel, 'Arrivée · Morzine')
  assert.equal(display.merged, false)
})

test('an arrival never invents a merge when the accommodation address names a different locality', () => {
  const accommodation = { name: 'Auberge du Val', address: '12 Rue Centrale, 74450 Le Grand-Bornand' }
  const display = resolveArrivalDisplay(j1Day, accommodation)
  assert.equal(display.primaryName, 'Morzine')
  assert.equal(display.subLabel, 'Arrivée · Morzine')
  assert.equal(display.merged, false)
})

test('locality matching is accent- and case-insensitive', () => {
  const day = { id: 'J10', startName: 'Barcelonnette', endName: 'Saint-Étienne-de-Tinée' }
  const accommodation = { name: 'Chez Martine et Serge', address: '1 Rue du Val Gelé, 06660 SAINT-ETIENNE-DE-TINEE' }
  const display = resolveArrivalDisplay(day, accommodation)
  assert.equal(display.primaryName, 'Chez Martine et Serge')
  assert.equal(display.merged, true)
})
