import './support/dom-shim.mjs'

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { buildTripOverview } from '../../src/ui/trips/trip-overview-view.ts'
import { buildDayDetail } from '../../src/ui/trips/day-detail-view.ts'
import { renderRaceModeToggle } from '../../src/ui/trips/race-mode-toggle.ts'
import { renderClimbSensitivitySlider } from '../../src/ui/trips/climb-sensitivity-slider.ts'
import { isSignificantWaypoint } from '../../src/analysis/canonical-waypoints.ts'
import { deriveTripTemporalState } from '../../src/trips-manager/trip-day-temporal-state.ts'
import { createLinkedTripBundle, withVillages } from '../trips-manager/support/linked-trip-fixture.mjs'
import { withDayDepartureTime } from '../../src/trips-manager/linked-stages.ts'
import { createGenericTripBundle } from '../trip-core/support/generic-trip-fixture.mjs'

// --- the Normal/Montagne mode is gone ---------------------------------------

test('no source file exposes the Normal/Montagne selector any more', () => {
  const wizard = readFileSync(new URL('../../src/ui/trips/import-wizard.ts', import.meta.url), 'utf8')
  const editor = readFileSync(new URL('../../src/ui/trips/trip-editor.ts', import.meta.url), 'utf8')
  for (const [name, source] of [['wizard', wizard], ['editor', editor]]) {
    assert.doesNotMatch(source, /set-terrain-mode/, `${name}: the control is gone`)
    assert.doesNotMatch(source, /renderTerrainToggle/, `${name}: the module is gone`)
    assert.doesNotMatch(source, /terrainOverride/, `${name}: the state is gone`)
    assert.doesNotMatch(source, /mountainMode/, `${name}: the setting is gone`)
  }
})

test('no saved preference can hide a detected climb any longer', () => {
  // `isSignificantWaypoint` used to take a filter that hid a climb classified
  // as "secondaire". It takes none now, and a climb is shown because it was
  // detected at all.
  assert.equal(isSignificantWaypoint.length, 1)
  const climb = { kind: 'climb', importance: 'major', visibleByDefault: true, pauseDurationMinutes: null }
  assert.equal(isSignificantWaypoint(climb), true)
})

test('a trip still carrying a legacy mountainMode value behaves exactly like one without it', () => {
  const plain = createGenericTripBundle()
  const legacy = { ...plain, settings: { ...plain.settings, global: { ...plain.settings.global, mountainMode: true } } }
  assert.equal(buildDayDetail(legacy, 'day-alpha').timelineHtml, buildDayDetail(plain, 'day-alpha').timelineHtml)
})

test('the 5-level detection sensitivity survives, slider included, and its "Montagne" step is not the removed mode', () => {
  const html = renderClimbSensitivitySlider('standard')
  assert.match(html, /data-field="climb-sensitivity"/)
  assert.match(html, /max="4"/, 'five steps, 0 through 4')
  assert.match(html, /Montagne/)
  assert.match(html, /Pays plat/)
  assert.doesNotMatch(html, /set-terrain-mode/)
})

// --- mode names -------------------------------------------------------------

test('the visible mode names are Voyage and Tour', () => {
  for (const raceMode of [false, true]) {
    const html = renderRaceModeToggle(raceMode)
    assert.match(html, />Voyage</)
    assert.match(html, />Tour</)
    assert.doesNotMatch(html, /Classique/)
    assert.doesNotMatch(html, /Course/)
  }
})

test('the stored value stays `raceMode` — renaming the toggle changed no data', () => {
  assert.match(renderRaceModeToggle(true), /data-action="set-race-mode" data-race-mode="on" aria-pressed="true"/)
  assert.match(renderRaceModeToggle(false), /data-action="set-race-mode" data-race-mode="off" aria-pressed="true"/)
})

// --- "Étapes restantes" -----------------------------------------------------

function tripWithOffAndLink() {
  // ride, ride (same day as the first), OFF, ride
  const base = withVillages(createLinkedTripBundle({ rideCount: 4, links: [1] }))
  const days = base.days.map((day) => ({ ...day }))
  const offDay = { ...days[2], type: 'off', stageId: null }
  delete offDay.sameCalendarDayAsPrevious
  days[2] = offDay
  return { ...base, days, stages: base.stages.filter((stage) => stage.dayId !== days[2].id) }
}

test('Étapes restantes counts stages, so two stages on one day count twice and OFF days count for none', () => {
  const overview = buildTripOverview(tripWithOffAndLink(), '2028-05-01')
  assert.match(overview.html, /<dt>Étapes restantes<\/dt><dd>3<\/dd>/)
  assert.doesNotMatch(overview.html, /Journées restantes/)
})

test('a stage stops counting once its own ETA has passed — the existing completion rule, unchanged', () => {
  const bundle = tripWithOffAndLink()
  const beforeStart = buildTripOverview(bundle, '2028-05-01')
  assert.match(beforeStart.html, /<dt>Étapes restantes<\/dt><dd>3<\/dd>/)
  // Late on the first day: both stages of the group are done, the OFF day is
  // not a stage, so only the last stage is left.
  const endOfFirstDay = buildTripOverview(bundle, '2028-06-01T23:30:00+02:00')
  assert.match(endOfFirstDay.html, /<dt>Étapes restantes<\/dt><dd>1<\/dd>/)
  assert.match(endOfFirstDay.html, /<dt>Étapes terminées<\/dt><dd>2<\/dd>/)
})

test('after the first stage of a day arrives, the next stage of the SAME day becomes the current one', () => {
  // A real group gives its second stage a departure after the first one's
  // ETA (`initializeLinkedGroupDepartures`); the fixture leaves both at the
  // default, so set it here rather than test an impossible schedule.
  const bundle = withDayDepartureTime(tripWithOffAndLink(), 'day-1', '13:00')
  const temporal = deriveTripTemporalState(bundle, '2028-06-01T12:00:00+02:00')
  assert.equal(temporal.days[0].completed, true, 'the first stage of the day is done by midday')
  assert.equal(temporal.priorityDayId, bundle.days[1].id, 'the next stage is the same day’s second one')
  assert.equal(temporal.days[1].current, true)
})

test('the trip-wide day counters that really mean calendar days are left alone', () => {
  const overview = buildTripOverview(tripWithOffAndLink(), '2028-05-01')
  // Distance/D+ totals are per stage and unchanged; nothing else in the grid
  // was turned into a stage counter.
  assert.match(overview.html, /<dt>Distance totale<\/dt>/)
  assert.match(overview.html, /<dt>D\+ total<\/dt>/)
  const progressBlock = overview.html.match(/<section class="card trip-overview__progress"[\s\S]*?<\/section>/)?.[0] ?? ''
  assert.equal((progressBlock.match(/<dt>/g) ?? []).length, 6)
})
