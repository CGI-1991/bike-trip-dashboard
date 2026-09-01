import '../storage/indexeddb/support/setup-fake-indexeddb.mjs'

import assert from 'node:assert/strict'
import test from 'node:test'

import { createTripRepository } from '../../src/storage/indexeddb/trip-repository.ts'
import { createGenericTripBundle } from '../trip-core/support/generic-trip-fixture.mjs'
import { openTestDatabase } from '../storage/indexeddb/support/open-test-database.mjs'
import {
  applyTripPreferences,
  deriveTripPreferenceInvalidation,
  shiftTripStartDate,
  tripPreferencesUpdateIsNoop,
  TRIP_REFERENCE_SPEED_MAX_KPH,
  TRIP_REFERENCE_SPEED_MIN_KPH,
  updateTripPreferences,
  validateTripPreferencesUpdate,
} from '../../src/trips-manager/trip-preferences.ts'

// --- validateTripPreferencesUpdate (CDC D3.1 section 36) --------------------

test('validateTripPreferencesUpdate accepts an empty update and any single valid field', () => {
  assert.deepEqual(validateTripPreferencesUpdate({}), [])
  assert.deepEqual(validateTripPreferencesUpdate({ name: 'Roadtrip des Alpes' }), [])
  assert.deepEqual(validateTripPreferencesUpdate({ startDate: '2027-06-01' }), [])
  assert.deepEqual(validateTripPreferencesUpdate({ referenceSpeedKph: 18 }), [])
  assert.deepEqual(validateTripPreferencesUpdate({ terrainOverride: null }), [])
  assert.deepEqual(validateTripPreferencesUpdate({ terrainOverride: true }), [])
})

test('validateTripPreferencesUpdate: an empty or all-whitespace name is rejected', () => {
  assert.equal(validateTripPreferencesUpdate({ name: '' })[0]?.field, 'name')
  assert.equal(validateTripPreferencesUpdate({ name: '   ' })[0]?.field, 'name')
})

test('validateTripPreferencesUpdate: a name over 200 characters is rejected', () => {
  const errors = validateTripPreferencesUpdate({ name: 'A'.repeat(201) })
  assert.equal(errors.length, 1)
  assert.equal(errors[0].field, 'name')
})

test('validateTripPreferencesUpdate: an invalid ISO startDate is rejected', () => {
  assert.equal(validateTripPreferencesUpdate({ startDate: '2027-13-40' })[0]?.field, 'startDate')
  assert.equal(validateTripPreferencesUpdate({ startDate: 'not-a-date' })[0]?.field, 'startDate')
})

test('validateTripPreferencesUpdate: referenceSpeedKph outside [MIN, MAX] or non-finite is rejected', () => {
  assert.equal(validateTripPreferencesUpdate({ referenceSpeedKph: TRIP_REFERENCE_SPEED_MIN_KPH - 0.5 })[0]?.field, 'referenceSpeedKph')
  assert.equal(validateTripPreferencesUpdate({ referenceSpeedKph: TRIP_REFERENCE_SPEED_MAX_KPH + 0.5 })[0]?.field, 'referenceSpeedKph')
  assert.equal(validateTripPreferencesUpdate({ referenceSpeedKph: Number.NaN })[0]?.field, 'referenceSpeedKph')
  assert.deepEqual(validateTripPreferencesUpdate({ referenceSpeedKph: TRIP_REFERENCE_SPEED_MIN_KPH }), [])
  assert.deepEqual(validateTripPreferencesUpdate({ referenceSpeedKph: TRIP_REFERENCE_SPEED_MAX_KPH }), [])
})

test('validateTripPreferencesUpdate accumulates every issue rather than stopping at the first', () => {
  const errors = validateTripPreferencesUpdate({ name: '', startDate: 'bad', referenceSpeedKph: 999 })
  assert.deepEqual(errors.map((error) => error.field).sort(), ['name', 'referenceSpeedKph', 'startDate'])
})

// --- tripPreferencesUpdateIsNoop (CDC D3.1 section 29) -----------------------

test('tripPreferencesUpdateIsNoop: true for an empty update or one that only repeats the current values', () => {
  const bundle = createGenericTripBundle({ dated: true })
  assert.equal(tripPreferencesUpdateIsNoop(bundle, {}), true)
  assert.equal(tripPreferencesUpdateIsNoop(bundle, { name: bundle.metadata.name }), true)
  assert.equal(tripPreferencesUpdateIsNoop(bundle, { startDate: bundle.calendar.startDate }), true)
  assert.equal(tripPreferencesUpdateIsNoop(bundle, { referenceSpeedKph: bundle.settings.global.referenceSpeedKph }), true)
  assert.equal(tripPreferencesUpdateIsNoop(bundle, { terrainOverride: null }), true) // fixture has no mountainMode override
})

