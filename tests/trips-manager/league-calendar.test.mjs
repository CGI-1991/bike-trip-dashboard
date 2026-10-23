import '../storage/indexeddb/support/setup-fake-indexeddb.mjs'
import { installMinimalDOMParser } from '../support/minimal-dom-parser.mjs'
installMinimalDOMParser()

import assert from 'node:assert/strict'
import test from 'node:test'
import { importGpxTrip } from '../../src/import/gpx/import-gpx-trip.ts'
import { buildGpxXml, toGpxImportFile } from '../import/gpx/support/fixtures.mjs'
import { createIdFactory, fixedNow, openImportTestDatabase } from '../import/gpx/support/run-import.mjs'
import { applyLeagueSchedule, selectAutomaticPoiSearch, selectOrganizationCapabilities, selectOrganizationMode, selectRaceMode, selectTripDayLabel, validateTripBundle } from '../../src/trip-core/index.ts'
import { applyRaceMode } from '../../src/trips-manager/race-mode.ts'
import { createGenericTripBundle } from '../trip-core/support/generic-trip-fixture.mjs'
import { createTripRepository } from '../../src/storage/indexeddb/trip-repository.ts'
import { createSourceFileRepository } from '../../src/storage/indexeddb/source-file-repository.ts'
import { loadTripEditDraft, editGpxTrip } from '../../src/trips-manager/trip-editor.ts'
import { updateTripPreferences } from '../../src/trips-manager/trip-preferences.ts'
import { createTripBackup, prepareTripBackupRestore, restorePreparedTripBackup } from '../../src/backup/trip-backup.ts'
import { tripNeedsAutomaticEnrichment, runStoredTripAutomaticEnrichment } from '../../src/route-enrichment/automatic-enrichment.ts'
import { deriveStagePreparationStatus, NO_STAGE_PREPARATION_CONTEXT } from '../../src/trips-manager/stage-preparation.ts'
import { buildTripWeatherDayDefinitions } from '../../src/weather/generic/sample-points.ts'
import { renderLeagueCalendar } from '../../src/ui/trips/league-calendar-view.ts'
import { createEmptyWizardState, formValidation } from '../../src/ui/trips/import-wizard-state.ts'

const NOW = '2027-02-01T08:00:00.000Z'
function file(latitude, name) {
  return toGpxImportFile(buildGpxXml({ tracks: [{ name, segments: [Array.from({ length: 21 }, (_, i) => ({ lat: latitude + i * .001, lon: 6, ele: 200 + i * 2, time: '2020-01-01T08:00:00Z' }))] }] }), `${name}.gpx`)
}
const files = [file(45, 'Late'), file(46, 'Early')]
const slots = [{ kind: 'ride', customName: 'Late race', eventDate: '2027-05-24', departureTime: '10:00' }, { kind: 'ride', customName: 'Early race', eventDate: '2027-05-10', departureTime: '08:30' }]
async function setup(overrides = {}) {
  const database = await openImportTestDatabase()
  const result = await importGpxTrip({ database, files, options: { tripId: 'league', slug: 'league', name: 'Season 2027', organizationMode: 'league', startDate: '2027-05-24', timezone: 'Europe/Brussels', importedAt: NOW, engineVersion: 'test', ...overrides }, dayStructure: slots, idFactory: createIdFactory('league'), now: fixedNow() })
  assert.equal(result.ok, true, result.error?.message)
  return { database, bundle: result.bundle }
}
const stageFor = (bundle, day) => bundle.stages.find(stage => stage.id === day.stageId)
const sourceFor = (bundle, day) => {
  const stage = stageFor(bundle, day)
  const route = bundle.routes.find(route => route.id === stage.sourceRouteId)
  return bundle.sourceFiles.find(source => source.id === route.sourceFileId)
}

test('legacy Voyage/Tour capabilities remain unchanged and a League shares competition without linked dates', () => {
  const bundle = createGenericTripBundle()
  assert.equal(selectOrganizationMode(bundle), 'voyage')
  assert.equal(selectRaceMode(bundle), false)
  assert.equal(selectAutomaticPoiSearch(bundle), true)
  bundle.settings.global.raceMode = true
  assert.equal(selectOrganizationMode(bundle), 'tour')
  assert.equal(selectOrganizationCapabilities(bundle).linkedStages, true)
  bundle.settings.global.organizationMode = 'league'
  assert.equal(selectRaceMode(bundle), true)
  assert.equal(selectOrganizationCapabilities(bundle).independentDates, true)
  assert.equal(selectOrganizationCapabilities(bundle).linkedStages, false)
  assert.equal(selectAutomaticPoiSearch(bundle), false)
})

