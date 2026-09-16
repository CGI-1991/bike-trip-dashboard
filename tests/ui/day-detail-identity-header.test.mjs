import './support/dom-shim.mjs'

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { buildDayDetail } from '../../src/ui/trips/day-detail-view.ts'
import { createGenericTripBundle } from '../trip-core/support/generic-trip-fixture.mjs'

// The bandeau is a two-row grid with EXPLICIT lines:
//
//   Jx | NOM MANUEL
//      | Départ → Arrivée
//
// It used to rely on implicit placement, so the title's row depended on
// whether the stage happened to carry a custom name — paging between stages
// moved it vertically. These tests pin the markup contract and the grid
// lines that make the composition deterministic.

const CSS = readFileSync(new URL('../../src/style.css', import.meta.url), 'utf8')

function rule(selector) {
  const escaped = selector.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`${escaped}\\s*\\{[^}]*\\}`).exec(CSS)?.[0] ?? ''
}

function bundleWithStageName(customName) {
  const bundle = createGenericTripBundle()
  return {
    ...bundle,
    stages: bundle.stages.map((stage) => (stage.id === 'stage-alpha' && customName !== undefined ? { ...stage, customName } : stage)),
  }
}

// --- markup -----------------------------------------------------------------

test('with a custom name: Jx, then the name, then the départ → arrivée, in that order', () => {
  const { identityHtml } = buildDayDetail(bundleWithStageName('Étape reine'), 'day-alpha')
  const numberAt = identityHtml.indexOf('day-detail__identity-number')
  const routeAt = identityHtml.indexOf('day-detail__identity-route')
  const subtitleAt = identityHtml.indexOf('day-detail__identity-subtitle')
  assert.ok(numberAt >= 0 && routeAt > numberAt && subtitleAt > routeAt)
  assert.match(identityHtml, /day-detail__identity-route">Étape reine</)
  assert.match(identityHtml, /day-detail__identity-subtitle[^>]*>[^<]*Riverside[^<]*→[^<]*Hilltown/)
  assert.doesNotMatch(identityHtml, /day-detail__sticky-identity--single/)
})

test('without a custom name: one line, flagged so the CSS can span it over both rows', () => {
  const { identityHtml } = buildDayDetail(bundleWithStageName(undefined), 'day-alpha')
  assert.match(identityHtml, /class="day-detail__sticky-identity day-detail__sticky-identity--single"/)
  assert.doesNotMatch(identityHtml, /day-detail__identity-subtitle/, 'no empty second line is emitted')
  assert.match(identityHtml, /day-detail__identity-route">Riverside → Hilltown</)
})

test('an OFF or transfer day keeps the same bandeau contract', () => {
  for (const dayId of ['day-bravo', 'day-charlie']) {
    const { identityHtml } = buildDayDetail(createGenericTripBundle(), dayId)
    assert.match(identityHtml, /day-detail__sticky-identity--single/)
    assert.match(identityHtml, /day-detail__identity-number/)
  }
})

// --- the grid itself --------------------------------------------------------

test('the bandeau declares two explicit rows and a fixed left column', () => {
  const container = rule('.day-detail__sticky-identity')
  assert.match(container, /display:\s*grid/)
  assert.match(container, /grid-template-columns:\s*auto minmax\(0, 1fr\)/)
  assert.match(container, /grid-template-rows:\s*auto auto/, 'both rows always exist')
  assert.match(container, /overflow:\s*hidden/)
})

test('Jx occupies the left column across both rows and is centred against them', () => {
  const number = rule('.day-detail__identity-number')
  assert.match(number, /grid-column:\s*1/)
  assert.match(number, /grid-row:\s*1 \/ 3/)
  assert.match(number, /align-self:\s*center/)
})

test('the title is pinned to row 1 and the subtitle to row 2 — never implicit placement', () => {
  const route = rule('.day-detail__identity-route')
  assert.match(route, /grid-column:\s*2/)
  assert.match(route, /grid-row:\s*1/)
  const subtitle = rule('.day-detail__identity-subtitle')
  assert.match(subtitle, /grid-column:\s*2/)
  assert.match(subtitle, /grid-row:\s*2/)
})

test('a stage with no custom name spans its single line over both rows, so the header keeps one height', () => {
  const single = rule('.day-detail__sticky-identity--single .day-detail__identity-route')
  assert.match(single, /grid-row:\s*1 \/ 3/)
})

test('both lines truncate cleanly instead of wrapping, so the rows never grow', () => {
  for (const selector of ['.day-detail__identity-route', '.day-detail__identity-subtitle']) {
    const declaration = rule(selector)
    assert.match(declaration, /white-space:\s*nowrap/, `${selector}: never wraps`)
    assert.match(declaration, /text-overflow:\s*ellipsis/, `${selector}: ellipsis`)
    assert.match(declaration, /overflow:\s*hidden/, `${selector}: clipped`)
    assert.match(declaration, /min-width:\s*0/, `${selector}: shrinks inside the grid track, the precondition for ellipsis`)
    assert.match(declaration, /line-height:\s*[\d.]+/, `${selector}: an explicit line-height keeps its row deterministic`)
  }
})

test('a very long name or route changes nothing structural — same classes, same rows', () => {
  const long = 'Étape reine du massif des Vosges par la route des crêtes et le Grand Ballon'
  const { identityHtml } = buildDayDetail(bundleWithStageName(long), 'day-alpha')
  assert.match(identityHtml, /day-detail__identity-route">/)
  assert.match(identityHtml, /day-detail__identity-subtitle/)
  assert.doesNotMatch(identityHtml, /day-detail__sticky-identity--single/)
})
