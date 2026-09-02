import assert from 'node:assert/strict'
import test from 'node:test'

import { renderSingleDayCard, renderStagePreparationIndicator, renderTripDetail } from '../../src/ui/trips/trip-detail-view.ts'
import { createGenericTripBundle } from '../trip-core/support/generic-trip-fixture.mjs'

// Fixture ride days: day-alpha (2027-05-10), day-delta (2027-05-13).

test('renderStagePreparationIndicator carries no Postpass/HTTP/provider jargon, only an accessible label (section 11)', () => {
  for (const status of ['pending', 'running', 'stale', 'partial', 'error']) {
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

// R1 section 3 ("silence when healthy") — test A.
test('R1 test A: renderStagePreparationIndicator renders nothing at all for "ready" — no permanent checkmark once a stage is genuinely done', () => {
  assert.equal(renderStagePreparationIndicator('ready'), '')
})

test('without a status map, renderTripDetail shows no indicator/summary line — only the always-present, empty mount a later status patch could grow into (R1: `patchStagePreparationIndicators` targets it unconditionally, see `renderStagePreparationIndicator`\'s own doc comment)', () => {
  const bundle = createGenericTripBundle()
  const html = renderTripDetail(bundle, { now: '2027-05-01' })
  assert.match(html, /<span data-trip-day-prep-slot><\/span>/, 'the mount itself is always present, empty')
  assert.doesNotMatch(html, /data-trip-day-prep /, 'but never a real indicator glyph/label without a status map')
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

// --- R2 section 12: pragmatic transfer mode/heures on the Voyage card ------

test('a transfer card with no mode/heures shows no extra line at all — never a fake D+/profile', () => {
  const bundle = createGenericTripBundle()
  const html = renderTripDetail(bundle)
  const card = html.slice(html.indexOf('data-day-id="day-charlie"'), html.indexOf('data-day-id="day-delta"'))
  assert.doesNotMatch(card, /trip-day-card__transfer-meta/)
})

test('a transfer card with mode + heures shows the compact "Mode · HH:MM → HH:MM" line, matching the CDC worked example', () => {
  const bundle = createGenericTripBundle()
  bundle.days[2].transferMode = 'Train'
  bundle.days[2].transferDepartureTime = '09:20'
  bundle.days[2].transferArrivalTime = '12:05'
  const html = renderTripDetail(bundle)
  const card = html.slice(html.indexOf('data-day-id="day-charlie"'), html.indexOf('data-day-id="day-delta"'))
  assert.match(card, /<span class="trip-day-card__transfer-meta">Train · 09:20 → 12:05<\/span>/)
})

test('renderSingleDayCard produces a `<button data-day-id>` carrying the requested status and the day\'s own route/name — a valid patch target for that one card', () => {
  const bundle = createGenericTripBundle()
  const single = renderSingleDayCard(bundle, 'day-alpha', '2027-05-01', 'partial')
  assert.match(single, /^<button class="trip-day-card trip-day-card--ride[^]*<\/button>$/)
  assert.match(single, /data-day-id="day-alpha"/)
  assert.match(single, /Riverside → Hilltown/)
  assert.match(single, /trip-day-card__prep--partial/)
})

// R1 test A: a ready card still always carries the always-present slot (so a
// later status regression has somewhere to patch into), but nothing visible
// inside it.
test('renderSingleDayCard for a "ready" status carries the prep slot but no visible indicator inside it', () => {
  const bundle = createGenericTripBundle()
  const single = renderSingleDayCard(bundle, 'day-alpha', '2027-05-01', 'ready')
  assert.match(single, /data-trip-day-prep-slot><\/span>/)
  assert.doesNotMatch(single, /trip-day-card__prep--/)
})

test('renderSingleDayCard returns null for an unknown day id', () => {
  const bundle = createGenericTripBundle()
  assert.equal(renderSingleDayCard(bundle, 'does-not-exist', '2027-05-01', 'ready'), null)
})
