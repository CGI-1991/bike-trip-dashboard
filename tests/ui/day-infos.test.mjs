import assert from 'node:assert/strict'
import test from 'node:test'

import { renderDayInfos } from '../../src/ui/day-infos.ts'
import { renderAccommodation } from '../../src/trip/accommodations.ts'

test('ride Infos keeps unique editorial notes without duplicating documented points', () => {
  const container = { innerHTML: '' }
  renderDayInfos(container, {
    type: 'ride',
    roadbook: {
      type: 'ride',
      ambiance: 'Une ambiance documentée.',
      notes: ['Départ tôt.', 'Départ tôt.', 'Manger régulièrement.'],
      variant: 'Bonette',
    },
    points: [{ name: 'Col du Test' }],
  })
  assert.equal((container.innerHTML.match(/Départ tôt\./g) ?? []).length, 1)
  assert.match(container.innerHTML, /Une ambiance documentée\./)
  assert.match(container.innerHTML, /Manger régulièrement\./)
  assert.match(container.innerHTML, /Variante : Bonette/)
  assert.doesNotMatch(container.innerHTML, /Col du Test|Roadbook|Autres passages/)
})

test('OFF Infos keeps documented activities, recovery and logistics without cycling content', () => {
  const container = { innerHTML: '' }
  renderDayInfos(container, {
    type: 'off',
    roadbook: {
      type: 'off',
      ambiance: 'Repos documenté.',
      activities: [{ description: 'Visite douce.' }],
      recovery: [{ description: 'Récupération.' }],
      logistics: [{ description: 'Préparer demain.' }, { description: 'Préparer demain.' }],
      notes: [],
    },
    points: [],
  })
  assert.match(container.innerHTML, /Repos documenté\./)
  assert.match(container.innerHTML, /Visite douce\./)
  assert.match(container.innerHTML, /Récupération\./)
  assert.equal((container.innerHTML.match(/Préparer demain\./g) ?? []).length, 1)
  assert.doesNotMatch(container.innerHTML, /GPX|pause|Distance|D\+/i)
})

test('confirmed accommodation renders its address and Maps action inside its single host', () => {
  const container = { innerHTML: '', hidden: true }
  renderAccommodation(container, { id: 'morzine-le-soly', dayIds: ['J1'], name: 'Hôtel Le Soly', type: 'hotel', address: '234 Route de la Manche, 74110 Morzine', confirmed: true })
  assert.equal(container.hidden, false)
  assert.match(container.innerHTML, /Hébergement confirmé/)
  assert.match(container.innerHTML, /Hôtel Le Soly/)
  assert.match(container.innerHTML, /234 Route de la Manche/)
  assert.match(container.innerHTML, /Ouvrir dans Maps/)
})

test('ride Infos lists documented climb statistics in roadbook order', () => {
  const container = { innerHTML: '' }
  renderDayInfos(container, {
    type: 'ride',
    roadbook: {
      type: 'ride',
      ambiance: 'Deux cols documentés.',
      notes: [],
      variant: null,
      cols: [
        { id: 'col-1', name: 'Col du Premier', elevationM: 1_234, distanceKm: 8.5, elevationGainM: 650, averageGradientPercent: 7.6 },
        { id: 'col-2', name: 'Col du Second', elevationM: 2_000, distanceKm: 12, elevationGainM: 900, averageGradientPercent: 7.5 },
      ],
    },
    points: [],
  })
  assert.match(container.innerHTML, /Cols du jour/)
  assert.equal((container.innerHTML.match(/class="day-infos__col"/g) ?? []).length, 2)
  assert.ok(container.innerHTML.indexOf('Col du Premier') < container.innerHTML.indexOf('Col du Second'))
  assert.match(container.innerHTML, /1.234 m/)
  assert.match(container.innerHTML, /8,5 km/)
  assert.match(container.innerHTML, /650 m/)
  assert.match(container.innerHTML, /7,6 %/)
  assert.match(container.innerHTML, /<dt>Montée<\/dt>.*<dt>D\+<\/dt>.*<dt>Pente moyenne<\/dt>/s)
})
