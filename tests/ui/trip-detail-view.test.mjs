import assert from 'node:assert/strict'
import test from 'node:test'

import { renderSingleDayCard, renderStagePreparationIndicator, renderTripDetail } from '../../src/ui/trips/trip-detail-view.ts'
import { createGenericTripBundle } from '../trip-core/support/generic-trip-fixture.mjs'

// Fixture ride days: day-alpha (2027-05-10), day-delta (2027-05-13).

test('renderStagePreparationIndicator carries no Postpass/HTTP/provider jargon, only an accessible label (section 11)', () => {
  for (const status of ['pending', 'running', 'ready', 'stale', 'partial', 'error']) {
    const html = renderStagePreparationIndicator(status)
    assert.doesNotMatch(html, /postpass|http|provider|sql/i)
    assert.match(html, /aria-label="[^"]+"/)
    assert.match(html, /data-trip-day-prep/)
  }
})

test('renderStagePreparationIndicator renders nothing for null/undefined (OFF/transfer, or no status supplied at all)', () => {
  assert.equal(renderStagePreparationIndicator(null), '')
  assert.equal(renderStagePreparationIndicator(undefined), '')
})

test('without a status map, renderTripDetail is byte-identical to before this feature existed — no indicator, no summary line', () => {
  const bundle = createGenericTripBundle()
  const html = renderTripDetail(bundle, { now: '2027-05-01' })
  assert.doesNotMatch(html, /data-trip-day-prep/)
  assert.doesNotMatch(html, /data-trip-prep-summary/)
})

test('C2.5 section 13: with a status map, a discreet "X/Y étapes prêtes" count appears — never a percentage (section 14)', () => {
  const bundle = createGenericTripBundle()
  const statuses = new Map([['day-alpha', 'ready'], ['day-delta', 'running']])
  const html = renderTripDetail(bundle, { now: '2027-05-01', stagePreparationStatuses: statuses })
  assert.match(html, /<p class="trip-detail__prep-summary" data-trip-prep-summary role="status">1\/2 étapes prêtes<\/p>/)
  assert.doesNotMatch(html, /%/)
})

test('the summary disappears once every ride day is ready — nothing left to report', () => {
  const bundle = createGenericTripBundle()
  const statuses = new Map([['day-alpha', 'ready'], ['day-delta', 'ready']])
  const html = renderTripDetail(bundle, { now: '2027-05-01', stagePreparationStatuses: statuses })
  assert.doesNotMatch(html, /data-trip-prep-summary/)
})

test('each ride card carries the indicator for its own day only — OFF/transfer cards never get one', () => {
  const bundle = createGenericTripBundle()
  const statuses = new Map([['day-alpha', 'pending'], ['day-delta', 'error']])
  const html = renderTripDetail(bundle, { now: '2027-05-01', stagePreparationStatuses: statuses })
  const alphaCard = html.slice(html.indexOf('data-day-id="day-alpha"'), html.indexOf('data-day-id="day-bravo"'))
  assert.match(alphaCard, /trip-day-card__prep--pending/)
  assert.doesNotMatch(html.slice(html.indexOf('data-day-id="day-bravo"'), html.indexOf('data-day-id="day-charlie"')), /data-trip-day-prep/)
})

test('renderSingleDayCard produces a `<button data-day-id>` carrying the requested status and the day\'s own route/name — a valid patch target for that one card', () => {
  const bundle = createGenericTripBundle()
  const single = renderSingleDayCard(bundle, 'day-alpha', '2027-05-01', 'ready')
  assert.match(single, /^<button class="trip-day-card trip-day-card--ride[^]*<\/button>$/)
  assert.match(single, /data-day-id="day-alpha"/)
  assert.match(single, /Riverside → Hilltown/)
  assert.match(single, /trip-day-card__prep--ready/)
})

test('renderSingleDayCard returns null for an unknown day id', () => {
  const bundle = createGenericTripBundle()
  assert.equal(renderSingleDayCard(bundle, 'does-not-exist', '2027-05-01', 'ready'), null)
})