test('real GPX import preserves explicit independent dates, names, sources and times after chronological sorting', async () => {
  const { database, bundle } = await setup()
  try {
    assert.deepEqual(bundle.days.map(day => day.date), ['2027-05-10', '2027-05-24'])
    assert.deepEqual(bundle.days.map(day => stageFor(bundle, day).customName), ['Early race', 'Late race'])
    assert.deepEqual(bundle.days.map(day => sourceFor(bundle, day).originalName), ['Early.gpx', 'Late.gpx'])
    assert.deepEqual(bundle.days.map(day => bundle.settings.days.find(entry => entry.dayId === day.id).departureTime), ['08:30', '10:00'])
    assert.equal(bundle.calendar.startDate, '2027-05-10')
    assert.equal(bundle.calendar.endDate, '2027-05-24')
    assert.ok(bundle.stages.every(stage => stage.pauseDurationSeconds === 0))
    assert.equal(selectTripDayLabel(bundle, bundle.days[1].id), 'C2')
    assert.equal(validateTripBundle(bundle).ok, true)
    assert.deepEqual((await createTripRepository(database).loadTripBundle('league')).days, bundle.days)
    const definitions = buildTripWeatherDayDefinitions(bundle)
    assert.deepEqual(definitions.map(day => day.tripDate), bundle.days.map(day => day.date))
  } finally { database.close() }
})

test('a League without explicit event dates cannot use GPX timestamps or import date as a substitute', async () => {
  const database = await openImportTestDatabase()
  try {
    const result = await importGpxTrip({ database, files, options: { tripId: 'league', slug: 'league', name: 'Season', organizationMode: 'league', startDate: '2027-05-10', timezone: 'Europe/Paris', importedAt: NOW, engineVersion: 'test' }, idFactory: createIdFactory(), now: fixedNow() })
    assert.equal(result.ok, false)
    assert.deepEqual(await createTripRepository(database).listTrips(), [])
  } finally { database.close() }
})

test('League validation rejects a forged calendar, linked course, non-course day, pauses and unknown mode', async () => {
  const { database, bundle } = await setup()
  try {
    for (const mutate of [
      copy => { copy.calendar.startDate = copy.metadata.startDate = '2027-05-09' },
      copy => { copy.calendar.endDate = copy.metadata.endDate = '2027-05-25' },
      copy => { copy.days[1].sameCalendarDayAsPrevious = true },
      copy => { copy.days[0].date = null },
      copy => { copy.days[0].type = 'off' },
      copy => { copy.stages[0].pauseDurationSeconds = 600 },
      copy => { copy.settings.global.raceMode = false },
      copy => { copy.settings.global.organizationMode = 'unknown' },
    ]) {
      const copy = structuredClone(bundle); mutate(copy)
      assert.equal(validateTripBundle(copy).ok, false)
    }
    const sameDay = applyLeagueSchedule(bundle, [{ dayId: bundle.days[0].id, date: '2027-05-24', departureTime: '12:00' }])
    assert.equal(validateTripBundle(sameDay).ok, true)
    assert.equal(sameDay.days[1].id, bundle.days[0].id, 'same-date races sort by departure without becoming linked')
  } finally { database.close() }
})

test('moving one race reorders the calendar without shifting another race or altering its source identity', async () => {
  const { database, bundle } = await setup()
  try {
    const moved = bundle.days[0]
    const unchanged = bundle.days[1]
    const next = applyLeagueSchedule(bundle, [{ dayId: moved.id, date: '2027-06-04', departureTime: '09:15' }])
    assert.equal(next.days[0].id, unchanged.id)
    assert.equal(next.days[0].date, unchanged.date)
    assert.equal(next.days[1].id, moved.id)
    assert.equal(sourceFor(next, next.days[1]).id, sourceFor(bundle, moved).id)
    assert.equal(next.settings.days.find(entry => entry.dayId === unchanged.id).departureTime, '10:00')
    for (const key of ['routes', 'sourceFiles', 'routePoints', 'climbs', 'practicalPlaces', 'accommodations']) assert.equal(next[key], bundle[key])
    assert.equal(validateTripBundle(next).ok, true)
    assert.equal(applyLeagueSchedule(next, [{ dayId: moved.id, date: '2027-06-04', departureTime: '09:15' }]), next)
  } finally { database.close() }
})