test('tripPreferencesUpdateIsNoop: false as soon as any single field genuinely differs', () => {
  const bundle = createGenericTripBundle({ dated: true })
  assert.equal(tripPreferencesUpdateIsNoop(bundle, { name: `${bundle.metadata.name} bis` }), false)
  assert.equal(tripPreferencesUpdateIsNoop(bundle, { startDate: '2028-01-01' }), false)
  assert.equal(tripPreferencesUpdateIsNoop(bundle, { referenceSpeedKph: bundle.settings.global.referenceSpeedKph + 1 }), false)
  assert.equal(tripPreferencesUpdateIsNoop(bundle, { terrainOverride: true }), false)
})

test('tripPreferencesUpdateIsNoop treats a name that only differs by surrounding whitespace as a no-op (trimmed comparison)', () => {
  const bundle = createGenericTripBundle({ dated: true })
  assert.equal(tripPreferencesUpdateIsNoop(bundle, { name: `  ${bundle.metadata.name}  ` }), true)
})

// --- shiftTripStartDate (CDC D3.1 sections 6-8) ------------------------------

test('shiftTripStartDate translates every dated day by the same offset, preserving each day\'s own index-derived date', () => {
  const bundle = createGenericTripBundle({ dated: true })
  const shifted = shiftTripStartDate(bundle, '2028-01-10')
  assert.equal(shifted.calendar.startDate, '2028-01-10')
  assert.deepEqual(shifted.days.map((day) => day.date), ['2028-01-10', '2028-01-11', '2028-01-12', '2028-01-13'])
  // Relative gaps (here: every day consecutive, index-based) are exactly preserved — only the anchor moved.
  assert.deepEqual(shifted.days.map((day) => day.index), bundle.days.map((day) => day.index))
  assert.equal(shifted.calendar.endDate, '2028-01-13')
  assert.equal(shifted.metadata.startDate, '2028-01-10')
  assert.equal(shifted.metadata.endDate, '2028-01-13')
})

test('shiftTripStartDate never touches structure: same day/stage/route ids, same types, same order', () => {
  const bundle = createGenericTripBundle({ dated: true })
  const shifted = shiftTripStartDate(bundle, '2028-01-10')
  assert.deepEqual(shifted.days.map((day) => day.id), bundle.days.map((day) => day.id))
  assert.deepEqual(shifted.days.map((day) => day.type), bundle.days.map((day) => day.type))
  assert.deepEqual(shifted.days.map((day) => day.stageId), bundle.days.map((day) => day.stageId))
  assert.deepEqual(shifted.stages.map((stage) => stage.id), bundle.stages.map((stage) => stage.id))
  assert.deepEqual(shifted.stages, bundle.stages) // date shift never re-touches stage timing/geometry
})

test('shiftTripStartDate clears stale weather (CDC section 8/26 — the editor never re-fetches, it only invalidates)', () => {
  const bundle = createGenericTripBundle({ dated: true })
  assert.ok(bundle.weather.length > 0)
  const shifted = shiftTripStartDate(bundle, '2028-01-10')
  assert.deepEqual(shifted.weather, [])
  assert.ok(shifted.stages.every((stage) => stage.weatherRecordIds.length === 0))
})

test('shiftTripStartDate is a no-op for a still-undated trip and for a date equal to the current one', () => {
  const undated = createGenericTripBundle({ dated: false })
  assert.equal(shiftTripStartDate(undated, '2028-01-10'), undated)
  const dated = createGenericTripBundle({ dated: true })
  assert.equal(shiftTripStartDate(dated, dated.calendar.startDate), dated)
})

// --- applyTripPreferences (CDC D3.1 section 17) ------------------------------

test('applyTripPreferences: name is trimmed, Unicode preserved, and applied without touching anything structural', () => {
  const bundle = createGenericTripBundle({ dated: true })
  const next = applyTripPreferences(bundle, { name: '  Randonnée à vélo — Été 2028 🚴  ' }, '2028-01-01T00:00:00.000Z')
  assert.equal(next.metadata.name, 'Randonnée à vélo — Été 2028 🚴')
  assert.equal(next.metadata.id, bundle.metadata.id)
  assert.equal(next.metadata.slug, bundle.metadata.slug)
  assert.deepEqual(next.days, bundle.days)
  assert.deepEqual(next.stages, bundle.stages)
  assert.equal(next.metadata.updatedAt, '2028-01-01T00:00:00.000Z')
})

