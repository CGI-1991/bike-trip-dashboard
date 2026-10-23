import assert from 'node:assert/strict'
import test from 'node:test'
import { APP_RELEASES, CURRENT_APP_VERSION } from '../../src/releases.ts'
import { featureReleaseKey, renderFeatureUpdateBadge, renderReleaseNotes } from '../../src/ui/release-notes.ts'
import { buildDayDetail } from '../../src/ui/trips/day-detail-view.ts'
import { renderDashboard } from '../../src/ui/render.ts'
import { createGenericTripBundle } from '../trip-core/support/generic-trip-fixture.mjs'
import { createDefaultRideDaySettingsDocument } from '../../src/storage/ride-day-settings.ts'

test('an unread update appears beside the changed feature, without depending on trip storage', () => {
  const markup = renderFeatureUpdateBadge('poi-search', null)
  assert.match(markup, />MAJ</)
  assert.match(markup, /data-feature-update="poi-search"/)
  assert.match(markup, /aria-haspopup="dialog"/)
  assert.match(markup, /type="button"/)
  assert.equal(renderFeatureUpdateBadge('unknown-feature', null), '')
})

test('only the latest read version of a feature suppresses its badge; a later update makes it new again', () => {
  const key = featureReleaseKey('poi-search')
  assert.match(key, /2026\.10\.23\.1/)
  assert.equal(renderFeatureUpdateBadge('poi-search', {getItem: storageKey => storageKey.endsWith(key) ? 'read' : null}), '')
  assert.notEqual(renderFeatureUpdateBadge('poi-search', {getItem: () => 'an older version'}), '')
  const next = [{version: '2026.10.24.1', date: '2026-10-24', changes: [{feature: 'poi-search', title: 'Next', description: 'Next'}]}, ...APP_RELEASES]
  assert.equal(featureReleaseKey('poi-search', next), '2026.10.24.1:poi-search')
})

test('blocked localStorage does not prevent reading a changed feature or using the application', () => {
  assert.match(renderFeatureUpdateBadge('poi-refresh', {getItem() {throw new Error('blocked')}}), />MAJ</)
  assert.match(renderReleaseNotes('poi-refresh'), /Actualiser uniquement les services/)
})

test('the touch dialog explains that feature across its releases, while history remains complete and dated', () => {
  const feature = renderReleaseNotes('poi-search')
  assert.match(feature, /23 octobre 2026/)
  assert.match(feature, /22 octobre 2026/)
  assert.match(feature, /progressivement/)
  assert.doesNotMatch(feature, /Actualiser uniquement les services/)
  const history = renderReleaseNotes()
  assert.match(history, /Actualiser uniquement les services/)
  assert.match(history, /Version chargée/)
  assert.ok(history.includes(CURRENT_APP_VERSION))
  assert.equal(new Set(APP_RELEASES.map(release => release.version)).size, APP_RELEASES.length)
})

test('real stage and app-shell renderers expose the local badge and permanent history button', () => {
  const bundle = createGenericTripBundle()
  assert.match(buildDayDetail(bundle, bundle.days[0].id).html, /data-feature-update="poi-search"/)
  assert.match(renderDashboard(createDefaultRideDaySettingsDocument()), /data-release-notes/)
})