test('invalid or duplicate schedule updates and a global date shift never replace a saved League', async () => {
  const { database, bundle } = await setup()
  try {
    const event = { dayId: bundle.days[0].id, date: '2027-06-04', departureTime: '09:15' }
    for (const update of [{ leagueEvents: [{ ...event, dayId: 'missing' }] }, { leagueEvents: [event, event] }, { leagueEvents: [{ ...event, date: '2027-02-30' }] }, { leagueEvents: [{ ...event, departureTime: '25:00' }] }, { startDate: '2027-06-01' }, { raceMode: false }]) {
      const result = await updateTripPreferences({ database, tripId: 'league', update, now: () => '2027-02-02T08:00:00Z' })
      assert.equal(result.ok, false)
      assert.deepEqual(await createTripRepository(database).loadTripBundle('league'), bundle)
    }
    const result = await updateTripPreferences({ database, tripId: 'league', update: { leagueEvents: [event] }, now: () => '2027-02-02T08:00:00Z' })
    assert.equal(result.ok, true, result.message)
    assert.equal(result.invalidation.calendarChanged, true)
    assert.equal(result.invalidation.postpassChanged, false)
    assert.equal(result.bundle.days[1].id, event.dayId)
  } finally { database.close() }
})

test('structural add/remove plus calendar reordering preserves each retained course id and exact GPX bytes', async () => {
  const { database, bundle } = await setup()
  try {
    const place = { ...createGenericTripBundle().practicalPlaces[0], dayIds: [bundle.days[0].id],
      provenance: { ...createGenericTripBundle().practicalPlaces[0].provenance, sourceType: 'user', manuallyOverridden: true } }
    bundle.practicalPlaces = [place]
    await createTripRepository(database).saveTripBundle(bundle)
    const draft = await loadTripEditDraft(database, 'league')
    const added = file(47, 'Middle')
    const result = await editGpxTrip({ database, tripId: 'league', slots: [
      ...draft.slots.map((slot, index) => ({ ...slot, eventDate: index === 0 ? '2027-06-05' : slot.eventDate })),
      { kind: 'ride', existingDayId: null, existingSourceFileId: null, file: added, customName: 'Middle race', eventDate: '2027-05-15', departureTime: '07:30' },
    ], idFactory: createIdFactory('edit'), now: () => '2027-02-02T08:00:00Z' })
    assert.equal(result.ok, true, result.message)
    assert.deepEqual(result.bundle.days.map(day => stageFor(result.bundle, day).customName), ['Middle race', 'Late race', 'Early race'])
    assert.equal(result.bundle.days[2].id, bundle.days[0].id)
    assert.equal(result.bundle.days[1].id, bundle.days[1].id)
    assert.deepEqual(result.bundle.practicalPlaces, [place], 'a pinned place stays attached to its own retained course')
    const payloads = createSourceFileRepository(database)
    for (const oldDay of bundle.days) {
      const nextDay = result.bundle.days.find(day => day.id === oldDay.id)
      const source = sourceFor(result.bundle, nextDay)
      assert.equal(source.id, sourceFor(bundle, oldDay).id)
      const saved = await payloads.getSourceFilePayload('league', source.id)
      const expected = files.find(file => file.name === source.originalName)
      assert.deepEqual(saved.content, expected.bytes)
    }
    const nextDraft = await loadTripEditDraft(database, 'league')
    const removed = await editGpxTrip({ database, tripId: 'league', slots: nextDraft.slots.filter(slot => slot.customName !== 'Middle race'), idFactory: createIdFactory('remove'), now: () => '2027-02-03T08:00:00Z' })
    assert.equal(removed.ok, true, removed.message)
    assert.equal(removed.bundle.days.length, 2)
    assert.equal(removed.bundle.routes.length, 2)
    assert.equal(removed.bundle.calendar.startDate, '2027-05-24')
    assert.equal(validateTripBundle(removed.bundle).ok, true)
  } finally { database.close() }
})