test('applyTripPreferences: terrainOverride true/false sets settings.global.mountainMode, null clears it back to undefined (automatic)', () => {
  const bundle = createGenericTripBundle({ dated: true })
  assert.equal(applyTripPreferences(bundle, { terrainOverride: true }, 't').settings.global.mountainMode, true)
  assert.equal(applyTripPreferences(bundle, { terrainOverride: false }, 't').settings.global.mountainMode, false)
  const forced = applyTripPreferences(bundle, { terrainOverride: true }, 't')
  assert.equal(applyTripPreferences(forced, { terrainOverride: null }, 't2').settings.global.mountainMode, undefined)
})

test('applyTripPreferences: combining name + startDate + referenceSpeedKph applies all three in one pass', () => {
  const bundle = createGenericTripBundle({ dated: true })
  const next = applyTripPreferences(bundle, { name: 'Nouveau nom', startDate: '2028-03-01', referenceSpeedKph: 22 }, 'ts')
  assert.equal(next.metadata.name, 'Nouveau nom')
  assert.equal(next.calendar.startDate, '2028-03-01')
  assert.equal(next.settings.global.referenceSpeedKph, 22)
  assert.equal(next.metadata.updatedAt, 'ts')
})

test('applyTripPreferences: an update that changes nothing returns the exact same bundle reference (no spurious updatedAt bump)', () => {
  const bundle = createGenericTripBundle({ dated: true })
  assert.equal(applyTripPreferences(bundle, {}, 'ts'), bundle)
})

test('applyTripPreferences: a speed change never touches GPX/geometry/routePoints/climbs/sourceFiles (CDC section 10)', () => {
  const bundle = createGenericTripBundle({ dated: true })
  const next = applyTripPreferences(bundle, { referenceSpeedKph: 25 }, 'ts')
  assert.deepEqual(next.routes, bundle.routes)
  assert.deepEqual(next.routePoints, bundle.routePoints)
  assert.deepEqual(next.climbs, bundle.climbs)
  assert.deepEqual(next.sourceFiles, bundle.sourceFiles)
  assert.equal(next.settings.global.referenceSpeedKph, 25)
})

test('applyTripPreferences: automatic-mode stage timing is recomputed at the new speed, moving duration changes', () => {
  const bundle = createGenericTripBundle({ dated: true })
  const next = applyTripPreferences(bundle, { referenceSpeedKph: 30 }, 'ts')
  const originalStage1 = bundle.stages.find((stage) => stage.id === bundle.stages[0].id)
  const nextStage1 = next.stages.find((stage) => stage.id === originalStage1.id)
  assert.notEqual(nextStage1.movingDurationSeconds, originalStage1.movingDurationSeconds)
  assert.ok(nextStage1.movingDurationSeconds > 0)
  // Identity untouched by a speed change (CDC section 33).
  assert.equal(nextStage1.id, originalStage1.id)
  assert.equal(nextStage1.dayId, originalStage1.dayId)
  assert.equal(nextStage1.sourceRouteId, originalStage1.sourceRouteId)
})

test('applyTripPreferences: a stage with no usable distance/geometry (pending analysis) is left untouched by a speed change', () => {
  const bundle = createGenericTripBundle({ dated: true })
  const next = applyTripPreferences(bundle, { referenceSpeedKph: 30 }, 'ts')
  const originalStage2 = bundle.stages[1]
  const nextStage2 = next.stages.find((stage) => stage.id === originalStage2.id)
  assert.deepEqual(nextStage2, originalStage2)
})

test('applyTripPreferences: custom-mode pauseDurationSeconds is left untouched by a speed change, only moving/total duration move', () => {
  const bundle = createGenericTripBundle({ dated: true })
  const customBundle = {
    ...bundle,
    settings: {
      ...bundle.settings,
      stages: [{ stageId: bundle.stages[0].id, pausePlanMode: 'custom', pauses: bundle.settings.stages[0].pauses }],
    },
  }
  const next = applyTripPreferences(customBundle, { referenceSpeedKph: 30 }, 'ts')
  const nextStage1 = next.stages.find((stage) => stage.id === bundle.stages[0].id)
  assert.equal(nextStage1.pauseDurationSeconds, bundle.stages[0].pauseDurationSeconds)
  assert.notEqual(nextStage1.movingDurationSeconds, bundle.stages[0].movingDurationSeconds)
  assert.equal(nextStage1.totalDurationSeconds, nextStage1.movingDurationSeconds + nextStage1.pauseDurationSeconds)
})

