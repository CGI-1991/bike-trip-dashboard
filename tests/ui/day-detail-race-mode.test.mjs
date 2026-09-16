import './support/dom-shim.mjs'

import assert from 'node:assert/strict'
import test from 'node:test'

import { buildDayDetail } from '../../src/ui/trips/day-detail-view.ts'
import { applyRaceMode } from '../../src/trips-manager/race-mode.ts'
import { createGenericTripBundle } from '../trip-core/support/generic-trip-fixture.mjs'

test('Course/Tour removes the Pauses panel entirely — never a disabled-looking editor', () => {
  const classic = buildDayDetail(createGenericTripBundle(), 'day-alpha')
  assert.notEqual(classic.pausesHtml, '')
  assert.match(classic.html, /data-day-bottom-panel-pauses|aria-controls="day-bottom-panel-pauses"/)

  const race = buildDayDetail(applyRaceMode(createGenericTripBundle(), true), 'day-alpha')
  assert.equal(race.pausesHtml, '')
  assert.doesNotMatch(race.html, /day-bottom-panel-pauses/, 'no toggle and no panel to open onto nothing')
  assert.doesNotMatch(race.html, /data-action="save-manual-pauses"/)
})

test('Course/Tour drops the Pauses stat, and leaves every other stat in place', () => {
  const classic = buildDayDetail(createGenericTripBundle(), 'day-alpha')
  assert.match(classic.statsHtml, /<dt>Pauses<\/dt>/)

  const race = buildDayDetail(applyRaceMode(createGenericTripBundle(), true), 'day-alpha')
  assert.doesNotMatch(race.statsHtml, /<dt>Pauses<\/dt>/)
  for (const label of ['Départ', 'Arrivée estimée', 'Distance', 'Durée', 'D\\+', 'Montées']) {
    assert.match(race.statsHtml, new RegExp(`<dt>${label}</dt>`))
  }
})

test('Course/Tour keeps the Météo panel, and leaves OFF/transfer days untouched', () => {
  const race = applyRaceMode(createGenericTripBundle(), true)
  const ride = buildDayDetail(race, 'day-alpha')
  assert.match(ride.html, /day-bottom-panel-weather/)

  const off = buildDayDetail(race, 'day-bravo')
  const transfer = buildDayDetail(race, 'day-charlie')
  const classicOff = buildDayDetail(createGenericTripBundle(), 'day-bravo')
  const classicTransfer = buildDayDetail(createGenericTripBundle(), 'day-charlie')
  assert.equal(off.html, classicOff.html, 'an OFF day renders identically in both modes')
  assert.equal(transfer.html, classicTransfer.html, 'so does a transfer')
})
