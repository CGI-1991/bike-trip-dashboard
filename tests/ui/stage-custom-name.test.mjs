import './support/dom-shim.mjs'

import assert from 'node:assert/strict'
import test from 'node:test'

import { buildDayDetail } from '../../src/ui/trips/day-detail-view.ts'
import { renderTripDetail } from '../../src/ui/trips/trip-detail-view.ts'
import { buildTripOverview } from '../../src/ui/trips/trip-overview-view.ts'
import { selectStageCustomName } from '../../src/trip-core/index.ts'
import { createGenericTripBundle } from '../trip-core/support/generic-trip-fixture.mjs'

/** `createGenericTripBundle`'s day-alpha ride stage, given (or not) a custom name. */
function bundleWithStageName(customName) {
  const bundle = createGenericTripBundle()
  return {
    ...bundle,
    stages: bundle.stages.map((stage) => (stage.id === 'stage-alpha'
      ? (customName === undefined ? stage : { ...stage, customName })
      : stage)),
  }
}

// --- normalization -----------------------------------------------------------

test('absent, empty and whitespace-only all mean "no custom name"', () => {
  assert.equal(selectStageCustomName({}), null)
  assert.equal(selectStageCustomName({ customName: '' }), null)
  assert.equal(selectStageCustomName({ customName: '   ' }), null)
  assert.equal(selectStageCustomName({ customName: '  Étape reine  ' }), 'Étape reine')
  assert.equal(selectStageCustomName(null), null)
})

// --- Détail ------------------------------------------------------------------

test('Détail: the custom name is the title and the trajet becomes its subtitle', () => {
  const detail = buildDayDetail(bundleWithStageName('Étape reine'), 'day-alpha')
  assert.match(detail.identityHtml, /day-detail__identity-route">Étape reine</)
  assert.match(detail.identityHtml, /day-detail__identity-subtitle[^>]*>[^<]*Riverside[^<]*→[^<]*Hilltown/)
  assert.match(detail.identityHtml, /aria-label="Étape reine — Riverside → Hilltown"/)
})

test('Détail: without a custom name the bandeau is byte-for-byte what it always was', () => {
  const withName = buildDayDetail(bundleWithStageName('Étape reine'), 'day-alpha')
  const without = buildDayDetail(bundleWithStageName(undefined), 'day-alpha')
  assert.doesNotMatch(without.identityHtml, /day-detail__identity-subtitle/)
  assert.match(without.identityHtml, /day-detail__identity-route">Riverside → Hilltown</)
  assert.notEqual(withName.identityHtml, without.identityHtml)
})

test('Détail: a name cleared back to empty restores the original display exactly', () => {
  const cleared = buildDayDetail(bundleWithStageName('   '), 'day-alpha')
  const never = buildDayDetail(bundleWithStageName(undefined), 'day-alpha')
  assert.equal(cleared.identityHtml, never.identityHtml)
  assert.equal(cleared.stageLabel, never.stageLabel)
})

test('Détail: the stage label used elsewhere (map dialog, exports) follows the custom name too', () => {
  assert.equal(buildDayDetail(bundleWithStageName('Étape reine'), 'day-alpha').stageLabel, 'J1 — Étape reine')
  assert.equal(buildDayDetail(bundleWithStageName(undefined), 'day-alpha').stageLabel, 'J1 — Riverside → Hilltown')
})

// --- Voyage ------------------------------------------------------------------

test('Voyage: the custom name replaces the départ/arrivée label in the slot it already occupied', () => {
  const html = renderTripDetail(bundleWithStageName('Étape reine'))
  assert.match(html, /class="trip-day-card__route" title="Étape reine — Riverside → Hilltown"[^>]*>Étape reine</)
  // No extra line: the card still carries exactly one route element per day.
  assert.equal((html.match(/trip-day-card__route/g) ?? []).length, (renderTripDetail(bundleWithStageName(undefined)).match(/trip-day-card__route/g) ?? []).length)
})

test('Voyage: without a custom name the card markup is unchanged', () => {
  const html = renderTripDetail(bundleWithStageName(undefined))
  assert.match(html, /class="trip-day-card__route" title="Riverside → Hilltown"/)
})

// --- Aperçu ------------------------------------------------------------------

test('Aperçu: the highlighted day uses the custom name, with the trajet kept underneath', () => {
  const overview = buildTripOverview(bundleWithStageName('Étape reine'), '2027-05-10')
  assert.match(overview.html, /<h3>J1 — Étape reine<\/h3>/)
  assert.match(overview.html, /trip-overview__highlighted-day-route">Riverside → Hilltown/)
})

test('Aperçu: without a custom name the heading is the trajet, and no extra line appears', () => {
  const overview = buildTripOverview(bundleWithStageName(undefined), '2027-05-10')
  assert.match(overview.html, /<h3>J1 — Riverside → Hilltown<\/h3>/)
  assert.doesNotMatch(overview.html, /trip-overview__highlighted-day-route/)
})