// --- deriveTripPreferenceInvalidation (CDC D3.1 section 18) ------------------

test('deriveTripPreferenceInvalidation: a name-only change reports metadataChanged and nothing else', () => {
  const bundle = createGenericTripBundle({ dated: true })
  const next = applyTripPreferences(bundle, { name: 'Autre nom' }, 'ts')
  const invalidation = deriveTripPreferenceInvalidation(bundle, next)
  assert.equal(invalidation.metadataChanged, true)
  assert.equal(invalidation.calendarChanged, false)
  assert.equal(invalidation.timingChanged, false)
  assert.equal(invalidation.pauseRecommendationsChanged, false)
  assert.equal(invalidation.weatherChanged, false)
  assert.equal(invalidation.postpassChanged, false)
})

test('deriveTripPreferenceInvalidation: a startDate change reports calendarChanged + metadataChanged + weatherChanged, and pauseRecommendationsChanged follows calendarChanged', () => {
  const bundle = createGenericTripBundle({ dated: true })
  const next = applyTripPreferences(bundle, { startDate: '2028-05-01' }, 'ts')
  const invalidation = deriveTripPreferenceInvalidation(bundle, next)
  assert.equal(invalidation.calendarChanged, true)
  assert.equal(invalidation.metadataChanged, true)
  assert.equal(invalidation.weatherChanged, true)
  assert.equal(invalidation.pauseRecommendationsChanged, true)
  assert.equal(invalidation.timingChanged, false)
  assert.equal(invalidation.postpassChanged, false)
})

test('deriveTripPreferenceInvalidation: a speed change reports timingChanged and pauseRecommendationsChanged, never calendar/metadata/weather/postpass', () => {
  const bundle = createGenericTripBundle({ dated: true })
  const next = applyTripPreferences(bundle, { referenceSpeedKph: 28 }, 'ts')
  const invalidation = deriveTripPreferenceInvalidation(bundle, next)
  assert.equal(invalidation.timingChanged, true)
  assert.equal(invalidation.pauseRecommendationsChanged, true)
  assert.equal(invalidation.calendarChanged, false)
  assert.equal(invalidation.metadataChanged, false)
  assert.equal(invalidation.weatherChanged, false)
  assert.equal(invalidation.postpassChanged, false)
})

// --- updateTripPreferences orchestration (CDC D3.1 sections 17/19/28-29) ----

async function seededDatabase(bundle) {
  const database = await openTestDatabase()
  await createTripRepository(database).saveTripBundle(bundle)
  return database
}

test('updateTripPreferences: not-found trip returns an ok:false "not-found" result', async () => {
  const database = await openTestDatabase()
  try {
    const result = await updateTripPreferences({ database, tripId: 'does-not-exist', update: { name: 'X' }, now: () => 'ts' })
    assert.equal(result.ok, false)
    assert.equal(result.code, 'not-found')
  } finally {
    database.close()
  }
})

test('updateTripPreferences: invalid input is rejected before any load/save, with field errors returned', async () => {
  const bundle = createGenericTripBundle({ dated: true })
  const database = await seededDatabase(bundle)
  try {
    const result = await updateTripPreferences({ database, tripId: bundle.metadata.id, update: { name: '' }, now: () => 'ts' })
    assert.equal(result.ok, false)
    assert.equal(result.code, 'invalid-input')
    assert.equal(result.errors?.[0]?.field, 'name')
    const reloaded = await createTripRepository(database).loadTripBundle(bundle.metadata.id)
    assert.deepEqual(reloaded, bundle)
  } finally {
    database.close()
  }
})

test('updateTripPreferences: a genuine no-op update returns ok/noop without moving updatedAt or writing anything', async () => {
  const bundle = createGenericTripBundle({ dated: true })
  const database = await seededDatabase(bundle)
  try {
    const result = await updateTripPreferences({ database, tripId: bundle.metadata.id, update: {}, now: () => 'should-not-be-used' })
    assert.equal(result.ok, true)
    assert.equal(result.noop, true)
    assert.equal(result.bundle.metadata.updatedAt, bundle.metadata.updatedAt)
    assert.deepEqual(result.bundle, bundle)
  } finally {
    database.close()
  }
})

test('updateTripPreferences: setting a startDate on a still-undated trip is refused explicitly rather than silently doing nothing', async () => {
  const bundle = createGenericTripBundle({ dated: false })
  const database = await seededDatabase(bundle)
  try {
    const result = await updateTripPreferences({ database, tripId: bundle.metadata.id, update: { startDate: '2028-01-01' }, now: () => 'ts' })
    assert.equal(result.ok, false)
    assert.equal(result.code, 'invalid-input')
  } finally {
    database.close()
  }
})