test('a departure-only save invalidates only that course forecast and an unchanged schedule performs no save', async () => {
  const { database, bundle } = await setup()
  try {
    const prototype = createGenericTripBundle({ dated: true }).weather[0]
    bundle.weather = bundle.days.map((day, index) => ({ ...prototype, id: `forecast-${index}`, dayId: day.id, routePointId: null, forDate: day.date }))
    bundle.stages = bundle.stages.map(stage => ({ ...stage, weatherRecordIds: [bundle.weather.find(record => record.dayId === stage.dayId).id] }))
    const repository = createTripRepository(database)
    await repository.saveTripBundle(bundle)
    const unchanged = await updateTripPreferences({ database, tripId: 'league', update: { leagueEvents: [{ dayId: bundle.days[0].id, date: bundle.days[0].date, departureTime: '08:30' }] }, now: () => assert.fail('no timestamp for a no-op') })
    assert.equal(unchanged.ok, true)
    assert.equal(unchanged.noop, true)
    const edited = await updateTripPreferences({ database, tripId: 'league', update: { leagueEvents: [{ dayId: bundle.days[0].id, date: bundle.days[0].date, departureTime: '09:00' }] }, now: () => '2027-02-02T08:00:00Z' })
    assert.equal(edited.ok, true, edited.message)
    assert.equal(edited.invalidation.calendarChanged, false)
    assert.equal(edited.invalidation.timingChanged, true)
    assert.equal(edited.invalidation.weatherChanged, true)
    assert.deepEqual(edited.bundle.weather, [bundle.weather[1]])
    assert.deepEqual(edited.bundle.calendar, bundle.calendar)
    assert.equal(validateTripBundle(edited.bundle).ok, true)
  } finally { database.close() }
})

test('backup and copy restoration retain independent dates and source payloads', async () => {
  const { database, bundle } = await setup()
  try {
    const prepared = await prepareTripBackupRestore((await createTripBackup(database, NOW)).file)
    const ids = await restorePreparedTripBackup(database, prepared, createIdFactory('restore'), NOW)
    const restored = await createTripRepository(database).loadTripBundle(ids[0])
    assert.equal(selectOrganizationMode(restored), 'league')
    assert.deepEqual(restored.days, bundle.days)
    assert.deepEqual(restored.settings, bundle.settings)
    assert.equal(validateTripBundle(restored).ok, true)
    for (const source of restored.sourceFiles) assert.ok(await createSourceFileRepository(database).getSourceFilePayload(restored.metadata.id, source.id))
    assert.deepEqual(await createTripRepository(database).loadTripBundle('league'), bundle)
  } finally { database.close() }
})

test('POI searches are opt-in for League and do not leave its courses permanently pending', async () => {
  const { database, bundle } = await setup()
  try {
    const provider = { id: 'postpass-practical-places', async fetch() { assert.fail('no automatic POI request for a League') } }
    assert.equal(tripNeedsAutomaticEnrichment(bundle, { practicalPlacesProvider: provider }), false)
    assert.equal(deriveStagePreparationStatus(bundle, bundle.days[0].id, { ...NO_STAGE_PREPARATION_CONTEXT, practicalPlacesConfigured: true }), 'ready')
    const result = await runStoredTripAutomaticEnrichment({ database, tripId: 'league', practicalPlacesProvider: provider, now: fixedNow(), idFactory: createIdFactory() })
    assert.equal(result.practicalPlacesAttempted, false)
    const optedIn = { ...bundle, settings: { ...bundle.settings, global: { ...bundle.settings.global, leaguePoiSearchEnabled: true } } }
    assert.equal(selectAutomaticPoiSearch(optedIn), true)
    assert.equal(tripNeedsAutomaticEnrichment(optedIn, { practicalPlacesProvider: provider }), true)
  } finally { database.close() }
})

test('League month groups expose course dates and departure times while escaping user names', async () => {
  const { database, bundle } = await setup()
  try {
    bundle.stages[0].customName = '<img src=x onerror=alert(1)>'
    const html = renderLeagueCalendar(bundle)
    assert.match(html, /mai 2027/)
    assert.match(html, /10 mai · Départ 08:30/)
    assert.match(html, /24 mai · Départ 10:00/)
    assert.match(html, /&lt;img/)
    assert.doesNotMatch(html, /<img/)
    assert.equal((html.match(/data-action="open-day-detail"/g) ?? []).length, 2)
  } finally { database.close() }
})

test('League wizard needs event dates, not a global start date, and a new explicit Tour can return to Voyage', () => {
  const state = createEmptyWizardState()
  state.name = 'Season'; state.organizationMode = 'league'; state.raceMode = true
  assert.ok(formValidation(state).reasons.every(reason => !reason.includes('date de départ est requise')))
  state.structure = [{ kind: 'ride', key: 'event' }]
  assert.ok(formValidation(state).reasons.some(reason => reason.includes('date et l’heure')))
  const tour = createGenericTripBundle()
  tour.settings.global.organizationMode = 'tour'; tour.settings.global.raceMode = true
  assert.equal(selectOrganizationMode(applyRaceMode(tour, false)), 'voyage')
})