test('updateTripPreferences: a name-only save is a single atomic write that preserves every entity id (CDC sections 5/17/33)', async () => {
  const bundle = createGenericTripBundle({ dated: true })
  const database = await seededDatabase(bundle)
  try {
    const result = await updateTripPreferences({ database, tripId: bundle.metadata.id, update: { name: 'RGA 2028' }, now: () => '2028-01-01T00:00:00.000Z' })
    assert.equal(result.ok, true)
    assert.equal(result.noop, false)
    assert.equal(result.bundle.metadata.name, 'RGA 2028')
    assert.equal(result.bundle.metadata.updatedAt, '2028-01-01T00:00:00.000Z')
    assert.deepEqual(result.bundle.days.map((day) => day.id), bundle.days.map((day) => day.id))
    assert.deepEqual(result.bundle.stages.map((stage) => stage.id), bundle.stages.map((stage) => stage.id))
    assert.deepEqual(result.bundle.routes.map((route) => route.id), bundle.routes.map((route) => route.id))
    assert.deepEqual(result.bundle.sourceFiles.map((sourceFile) => sourceFile.id), bundle.sourceFiles.map((sourceFile) => sourceFile.id))
    assert.equal(result.bundle.metadata.id, bundle.metadata.id)
    assert.equal(result.bundle.metadata.slug, bundle.metadata.slug)
    // Never touched by a preferences save (CDC section 2's own regression target).
    assert.equal(result.bundle.settings.global.pausePlanMode, bundle.settings.global.pausePlanMode)
    assert.deepEqual(result.bundle.settings.stages, bundle.settings.stages)

    const reloaded = await createTripRepository(database).loadTripBundle(bundle.metadata.id)
    assert.deepEqual(reloaded, result.bundle)
  } finally {
    database.close()
  }
})

test('updateTripPreferences: a startDate save shifts every day, clears weather, and never rebuilds structure/GPX (CDC section 32)', async () => {
  const bundle = createGenericTripBundle({ dated: true })
  const database = await seededDatabase(bundle)
  try {
    const result = await updateTripPreferences({ database, tripId: bundle.metadata.id, update: { startDate: '2028-09-01' }, now: () => 'ts' })
    assert.equal(result.ok, true)
    assert.deepEqual(result.bundle.days.map((day) => day.date), ['2028-09-01', '2028-09-02', '2028-09-03', '2028-09-04'])
    assert.deepEqual(result.bundle.days.map((day) => day.id), bundle.days.map((day) => day.id))
    assert.deepEqual(result.bundle.routePoints, bundle.routePoints)
    assert.deepEqual(result.bundle.practicalPlaces, bundle.practicalPlaces)
    assert.deepEqual(result.bundle.weather, [])
    assert.equal(result.invalidation.calendarChanged, true)
    assert.equal(result.invalidation.postpassChanged, false)
  } finally {
    database.close()
  }
})

test('updateTripPreferences: a referenceSpeedKph save recomputes timing locally and reports it via the invalidation report', async () => {
  const bundle = createGenericTripBundle({ dated: true })
  const database = await seededDatabase(bundle)
  try {
    const result = await updateTripPreferences({ database, tripId: bundle.metadata.id, update: { referenceSpeedKph: 26 }, now: () => 'ts' })
    assert.equal(result.ok, true)
    assert.equal(result.bundle.settings.global.referenceSpeedKph, 26)
    assert.notEqual(result.bundle.stages[0].movingDurationSeconds, bundle.stages[0].movingDurationSeconds)
    assert.equal(result.invalidation.timingChanged, true)
    assert.equal(result.invalidation.postpassChanged, false)
    // Structure/GPX/routes untouched (CDC section 10).
    assert.deepEqual(result.bundle.routes, bundle.routes)
    assert.deepEqual(result.bundle.climbs, bundle.climbs)
  } finally {
    database.close()
  }
})

test('updateTripPreferences: a terrainOverride save round-trips through storage and back', async () => {
  const bundle = createGenericTripBundle({ dated: true })
  const database = await seededDatabase(bundle)
  try {
    const result = await updateTripPreferences({ database, tripId: bundle.metadata.id, update: { terrainOverride: true }, now: () => 'ts' })
    assert.equal(result.ok, true)
    assert.equal(result.bundle.settings.global.mountainMode, true)
    const reloaded = await createTripRepository(database).loadTripBundle(bundle.metadata.id)
    assert.equal(reloaded.settings.global.mountainMode, true)
  } finally {
    database.close()
  }
})
